import Controller from './Controller'
import Mapper, { MapperClass } from './Mapper'
import { sha1, shortHash } from './helpers'
import WebNote from './WebNote'
import { App, DebugOption, serverError, ServerErrors } from '../types'
import Log from './Log'
import { dateToSqlite, now, SQLite } from './Database'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { appInstance } from '../index'
import { userFilesFolder } from '../paths'
import { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { randomUUID } from 'node:crypto'
import { SlugError, SlugPublication, validateSlug } from './custom-slugs'
import { withFileLock } from './file-lock'
import { ContentfulStatusCode } from 'hono/dist/types/utils/http-status'

export const fileExtensionWhitelist = [
  // HTML
  'html', 'css',
  // Images
  'jpg', 'jpeg', 'png', 'webp', 'svg', 'gif',
  // Video
  'webm',
  // Fonts
  'ttf', 'otf', 'woff', 'woff2'
]

// Length of the base36 filenames (html length is configurable via FILENAME_LENGTH_HTML)
const filenameLengths: { [key: string]: number } = {
  default: 20
}

interface CheckFileItem {
  filetype: string;
  hash: string;
  byteLength: number;
}

type CheckFileResult = {
  success: boolean;
  url: string | null;
}

export default class File extends Controller {
  // From the Controller:
  // app
  // post
  // user
  db: SQLite
  filename: string = ''
  extension: string = ''
  hash: string
  byteLength: number
  paths: Paths
  private initialised = false
  private file?: MapperClass
  private cssFilename?: string
  private publication?: SlugPublication
  private newPublication = false
  private reservedFileId?: number

  constructor (c: Context) {
    super(c)
    this.db = appInstance.db
    this.hash = this.post.hash
    this.paths = new Paths(appInstance)
    this.byteLength = this.post.byteLength
  }

  checkPostFilenameAndExtension () {
    if (this.post.filename !== undefined && typeof this.post.filename !== 'string') throw new HTTPException(400)
    // File extension must be in our whitelist
    if (typeof this.post.filetype === 'string' && this.post.filetype?.length) {
      this.extension = this.post.filetype as string
    } else {
      this.extension = 'Unknown'
    }
    if (!fileExtensionWhitelist.includes(this.extension)) {
      throw new HTTPException(415, {
        message: `Unsupported media type ${this.extension.toUpperCase()}, please open an issue on Github`
      })
    }

    if (this.post.filename && this.extension === 'html') {
      // Custom names are looked up before legacy filename parsing, which strips dots.
      const publication = this.db.prepare(`
        SELECT s.*, f.filename, f.users_id, f.expires FROM custom_slugs s
        JOIN files f ON f.id = s.files_id WHERE s.slug = ? OR f.filename = ?
      `).get(this.post.filename, this.post.filename) as SlugPublication | undefined
      if (publication) {
        if (this.post.filename !== publication.slug) throw new SlugError(409, { message: 'Use the public slug and its publication identifier to modify this note.' })
        this.filename = publication.filename
        this.publication = publication
        return
      }
      if (this.post.publicationId !== undefined || this.post.customSlug !== undefined) {
        validateSlug(this.post.filename)
        this.filename = this.post.filename
        return
      }
    }

    if (this.post.filename) {
      // Perform basic sanity check on the filename
      let filename = this.post.filename
      if (typeof filename !== 'string') {
        throw new HTTPException(400) // Bad request
      }

      if (filename.includes('.')) {
        // Legacy filename type, extract just the first part
        filename = filename.split('.')[0]
      }

      if (this.extension === 'html' && this.db.prepare('SELECT 1 FROM custom_slugs s JOIN files f ON f.id = s.files_id WHERE f.filename = ? OR s.slug = ?').get(filename, filename)) {
        throw new SlugError(409, { message: 'Use the exact public slug and its publication identifier to modify this note.' })
      }
      // Filename must be lowercase alphanumeric
      if (filename.match(/[^a-z0-9]/) || !filename.length) {
        throw new HTTPException(400) // Bad request
      }

      // Store the incoming filename
      this.filename = filename
    }
  }

  /**
   * Get an existing file DB object or return a new empty one
   */
  async initFile (createIfNotExist = true) {
    if (this.initialised) return

    // All requests must include the SHA1 (40 chars)
    if (this.hash?.length !== 40 || this.hash?.match(/[^a-f0-9]/)) {
      throw new HTTPException(463 as ContentfulStatusCode) // Bad request
    }

    this.checkPostFilenameAndExtension()
    if (this.extension !== 'html' && (this.post.customSlug !== undefined || this.post.publicationId !== undefined)) {
      throw new SlugError(400, { message: 'Custom slugs are only supported for HTML notes.' })
    }

    // Check if the file exists
    this.file = await Mapper(this.app.db, 'files')
    if (this.extension === 'html') {
      /*
       * HTML files
       */

      // If the HTML note file already exists, check that the owner is the current user.
      // This only applies to HTML files - as users can reference other assets
      // no matter who uploaded them.

      if (this.post.customSlug !== undefined || this.post.publicationId !== undefined || this.publication) {
        await this.initSlug()
        this.initialised = true
        return
      }
      const userProvidedName = !!this.filename
      if (!userProvidedName && createIfNotExist) {
        // No filename provided and we want to create a new one
        this.filename = await this.getHashFilename(this.extension)
      } else if (!userProvidedName && !createIfNotExist) {
        // No name provided and we don't want to create one, so fail
        throw new HTTPException(400) // Bad request
      }
      // Find records which match this filename and extension
      await this.file.load({
        filename: this.filename,
        filetype: this.extension
      })
      if (this.file.found && this.file.row.users_id !== this.user.row.id) {
        // User doesn't own this note
        if (createIfNotExist) {
          this.filename = await this.getHashFilename(this.extension)
        } else {
          // We don't want to create a new file, so fail as the user does not own this file
          throw new HTTPException(403) // Delete your existing share link
        }
      } else if (userProvidedName && this.file.notFound) {
        // The user has sent a name but it's not found in the DB.
        // We don't want them using some random name so create a new one.
        if (createIfNotExist) {
          this.filename = await this.getHashFilename(this.extension)
        } else {
          throw new HTTPException(403) // Delete your existing share link
        }
      }
      // Now that we've created a new filename, check again to see if it
      // matches an existing upload for a different user.
      await this.file.load({
        filename: this.filename,
        filetype: this.extension
      })
      if (this.file.found && this.file.row.users_id !== this.user.row.id) {
        throw new HTTPException(403) // Delete your existing share link
      }
    } else if (this.extension === 'css') {
      /*
       * CSS is special, as it uses the user's UID for the filename
       */
      this.filename = await this.getCssFilename()
      await this.file.load({
        filetype: this.extension,
        filename: this.filename
      })
    } else {
      /*
       * Other file-types, not HTML
       */

      // Files other than HTML can be re-used by multiple people without re-uploading.
      // If we find a file matching that filehash, then return the link for use.

      await this.file.load({
        filetype: this.extension,
        hash: this.hash
      })
      if (this.file.found) {
        this.filename = this.file.row.filename
        return this.returnSuccessUrl()
      } else if (!createIfNotExist) {
        // Not certain what circumstance we wouldn't want to create an asset file,
        // but I'm including the `createIfNotExist` here for completeness
        throw new HTTPException(404)
      } else {
        // No existing file found - generate a new filename
        this.filename = await this.getHashFilename(this.extension)
      }
    }

    if (this.extension === 'html' && this.file.notFound) {
      this.reserveNote()
    }
    // Successful result
    this.initialised = true
  }

  private reserveNote (slug?: string) {
    const reservation = this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM custom_slugs WHERE slug = ?').get(this.filename)) {
        throw new SlugError(409, { message: 'This URL is already in use. Try sharing again.' })
      }
      if (slug && this.db.prepare("SELECT 1 FROM files WHERE filename = ? AND filetype = 'html'").get(slug)) {
        throw new SlugError(409, { message: 'This slug is already in use. Choose another slug.' })
      }
      const result = this.db.prepare("INSERT INTO files (users_id, filename, filetype, expires) VALUES (?, ?, 'html', ?)").run(this.user.row.id, this.filename, this.getExpiration())
      const fileId = Number(result.lastInsertRowid)
      let publication: SlugPublication | undefined
      if (slug) {
        const id = randomUUID()
        this.db.prepare('INSERT INTO custom_slugs (slug, files_id, publication_id) VALUES (?, ?, ?)').run(slug, fileId, id)
        publication = { slug, files_id: fileId, publication_id: id, filename: this.filename, users_id: this.user.row.id, expires: this.getExpiration() ?? null }
      }
      return { fileId, publication }
    })()
    this.reservedFileId = reservation.fileId
    this.publication = reservation.publication
    this.newPublication = true
    // Reload without an asynchronous gap after the namespace reservation.
    this.file!.row = this.db.prepare('SELECT * FROM files WHERE id = ?').get(this.reservedFileId) as Record<string, any>
  }

  private async initSlug (): Promise<void> {
    const slug = this.post.customSlug ?? this.publication?.slug ?? this.post.filename
    validateSlug(slug)
    if (this.post.publicationId !== undefined && typeof this.post.publicationId !== 'string') {
      throw new SlugError(400, { message: 'Invalid publication identifier.' })
    }
    const original = this.db.prepare('SELECT s.slug FROM custom_slugs s JOIN files f ON f.id = s.files_id WHERE s.publication_id = ? AND (f.expires IS NULL OR f.expires > ?)').get(this.post.publicationId ?? '', now()) as { slug: string } | undefined
    if (original && original.slug !== slug) throw new SlugError(409, { message: 'The slug of an active publication cannot be changed.' })
    if (this.post.filename !== undefined && this.post.filename !== slug) {
      throw new SlugError(409, { message: 'The slug of a shared note cannot be changed.' })
    }
    if (this.publication && this.publication.expires !== null && this.publication.expires <= now()) {
      const old = this.publication
      // Different backing files and id-scoped deletes protect a subsequent claim.
      this.db.prepare('DELETE FROM custom_slugs WHERE files_id = ?').run(old.files_id)
      this.db.prepare('DELETE FROM files WHERE id = ?').run(old.files_id)
      try { await unlink(this.paths.fullFilePath(old.filename, 'html').filePath) } catch {}
      await this.app.cloudflare.purgeCache([this.paths.displayUrl(old.slug, 'html')])
      this.publication = undefined
    }
    if (!this.publication) {
      this.publication = this.db.prepare(`
        SELECT s.*, f.filename, f.users_id, f.expires FROM custom_slugs s
        JOIN files f ON f.id = s.files_id WHERE s.slug = ?
      `).get(slug) as SlugPublication | undefined
      if (this.publication && this.publication.expires !== null && this.publication.expires <= now()) {
        // Expiry also releases a slug for a first-time claimant.
        return this.initSlug()
      }
    }
    if (this.publication) {
      if (this.post.filename !== slug || this.post.publicationId !== this.publication.publication_id) {
        throw new SlugError(409, { message: 'This slug is already in use, or this publication is stale. Choose another slug for a new share.' })
      }
      if (this.publication.users_id !== this.user.row.id) throw new SlugError(403, { message: 'You do not own this publication.' })
      this.filename = this.publication.filename
      await this.file!.load({ id: this.publication.files_id })
      return
    }
    if (!this.app.allowCustomSlugs) throw new SlugError(400, { message: 'Custom slug creation is disabled. Enable ALLOW_CUSTOM_SLUGS on your server.' })
    // Existing random URLs cannot be converted into slugs through this API.
    if (this.post.filename && !this.post.publicationId) throw new SlugError(409, { message: 'An existing shared URL cannot be changed into a custom slug.' })
    const expiredRandom = this.db.prepare("SELECT id, filename FROM files WHERE filename = ? AND filetype = 'html' AND expires IS NOT NULL AND expires <= ?").get(slug, now()) as { id: number, filename: string } | undefined
    if (expiredRandom) {
      this.db.prepare('DELETE FROM files WHERE id = ?').run(expiredRandom.id)
      try { await unlink(this.paths.fullFilePath(expiredRandom.filename, 'html').filePath) } catch {}
      await this.app.cloudflare.purgeCache([this.paths.displayUrl(slug, 'html')])
    }
    do { this.filename = await this.getHashFilename('html') } while (this.filename === slug)
    try {
      this.reserveNote(slug)
    } catch (error) {
      if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new SlugError(409, { message: 'This slug is already in use. Choose another slug.' })
      }
      throw error
    }
  }

  async createNote () {
    return withFileLock(async () => {
      try {
        return await this.createNoteUnlocked()
      } catch (error) {
        if (this.reservedFileId) {
          this.db.prepare('DELETE FROM custom_slugs WHERE files_id = ?').run(this.reservedFileId)
          this.db.prepare('DELETE FROM files WHERE id = ?').run(this.reservedFileId)
          try { await unlink(this.getFullFilePath().filePath) } catch {}
        }
        throw error
      }
    })
  }

  private async createNoteUnlocked () {
    await this.initFile()

    const note = new WebNote(this.app)
    const template = this.post.template

    // Make replacements
    note.setCss(this.getDisplayUrl(await this.getCssFilename(), 'css'))
    note.setWidth(template.width)
    note.enableMathjax(!!template.mathJax)

    // Add note contents
    if (template.encrypted === false) {
      // Unencrypted plaintext contents
      note.addUnencryptedContents(template.content)
      note.setTitle(template.title)
      note.setMetaDescription(template.description)
    } else {
      // Encrypted contents
      note.addEncryptedData(template.content, this.context.get('pluginVersion'))
    }

    if (Array.isArray(template.elements)) {
      template.elements.forEach((el: any) => {
        note.setClassAndStyle(el?.element, el?.classes, el?.style)
      })
    }

    // We need to get the hash of the final contents. The use of sha1 came from originally
    // using Backblaze B2 as the storage target, and that was their required format.
    const contents = note.contents()
    this.hash = await sha1(contents)

    // Upload the new note
    await this.saveFile(contents)

    const result: { [key: string]: any } = this.returnSuccessUrl()

    // Add debugging options if any
    if (this.extension === 'html' && this.post.debug === DebugOption.returnHtml) {
      result.html = contents
    }

    return result
  }

  async deleteFile () {
    return withFileLock(() => this.deleteFileUnlocked())
  }

  private async deleteFileUnlocked () {
    // Only HTML notes for now
    if (this.post.filetype !== 'html') {
      throw new HTTPException(404)
    }

    // Check the incoming filename and extension, and fail if necessary
    this.checkPostFilenameAndExtension()

    if (this.publication) {
      if (this.post.publicationId !== this.publication.publication_id) throw new SlugError(409, { message: 'This publication is stale or its identifier is missing. Nothing was deleted.' })
      if (this.publication.users_id !== this.user.row.id) throw new SlugError(403, { message: 'You do not own this publication.' })
    } else if (this.post.publicationId !== undefined || this.filename.includes('-')) {
      throw new SlugError(409, { message: 'This publication has expired or was deleted. Nothing was deleted.' })
    }

    // Check the file exists and is owned by this user
    this.file = await Mapper(this.app.db, 'files')
    await this.file.load({
      filename: this.filename,
      filetype: this.extension
    })

    if (this.extension === 'html' && this.file.found && this.file.row.users_id === this.user.row.id) {
      // File exists and this user owns the file

      // Delete the file
      try {
        await unlink(this.getFullFilePath().filePath)
      } catch {
      }

      // Clear from Cloudflare cache
      await this.app.cloudflare.purgeCache([this.getDisplayUrl()])

      // Finally, delete the reference from our DB
      this.db.prepare('DELETE FROM custom_slugs WHERE files_id = ?').run(this.file.row.id)
      this.db
        .prepare('DELETE FROM files WHERE filetype = \'html\' AND filename = ?')
        .run(this.filename)
    }

    return {
      success: true
    }
  }

  async upload () {
    await this.initFile()

    try {
      await this.saveFile(Buffer.from(this.post.content))
    } catch (e) {
      const status = serverError(ServerErrors.FILE_FAILED_TO_UPLOAD)
      Log.event(this.context, {
        status,
        data: JSON.stringify(e)
      })
      throw new HTTPException(status)
    }

    return this.returnSuccessUrl()
  }

  async saveFile (contents: string | Buffer) {
    if (!this.file) {
      throw new HTTPException(serverError(ServerErrors.FILE_FAILED_TO_INIT))
    }

    const {
      folder,
      filePath
    } = this.getFullFilePath()

    // Create the folder if needed, then save the file
    try {
      await mkdir(folder, { recursive: true })
      await writeFile(filePath, contents)
    } catch (e) {
      console.log(e)
      throw new HTTPException(serverError(ServerErrors.FILE_FAILED_TO_SAVE))
    }

    // Purge the cached asset from Cloudflare
    await this.app.cloudflare.purgeCache([
      this.getDisplayUrl(),
      this.getFileUrl()
    ])
    const date = now()
    const isNew = this.file.notFound || this.newPublication
    if (isNew) {
      // This is a new record
      this.file.set({
        users_id: this.user.row.id,
        filename: this.filename,
        filetype: this.extension,
        created: date
      })
    }
    this.file.set({
      bytes: typeof contents === 'string' ? contents.length : contents.byteLength,
      encrypted: this?.post?.template?.encrypted ? 1 : 0,
      expires: this.getExpiration(),
      hash: this.hash,
      updated: date
    })
    if (!(this.file.save())) {
      throw new HTTPException(serverError(ServerErrors.FILE_FAILED_TO_SAVE))
    }

    if (this.extension === 'html') {
      const col = isNew ? 'new_notes' : 'updated_notes'
      this.db.prepare(
        `INSERT INTO shares_daily (date, ${col}) VALUES (unixepoch(date('now')), 1)
         ON CONFLICT(date) DO UPDATE SET ${col} = ${col} + 1`
      ).run()
    }

    return this.file.row
  }

  hydrate (filename?: string, extension?: string) {
    return {
      filename: filename || this.filename,
      extension: extension || this.extension
    }
  }

  /**
   * This is the URL which will be provided to a visitor. HTML files are
   * without extension and at the root of the env.BASE_WEB_URL
   */
  getDisplayUrl (optionalFilename?: string, optionalExtension?: string) {
    const {
      filename,
      extension
    } = this.hydrate(optionalFilename, optionalExtension)
    return this.paths.displayUrl(extension === 'html' && !optionalFilename && this.publication ? this.publication.slug : filename, extension)
  }

  /**
   * This is the actual full URL of the asset; unlike getDisplayUrl()
   * which is the URL given to visitors
   */
  getFileUrl (optionalFilename?: string, optionalExtension?: string) {
    const {
      filename,
      extension
    } = this.hydrate(optionalFilename, optionalExtension)
    return this.paths.fileUrl(filename, extension)
  }

  /**
   * The CSS filename is a salted hash of the UID
   */
  async getCssFilename () {
    if (!this.cssFilename) {
      this.cssFilename = await shortHash(this.app.hashSalt + (this.user?.row?.uid || Date.now()))
    }
    return this.cssFilename
  }

  async checkCss () {
    const file = await Mapper(this.app.db, 'files')
    await file.load({
      filename: await this.getCssFilename(),
      filetype: 'css'
    })
    return {
      success: !!file?.found
    }
  }

  /**
   * Check to see if a file matching this exact contents is already uploaded on the server
   */
  async checkFile (item?: CheckFileItem): Promise<CheckFileResult> {
    const params: { [key: string]: string } = {
      filetype: item?.filetype || this.post.filetype,
      hash: item?.hash || this.post.hash
    }
    if (params.filetype === 'css') {
      // CSS files also need to match on salted UID
      params.filename = await this.getCssFilename()
    }
    const file = await Mapper(this.app.db, 'files')
    if (params.filetype && params.hash) {
      await file.load(params)
      if (file.found) {
        const url = this.getDisplayUrl(file.row.filename, file.row.filetype)
        return this.returnSuccessUrl(url)
      }
    }
    return {
      success: false,
      url: null
    }
  }

  async checkFiles () {
    const result = []

    // Check the incoming files
    for (const file of this.post.files || []) {
      const res = await this.checkFile(file)
      file.url = res.url
      result.push(file)
    }

    // Get the info on the user's CSS (if exists)
    const css = await Mapper(this.app.db, 'files')
    await css.load({
      filename: await this.getCssFilename(),
      filetype: 'css'
    })

    return {
      success: true,
      files: result,
      capabilities: { customSlugs: this.app.allowCustomSlugs },
      css: css.notFound
        ? null
        : {
            url: this.getDisplayUrl(await this.getCssFilename(), 'css'),
            hash: css.row.hash
          }
    }
  }

  /**
   * Generate a random base36 filename for the given extension, guaranteed not to
   * collide with an existing row in the `files` table.
   *
   * The length comes from `filenameLength(extension)` (configurable for `html`
   * via `FILENAME_LENGTH_HTML`). Random generation can collide, especially at
   * short lengths, so we retry until we find a free slot.
   *
   * @throws HTTPException(500) if no free filename is found after
   *   `filenameMaxAttempts` tries - the filename space is too saturated for the
   *   configured length and `FILENAME_LENGTH_HTML` should be increased.
   */
  async getHashFilename (extension: string) {
    const filenameMaxAttempts = 10 // Cap on retries when generating a unique random filename
    const length = this.filenameLength(extension)
    const check = this.db.prepare('SELECT 1 FROM files WHERE filename = ?')
    for (let attempt = 0; attempt < filenameMaxAttempts; attempt++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length))
      let name = ''
      for (let i = 0; i < bytes.length; i++) {
        // 0.140625 = 36 / 256
        name += Math.floor(bytes[i] * 0.140625).toString(36)
      }
      if (!check.get(name) && !this.db.prepare('SELECT 1 FROM custom_slugs WHERE slug = ?').get(name)) {
        return name
      }
    }
    // Filename space is too saturated to find a free slot - bump FILENAME_LENGTH_HTML
    throw new HTTPException(500)
  }

  /**
   * Get the expiration datetime for this file, if any
   */
  getExpiration () {
    const expires = this?.post?.expiration
    if (expires) {
      // Convert from Javascript milliseconds to SQLite datetime
      return dateToSqlite(new Date(expires))
    }
    return null
  }

  returnSuccessUrl (url?: string) {
    return {
      success: true,
      url: url || this.getDisplayUrl(),
      ...(this.publication && { publicationId: this.publication.publication_id })
    }
  }

  /**
   * Get the correct filename length for a file-type.
   * Will use this.extension if no extension provided.
   */
  filenameLength (optionalExtension?: string) {
    const { extension } = this.hydrate(undefined, optionalExtension)
    if (extension === 'html') {
      return this.app.filenameLengthHtml
    }
    return filenameLengths[extension] || filenameLengths.default
  }

  /**
   * Split files into subfolders based off the first 2 characters in the filename.
   * Does not have a leading or trailing slash.
   *
   * Returns 'note/d6' etc.
   */
  folderPath (optionalFilename?: string, optionalExtension?: string) {
    const {
      filename,
      extension
    } = this.hydrate(optionalFilename, optionalExtension)
    // Split files into subfolders based off the first 2 characters in the filename
    return this.paths.folderPath(filename, extension)
  }

  getFullFilePath (optionalFilename?: string, optionalExtension?: string) {
    const {
      filename,
      extension
    } = this.hydrate(optionalFilename, optionalExtension)
    return this.paths.fullFilePath(filename, extension)
  }
}

export class Paths {
  app: App

  constructor (app: App) {
    this.app = app
  }

  folderPath (filename: string, extension: string) {
    const length = this.app.folderPrefix
    const subdir = length ? '/' + filename.substring(0, length) : ''
    switch (extension) {
      case 'html':
        return `notes${subdir}`
      case 'css':
        return `css${subdir}`
      default:
        return `files${subdir}`
    }
  }

  fullFilePath (filename: string, extension: string) {
    const folder = userFilesFolder + '/' + this.folderPath(filename, extension)
    return {
      folder,
      filePath: folder + '/' + filename + '.' + extension
    }
  }

  displayUrl (filename: string, extension: string) {
    if (extension === 'html') {
      // No extension or path for HTML files
      return this.app.baseWebUrl + '/' + filename
    } else {
      return this.fileUrl(filename, extension)
    }
  }

  fileUrl (filename: string, extension: string) {
    return [
      this.app.baseWebUrl,
      this.folderPath(filename, extension),
      filename + '.' + extension
    ].join('/')
  }
}

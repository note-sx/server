import Controller from './Controller'
import Mapper, { MapperClass } from './Mapper'
import { sha1, shortHash } from './helpers'
import WebNote from './WebNote'
import { App, DebugOption, serverError, ServerErrors } from '../types'
import Log from './Log'
import { dateToSqlite, now, SQLite } from './Database'
import * as fs from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import { appInstance } from '../index'
import { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
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

// Length of the base36 filenames
const filenameLengths: { [key: string]: number } = {
  html: 8,
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

  constructor (c: Context) {
    super(c)
    this.db = appInstance.db
    this.hash = this.post.hash
    this.paths = new Paths(appInstance)
    this.byteLength = this.post.byteLength
  }

  checkPostFilenameAndExtension () {
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

      // Filename must be lowercase alphanumeric
      filename = filename.replace(/[^a-z0-9]/g, '')

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

    // Check if the file exists
    this.file = await Mapper(this.app.db, 'files')
    if (this.extension === 'html') {
      /*
       * HTML files
       */

      // If the HTML note file already exists, check that the owner is the current user.
      // This only applies to HTML files - as users can reference other assets
      // no matter who uploaded them.

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

    // Successful result
    this.initialised = true
  }

  async createNote () {
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
      note.addEncryptedData(template.content)
    }

    if (Array.isArray(template.elements)) {
      template.elements.forEach((el: any) => {
        note.setClassAndStyle(el?.element, el?.classes, el?.style)
      })
    }

    // We need to get the hash of the final contents, as it will be used
    // by Backblaze upload
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
    // Only HTML notes for now
    if (this.post.filetype !== 'html') {
      throw new HTTPException(404)
    }

    // Check the incoming filename and extension, and fail if necessary
    this.checkPostFilenameAndExtension()

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
      } catch (e) {
      }

      // Clear from Cloudflare cache
      await this.app.cloudflare.purgeCache([this.getDisplayUrl()])

      // Finally, delete the reference from our DB
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

    // Create the directory if it does not exist
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true })
    }

    // Save the file to disk
    try {
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
    if (this.file.notFound) {
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
    return this.paths.displayUrl(filename, extension)
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
      css: css.notFound ? null : {
        url: this.getDisplayUrl(await this.getCssFilename(), 'css'),
        hash: css.row.hash
      }
    }
  }

  async getHashFilename (extension: string) {
    const bytes = crypto.getRandomValues(new Uint8Array(this.filenameLength(extension)))
    let name = ''
    for (let i = 0; i < bytes.length; i++) {
      // 0.140625 = 36 / 256
      name += Math.floor(bytes[i] * 0.140625).toString(36)
    }
    return name
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
      url: url || this.getDisplayUrl()
    }
  }

  /**
   * Get the correct filename length for a file-type.
   * Will use this.extension if no extension provided.
   */
  filenameLength (optionalExtension?: string) {
    const { extension } = this.hydrate(undefined, optionalExtension)
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
    const folder = this.app.baseFolder + '/userfiles/' + this.folderPath(filename, extension)
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

import { App } from '../types'
import { readFileSync } from 'node:fs'
import { checkVersion } from './helpers'

const htmlTemplate = readFileSync('./src/v1/templates/note.html', 'utf8')
const decryptionFunctions = '<script>' + readFileSync('./src/v1/templates/decrypt.js', 'utf8') + '</script>'
const decryptionFunctions_v1_1_3 = '<script>' + readFileSync('./src/v1/templates/decrypt-v1.1.3.js', 'utf8') + '</script>'
const plaintextFunctions = '<script>initDocument();</script>'

export default class WebNote {
  app: App
  private placeholders: { [key: string]: string } = {
    css: 'TEMPLATE_CSS',
    width: 'TEMPLATE_WIDTH',
    title: 'TEMPLATE_TITLE',
    ogTitle: 'TEMPLATE_OG_TITLE',
    metaDescription: 'TEMPLATE_META_DESCRIPTION',
    encryptedData: 'TEMPLATE_ENCRYPTED_DATA',
    noteContent: 'TEMPLATE_NOTE_CONTENT',
    scripts: 'TEMPLATE_SCRIPTS',
    assetsWebroot: 'TEMPLATE_ASSETS_WEBROOT',
    decryptionFunctions: 'TEMPLATE_DECRYPTION_FUNCTIONS'
  }
  private elements: { [key: string]: string } = {
    html: 'TEMPLATE_HTML',
    body: 'TEMPLATE_BODY',
    preview: 'TEMPLATE_PREVIEW',
    pusher: 'TEMPLATE_PUSHER'
  }
  private html: string

  constructor (app: App) {
    this.app = app
    this.html = htmlTemplate
    this.replace(this.placeholders.assetsWebroot, this.app.baseWebUrl + '/assets')
  }

  /**
   * Turn any value into a string
   */
  stringify (value: any): string {
    return (typeof value === 'string') ? value : ''
  }

  replace (variable: string, value: string) {
    this.html = this.html.replace(new RegExp(variable, 'g'), value)
  }

  /**
   * Remove any double-quotes or newlines from a string,
   * to make it safe to use in an HTML attribute
   */
  htmlQuote (string: string): string {
    return string
      .replace(/\s+/g, ' ')
      .replace(/[&<>'"]/g, (tag: string) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '\'': '&#39;',
        '"': '&quot;'
      }[tag] || ''))
  }

  setCss (url: string | string[]) {
    if (Array.isArray(url)) {
      // Multiple CSS files: generate multiple link tags
      const cssLinks = url.map(cssUrl => `<link rel='stylesheet' href='${cssUrl}'>`).join('\n    ')
      this.replace(this.placeholders.css, cssLinks)
    } else {
      // Single CSS file: maintain backward compatibility
      this.replace(this.placeholders.css, `<link rel='stylesheet' href='${url}'>`)
    }
  }

  setWidth (width: any) {
    width = this.stringify(width).replace(/["']/g, '')
    if (width) {
      width = `.markdown-preview-sizer.markdown-preview-section { max-width: ${width} !important; margin: 0 auto; }`
    }
    this.replace(this.placeholders.width, width)
  }

  setTitle (title: any) {
    title = this.htmlQuote(this.stringify(title))
    this.replace(this.placeholders.title, title)
    this.replace(this.placeholders.ogTitle, '<meta property="og:title" content="' + title + '">')
  }

  setMetaDescription (desc: any) {
    desc = this.htmlQuote(this.stringify(desc))
    let meta = '<meta name="description" content="' + desc + '">'
    meta += '<meta content="' + desc + '" property="og:description">'
    this.replace(this.placeholders.metaDescription, meta)
  }

  addUnencryptedContents (data: any) {
    if (typeof data === 'string') {
      this.replace(this.placeholders.noteContent, data)
    }
    this.replace(this.placeholders.decryptionFunctions, plaintextFunctions)
  }

  addEncryptedData (data: any, pluginVersion: string) {
    if (typeof data === 'string') {
      const html = `<div id='encrypted-data' style='display: none'>${data}</div>`
      this.replace(this.placeholders.encryptedData, html)
    }
    // Add the section which will be replaced by the inline Javascript
    // when the note decrypts
    this.replace(this.placeholders.noteContent, '<div id="template-user-data">Encrypted note</div>')
    // Add the decryption functions
    if (!checkVersion(pluginVersion, [1, 2, 0])) {
      // Legacy decryption for plugin versions < v1.2.0
      this.replace(this.placeholders.decryptionFunctions, decryptionFunctions_v1_1_3)
    } else {
      this.replace(this.placeholders.decryptionFunctions, decryptionFunctions)
    }
  }

  enableMathjax (enable = false) {
    if (enable) {
      this.replace(this.placeholders.scripts, `<script async src="${this.app.baseWebUrl}/assets/mathjax@3.2.2_es5_tex-chtml-full.js"></script>`)
    }
  }

  setClassAndStyle (elShortname: string, classes: any, style: any) {
    if (!this.elements[elShortname]) return

    // Sanitise data
    style = this.stringify(style)
    if (!Array.isArray(classes)) classes = []
    style = style.replace(/"/g, '')
    classes = classes.map((cls: any) => {
      cls = this.stringify(cls)
      return cls.replace(/[^\w-]/g, '')
    })

    const content = []
    if (classes.length) {
      content.push(`class="${classes.join(' ')}"`)
    }
    if (style) {
      content.push(`style="${style}"`)
    }

    this.replace(this.elements[elShortname], content.join(' '))
  }

  contents (): string {
    // Remove any leftover template placeholders
    [...Object.values(this.placeholders), ...Object.values(this.elements)]
      .forEach(placeholder => {
        this.replace(placeholder, '')
      })

    // Return the final note contents
    return this.html
  }
}

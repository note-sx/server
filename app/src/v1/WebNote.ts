import { App } from '../types';

const template = `
<!DOCTYPE HTML>
<html TEMPLATE_HTML>
<head>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1'>
  <title>TEMPLATE_TITLE</title>
  TEMPLATE_OG_TITLE
  TEMPLATE_META_DESCRIPTION
  <link rel='icon' type='image/x-icon' href='/favicon.ico'>
  <style>
    html,
    body {
      overflow: visible !important;
    }
    div.view-content {
      height: 100% !important;
      padding: 0 !important;
    }
    .callout.is-collapsible .callout-title {
      cursor: pointer !important;
    }
    TEMPLATE_WIDTH
  </style>
  <link rel='stylesheet' href='TEMPLATE_CSS'>
  <script src='TEMPLATE_ASSETS_WEBROOT/app.js'></script>
  TEMPLATE_SCRIPTS
</head>
<body TEMPLATE_BODY>
<div class='app-container'>
  <div class='horizontal-main-container'>
    <div class='workspace'>
      <div class='workspace-split mod-vertical mod-root'>
        <div class='workspace-leaf mod-active'>
          <div class='workspace-leaf-content'>
            <div class='view-content'>
              <div class='markdown-reading-view' style='height:100%;width:100%;'>
                <div TEMPLATE_PREVIEW>
                  <div class='markdown-preview-sizer markdown-preview-section'>
                    <div TEMPLATE_PUSHER></div>
                    TEMPLATE_NOTE_CONTENT
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class='status-bar' style='display:flex !important;position:fixed !important;'>
    <div class='status-bar-item'>
      <span class='status-bar-item-segment'><a href='https://note.sx/' target='_blank'>Share Note</a> for Obsidian</span>
      <span id='theme-mode-toggle' class='status-bar-item-segment'>🌓</span>
    </div>
  </div>
</div>
TEMPLATE_ENCRYPTED_DATA
TEMPLATE_DECRYPTION_FUNCTIONS
</body>
</html>
`;

const decryptionFunctions = `
<script>
  function base64ToArrayBuffer (base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async function decryptString ({ ciphertext, iv }, secret) {
    const ivArr = iv ? base64ToArrayBuffer(iv) : new Uint8Array(1)
    const aesKey = await window.crypto.subtle.importKey('raw', base64ToArrayBuffer(secret), {
      name: 'AES-GCM',
      length: 256
    }, false, ['decrypt'])

    const plaintext = []
    for (let index = 0; index < ciphertext.length; index++) {
      const ciphertextChunk = ciphertext[index]
      if (!iv) ivArr[0] = index & 0xFF
      const ciphertextBuf = base64ToArrayBuffer(ciphertextChunk)
      const plaintextChunk = await window.crypto.subtle
        .decrypt({ name: 'AES-GCM', iv: ivArr }, aesKey, ciphertextBuf)
      plaintext.push(new TextDecoder().decode(plaintextChunk))
    }
    return plaintext.join('')
  }

  /*
   * Decrypt the original note content
   */
  const encryptedData = document.getElementById('encrypted-data').innerText.trim();
  const payload = encryptedData ? JSON.parse(encryptedData) : '';
  const secret = window.location.hash.slice(1); // Taken from the URL # parameter
  if (payload && secret) {
    decryptString({ ciphertext: payload.ciphertext, iv: payload.iv }, secret)
      .then(text => {
        // Inject the user's data
        const data = JSON.parse(text);
        const contentEl = document.getElementById('template-user-data');
        if (contentEl) contentEl.outerHTML = data.content;
        document.title = data.basename;
        initDocument();
      })
      .catch(() => {
        const contentEl = document.getElementById('template-user-data');
        if (contentEl) contentEl.innerHTML = 'Unable to decrypt using this key.';
      });
  }
</script>
`;

const plaintextFunctions = `
<script>initDocument();</script>
`;

export default class WebNote {
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
  };
  private elements: { [key: string]: string } = {
    html: 'TEMPLATE_HTML',
    body: 'TEMPLATE_BODY',
    preview: 'TEMPLATE_PREVIEW',
    pusher: 'TEMPLATE_PUSHER'
  };

  app: App;
  private html: string;

  constructor (app: App) {
    this.app = app;
    this.html = template;
    this.replace(this.placeholders.assetsWebroot, this.app.baseWebUrl + '/assets');
  }

  /**
   * Turn any value into a string
   */
  stringify (value: any): string {
    return (typeof value === 'string') ? value : '';
  }

  replace (variable: string, value: string) {
    this.html = this.html.replace(new RegExp(variable, 'g'), value);
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
      }[tag] || ''));
  }

  setCss (url: string) {
    this.replace(this.placeholders.css, url);
  }

  setWidth (width: any) {
    width = this.stringify(width).replace(/["']/g, '');
    if (width) {
      width = `.markdown-preview-sizer.markdown-preview-section { max-width: ${width} !important; margin: 0 auto; }`;
    }
    this.replace(this.placeholders.width, width);
  }

  setTitle (title: any) {
    title = this.htmlQuote(this.stringify(title));
    this.replace(this.placeholders.title, title);
    this.replace(this.placeholders.ogTitle, '<meta property="og:title" content="' + title + '">');
  }

  setMetaDescription (desc: any) {
    desc = this.htmlQuote(this.stringify(desc));
    let meta = '<meta name="description" content="' + desc + '">';
    meta += '<meta content="' + desc + '" property="og:description">';
    this.replace(this.placeholders.metaDescription, meta);
  }

  addUnencryptedContents (data: any) {
    if (typeof data === 'string') {
      this.replace(this.placeholders.noteContent, data);
    }
    this.replace(this.placeholders.decryptionFunctions, plaintextFunctions);
  }

  addEncryptedData (data: any) {
    if (typeof data === 'string') {
      const html = `<div id='encrypted-data' style='display: none'>${data}</div>`;
      this.replace(this.placeholders.encryptedData, html);
    }
    // Add the section which will be replaced by the inline Javascript
    // when the note decrypts
    this.replace(this.placeholders.noteContent, '<div id="template-user-data">Encrypted note</div>');
    // Add the decryption functions
    this.replace(this.placeholders.decryptionFunctions, decryptionFunctions);
  }

  enableMathjax (enable = false) {
    if (enable) {
      this.replace(this.placeholders.scripts, `<script async src="${this.app.baseWebUrl}/assets/mathjax@3.2.2_es5_tex-chtml-full.js"></script>`);
    }
  }

  setClassAndStyle (elShortname: string, classes: any, style: any) {
    if (!this.elements[elShortname]) return;

    // Sanitise data
    style = this.stringify(style);
    if (!Array.isArray(classes)) classes = [];
    style = style.replace(/"/g, '');
    classes = classes.map((cls: any) => {
      cls = this.stringify(cls);
      return cls.replace(/[^\w-]/g, '');
    });

    const content = [];
    if (classes.length) {
      content.push(`class="${classes.join(' ')}"`);
    }
    if (style) {
      content.push(`style="${style}"`);
    }

    this.replace(this.elements[elShortname], content.join(' '));
  }

  contents (): string {
    // Remove any leftover template placeholders
    [...Object.values(this.placeholders), ...Object.values(this.elements)]
      .forEach(placeholder => {
        this.replace(placeholder, '');
      });

    // Return the final note contents
    return this.html;
  }
}

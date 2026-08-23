function base64ToArrayBuffer (base64) {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
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
const encryptedData = document.getElementById('encrypted-data').innerText.trim()
const payload = encryptedData ? JSON.parse(encryptedData) : ''
const secret = window.location.hash.slice(1) // Taken from the URL # parameter
if (payload && secret) {
  decryptString({ ciphertext: payload.ciphertext, iv: payload.iv }, secret)
    .then(text => {
      // Inject the user's data
      const data = JSON.parse(text)
      const contentEl = document.getElementById('template-user-data')
      if (contentEl) contentEl.outerHTML = data.content
      document.title = data.basename
      initDocument()
    })
    .catch(() => {
      const contentEl = document.getElementById('template-user-data')
      if (contentEl) contentEl.innerHTML = 'Unable to decrypt using this key.'
    })
}

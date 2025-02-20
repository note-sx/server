const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatInt (int: number, precision: number) {
  let tmp = int.toString(),
    len = tmp.length
  if (len >= precision) {
    return tmp
  } else {
    for (let i = 0; i < (precision - len); i++) {
      tmp = '0' + tmp
    }
  }
  return tmp
}

/**
 * Format a date for use in a Last-Modified HTTP header
 * @param date
 */
export function httpHeaderDate (date?: Date) {
  if (!date) date = new Date()

  const timeString = [
    formatInt(date.getUTCHours(), 2),
    formatInt(date.getUTCMinutes(), 2),
    formatInt(date.getUTCSeconds(), 2)
  ].join(':')

  const dateString = [
    formatInt(date.getUTCDate(), 2),
    months[date.getUTCMonth()],
    date.getUTCFullYear()
  ].join(' ')

  return [days[date.getUTCDay()] + ',', dateString, timeString, 'GMT'].join(' ')
}

async function sha (algorithm: string, data: string | ArrayBuffer) {
  let uint8Array
  if (typeof data === 'string') {
    const encoder = new TextEncoder()
    uint8Array = encoder.encode(data)
  } else {
    uint8Array = data
  }
  const hash = await crypto.subtle.digest(algorithm, uint8Array)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function convertBase (value: string, fromBase: number, toBase: number): string {
  const range = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/'.split('')
  const rangeFrom = range.slice(0, fromBase)
  const rangeTo = range.slice(0, toBase)

  let decValue = value
    .split('')
    .reverse()
    .reduce((carry: number, digit: string, index: number) => {
      carry += rangeFrom.indexOf(digit) * (Math.pow(fromBase, index))
      return carry
    }, 0)

  let newValue = ''
  while (decValue > 0) {
    newValue = rangeTo[decValue % toBase] + newValue
    decValue = (decValue - (decValue % toBase)) / toBase
  }
  return newValue || '0'
}

export async function sha256 (data: string | ArrayBuffer) {
  return sha('SHA-256', data)
}

export async function sha1 (data: string | Buffer) {
  return sha('SHA-1', data)
}

export async function shortHash (text: string) {
  return (await sha256(text)).slice(0, 32)
}

export type Semver = [number, number, number]

/**
 * Check whether the user's plugin version meets a minimum version
 *
 * @example
 * checkVersion('0.8.7', '0.9.0') => false
 */
export function checkVersion (version: string, minimumRequired: Semver) {
  const userVersion = version.split('.')
  if (userVersion.length === 3) {
    for (let i = 0; i < 3; i++) {
      if (~~userVersion[i] > minimumRequired[i]) return true  // Version is newer
      if (~~userVersion[i] < minimumRequired[i]) return false // Version is older
    }
    return true // Versions are the same
  }
  return false // Incoming version number didn't have the expected 3 parts
}

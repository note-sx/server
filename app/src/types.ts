import Cloudflare from './v1/Cloudflare';
import { Log } from './v1/Log';
import { SQLite } from './v1/Database'
import { ContentfulStatusCode } from 'hono/dist/types/utils/http-status'

export interface App {
  db: SQLite;
  log: Log;
  cloudflare: Cloudflare;
  baseFolder: string;
  baseWebUrl: string;
  hashSalt: string;
  folderPrefix: number;
}

export enum DebugOption {
  none,
  returnHtml
}

// 560 plus this number
export enum ServerErrors {
  FILE_FAILED_TO_INIT,
  FILE_FAILED_TO_SAVE,
  FILE_FAILED_TO_UPLOAD,
  USER_FAILED_TO_SAVE,
  API_KEY_FAILED_TO_SAVE,
  TURNSTILE_NO_VERIFY
}

export const StatusCodes: { [key: number]: string } = {
  // Standard error codes
  400: 'Invalid request, please make sure you are using the latest plugin verison and try again',
  401: 'Invalid API key, please request a new one through the Settings page',
  403: 'Unable to update this link, please delete any existing share links and try again',
  413: 'Uploaded file size is too large. Please consider resizing, or hosting any large images on Imgur and linking back into your note.',
  415: 'Unsupported media type - please open an issue on Github',
  // Custom error codes
  460: 'Plugin out of date - please upgrade to the latest version',
  461: 'I am currently performing maintenance on the server. Service will return to normal soon.',
  462: 'Invalid API key, you should automatically be redirected to your browser to request a new one', // 462 will automatically get a new key
  463: 'Invalid authentication token'
};

export function serverError (error: ServerErrors) {
  return (560 + error) as ContentfulStatusCode
}

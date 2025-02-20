import Mapper from './Mapper';
import { shortHash } from './helpers';
import Controller from './Controller';
import { serverError, ServerErrors } from '../types'
import { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { now } from './Database'

export default class User extends Controller {

  constructor (c: Context) {
    super(c);
  }

  /**
   * Send a UID and get an API key
   */
  async getKey (uid: string) {
    // Look for a user record for this UID
    const user = await Mapper(this.app.db, 'users');
    await user.load({
      uid: uid
    });
    if (user.notFound) {
      // Create a new user
      user.row.uid = uid;
      user.row.created = now();
      if (!(user.save())) {
        throw new HTTPException(serverError(ServerErrors.USER_FAILED_TO_SAVE)); // Server error, unable to save
      }
    }
    this.user = user;

    // Revoke any existing keys
    this.app.db
      .prepare('UPDATE api_keys SET revoked=? WHERE users_id = ? AND revoked IS NULL')
      .run(now(), user.row.id)

    // Create the new API key
    const apiKey = await Mapper(this.app.db, 'api_keys');
    apiKey.set({
      users_id: user.row.id,
      api_key: await shortHash('' + user.row.id + new Date().getTime()),
      created: now()
    });
    if (!(apiKey.save())) {
      throw new HTTPException(serverError(ServerErrors.API_KEY_FAILED_TO_SAVE)); // Server error, unable to save
    } else {
      return {
        user,
        apiKey,
        key: apiKey.row.api_key
      };
    }
  }
}

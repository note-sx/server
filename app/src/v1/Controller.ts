import { App } from '../types'
import { Row } from './Mapper'
import { Context, HonoRequest } from 'hono'

export default class Controller {
  app: App
  post: any
  user: Row
  request: HonoRequest
  context: Context

  constructor (c: Context) {
    this.app = c.get('app')
    this.post = c.get('content') || {}
    this.user = c.get('user') || {}
    this.request = c.req
    c.set('pluginVersion', c.req.header('x-sharenote-version'))
    this.context = c
  }
}

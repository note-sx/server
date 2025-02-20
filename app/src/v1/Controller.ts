import { App } from '../types'
import { Row } from './Mapper'
import { appInstance } from '../index'
import { Context, HonoRequest } from 'hono'

export default class Controller {
  app: App
  post: any
  user: Row
  request: HonoRequest
  context: Context

  constructor (c: Context) {
    this.app = appInstance
    this.post = c.get('content') || {}
    this.user = c.get('user') || {}
    this.request = c.req
    this.context = c
  }
}

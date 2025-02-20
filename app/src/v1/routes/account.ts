import User from '../User'
import { Hono } from 'hono'
import { appInstance } from '../../index'

export const router = new Hono()

router
  .get('/get-key', async (c) => {
    const cloudflare = appInstance.cloudflare
    const { searchParams } = new URL(c.req.url)
    const token = searchParams.get('token') || ''
    if (!searchParams.has('id')) {
      return new Response('Missing ID parameter', { status: 400 })
    } else if (!token && cloudflare.useTurnstile) {
      // Show the challenge
      return await cloudflare.showChallenge()
    } else {
      if (cloudflare.useTurnstile) {
        // Validate the returned token, and throw an error if invalid
        await cloudflare.validateToken(c.req)
      }

      const user = new User(c)
      const keyData = await user.getKey(searchParams.get('id') || '')

      // Generate the HTML response
      const head = `<meta http-equiv='Refresh' content='3; URL=obsidian://share-note?key=${keyData.key}' />`
      const body = `<h3>Successfully connected Share Note!</h3>
        <p>This will only happen once 😊</p>
        <p>You should now be automatically sent back to Obsidian and the setup will complete.
        If you want to do it manually, you can copy and paste this value into the settings page,
        in the API key field: <code>${keyData.key}</code></p>`

      // Return the completed webpage
      return new Response(cloudflare.htmlResponse(head, body), {
        headers: { 'content-type': 'text/html' }
      })
    }
  })

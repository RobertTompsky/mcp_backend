import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import 'dotenv/config'
import { runAgent } from 'src/mcp/client'

const app = new Hono()

app
  .use('/*', cors())
  .get('/', (c) => {
    return c.text('Hello Hono!')
  })
  .get('/mcp', async (c) => {

    const answer = await runAgent('ну-ка порадуй меня ценой эфира')
    console.log(answer)

    const answer2 = await runAgent('а у соланы сначала узнай ее, а потом новости', answer.responseId)
    console.log(answer2)
    
    return c.text('Прибыль показана')
  })

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})

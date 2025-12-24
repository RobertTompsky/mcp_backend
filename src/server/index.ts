import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import 'dotenv/config'
import { Client } from '@modelcontextprotocol/sdk/client'
import path from 'path'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { log } from '@utils/logger'
import { setup } from '@llm/agent'
import { def } from '@code/actions'
import z from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { zValidator } from '@hono/zod-validator'
import { InputSchema } from '@llm/schemas'

const app = new Hono()

const mcpClient = new Client(
  {
    name: 'demo_client',
    version: '2.2.8'
  },
  {}
)

const tsxBin = path.resolve(
  'node_modules/.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
)

const transport = new StdioClientTransport({
  command: tsxBin,
  args: [path.resolve('src/mcp/server.ts')],
  stderr: 'inherit'
})
log.section('MAIN')
log.info("Hono + MCP client started");

try {
  await mcpClient.connect(transport)
} catch (error) {
  log.error('[MCP] failed to connect:', error)
}

const agent = setup({
  model: 'gpt-5.1-chat-latest',
  actions: [
    {
      name: 'calculate',
      description: 'Write simple func that calculates numbers'
    },
    // {
    //   name: 'useMcpClient',
    //   description: [
    //     "Use MCP client inside the sandbox to discover and call MCP tools directly from TypeScript code.",
    //     "Methods:",
    //     "- client.listTools()",
    //     "- client.callTool({ name, arguments })"
    //   ].join("\n"),
    //   globals: {
    //     client: mcpClient
    //   }
    // },
    def({
      name: "list_McpTools",
      description: [
        "Return a list of available tools via MCP client including names, descriptions and input schemas.",
      ].join("\n"),
      call: async () => {
        const { tools } = await mcpClient.listTools()

        return JSON.stringify(
          tools.map(t => ({
            name: t.name,
            description: t.description,
            args: t.inputSchema,
          })),
          null,
          2
        )
      }
    }),
    def({
      name: "call_McpTool",
      description: [
        "Call an existing MCP tool by name via client.",
      ].join("\n"),
      schema: z.object({
        name: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
      call: async ({ name, args }) => {
        const out = await mcpClient.callTool({
          name,
          arguments: args
        }) as CallToolResult

        const text = out.content
          .map(el => el.type === "text" ? el.text : JSON.stringify(el))
          .join("\n")
          .trim();

        return text
      }
    })
  ],
  opts: {
    toolRounds: 3,
    prompt: [
      "For all external data you **must** use MCP client inside sandbox to discover tools and call the appropriate one",
      "Never invent tool names."
    ].join('\n')
  }
})

app
  .use('/*', cors())
  .get('/', (c) => {
    return c.text('Hello Hono!')
  })
  .post('/mcp', zValidator('json', InputSchema), async (c) => {
    const body = c.req.valid('json')

    const res = await agent.text(body)

    return c.text(res.text)
  })

process.once('SIGINT', async () => {
  log.info('Closing MCP client')
  await mcpClient.close()
  await transport.close()
  process.exit(0)
})

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  log.info(`Server is running on http://localhost:${info.port}`)
})



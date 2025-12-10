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
      description: 'Write simple code to calculate numbers.'
    },
    // {
    //   name: "useMcpClient",
    //   description: [
    //     "Use MCP client inside the sandbox to discover and call MCP tools directly from TypeScript code.", 
    //     "Allowed methods:",
    //     "- .listTools()",
    //     "- .callTool({ name: string, arguments: Record<string, unknown> })"
    //   ].join("\n"),
    //   globals: {
    //     client: mcpClient,
    //   },
    // },
    def({
      name: "createPlan",
      description: [
        "Generate a clear, structured plan for solving the user’s request.",
        "",
        "First, briefly outline your internal reasoning about how to approach the task.",
        "Then, turn this reasoning into an ordered list of small, meaningful subtasks.",
        "",
        "Both reasoning and subtasks must be written in natural language only — no code.",
        "The plan should reflect your own understanding of the problem and how to solve it.",
        "Choose whatever steps are logically appropriate for the task; do not follow a fixed template.",
      ].join("\n"),
      schema: z.object({
        thinking: z
          .string()
          .min(1)
          .describe(
            "A short, free-form description of your reasoning and high-level approach to the user’s request."
          ),
        todos: z
          .array(
            z
              .string()
              .min(1)
              .describe("One concrete, meaningful subtask that moves the solution forward.")
          )
          .min(1)
          .describe("An ordered list of subtasks needed to solve the request."),
      }),
      call: async () => 'Follow generated plan step by step and call other tools if needed. **DO NOT** ask user to continue.',
    }),
    def({
      name: "listMcpTools",
      description: [
        "Return a list of available tools from MCP server including names, descriptions and input schemas.",
      ].join("\n"),
      call: async () => {
        const { tools } = await mcpClient.listTools();

        return JSON.stringify(
          tools.map(t => ({
            name: t.name,
            description: t.description,
            args: t.inputSchema,
          })),
          null,
          2
        );
      }
    }),
    def({
      name: "callMcpTool",
      description: [
        "Call an existing MCP tool by name.",
        "",
        "IMPORTANT RULES:",
        "- You MUST NOT implement your own logic inside code when using this tool.",
        "- You MUST ONLY call tools that exist on the MCP server.",
        "- Never invent tool names.",
      ].join("\n"),
      schema: z.object({
        name: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
      call: async ({ name, args = {} }) => {
        const out = await mcpClient.callTool({
          name,
          arguments: args
        }) as CallToolResult;

        const text = out.content
          .map(el => el.type === "text" ? el.text : JSON.stringify(el))
          .join("\n")
          .trim();

        return text;
      }
    })
  ],
  opts: {
    toolRounds: 3,
    sandboxTimeout: 15_000,
    prompt: [
      "**Always** start with calling the `createPlan` tool for each new user task.",
      "For all external data you **must** use MCP client inside sandbox to discover tools and call the appropriate one",
      "Never invent tool names."
    ].join("\n")
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



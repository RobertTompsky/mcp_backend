import { Client as McpClient } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import type { Tool } from "openai/resources/responses/responses.js";
import path from "path";
import { z } from "zod";
import { cryptoInputSchema, newsSearchSchema } from "./schemas";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const zodValidators: Record<string, z.ZodTypeAny | undefined> = {
    get_cryptoInfo: cryptoInputSchema,
    search_news: newsSearchSchema
}

export async function runAgent(query: string, previousResponseId?: string): Promise<{
    responseId: string | undefined,
    text: string
}> {
    const tsxBin = path.resolve(
        'node_modules/.bin',
        process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
    )

    const transport = new StdioClientTransport({
        command: tsxBin,
        args: [path.resolve('src/mcp/server.ts')],
        stderr: 'inherit'
    })

    const mcpClient = new McpClient(
        {
            name: 'demo_client',
            version: '2.2.8'
        },
        {}
    )

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        maxRetries: 0
    })
    const MODEL = 'gpt-4.1-nano'

    try {
        await mcpClient.connect(transport)

        const { tools } = await mcpClient.listTools()
        console.log(
            "[MCP] Connected to server with tools:",
            tools.map(({ name }) => name)
        )

        const openaiTools: Tool[] = tools.map(t => ({
            type: 'function' as const,
            name: t.name,
            description: t.description ?? '',
            parameters: (t.inputSchema ?? {
                type: 'object',
                properties: {},
                required: []
            }),
            strict: true
        }))

        let result = await openai.responses.create({
            model: MODEL,
            store: true,
            previous_response_id: previousResponseId ?? undefined,
            input: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: query
                        }
                    ]
                }
            ],
            tools: openaiTools,
            // parallel_tool_calls: false
        })

        const MAX_TOOL_ROUNDS = 3

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const calls = result.output.filter((item) => item.type === 'function_call')
            if (!calls.length) break
            
            console.log(`[MCP] Calling tools: ROUND ${round+1}`)

            const toolResults = await Promise.all(calls.map(async (call) => {
                const schema = zodValidators[call.name]
                const args = (
                    schema
                        ? schema.parse(JSON.parse(call.arguments))
                        : {}
                ) as Record<string, unknown>

                const mcpToolOutput = (await mcpClient.callTool({
                    name: call.name,
                    arguments: args
                })) as CallToolResult

                const text = mcpToolOutput.content
                    .map(item => item.type === 'text' ? item.text : JSON.stringify(item))
                    .join('\n')
                    .trim()

                return {
                    type: 'function_call_output' as const,
                    call_id: call.call_id,
                    output: text
                }
            }))

            result = await openai.responses.create({
                model: MODEL,
                store: true,
                previous_response_id: result.id,
                input: [
                    ...toolResults
                ],
                tools: openaiTools,
                // parallel_tool_calls: false
            })
        }

        return {
            responseId: result.id,
            text: result.output_text
        }
        
    } catch (error) {
        console.error('[runAgent] error:', error)
        return {
            responseId: undefined,
            text: `Ошибка выполнения запроса: ${String(error)}`
        }
    } finally {
        await mcpClient.close()
        await transport.close()
    }
}
import OpenAI from "openai";
import type {
    ResponseInput,
    FunctionTool,
    ResponseInputItem
} from "openai/resources/responses/responses.js";
import { z } from "zod";
import { InputSchema } from "./schemas";
import { type SandboxAction, createApi } from "@code/actions";
import { log } from "@utils/logger";
import { CodeGenSchema } from "@code/schemas";

type Input = z.infer<typeof InputSchema>

export type Config = {
    model: string;
    actions?: SandboxAction[];
    opts?: {
        toolRounds?: number;
        prompt?: string;
        sandboxTimeout?: number;
    };
};
export function setup(config: Config) {
    const {
        model,
        actions = [],
        opts: {
            sandboxTimeout,
            prompt,
            toolRounds = 3
        } = {}
    } = config

    log.section("AGENT INITIALIZED");
    if (prompt) log.info("Prompt enabled");

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        maxRetries: 0
    })

    const { api, executeCode } = createApi(actions!)

    async function text(payload: Input) {
        const {
            query,
            options: {
                previousResponseId,
            } = {}
        } = payload

        log.section("INPUT");
        let initialInput: ResponseInput = [
            ...(prompt
                ? [{
                    role: "system",
                    content: [{ type: "input_text", text: prompt }]
                } satisfies ResponseInput[number]]
                : []
            ),
            {
                role: "user",
                content: [{ type: "input_text", text: query as string }]
            }
        ];
        log.json("Initial input", initialInput);

        log.section("TOOLS");
        const openaiTools: FunctionTool[] = Object.entries(api).map(([name, {
            template,
            description
        }]) => {
            const annotatedSchema = z.object({
                ...CodeGenSchema.shape,
                code: CodeGenSchema.shape.code.describe([
                    template,
                    "NO imports, NO fetch, NO network."
                ].join("\n"))
            });

            return {
                type: "function",
                name,
                description: description.trim(),
                parameters: z.toJSONSchema(annotatedSchema),
                strict: true,
            }
        });
        log.json('Registered tools:', Object.fromEntries(
            openaiTools.map(t => [
                t.name,
                {
                    description: t.description ?? '',
                    parameters: t.parameters
                }
            ])
        ))

        let result = await openai.responses.create({
            model,
            store: true,
            previous_response_id: previousResponseId,
            input: initialInput,
            tools: openaiTools,
            max_output_tokens: 2000
        })

        for (let round = 0; round <= toolRounds; round++) {
            const calls = result.output.filter((item) => item.type === 'function_call')
            if (!calls.length) break

            if (round === toolRounds && calls.length > 0) {
                const exceedMessage = `Tool rounds limit exceeded (attempted round ${round + 1} of max ${toolRounds}).`

                log.section('Final Output')
                log.info(exceedMessage)

                return {
                    responseId: result.id,
                    text: exceedMessage,
                };
            }

            log.section(`TOOLCALL: ROUND ${round + 1}`);
            log.info(`Calling: [${calls.map((c) => c.name).join(', ')}]`);

            const toolNameSet = new Set(openaiTools.map(t => t.name));
            const toolResults: ResponseInputItem.FunctionCallOutput[] = await Promise.all(calls.map(async (call) => {
                if (!toolNameSet.has(call.name)) {
                    return {
                        type: "function_call_output" as const,
                        call_id: call.call_id,
                        output: `unknown tool: ${call.name}`,
                    };
                }

                const args = CodeGenSchema.parse(JSON.parse(call.arguments))
                log.json(`Code for ${call.name}`, JSON.parse(call.arguments));

                const { stdout } = await executeCode(args.code, sandboxTimeout ?? 10, call.name);
                log.json(`Sandbox result for ${call.name}`, stdout)

                return {
                    type: "function_call_output",
                    call_id: call.call_id,
                    output: stdout
                };
            }))

            result = await openai.responses.create({
                model,
                store: true,
                previous_response_id: result.id,
                input: toolResults,
                tools: openaiTools
            })
        }

        log.section('Final Output')
        log.info(result.output_text)

        return {
            responseId: result.id,
            text: result.output_text,
        }
    }

    return {
        text
    }
}

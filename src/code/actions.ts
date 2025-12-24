import { z } from "zod";
import ts from "typescript";
import vm from "vm";
import { log } from "@utils/logger";

export type SandboxAction<Name extends string = string> = {
    name: Name;
    description: string;
    globals?: Record<string, any>;
};

export function hasGlobals(
    a: SandboxAction
): a is SandboxAction & { globals: NonNullable<SandboxAction["globals"]> } {
    return typeof a.globals === "object" && a.globals !== null;
}

const DEFAULT_SCHEMA = z.record(z.string(), z.unknown())
type ActionSchema<S> = S extends z.ZodObject<any> ? S : typeof DEFAULT_SCHEMA;

export type ActionDef<
    Name extends string = string,
    S extends z.ZodObject | undefined = undefined
> = Omit<SandboxAction<Name>, "globals"> & {
    schema: ActionSchema<S>;
    call(args: z.infer<ActionSchema<S>>): Promise<string>;
};

export function isActionDef(a: SandboxAction): a is ActionDef {
    return (
        "schema" in a &&
        "call" in a &&
        typeof a.call === "function" &&
        typeof a.schema === "object" &&
        a.schema !== null &&
        "parse" in a.schema
    );
}

export function def<
    const Name extends string,
    S extends z.ZodObject | undefined
>(
    config: Omit<ActionDef<Name, S>, "schema"> & {
        schema?: ActionSchema<S>;
    }
): ActionDef<Name, S> {
    const schema = (config.schema ?? DEFAULT_SCHEMA) as ActionSchema<S>;

    return {
        ...config,
        schema,
    }
}

export function createApi(actions: SandboxAction[]) {
    const SDK_NAME = 'api'
    const FUNC_NAME = 'call'

    type ApiEntry<
        S extends z.ZodTypeAny = typeof DEFAULT_SCHEMA
    > = {
        description: string;
        schema?: ActionSchema<S>;
        [FUNC_NAME]?: (args: z.infer<ActionSchema<S>>) => Promise<string>;
        template?: string;
    };

    const api: Record<string, ApiEntry> = {};

    const requiredCallPattern = (toolName: keyof typeof api) => `await ${SDK_NAME}.${toolName}.${FUNC_NAME}`

    for (const a of actions) {
        if (isActionDef(a)) {
            api[a.name] = {
                description: a.description,
                schema: a.schema,
                call: async (rawArgs: unknown) => {
                    try {
                        const parsed = a.schema.parse(rawArgs);
                        log.info(
                            `Action validated: ${a.name}\n`,
                            JSON.stringify(parsed, null, 2)
                        );
                        return await a.call(parsed);
                    } catch (e) {
                        if (e instanceof z.ZodError) {
                            return [
                                "[SANDBOX_FEEDBACK] Invalid arguments for action:",
                                e.issues.map(err =>
                                    `- ${err.path.join(".")}: ${err.message}`
                                ).join("\n")
                            ].join("\n");
                        }
                        throw e;
                    }
                },
                template: [
                    `Inside the TypeScript sandbox, always call this tool via global \`${SDK_NAME}\` object.`,
                    "",
                    `You **MUST** use this exact template when calling this tool:`,
                    "```ts",
                    `const res = ${requiredCallPattern(a.name)}(args); console.log(res)`,
                    "```",
                    "\n",
                    "Arguments must match this schema:",
                    "```json",
                    JSON.stringify(z.toJSONSchema(a.schema), null, 2),
                    "```"
                ].join('\n'),
            };
        } else {
            const globalsInfo = hasGlobals(a)
                ? [
                    `You have direct access to these globals:`,
                    "",
                    ...Object.keys(a.globals).map(name => `- \`${name}\``),
                    "",
                    `Use them directly in your TypeScript code (no imports needed).`
                ]
                : []
            api[a.name] = {
                description: a.description,
                template: [
                    `Inside the TypeScript sandbox, write a compact TypeScript snippet to complete this action.`,
                    ``,
                    ...globalsInfo,
                    "Always return result via console.log"
                ].join("\n")
            };
        }
    }

    async function executeCode(
        code: string,
        sandboxTimeout: number,
        toolName: string
    ): Promise<{ stdout: string }> {
        const action = actions.find(a => a.name === toolName);
        if (!action) throw Error('Invalid toolName');

        const apiEntry = api[toolName];

        if (isActionDef(actions.find((a) => a.name === toolName)!)) {

            if (!code.includes(requiredCallPattern(toolName))) {
                return {
                    stdout: [
                        `[SANDBOX_FEEDBACK] Invalid call pattern for '${toolName}'.`,
                        ``,
                        apiEntry.template ?? "",
                        ``,
                        "Fix the code and try again.",
                    ].join("\n"),
                };
            }
        }

        const js = ts.transpileModule(code, {
            compilerOptions: {
                target: ts.ScriptTarget.ESNext,
                module: ts.ModuleKind.ESNext,
                moduleResolution: ts.ModuleResolutionKind.NodeNext,
                esModuleInterop: true,
                skipLibCheck: true,
                isolatedModules: true,
                noEmitOnError: false,
            },
            reportDiagnostics: false,
        }).outputText;

        const logs: string[] = [];
        const safeLog = (...args: unknown[]) =>
            logs.push(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));

        const blocked = (msg: string) => () => { throw new Error(msg); };

        const sandbox: vm.Context = {
            console: { log: safeLog },
            ...(hasGlobals(action) ? action.globals : {}),
            ...(isActionDef(action) ? { [SDK_NAME]: api } : {}),
            fetch: blocked("[SANDBOX_ERROR]: Network is disabled."),
            require: blocked("[SANDBOX_ERROR]: Imports are disabled."),
            setTimeout, clearTimeout, setInterval, clearInterval,
        };

        const context = vm.createContext(sandbox, {
            name: "mcp-ts-sandbox",
            codeGeneration: { strings: true, wasm: false },
        });

        const wrappedCode = [
            "(async () => {",
            js,
            "})().catch(e => console.log('[SANDBOX_ERROR]:', String(e)));",
        ].join("\n");

        try {
            const script = new vm.Script(wrappedCode, { filename: "snippet.ts" });
            await script.runInContext(context, { timeout: sandboxTimeout });
        } catch (e) {
            safeLog("[SANDBOX_ERROR]:", String(e));
        }

        if (logs.length === 0) logs.push("[SANDBOX_FEEDBACK] MUST print the final result using console.log(...).");

        return {
            stdout: logs.map(line => line.trimStart()).join("\n")
        };
    }

    return { api, executeCode };
}
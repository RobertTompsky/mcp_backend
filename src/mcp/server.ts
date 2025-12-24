import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import 'dotenv/config'
import { log } from "@utils/logger";
import { CryptoToolShape, WebSearchToolShape } from "./schemas";

const mcpServer = new McpServer({
    name: "demo_server",
    version: "2.2.8",
});

mcpServer.registerTool(
    'get_cryptoInfo',
    {
        title: 'get_cryptoInfo',
        description: 'Get the current price and market metrics of a specific cryptocurrency',
        inputSchema: CryptoToolShape
    },
    async ({ ticker, name, quantity }) => {

        try {
            const id = `${ticker.toLowerCase()}-${name.toLowerCase()}`;
            const url = `https://api.coinpaprika.com/v1/tickers/${id}`

            interface IApiResponse {
                rank: number;
                total_supply: number;
                beta_value: number;
                quotes: {
                    USD: {
                        price: number;
                        volume_24h: number;
                        volume_24h_change_24h: number;
                        market_cap: number;
                        percent_change_24h: number;
                        percent_change_7d: number;
                        percent_change_30d: number;
                        percent_change_1y: number;
                        ath_price: number;
                        ath_date: string;
                        percent_from_price_ath: number;
                    };
                }
            }
            const {
                rank,
                total_supply,
                beta_value,
                quotes: {
                    USD: {
                        price,
                        volume_24h,
                        market_cap,
                        percent_change_24h,
                        percent_change_7d,
                        percent_change_30d,
                        percent_change_1y,
                        ath_price,
                        ath_date,
                        percent_from_price_ath
                    }
                }
            }: IApiResponse = await fetch(url).then(data => data.json())

            const totalPrice = quantity !== 1 ? price * quantity : price;

            const formatCurrency = (value: number) => `$${value.toFixed(2)}`;
            const formatPercent = (value: number) => `${value.toFixed(2)}%`;

            const priceText = quantity === 1 ? `Current price: ${formatCurrency(price)}` : `Total price for ${quantity} ${ticker}: ${formatCurrency(totalPrice)}`;

            const statsText = [
                `Rank: ${rank}`,
                `Market Cap: ${formatCurrency(market_cap)}`,
                `24h Volume: ${formatCurrency(volume_24h)}`,
                `Price change in the last 24h: ${formatPercent(percent_change_24h)}`,
                `Price change in the last 7d: ${formatPercent(percent_change_7d)}`,
                `Price change in the last 30d: ${formatPercent(percent_change_30d)}`,
                `Price change in the last 1y: ${formatPercent(percent_change_1y)}`,
                `All-Time High: ${formatCurrency(ath_price)} on ${new Date(ath_date).toLocaleDateString()}`,
                `Currently ${formatPercent(percent_from_price_ath)} from ATH`,
                `Total Supply: ${total_supply.toLocaleString()}`,
                `Beta value: ${beta_value.toFixed(2)}`
            ];

            const fullInfo = [
                `=== ${name.toUpperCase()} (${ticker}) ===`,
                priceText,
                ...statsText
            ].map(s => s.trim()).join("\n");

            return {
                content: [
                    {
                        type: "text",
                        text: fullInfo,
                    },
                ],
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to retrieve cryptocurrency data",
                    },
                ],
            }
        }
    }
)

mcpServer.registerTool(
    'search_news',
    {
        title: 'search_news',
        description: 
            `Search recent news on the web. 
            **DO NOT USE IT** when you are asked about crypto token price or market metrics - these metrics should be queried using a different tool designed for that purpose.`,
        inputSchema: WebSearchToolShape
    },
    async ({ query }) => {
        const apiKey = process.env.TAVILY_API_KEY

        const body = {
            query,
            topic: 'news',
            search_depth: 'basic',
            max_results: 6,
            days: 1,
            include_answer: true
        }

        try {
            const res = await fetch("https://api.tavily.com/search", {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            })

            interface TavilySource {
                url: string;
                title: string;
                content: string;
                raw_content?: string;
                published_date: string
            }
            interface TavilyResponse {
                answer?: string;
                results: TavilySource[];
            }

            const { answer, results } = await res.json() as TavilyResponse

            if (!results.length) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `No news found for query: "${query}". Try refining the query.`,
                        }
                    ]
                }
            }

            const digest = [
                answer ?? 'No preview answer',
                ...results.map((r, i) => `[${i+1}]: ${r.url}\n${r.content}`)
            ].join('\n')

            const links = results.map((r) => ({
                type: 'resource_link' as const,
                name: r.title ?? r.url,
                uri: r.url
            }))

            return {
                content: [
                    {
                        type: 'text',
                        text: digest
                    },
                    ...links
                ]
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `News search error: ${String(error)}`,
                    }
                ],
                isError: true
            }
        }
    }
)

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
log.error("MCP Server started (stdio).");

function shutdown(reason: string, exitCode = 0) {
    log.error(`Shutting down MCP server: ${reason}`);

    mcpServer.close().finally(() => {
        process.exit(exitCode);
    });
}

// stdin closed
process.stdin.once("close", () => shutdown("stdio closed"));

// CTRL+C
process.once("SIGINT", () => shutdown("SIGINT", 130));

// Docker stop / systemctl
process.once("SIGTERM", () => shutdown("SIGTERM", 143));
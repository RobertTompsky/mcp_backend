import z, { type ZodRawShape } from "zod";

export const cryptoInputShape = {
    ticker: z
        .string()
        .describe(
            "The official ticker symbol of the cryptocurrency, a short, uppercase code used" +
            "on exchanges and in APIs (e.g., 'BTC' for Bitcoin, 'ETH' for Ethereum, 'SOL' for Solana)."
        ),
    name: z
        .string()
        .describe(
            "The official name of the cryptocurrency used on exchanges and in APIs" +
            "(e.g., 'bitcoin', 'ethereum', 'dogecoin')."
        ),
    quantity: z
        .number()
        .positive()
        .describe(
            'The amount of cryptocurrency. Defaults to 1 if not specified'
        ),
} satisfies ZodRawShape

export const cryptoInputSchema = z.object(cryptoInputShape)

export const newsSearchInputShape = {
    query: z
        .string()
        .min(1)
        .describe("News/search query, e.g. 'bitcoin spot ETF flows'")
}

export const newsSearchSchema = z.object(newsSearchInputShape)
import z from "zod";

export const CryptoToolShape = {
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
}

export const cryptoInputSchema = z.object(CryptoToolShape)

export const WebSearchToolShape = {
  query: z
    .string()
    .min(1)
    .describe("News/search query, e.g. 'bitcoin spot ETF flows'"),
}

export const newsSearchSchema = z.object(WebSearchToolShape)
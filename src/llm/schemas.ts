import z from "zod";

export const InputSchema = z.object({
    query: z.string().nullable(),
    options: z.object({
        previousResponseId: z.string().optional(),
    }).optional()
})
import z from "zod";

export const CodeGenSchema = z.object({
  code: z.string().min(1)
})
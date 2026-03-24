import { z } from "zod";

export const formSubmissionSchema = z.object({
    correlationId: z.string().uuid(),
    name: z.string().min(1).max(200),
    email: z.string().email().max(320),
    phone: z.string().min(3).max(50),
    product: z.enum(["azure", "m365"]),
    correctionConfirmed: z.boolean().optional().default(false),
    correctionNote: z.string().max(500).optional(),
});

export type FormSubmission = z.infer<typeof formSubmissionSchema>;

export type SendEmailInput = FormSubmission;

export const correctionSubmitSchema = z.object({
    correlationId: z.string().uuid(),
    correctionConfirmed: z.boolean().optional(),
    name: z.string().min(1).max(200).optional(),
    email: z.string().email().max(320).optional(),
    phone: z.string().min(3).max(50).optional(),
    correctionNote: z.string().max(500).optional(),
});

export type CorrectionSubmit = z.infer<typeof correctionSubmitSchema>;

export type MockApiResult = { ok: true } | { ok: false; error: string };

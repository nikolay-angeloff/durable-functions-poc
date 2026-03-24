import { z } from "zod";

export const formSubmissionSchema = z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(320),
    phone: z.string().min(3).max(50),
    product: z.enum(["azure", "m365"]),
});

export type FormSubmission = z.infer<typeof formSubmissionSchema>;

export type SendEmailInput = FormSubmission;

import { InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import type { SendEmailInput } from "../lib/types";
import { demoStepDelayMs } from "../lib/demoStepDelay";
import { getAcsEmailConfig, sendAcsPlainTextEmail } from "../lib/acsEmail";

df.app.activity("sendEmail", {
    handler: async (input: SendEmailInput, context: InvocationContext) => {
        await demoStepDelayMs();

        if (!getAcsEmailConfig()) {
            context.log(
                "AZURE_COMMUNICATION_CONNECTION_STRING or ACS_EMAIL_SENDER not set; skipping email."
            );
            return { sent: false, reason: "email-not-configured" };
        }

        const productLabel = input.product === "azure" ? "Azure" : "Microsoft 365";
        const plainText = [
            `Hello ${input.name},`,
            ``,
            `Your ${productLabel} request was processed.`,
            `Phone on file: ${input.phone}`,
            input.correctionNote ? `Note: ${input.correctionNote}` : ``,
            ``,
            `This is a demo message from Azure Durable Functions (Azure Communication Services Email).`,
        ]
            .filter(Boolean)
            .join("\n");

        try {
            await sendAcsPlainTextEmail({
                to: input.email,
                subject: `[Demo] ${productLabel} flow completed`,
                plainText,
            });
            return { sent: true };
        } catch (err) {
            context.log(
                `ACS Email send failed: ${err instanceof Error ? err.message : String(err)}`
            );
            throw err;
        }
    },
});

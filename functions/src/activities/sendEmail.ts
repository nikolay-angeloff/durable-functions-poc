import { InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import sgMail from "@sendgrid/mail";
import type { SendEmailInput } from "../lib/types";

df.app.activity("sendEmail", {
    handler: async (input: SendEmailInput, context: InvocationContext) => {
        const apiKey = process.env.SENDGRID_API_KEY;
        const from = process.env.SENDGRID_FROM_EMAIL;

        if (!apiKey || !from) {
            context.log(
                "SENDGRID_API_KEY or SENDGRID_FROM_EMAIL not set; skipping email (local/dev)."
            );
            return { sent: false, reason: "email-not-configured" };
        }

        sgMail.setApiKey(apiKey);
        const productLabel = input.product === "azure" ? "Azure" : "Microsoft 365";

        await sgMail.send({
            to: input.email,
            from,
            subject: `[Demo] ${productLabel} flow completed`,
            text: [
                `Hello ${input.name},`,
                ``,
                `Your ${productLabel} request was processed.`,
                `Phone on file: ${input.phone}`,
                ``,
                `This is a demo message from Azure Durable Functions.`,
            ].join("\n"),
        });

        return { sent: true };
    },
});

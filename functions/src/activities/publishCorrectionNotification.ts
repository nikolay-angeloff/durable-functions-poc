import { InvocationContext } from "@azure/functions";
import { ServiceBusClient } from "@azure/service-bus";
import * as df from "durable-functions";
import { QUEUE_CORRECTION_NEEDED } from "../lib/constants";
import { getAcsEmailConfig, sendAcsPlainTextEmail } from "../lib/acsEmail";
import type { FormSubmission } from "../lib/types";

export type PublishCorrectionInput = {
    instanceId: string;
    correlationId: string;
    form: FormSubmission;
    flow: "azure" | "m365";
    /** Azure parallel validate+enrich join: all failures in one notification. */
    phase?: "parallelValidateEnrich" | "singleStep";
    aggregatedFailures?: { step: string; error: string }[];
    failedStep?: string;
    error?: string | undefined;
};

/** Loose UUID shape check before putting correlationId in a URL. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildResumeUrl(correlationId: string): string | undefined {
    const base = process.env.WEB_APP_BASE_URL?.trim().replace(/\/$/, "");
    if (!base || !UUID_RE.test(correlationId)) {
        return undefined;
    }
    return `${base}/?correlationId=${encodeURIComponent(correlationId)}`;
}

/** ACS Email with SPA link ?correlationId=… so the user can open the app and continue the same inquiry. */
async function sendCorrectionResumeEmail(
    input: PublishCorrectionInput,
    failedStep: string,
    context: InvocationContext
): Promise<void> {
    const to = input.form.email;
    const resumeUrl = buildResumeUrl(input.correlationId);

    if (!getAcsEmailConfig()) {
        context.log(
            "AZURE_COMMUNICATION_CONNECTION_STRING or ACS_EMAIL_SENDER not set; skip correction resume email"
        );
        return;
    }
    if (!resumeUrl) {
        context.log(
            "WEB_APP_BASE_URL missing or invalid correlationId; skip correction resume email"
        );
        return;
    }

    const productLabel = input.flow === "azure" ? "Azure" : "Microsoft 365";
    const failureSummary =
        input.aggregatedFailures && input.aggregatedFailures.length > 0
            ? input.aggregatedFailures.map((f) => `${f.step}: ${f.error}`).join("\n")
            : input.error ?? "(see orchestration status)";

    const plainText = [
        `Hello ${input.form.name},`,
        ``,
        `Your ${productLabel} workflow paused because a step needs a correction.`,
        `Failed step(s): ${failedStep}`,
        ``,
        `Open this link to continue the same inquiry (correlation ID is pre-filled):`,
        resumeUrl,
        ``,
        `Inquiry ID (correlation): ${input.correlationId}`,
        ``,
        `Details:`,
        failureSummary,
        ``,
        `This is a demo message from Azure Durable Functions (Azure Communication Services Email).`,
    ].join("\n");

    await sendAcsPlainTextEmail({
        to,
        subject: `[Demo] Action needed — ${productLabel} request (correction)`,
        plainText,
    });

    context.log(`Sent correction resume email to ${to}`);
}

df.app.activity("publishCorrectionNotification", {
    handler: async (input: PublishCorrectionInput, context: InvocationContext) => {
        const failedStep =
            input.aggregatedFailures && input.aggregatedFailures.length > 0
                ? input.aggregatedFailures.map((f) => f.step).join("+")
                : input.failedStep ?? "unknown";

        const body = {
            type: "correction-needed",
            flow: input.flow,
            phase: input.phase,
            instanceId: input.instanceId,
            correlationId: input.correlationId,
            failedStep,
            error: input.error,
            aggregatedFailures: input.aggregatedFailures,
            product: input.form.product,
            formSnapshot: {
                name: input.form.name,
                email: input.form.email,
                phone: input.form.phone,
            },
            hint: "Web: GET /api/orchestration-status ; POST /api/correction with same correlationId",
        };

        const conn = process.env.ServiceBusConnection;
        if (conn) {
            try {
                const client = new ServiceBusClient(conn);
                try {
                    const sender = client.createSender(QUEUE_CORRECTION_NEEDED);
                    await sender.sendMessages({
                        body,
                        contentType: "application/json",
                        correlationId: input.correlationId,
                        applicationProperties: {
                            flow: input.flow,
                            failedStep,
                            phase: input.phase ?? "",
                        },
                    });
                    await sender.close();
                } finally {
                    await client.close();
                }
                context.log(`Published correction-needed (${input.flow}) for instance ${input.instanceId}`);
            } catch (err) {
                context.log(
                    `Service Bus correction-needed publish failed: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        } else {
            context.log("ServiceBusConnection missing; skip correction queue publish");
        }

        try {
            await sendCorrectionResumeEmail(input, failedStep, context);
        } catch (err) {
            context.log(
                `Correction resume email failed: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    },
});

import { InvocationContext } from "@azure/functions";
import { ServiceBusClient } from "@azure/service-bus";
import * as df from "durable-functions";
import { QUEUE_CORRECTION_NEEDED } from "../lib/constants";
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

df.app.activity("publishCorrectionNotification", {
    handler: async (input: PublishCorrectionInput, context: InvocationContext) => {
        const conn = process.env.ServiceBusConnection;
        if (!conn) {
            context.log("ServiceBusConnection missing; skip correction queue publish");
            return;
        }

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
    },
});

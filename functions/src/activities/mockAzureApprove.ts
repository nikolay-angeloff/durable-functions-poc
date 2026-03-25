import { InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import type { FormSubmission, MockApiResult } from "../lib/types";
import { demoStepDelayMs } from "../lib/demoStepDelay";

/** Mock risk / human approval gate (isolated activity). */
df.app.activity("mockAzureApprove", {
    handler: async (
        input: { form: FormSubmission },
        context: InvocationContext
    ): Promise<MockApiResult> => {
        await demoStepDelayMs();
        const { form } = input;
        context.log(`mockAzureApprove for ${form.email}`);

        if (!form.correctionConfirmed) {
            return {
                ok: false,
                error: "[Azure] Risk gate: human confirmation required before provisioning (mock)",
            };
        }
        return { ok: true };
    },
});

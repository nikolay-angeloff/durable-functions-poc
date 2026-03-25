import { InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import type { FormSubmission, MockApiResult } from "../lib/types";
import { demoStepDelayMs } from "../lib/demoStepDelay";

/** Mock enrichment / policy on display name (isolated activity). */
df.app.activity("mockAzureEnrich", {
    handler: async (
        input: { form: FormSubmission },
        context: InvocationContext
    ): Promise<MockApiResult> => {
        await demoStepDelayMs();
        const { form } = input;
        context.log(`mockAzureEnrich for ${form.email}`);

        if (form.name.toUpperCase().includes("BLOCK")) {
            return { ok: false, error: "[Azure] Enrichment blocked — policy on display name (mock)" };
        }
        return { ok: true };
    },
});

import { InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import type { FormSubmission, MockApiResult } from "../lib/types";

/** Azure-only mock pipeline: resource validation → enrichment → risk approval */
export type AzureStepName = "validate" | "enrich" | "approve";

df.app.activity("mockAzureStep", {
    handler: async (
        input: { stepName: AzureStepName; form: FormSubmission },
        context: InvocationContext
    ): Promise<MockApiResult> => {
        const { stepName, form } = input;
        context.log(`mockAzureStep ${stepName} for ${form.email}`);

        if (stepName === "validate") {
            if (form.name.trim().length < 2) {
                return { ok: false, error: "[Azure] Name too short (mock ARM validation)" };
            }
            return { ok: true };
        }

        if (stepName === "enrich") {
            if (form.name.toUpperCase().includes("BLOCK")) {
                return { ok: false, error: "[Azure] Enrichment blocked — policy on display name (mock)" };
            }
            return { ok: true };
        }

        if (stepName === "approve") {
            if (!form.correctionConfirmed) {
                return {
                    ok: false,
                    error: "[Azure] Risk gate: human confirmation required before provisioning (mock)",
                };
            }
            return { ok: true };
        }

        return { ok: true };
    },
});

import { InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import type { FormSubmission, MockApiResult } from "../lib/types";
import { demoStepDelayMs } from "../lib/demoStepDelay";

/** Mock ARM-style name validation (isolated activity). */
df.app.activity("mockAzureValidate", {
    handler: async (
        input: { form: FormSubmission },
        context: InvocationContext
    ): Promise<MockApiResult> => {
        await demoStepDelayMs();
        const { form } = input;
        context.log(`mockAzureValidate for ${form.email}`);

        if (form.name.trim().length < 2) {
            return { ok: false, error: "[Azure] Name too short (mock ARM validation)" };
        }
        return { ok: true };
    },
});

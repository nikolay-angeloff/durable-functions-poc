import { InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import type { FormSubmission, MockApiResult } from "../lib/types";
import { demoStepDelayMs } from "../lib/demoStepDelay";

/** Mock admin consent / SoR gate (isolated activity). */
df.app.activity("mockM365ConsentGate", {
    handler: async (
        input: { form: FormSubmission },
        context: InvocationContext
    ): Promise<MockApiResult> => {
        await demoStepDelayMs();
        const { form } = input;
        context.log(`mockM365ConsentGate for ${form.email}`);

        if (!form.correctionConfirmed) {
            return {
                ok: false,
                error: "[M365] Admin consent / SoR acknowledgement not recorded (mock)",
            };
        }
        return { ok: true };
    },
});

import { InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import type { FormSubmission, MockApiResult } from "../lib/types";

/** Mock admin consent / SoR gate (isolated activity). */
df.app.activity("mockM365ConsentGate", {
    handler: async (
        input: { form: FormSubmission },
        context: InvocationContext
    ): Promise<MockApiResult> => {
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

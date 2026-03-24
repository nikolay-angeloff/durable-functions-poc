import { InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import type { FormSubmission, MockApiResult } from "../lib/types";

function digitCount(s: string): number {
    return (s.match(/\d/g) ?? []).length;
}

/** Mock license / contact validation (isolated activity). */
df.app.activity("mockM365LicenseCheck", {
    handler: async (
        input: { form: FormSubmission },
        context: InvocationContext
    ): Promise<MockApiResult> => {
        const { form } = input;
        context.log(`mockM365LicenseCheck for ${form.email}`);

        if (digitCount(form.phone) < 10) {
            return {
                ok: false,
                error: "[M365] License / contact validation — need at least 10 digits in phone (mock)",
            };
        }
        return { ok: true };
    },
});

import { InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import type { FormSubmission, MockApiResult } from "../lib/types";
import { demoStepDelayMs } from "../lib/demoStepDelay";

/** Mock Entra / tenant readiness (isolated activity). */
df.app.activity("mockM365TenantReadiness", {
    handler: async (
        input: { form: FormSubmission },
        context: InvocationContext
    ): Promise<MockApiResult> => {
        await demoStepDelayMs();
        const { form } = input;
        context.log(`mockM365TenantReadiness for ${form.email}`);

        if (form.name.toUpperCase().includes("NOTENANT")) {
            return {
                ok: false,
                error: "[M365] Tenant readiness failed — marker NOTENANT in name (mock Entra check)",
            };
        }
        if (!form.email.includes("@")) {
            return { ok: false, error: "[M365] Invalid email for tenant routing (mock)" };
        }
        return { ok: true };
    },
});

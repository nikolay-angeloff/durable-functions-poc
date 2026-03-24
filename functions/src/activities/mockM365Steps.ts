import { InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import type { FormSubmission, MockApiResult } from "../lib/types";

/** M365-only mock pipeline: Entra → licensing → admin consent (different rules from Azure) */
export type M365StepName = "tenantReadiness" | "licenseCheck" | "consentGate";

function digitCount(s: string): number {
    return (s.match(/\d/g) ?? []).length;
}

df.app.activity("mockM365Step", {
    handler: async (
        input: { stepName: M365StepName; form: FormSubmission },
        context: InvocationContext
    ): Promise<MockApiResult> => {
        const { stepName, form } = input;
        context.log(`mockM365Step ${stepName} for ${form.email}`);

        if (stepName === "tenantReadiness") {
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
        }

        if (stepName === "licenseCheck") {
            if (digitCount(form.phone) < 10) {
                return {
                    ok: false,
                    error: "[M365] License / contact validation — need at least 10 digits in phone (mock)",
                };
            }
            return { ok: true };
        }

        if (stepName === "consentGate") {
            if (!form.correctionConfirmed) {
                return {
                    ok: false,
                    error: "[M365] Admin consent / SoR acknowledgement not recorded (mock)",
                };
            }
            return { ok: true };
        }

        return { ok: true };
    },
});

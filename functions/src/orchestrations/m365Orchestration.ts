import * as df from "durable-functions";
import type { OrchestrationContext, OrchestrationHandler } from "durable-functions";
import type { FormSubmission, MockApiResult } from "../lib/types";

/** Logical step id (for custom status / failedStep); maps to one activity each. */
export type M365StepName = "tenantReadiness" | "licenseCheck" | "consentGate";

const ACTIVITY_BY_STEP: Record<M365StepName, string> = {
    tenantReadiness: "mockM365TenantReadiness",
    licenseCheck: "mockM365LicenseCheck",
    consentGate: "mockM365ConsentGate",
};

const M365_STEPS: readonly M365StepName[] = ["tenantReadiness", "licenseCheck", "consentGate"];

/**
 * Microsoft 365 path: Entra tenant → license/contact → consent gate.
 * Each step is a separate Azure Function activity.
 */
const m365OrchestrationHandler: OrchestrationHandler = function* (
    context: OrchestrationContext
) {
    const input = context.df.getInput<FormSubmission>();
    let form: FormSubmission = {
        ...input,
        product: "m365",
        correctionConfirmed: input.correctionConfirmed ?? false,
    };

    yield context.df.callActivity("registerCorrelation", {
        correlationId: form.correlationId,
        instanceId: context.df.instanceId,
    });

    for (const stepName of M365_STEPS) {
        const activityName = ACTIVITY_BY_STEP[stepName];
        let stepResult = (yield context.df.callActivity(activityName, {
            form,
        })) as MockApiResult;

        while (!stepResult.ok) {
            yield context.df.callActivity("publishCorrectionNotification", {
                instanceId: context.df.instanceId,
                correlationId: form.correlationId,
                failedStep: stepName,
                error: stepResult.ok ? undefined : stepResult.error,
                form,
                flow: "m365",
            });

            context.df.setCustomStatus({
                flow: "m365",
                waitingForCorrection: true,
                failedStep: stepName,
                reason: stepResult.ok ? undefined : stepResult.error,
            });

            const correction = (yield context.df.waitForExternalEvent(
                "CorrectionSubmitted"
            )) as Partial<FormSubmission>;

            form = {
                ...form,
                ...correction,
                product: "m365",
                correlationId: form.correlationId,
            };

            stepResult = (yield context.df.callActivity(activityName, {
                form,
            })) as MockApiResult;
        }
    }

    context.df.setCustomStatus({
        flow: "m365",
        waitingForCorrection: false,
        completedSteps: M365_STEPS.length,
    });

    return yield context.df.callActivity("sendEmail", form);
};

df.app.orchestration("m365Orchestration", m365OrchestrationHandler);

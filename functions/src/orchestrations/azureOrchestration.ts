import * as df from "durable-functions";
import type { OrchestrationContext, OrchestrationHandler } from "durable-functions";
import type { FormSubmission, MockApiResult } from "../lib/types";

/**
 * Azure path: parallel validate + enrich (join), then risk approval.
 * Parallel failures are surfaced in one correction round with all errors.
 */
const azureOrchestrationHandler: OrchestrationHandler = function* (
    context: OrchestrationContext
) {
    const input = context.df.getInput<FormSubmission>();
    let form: FormSubmission = {
        ...input,
        product: "azure",
        correctionConfirmed: input.correctionConfirmed ?? false,
    };

    yield context.df.callActivity("registerCorrelation", {
        correlationId: form.correlationId,
        instanceId: context.df.instanceId,
    });

    // Fan-out / fan-in: validate and enrich run in parallel; one inquiry with all failures.
    let parallelDone = false;
    while (!parallelDone) {
        context.df.setCustomStatus({
            flow: "azure",
            waitingForCorrection: false,
            phase: "parallelValidateEnrich",
            currentStep: "parallelValidateEnrich",
        });

        const tValidate = context.df.callActivity("mockAzureValidate", { form });
        const tEnrich = context.df.callActivity("mockAzureEnrich", { form });
        const batch = (yield context.df.Task.all([tValidate, tEnrich])) as MockApiResult[];

        const validateResult = batch[0];
        const enrichResult = batch[1];

        if (validateResult.ok && enrichResult.ok) {
            parallelDone = true;
            break;
        }

        const aggregatedFailures: { step: string; error: string }[] = [];
        if (!validateResult.ok) {
            aggregatedFailures.push({ step: "validate", error: validateResult.error });
        }
        if (!enrichResult.ok) {
            aggregatedFailures.push({ step: "enrich", error: enrichResult.error });
        }

        yield context.df.callActivity("publishCorrectionNotification", {
            instanceId: context.df.instanceId,
            correlationId: form.correlationId,
            form,
            flow: "azure",
            phase: "parallelValidateEnrich",
            aggregatedFailures,
        });

        context.df.setCustomStatus({
            flow: "azure",
            waitingForCorrection: true,
            phase: "parallelValidateEnrich",
            currentStep: "parallelValidateEnrich",
            aggregatedFailures,
        });

        const correction = (yield context.df.waitForExternalEvent(
            "CorrectionSubmitted"
        )) as Partial<FormSubmission>;

        form = {
            ...form,
            ...correction,
            product: "azure",
            correlationId: form.correlationId,
        };
    }

    // Sequential approve (single-step correction loop as before).
    const stepName = "approve";
    context.df.setCustomStatus({
        flow: "azure",
        waitingForCorrection: false,
        phase: "singleStep",
        currentStep: stepName,
    });

    let stepResult = (yield context.df.callActivity("mockAzureApprove", { form })) as MockApiResult;

    while (!stepResult.ok) {
        yield context.df.callActivity("publishCorrectionNotification", {
            instanceId: context.df.instanceId,
            correlationId: form.correlationId,
            failedStep: stepName,
            error: stepResult.ok ? undefined : stepResult.error,
            form,
            flow: "azure",
            phase: "singleStep",
        });

        context.df.setCustomStatus({
            flow: "azure",
            waitingForCorrection: true,
            phase: "singleStep",
            currentStep: stepName,
            failedStep: stepName,
            reason: stepResult.ok ? undefined : stepResult.error,
        });

        const correction = (yield context.df.waitForExternalEvent(
            "CorrectionSubmitted"
        )) as Partial<FormSubmission>;

        form = {
            ...form,
            ...correction,
            product: "azure",
            correlationId: form.correlationId,
        };

        context.df.setCustomStatus({
            flow: "azure",
            waitingForCorrection: false,
            phase: "singleStep",
            currentStep: stepName,
        });

        stepResult = (yield context.df.callActivity("mockAzureApprove", { form })) as MockApiResult;
    }

    context.df.setCustomStatus({
        flow: "azure",
        waitingForCorrection: false,
        completedSteps: 3,
        currentStep: "sendEmail",
    });

    return yield context.df.callActivity("sendEmail", form);
};

df.app.orchestration("azureOrchestration", azureOrchestrationHandler);

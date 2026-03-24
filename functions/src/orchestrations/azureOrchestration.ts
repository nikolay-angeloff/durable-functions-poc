import * as df from "durable-functions";
import type { OrchestrationContext } from "durable-functions";
import type { FormSubmission } from "../lib/types";

df.app.orchestration("azureOrchestration", function* (context: OrchestrationContext) {
    const input = context.df.getInput<FormSubmission>();
    const payload: FormSubmission = { ...input, product: "azure" };
    const result = yield context.df.callActivity("sendEmail", payload);
    return result;
});

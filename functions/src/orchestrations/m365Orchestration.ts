import * as df from "durable-functions";
import type { OrchestrationContext } from "durable-functions";
import type { FormSubmission } from "../lib/types";

df.app.orchestration("m365Orchestration", function* (context: OrchestrationContext) {
    const input = context.df.getInput<FormSubmission>();
    const payload: FormSubmission = { ...input, product: "m365" };
    const result = yield context.df.callActivity("sendEmail", payload);
    return result;
});

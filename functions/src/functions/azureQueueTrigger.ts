import * as df from "durable-functions";
import { QUEUE_AZURE } from "../lib/constants";
import type { FormSubmission } from "../lib/types";
import { parseServiceBusMessage } from "../lib/parseServiceBusMessage";

df.app.client.serviceBusQueue("startAzureOrchestration", {
    connection: "ServiceBusConnection",
    queueName: QUEUE_AZURE,
    handler: async (message: unknown, client, context) => {
        const body = parseServiceBusMessage<FormSubmission>(message);
        const instanceId = await client.startNew("azureOrchestration", { input: body });
        context.log(`Started azureOrchestration instanceId=${instanceId}`);
    },
});

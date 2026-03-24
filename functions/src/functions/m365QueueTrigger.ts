import * as df from "durable-functions";
import { QUEUE_M365 } from "../lib/constants";
import type { FormSubmission } from "../lib/types";
import { parseServiceBusMessage } from "../lib/parseServiceBusMessage";

df.app.client.serviceBusQueue("startM365Orchestration", {
    connection: "ServiceBusConnection",
    queueName: QUEUE_M365,
    handler: async (message: unknown, client, context) => {
        const body = parseServiceBusMessage<FormSubmission>(message);
        const instanceId = await client.startNew("m365Orchestration", { input: body });
        context.log(`Started m365Orchestration instanceId=${instanceId}`);
    },
});

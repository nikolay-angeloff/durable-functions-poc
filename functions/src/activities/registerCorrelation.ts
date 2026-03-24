import { InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import { ensureCorrelationTable, getCorrelationTableClient } from "../lib/correlationTable";

df.app.activity("registerCorrelation", {
    handler: async (
        input: { correlationId: string; instanceId: string },
        context: InvocationContext
    ) => {
        await ensureCorrelationTable();
        const client = getCorrelationTableClient();
        await client.upsertEntity({
            partitionKey: input.correlationId,
            rowKey: "instance",
            instanceId: input.instanceId,
        });
        context.log(`Registered correlation ${input.correlationId} -> ${input.instanceId}`);
    },
});

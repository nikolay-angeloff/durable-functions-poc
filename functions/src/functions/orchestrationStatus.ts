import { app, HttpRequest, InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import { corsHeaders } from "../lib/cors";
import { getInstanceIdForCorrelation } from "../lib/correlationTable";

app.http("orchestrationStatus", {
    methods: ["GET", "OPTIONS"],
    route: "orchestration-status",
    authLevel: "anonymous",
    extraInputs: [df.input.durableClient()],
    handler: async (request: HttpRequest, context: InvocationContext) => {
        const origin = request.headers.get("origin") ?? undefined;

        if (request.method === "OPTIONS") {
            return { status: 204, headers: corsHeaders(origin) };
        }

        const correlationId = request.query.get("correlationId");
        if (!correlationId) {
            return {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
                jsonBody: { error: "Missing correlationId query parameter" },
            };
        }

        const instanceId = await getInstanceIdForCorrelation(correlationId);
        if (!instanceId) {
            return {
                status: 404,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
                jsonBody: { error: "Unknown correlationId (orchestration not registered yet)" },
            };
        }

        const client = df.getClient(context);
        const status = await client.getStatus(instanceId, {
            showInput: true,
            showHistory: false,
        });

        return {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
            jsonBody: {
                instanceId,
                correlationId,
                runtimeStatus: status?.runtimeStatus,
                customStatus: status?.customStatus,
                input: status?.input,
                output: status?.output,
            },
        };
    },
});

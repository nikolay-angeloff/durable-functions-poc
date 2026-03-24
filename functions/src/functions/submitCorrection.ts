import { app, HttpRequest, InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import { corsHeaders } from "../lib/cors";
import { getInstanceIdForCorrelation } from "../lib/correlationTable";
import { correctionSubmitSchema } from "../lib/types";

app.http("submitCorrection", {
    methods: ["POST", "OPTIONS"],
    route: "correction",
    authLevel: "anonymous",
    extraInputs: [df.input.durableClient()],
    handler: async (request: HttpRequest, context: InvocationContext) => {
        const origin = request.headers.get("origin") ?? undefined;

        if (request.method === "OPTIONS") {
            return { status: 204, headers: corsHeaders(origin) };
        }

        let json: unknown;
        try {
            json = await request.json();
        } catch {
            return {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
                jsonBody: { error: "Invalid JSON body" },
            };
        }

        const parsed = correctionSubmitSchema.safeParse(json);
        if (!parsed.success) {
            return {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
                jsonBody: { error: "Validation failed", details: parsed.error.flatten() },
            };
        }

        const { correlationId, ...rest } = parsed.data;
        const instanceId = await getInstanceIdForCorrelation(correlationId);
        if (!instanceId) {
            return {
                status: 404,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
                jsonBody: { error: "Unknown correlationId" },
            };
        }

        const client = df.getClient(context);
        await client.raiseEvent(instanceId, "CorrectionSubmitted", {
            ...rest,
            correctionConfirmed: rest.correctionConfirmed ?? true,
        });

        return {
            status: 202,
            headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
            jsonBody: { accepted: true, instanceId },
        };
    },
});

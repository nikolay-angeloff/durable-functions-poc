import { app, HttpRequest, InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import { corsHeaders } from "../lib/cors";
import { formSubmissionSchema } from "../lib/types";

function iso(d: Date | string): string {
    if (d instanceof Date) {
        return d.toISOString();
    }
    return new Date(d).toISOString();
}

app.http("orchestrationMonitor", {
    methods: ["GET", "OPTIONS"],
    route: "orchestration-monitor",
    authLevel: "anonymous",
    extraInputs: [df.input.durableClient()],
    handler: async (request: HttpRequest, context: InvocationContext) => {
        const origin = request.headers.get("origin") ?? undefined;

        if (request.method === "OPTIONS") {
            return { status: 204, headers: corsHeaders(origin) };
        }

        const expected = process.env.MONITOR_DASHBOARD_KEY;
        if (expected) {
            const provided =
                request.headers.get("x-monitor-key") ?? request.query.get("key") ?? "";
            if (provided !== expected) {
                return {
                    status: 401,
                    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
                    jsonBody: { error: "Unauthorized — set X-Monitor-Key header or ?key= (MONITOR_DASHBOARD_KEY on Function App)" },
                };
            }
        }

        const limitRaw = request.query.get("limit");
        const limit = Math.min(Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1), 200);

        const client = df.getClient(context);
        const all = await client.getStatusAll();

        const sorted = [...all].sort(
            (a, b) => iso(b.lastUpdatedTime).localeCompare(iso(a.lastUpdatedTime))
        );
        const slice = sorted.slice(0, limit);

        const instances = slice.map((s) => {
            let correlationId: string | undefined;
            let product: string | undefined;
            let email: string | undefined;
            let name: string | undefined;

            const parsed = formSubmissionSchema.safeParse(s.input);
            if (parsed.success) {
                correlationId = parsed.data.correlationId;
                product = parsed.data.product;
                email = parsed.data.email;
                name = parsed.data.name;
            }

            return {
                instanceId: s.instanceId,
                orchestratorName: s.name,
                runtimeStatus: String(s.runtimeStatus),
                createdTime: iso(s.createdTime),
                lastUpdatedTime: iso(s.lastUpdatedTime),
                correlationId,
                product,
                email,
                submitterName: name,
                customStatus: s.customStatus ?? null,
            };
        });

        return {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
            jsonBody: {
                taskHubName: client.taskHubName,
                count: instances.length,
                totalInHub: all.length,
                instances,
            },
        };
    },
});

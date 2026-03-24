import { app, HttpRequest, InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import { corsHeaders } from "../lib/cors";
import { formSubmissionSchema } from "../lib/types";
import { parseDurableHistory } from "../lib/durableHistory";

function iso(d: Date | string): string {
    if (d instanceof Date) {
        return d.toISOString();
    }
    return new Date(d).toISOString();
}

function checkMonitorKey(request: HttpRequest): boolean {
    const expected = process.env.MONITOR_DASHBOARD_KEY;
    if (!expected) {
        return true;
    }
    const provided = request.headers.get("x-monitor-key") ?? request.query.get("key") ?? "";
    return provided === expected;
}

app.http("orchestrationMonitorDetail", {
    methods: ["GET", "OPTIONS"],
    route: "orchestration-monitor-detail",
    authLevel: "anonymous",
    extraInputs: [df.input.durableClient()],
    handler: async (request: HttpRequest, context: InvocationContext) => {
        const origin = request.headers.get("origin") ?? undefined;

        if (request.method === "OPTIONS") {
            return { status: 204, headers: corsHeaders(origin) };
        }

        if (!checkMonitorKey(request)) {
            return {
                status: 401,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
                jsonBody: { error: "Unauthorized — set X-Monitor-Key or ?key= (MONITOR_DASHBOARD_KEY)" },
            };
        }

        const instanceId = request.query.get("instanceId")?.trim();
        if (!instanceId) {
            return {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
                jsonBody: { error: "Missing instanceId query parameter" },
            };
        }

        const client = df.getClient(context);
        const status = await client.getStatus(instanceId, {
            showHistory: true,
            showHistoryOutput: true,
            showInput: true,
        });

        if (!status) {
            return {
                status: 404,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
                jsonBody: { error: "Instance not found" },
            };
        }

        const history = status.history ?? [];
        const parsed = parseDurableHistory(history);

        let correlationId: string | undefined;
        let product: string | undefined;
        const parsedInput = formSubmissionSchema.safeParse(status.input);
        if (parsedInput.success) {
            correlationId = parsedInput.data.correlationId;
            product = parsedInput.data.product;
        }

        /** Event index -> ms from first event for simple line chart */
        const firstTs = parsed.timeline[0]?.timestamp;
        const t0 = firstTs ? Date.parse(firstTs) : 0;
        const eventTimeline =
            t0 > 0
                ? parsed.timeline.map((row, i) => ({
                      index: i,
                      label: row.label,
                      offsetMs: Math.max(0, Date.parse(row.timestamp) - t0),
                  }))
                : [];

        return {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
            jsonBody: {
                instanceId: status.instanceId,
                orchestratorName: status.name,
                runtimeStatus: String(status.runtimeStatus),
                createdTime: iso(status.createdTime),
                lastUpdatedTime: iso(status.lastUpdatedTime),
                correlationId,
                product,
                customStatus: status.customStatus ?? null,
                input: status.input,
                output: status.output,
                historyEventCount: history.length,
                parsed: {
                    timeline: parsed.timeline,
                    activityDurations: parsed.activityDurations,
                    flowSteps: parsed.flowSteps,
                    eventTimeline,
                },
            },
        };
    },
});

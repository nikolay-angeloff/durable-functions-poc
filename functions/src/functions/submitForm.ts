import { app, HttpRequest, InvocationContext } from "@azure/functions";
import { ServiceBusClient } from "@azure/service-bus";
import { QUEUE_AZURE, QUEUE_M365 } from "../lib/constants";
import { formSubmissionSchema } from "../lib/types";

function corsHeaders(origin: string | undefined): Record<string, string> {
    const allow = process.env.CORS_ALLOW_ORIGIN ?? "*";
    return {
        "Access-Control-Allow-Origin": allow === "*" ? "*" : origin ?? allow,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

app.http("submitForm", {
    methods: ["POST", "OPTIONS"],
    route: "submit",
    authLevel: "anonymous",
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

        const parsed = formSubmissionSchema.safeParse(json);
        if (!parsed.success) {
            return {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
                jsonBody: { error: "Validation failed", details: parsed.error.flatten() },
            };
        }

        const conn = process.env.ServiceBusConnection;
        if (!conn) {
            context.error("ServiceBusConnection is not configured");
            return {
                status: 500,
                headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
                jsonBody: { error: "Server configuration error" },
            };
        }

        const queueName = parsed.data.product === "azure" ? QUEUE_AZURE : QUEUE_M365;
        const client = new ServiceBusClient(conn);
        try {
            const sender = client.createSender(queueName);
            await sender.sendMessages({ body: parsed.data, contentType: "application/json" });
            await sender.close();
        } finally {
            await client.close();
        }

        return {
            status: 202,
            headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
            jsonBody: { accepted: true, queue: queueName },
        };
    },
});

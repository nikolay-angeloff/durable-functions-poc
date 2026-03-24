export function corsHeaders(origin: string | undefined): Record<string, string> {
    const allow = process.env.CORS_ALLOW_ORIGIN ?? "*";
    return {
        "Access-Control-Allow-Origin": allow === "*" ? "*" : origin ?? allow,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

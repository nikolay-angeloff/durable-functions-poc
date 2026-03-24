import { AzureNamedKeyCredential, TableClient } from "@azure/data-tables";
import { CORRELATION_TABLE_NAME } from "./constants";

/** Azurite default account (same as Functions local storage). */
const DEV_ACCOUNT = "devstoreaccount1";
const DEV_KEY =
    "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";

function parseStorageConnection(conn: string): { account: string; key: string; endpoint: string } {
    if (conn.includes("UseDevelopmentStorage=true") || conn.includes("127.0.0.1:10000")) {
        return {
            account: DEV_ACCOUNT,
            key: DEV_KEY,
            endpoint: "http://127.0.0.1:10002/devstoreaccount1",
        };
    }
    const accountMatch = conn.match(/AccountName=([^;]+)/);
    const keyMatch = conn.match(/AccountKey=([^;]+)/);
    if (!accountMatch || !keyMatch) {
        throw new Error("Invalid AzureWebJobsStorage connection string (need AccountName and AccountKey)");
    }
    const account = accountMatch[1];
    const key = keyMatch[1];
    const endpoint = `https://${account}.table.core.windows.net`;
    return { account, key, endpoint };
}

let cached: TableClient | undefined;

export function getCorrelationTableClient(): TableClient {
    if (cached) {
        return cached;
    }
    const conn = process.env.AzureWebJobsStorage;
    if (!conn) {
        throw new Error("AzureWebJobsStorage is not configured");
    }
    const { account, key, endpoint } = parseStorageConnection(conn);
    const credential = new AzureNamedKeyCredential(account, key);
    cached = new TableClient(endpoint, CORRELATION_TABLE_NAME, credential);
    return cached;
}

export async function ensureCorrelationTable(): Promise<void> {
    const client = getCorrelationTableClient();
    await client.createTable();
}

export async function getInstanceIdForCorrelation(correlationId: string): Promise<string | undefined> {
    try {
        const client = getCorrelationTableClient();
        const entity = await client.getEntity(correlationId, "instance");
        return String(entity.instanceId);
    } catch {
        return undefined;
    }
}

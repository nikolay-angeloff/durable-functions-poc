import { EmailClient } from "@azure/communication-email";

/** Connection string from Communication Services → Keys (same resource where Email is enabled). */
const CS = "AZURE_COMMUNICATION_CONNECTION_STRING";
/** Verified sender from ACS Email (Azure domain or your connected custom domain). */
const SENDER = "ACS_EMAIL_SENDER";

export type AcsEmailConfig = { connectionString: string; senderAddress: string };

export function getAcsEmailConfig(): AcsEmailConfig | null {
    const connectionString = process.env[CS]?.trim();
    const senderAddress = process.env[SENDER]?.trim();
    if (!connectionString || !senderAddress) {
        return null;
    }
    return { connectionString, senderAddress };
}

export async function sendAcsPlainTextEmail(params: {
    to: string;
    subject: string;
    plainText: string;
}): Promise<void> {
    const cfg = getAcsEmailConfig();
    if (!cfg) {
        throw new Error(`${CS} or ${SENDER} not configured`);
    }
    const client = new EmailClient(cfg.connectionString);
    const poller = await client.beginSend({
        senderAddress: cfg.senderAddress,
        content: {
            subject: params.subject,
            plainText: params.plainText,
        },
        recipients: {
            to: [{ address: params.to }],
        },
    });
    await poller.pollUntilDone();
}

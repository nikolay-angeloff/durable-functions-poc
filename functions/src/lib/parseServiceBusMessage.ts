/**
 * Normalizes Service Bus trigger payload (body may be object, JSON string, or Buffer).
 */
export function parseServiceBusMessage<T>(message: unknown): T {
    if (message == null) {
        throw new Error("Empty Service Bus message");
    }
    if (Buffer.isBuffer(message)) {
        return JSON.parse(message.toString("utf8")) as T;
    }
    if (typeof message === "string") {
        return JSON.parse(message) as T;
    }
    if (typeof message === "object") {
        return message as T;
    }
    throw new Error("Unexpected Service Bus message shape");
}

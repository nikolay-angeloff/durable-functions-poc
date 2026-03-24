/**
 * Durable execution history comes from Azure Storage (same EventType numbers as
 * `durable-functions` HistoryEventType in node_modules).
 */

export const HISTORY_EVENT_LABELS: Record<number, string> = {
    0: "ExecutionStarted",
    1: "ExecutionCompleted",
    2: "ExecutionFailed",
    3: "ExecutionTerminated",
    4: "TaskScheduled",
    5: "TaskCompleted",
    6: "TaskFailed",
    7: "SubOrchestrationInstanceCreated",
    8: "SubOrchestrationInstanceCompleted",
    9: "SubOrchestrationInstanceFailed",
    10: "TimerCreated",
    11: "TimerFired",
    12: "OrchestratorStarted",
    13: "OrchestratorCompleted",
    14: "EventSent",
    15: "EventRaised",
    16: "ContinueAsNew",
    17: "GenericEvent",
    18: "HistoryState",
    19: "ExecutionSuspended",
    20: "ExecutionResumed",
};

function pick(ev: Record<string, unknown>, ...keys: string[]): unknown {
    for (const k of keys) {
        if (k in ev && ev[k] !== undefined) {
            return ev[k];
        }
    }
    return undefined;
}

function asRecord(x: unknown): Record<string, unknown> | null {
    return x !== null && typeof x === "object" && !Array.isArray(x)
        ? (x as Record<string, unknown>)
        : null;
}

export type TimelineRow = {
    eventId: number;
    eventType: number;
    label: string;
    timestamp: string;
    name?: string;
    detail?: string;
};

export type ActivityDurationBar = {
    /** Activity/orchestrator function name */
    name: string;
    durationMs: number;
    taskScheduledEventId: number;
};

export type ParsedHistory = {
    timeline: TimelineRow[];
    /** One bar per completed activity (TaskCompleted), for charts */
    activityDurations: ActivityDurationBar[];
    /** Ordered labels for “where it went” (activities + external events) */
    flowSteps: string[];
};

function truncate(s: string, max = 200): string {
    return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/**
 * Parse raw history array from getStatus({ showHistory: true }).
 */
export function parseDurableHistory(history: unknown): ParsedHistory {
    const timeline: TimelineRow[] = [];
    const activityDurations: ActivityDurationBar[] = [];
    const flowSteps: string[] = [];

    if (!Array.isArray(history)) {
        return { timeline, activityDurations, flowSteps };
    }

    /** TaskScheduled EventId -> { name, time } */
    const scheduled = new Map<number, { name: string; t: number }>();

    for (const raw of history) {
        const ev = asRecord(raw);
        if (!ev) {
            continue;
        }

        const eventId = Number(pick(ev, "EventId", "eventId"));
        const eventType = Number(pick(ev, "EventType", "eventType"));
        const tsRaw = pick(ev, "Timestamp", "timestamp");
        const timestamp =
            typeof tsRaw === "string"
                ? tsRaw
                : tsRaw instanceof Date
                  ? tsRaw.toISOString()
                  : new Date(String(tsRaw)).toISOString();

        const label = HISTORY_EVENT_LABELS[eventType] ?? `EventType_${eventType}`;

        let name: string | undefined;
        let detail: string | undefined;

        const n = pick(ev, "Name", "name");
        if (typeof n === "string") {
            name = n;
        }

        if (eventType === 4) {
            const fn = typeof n === "string" ? n : "?";
            scheduled.set(eventId, {
                name: fn,
                t: Date.parse(timestamp) || 0,
            });
            detail = pick(ev, "Input", "input") != null ? truncate(JSON.stringify(pick(ev, "Input", "input"))) : undefined;
            flowSteps.push(`Activity scheduled: ${fn}`);
        } else if (eventType === 5) {
            const tsId = Number(pick(ev, "TaskScheduledId", "taskScheduledId"));
            const sch = scheduled.get(tsId);
            const tEnd = Date.parse(timestamp) || 0;
            if (sch) {
                const durationMs = Math.max(0, tEnd - sch.t);
                activityDurations.push({
                    name: sch.name,
                    durationMs,
                    taskScheduledEventId: tsId,
                });
                detail = truncate(JSON.stringify(pick(ev, "Result", "result")));
                flowSteps.push(`Activity completed: ${sch.name} (${durationMs} ms)`);
            } else {
                detail = "TaskCompleted (no matching TaskScheduled)";
            }
        } else if (eventType === 6) {
            const tsId = Number(pick(ev, "TaskScheduledId", "taskScheduledId"));
            const sch = scheduled.get(tsId);
            detail = truncate(String(pick(ev, "Reason", "reason") ?? pick(ev, "Error", "error") ?? ""));
            flowSteps.push(
                sch ? `Activity failed: ${sch.name}` : `TaskFailed (#${tsId})`
            );
        } else if (eventType === 15) {
            const en = typeof n === "string" ? n : "event";
            flowSteps.push(`External event: ${en}`);
            detail = pick(ev, "Input", "input") != null ? truncate(JSON.stringify(pick(ev, "Input", "input"))) : undefined;
        } else if (eventType === 12) {
            flowSteps.push("Orchestrator replay / step");
        } else if (eventType === 14) {
            flowSteps.push(`Event sent: ${name ?? "?"}`);
        }

        timeline.push({
            eventId: Number.isFinite(eventId) ? eventId : -1,
            eventType: Number.isFinite(eventType) ? eventType : -1,
            label,
            timestamp,
            name,
            detail,
        });
    }

    return { timeline, activityDurations, flowSteps };
}

import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";

export type StepStatus = "pending" | "success" | "failed" | "waiting";

type Cs = {
    waiting?: boolean;
    phase?: string;
    failedStep?: string;
};

function readCustomStatus(cs: unknown): Cs {
    if (!cs || typeof cs !== "object") {
        return {};
    }
    const o = cs as Record<string, unknown>;
    return {
        waiting: o.waitingForCorrection === true,
        phase: typeof o.phase === "string" ? o.phase : undefined,
        failedStep: typeof o.failedStep === "string" ? o.failedStep : undefined,
    };
}

/**
 * Parse flow step lines from Durable history. Uses permissive patterns (no ^ anchor)
 * so minor format differences still match; trims \\r.
 */
export function parseActivityOutcomes(flowSteps: string[]): Map<string, "completed" | "failed"> {
    const last = new Map<string, "completed" | "failed">();
    for (const raw of flowSteps) {
        const line = raw.trim().replace(/\r/g, "");
        const done = line.match(/Activity completed:\s*([^\s(,]+)/);
        if (done) {
            last.set(done[1], "completed");
            continue;
        }
        const fail = line.match(/Activity failed:\s*([^\s(,]+)/);
        if (fail) {
            last.set(fail[1], "failed");
        }
    }
    return last;
}

/** Each duration entry is a successful TaskCompleted for that activity. */
function mergeActivityDurations(
    outcomes: Map<string, "completed" | "failed">,
    durations: { name: string }[]
): void {
    for (const d of durations) {
        if (!d.name) {
            continue;
        }
        if (outcomes.get(d.name) !== "failed") {
            outcomes.set(d.name, "completed");
        }
    }
}

/**
 * If the instance finished successfully, mark all expected activities as completed
 * unless the history explicitly recorded a failure for that name (fixes empty/missed flowSteps).
 */
function applyCompletedOverride(
    orchestratorName: string,
    runtime: string,
    outcomes: Map<string, "completed" | "failed">
): void {
    if (runtime !== "Completed") {
        return;
    }
    const azureActs = [
        "registerCorrelation",
        "mockAzureValidate",
        "mockAzureEnrich",
        "mockAzureApprove",
        "sendEmail",
    ];
    const m365Acts = [
        "registerCorrelation",
        "mockM365TenantReadiness",
        "mockM365LicenseCheck",
        "mockM365ConsentGate",
        "sendEmail",
    ];
    const acts =
        orchestratorName === "azureOrchestration"
            ? azureActs
            : orchestratorName === "m365Orchestration"
              ? m365Acts
              : [];
    for (const a of acts) {
        if (outcomes.get(a) !== "failed") {
            outcomes.set(a, "completed");
        }
    }
}

function buildOutcomes(
    orchestratorName: string,
    runtime: string,
    flowSteps: string[],
    activityDurations: { name: string }[]
): Map<string, "completed" | "failed"> {
    const outcomes = parseActivityOutcomes(flowSteps);
    mergeActivityDurations(outcomes, activityDurations);
    applyCompletedOverride(orchestratorName, runtime, outcomes);
    return outcomes;
}

function hadCorrectionSubmitted(flowSteps: string[]): boolean {
    return flowSteps.some((s) => /External event:\s*CorrectionSubmitted\b/.test(s.trim()));
}

function statusFromActivity(
    activity: string,
    outcomes: Map<string, "completed" | "failed">
): StepStatus {
    const o = outcomes.get(activity);
    if (o === "completed") {
        return "success";
    }
    if (o === "failed") {
        return "failed";
    }
    return "pending";
}

function sn(
    id: string,
    label: string,
    x: number,
    y: number,
    status: StepStatus,
    data?: Record<string, unknown>
): Node {
    return {
        id,
        type: "statusNode",
        position: { x, y },
        data: { label, status, ...data },
    };
}

const edgeDefaults = {
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
};

function e(
    id: string,
    source: string,
    target: string,
    sourceHandle?: string,
    targetHandle?: string,
    label?: string
): Edge {
    return {
        id,
        source,
        target,
        sourceHandle,
        targetHandle,
        label,
        ...edgeDefaults,
    };
}

/** Horizontal LR layout (x grows →). */
function buildAzureGraph(
    runtime: string,
    cs: Cs,
    outcomes: Map<string, "completed" | "failed">,
    flowSteps: string[]
): { nodes: Node[]; edges: Edge[] } {
    const waiting = cs.waiting === true;
    const parallelWait = waiting && cs.phase === "parallelValidateEnrich";
    const approveWait = waiting && cs.phase === "singleStep" && cs.failedStep === "approve";

    const reg = statusFromActivity("registerCorrelation", outcomes);
    const val = statusFromActivity("mockAzureValidate", outcomes);
    const enr = statusFromActivity("mockAzureEnrich", outcomes);
    const appr = statusFromActivity("mockAzureApprove", outcomes);
    const mail = statusFromActivity("sendEmail", outcomes);

    let joinStatus: StepStatus = "pending";
    if (val === "success" && enr === "success") {
        joinStatus = "success";
    } else if (val === "failed" || enr === "failed") {
        joinStatus = parallelWait ? "waiting" : "failed";
    } else if (parallelWait) {
        joinStatus = "waiting";
    }

    let approveStatus = appr;
    if (approveWait) {
        approveStatus = "waiting";
    }

    const correctionDone = hadCorrectionSubmitted(flowSteps);
    let waitUserStatus: StepStatus = "pending";
    if (parallelWait || approveWait) {
        waitUserStatus = "waiting";
    } else if (correctionDone && (val === "success" || enr === "success" || appr === "success")) {
        waitUserStatus = "success";
    } else if (runtime === "Completed") {
        waitUserStatus = "success";
    }

    let endStatus: StepStatus = "pending";
    if (runtime === "Completed") {
        endStatus = "success";
    } else if (runtime === "Failed") {
        endStatus = "failed";
    }

    const emailStatus: StepStatus =
        runtime === "Completed" ? (mail === "failed" ? "failed" : "success") : mail;

    /* y: main spine ~100; parallel branches above/below */
    const nodes: Node[] = [
        sn("start", "Start", 0, 80, "success"),
        sn("register", "registerCorrelation", 140, 80, reg, { handles: "split-out" }),
        sn("validate", "mockAzureValidate", 280, 0, parallelWait ? "waiting" : val),
        sn("enrich", "mockAzureEnrich", 280, 160, parallelWait ? "waiting" : enr),
        sn("join", "Parallel join\n(both)", 420, 80, joinStatus, { handles: "join-in" }),
        sn("approve", "mockAzureApprove", 560, 80, approveStatus),
        sn("waitUser", "User correction\n(event)", 700, 80, waitUserStatus),
        sn("email", "sendEmail", 860, 80, emailStatus),
        sn("end", "End", 1000, 80, endStatus),
    ];

    const edges: Edge[] = [
        e("e1", "start", "register"),
        e("e2", "register", "validate", "out-v"),
        e("e3", "register", "enrich", "out-e"),
        e("e4", "validate", "join", undefined, "in-v"),
        e("e5", "enrich", "join", undefined, "in-e"),
        e("e6", "join", "approve"),
        e("e7", "approve", "waitUser", undefined, undefined, "retry"),
        e("e8", "waitUser", "approve", undefined, undefined, "CorrectionSubmitted"),
        e("e9", "approve", "email"),
        e("e10", "email", "end"),
    ];

    return { nodes, edges };
}

function buildM365Graph(
    runtime: string,
    cs: Cs,
    outcomes: Map<string, "completed" | "failed">
): { nodes: Node[]; edges: Edge[] } {
    const waiting = cs.waiting === true;
    const failedStep = cs.failedStep;

    const reg = statusFromActivity("registerCorrelation", outcomes);
    const tenant = statusFromActivity("mockM365TenantReadiness", outcomes);
    const license = statusFromActivity("mockM365LicenseCheck", outcomes);
    const consent = statusFromActivity("mockM365ConsentGate", outcomes);
    const mail = statusFromActivity("sendEmail", outcomes);

    const tenantS =
        waiting && failedStep === "tenantReadiness" ? "waiting" : tenant;
    const licenseS = waiting && failedStep === "licenseCheck" ? "waiting" : license;
    const consentS = waiting && failedStep === "consentGate" ? "waiting" : consent;

    let endStatus: StepStatus = "pending";
    if (runtime === "Completed") {
        endStatus = "success";
    } else if (runtime === "Failed") {
        endStatus = "failed";
    }

    const emailStatus: StepStatus =
        runtime === "Completed" ? (mail === "failed" ? "failed" : "success") : mail;

    const nodes: Node[] = [
        sn("start", "Start", 0, 80, "success"),
        sn("register", "registerCorrelation", 140, 80, reg),
        sn("tenant", "tenant readiness", 280, 80, tenantS),
        sn("license", "license check", 420, 80, licenseS),
        sn("consent", "consent gate", 560, 80, consentS),
        sn("email", "sendEmail", 700, 80, emailStatus),
        sn("end", "End", 860, 80, endStatus),
    ];

    const edges: Edge[] = [
        e("m1", "start", "register"),
        e("m2", "register", "tenant"),
        e("m3", "tenant", "license"),
        e("m4", "license", "consent"),
        e("m5", "consent", "email"),
        e("m6", "email", "end"),
    ];

    return { nodes, edges };
}

/**
 * Build React Flow nodes/edges for known orchestrators. Unknown names return null.
 */
export function buildWorkflowGraph(input: {
    orchestratorName?: string;
    runtimeStatus?: string;
    customStatus: unknown;
    flowSteps: string[];
    activityDurations?: { name: string }[];
}): { nodes: Node[]; edges: Edge[] } | null {
    const name = input.orchestratorName ?? "";
    const runtime = input.runtimeStatus ?? "";
    const cs = readCustomStatus(input.customStatus);
    const outcomes = buildOutcomes(
        name,
        runtime,
        input.flowSteps,
        input.activityDurations ?? []
    );

    if (name === "azureOrchestration") {
        return buildAzureGraph(runtime, cs, outcomes, input.flowSteps);
    }
    if (name === "m365Orchestration") {
        return buildM365Graph(runtime, cs, outcomes);
    }
    return null;
}

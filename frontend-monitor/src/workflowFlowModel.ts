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

/** Last outcome per activity function name from parsed flowSteps. */
export function parseActivityOutcomes(flowSteps: string[]): Map<string, "completed" | "failed"> {
    const last = new Map<string, "completed" | "failed">();
    for (const line of flowSteps) {
        const done = line.match(/^Activity completed: ([^\s(]+)/);
        if (done) {
            last.set(done[1], "completed");
            continue;
        }
        const fail = line.match(/^Activity failed: ([^\s(]+)/);
        if (fail) {
            last.set(fail[1], "failed");
        }
    }
    return last;
}

function hadCorrectionSubmitted(flowSteps: string[]): boolean {
    return flowSteps.some((s) => /^External event: CorrectionSubmitted\b/.test(s));
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
    status: StepStatus
): Node {
    return {
        id,
        type: "statusNode",
        position: { x, y },
        data: { label, status },
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
    }

    let endStatus: StepStatus = "pending";
    if (runtime === "Completed") {
        endStatus = "success";
    } else if (runtime === "Failed") {
        endStatus = "failed";
    }

    const emailStatus: StepStatus =
        runtime === "Completed" ? (mail === "failed" ? "failed" : "success") : mail;

    const nodes: Node[] = [
        sn("start", "Start", 340, 0, "success"),
        sn("register", "registerCorrelation", 300, 70, reg),
        sn("validate", "mockAzureValidate", 120, 180, parallelWait ? "waiting" : val),
        sn("enrich", "mockAzureEnrich", 480, 180, parallelWait ? "waiting" : enr),
        sn("join", "Parallel join\n(both must pass)", 300, 300, joinStatus),
        sn("approve", "mockAzureApprove", 300, 410, approveStatus),
        sn("waitUser", "User correction\n(external event)", 560, 410, waitUserStatus),
        sn("email", "sendEmail", 300, 530, emailStatus),
        sn("end", "End", 340, 640, endStatus),
    ];

    const edges: Edge[] = [
        e("e1", "start", "register"),
        e("e2", "register", "validate"),
        e("e3", "register", "enrich"),
        e("e4", "validate", "join", undefined, "in-v"),
        e("e5", "enrich", "join", undefined, "in-e"),
        e("e6", "join", "approve"),
        e("e7", "approve", "waitUser", undefined, undefined, "retry path"),
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
        sn("start", "Start", 340, 0, "success"),
        sn("register", "registerCorrelation", 300, 80, reg),
        sn("tenant", "tenant readiness", 300, 170, tenantS),
        sn("license", "license check", 300, 270, licenseS),
        sn("consent", "consent gate", 300, 370, consentS),
        sn("email", "sendEmail", 300, 470, emailStatus),
        sn("end", "End", 340, 570, endStatus),
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
}): { nodes: Node[]; edges: Edge[] } | null {
    const name = input.orchestratorName ?? "";
    const runtime = input.runtimeStatus ?? "";
    const cs = readCustomStatus(input.customStatus);
    const outcomes = parseActivityOutcomes(input.flowSteps);

    if (name === "azureOrchestration") {
        return buildAzureGraph(runtime, cs, outcomes, input.flowSteps);
    }
    if (name === "m365Orchestration") {
        return buildM365Graph(runtime, cs, outcomes);
    }
    return null;
}

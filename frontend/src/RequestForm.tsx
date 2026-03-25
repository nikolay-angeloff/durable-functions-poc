import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

type Product = "azure" | "m365";

type OrchestrationStatusPayload = {
    runtimeStatus?: string;
    input?: { product?: "azure" | "m365" };
    customStatus?: {
        flow?: "azure" | "m365";
        waitingForCorrection?: boolean;
        phase?: "parallelValidateEnrich" | "singleStep";
        currentStep?: string;
        stepIndex?: number;
        totalSteps?: number;
        failedStep?: string;
        reason?: string;
        aggregatedFailures?: { step: string; error: string }[];
        completedSteps?: number;
    };
};

const M365_STEP_LABEL: Record<string, string> = {
    tenantReadiness: "tenant readiness",
    licenseCheck: "license check",
    consentGate: "consent gate",
};

const AZURE_STEP_TITLE: Record<string, string> = {
    parallelValidateEnrich: "Validate & enrich (parallel)",
    approve: "Risk approval",
    sendEmail: "Send notification email",
};

/** Human-readable automation state for the bottom status strip (polled every 2s). */
function describeAutomationStatus(orch: OrchestrationStatusPayload | null): {
    title: string;
    detail?: string;
} {
    if (!orch) {
        return {
            title: "Connecting to automation…",
            detail: "Fetching status every 2 seconds.",
        };
    }

    const rs = orch.runtimeStatus ?? "";
    const cs = orch.customStatus;
    const product = orch.input?.product;
    const productHint =
        product === "azure" ? "Azure" : product === "m365" ? "Microsoft 365" : null;

    if (rs === "Pending") {
        return { title: "Queued — starting soon.", detail: productHint ? `Flow: ${productHint}` : undefined };
    }

    if (rs === "Running") {
        if (cs && typeof cs === "object" && cs.waitingForCorrection === true) {
            const m365Pos =
                cs.flow === "m365" &&
                typeof cs.stepIndex === "number" &&
                typeof cs.totalSteps === "number"
                    ? ` — step ${cs.stepIndex + 1} of ${cs.totalSteps}`
                    : "";

            if (cs.phase === "parallelValidateEnrich") {
                return {
                    title: "Paused — parallel validate / enrich need a fix.",
                    detail: "Submit the correction form above.",
                };
            }
            if (cs.flow === "azure" && cs.phase === "singleStep" && cs.failedStep === "approve") {
                return {
                    title: "Paused — approval step needs a correction.",
                    detail: cs.reason,
                };
            }
            if (cs.flow === "m365" && cs.failedStep) {
                const stepHuman = M365_STEP_LABEL[cs.failedStep] ?? cs.failedStep;
                return {
                    title: `Paused — ${stepHuman} failed${m365Pos}.`,
                    detail: cs.reason,
                };
            }
            return {
                title: "Paused — waiting for your correction.",
                detail: cs.reason,
            };
        }

        if (cs && typeof cs === "object" && cs.waitingForCorrection !== true) {
            const step = cs.currentStep;
            const tick = "Status refreshes every 2 seconds.";

            if (step === "sendEmail") {
                return {
                    title: `Current step: ${AZURE_STEP_TITLE.sendEmail}…`,
                    detail: "Final step before completion.",
                };
            }

            if (cs.flow === "m365" && step && typeof cs.stepIndex === "number" && typeof cs.totalSteps === "number") {
                const human = M365_STEP_LABEL[step] ?? step;
                return {
                    title: `Current step (${cs.stepIndex + 1} of ${cs.totalSteps}): ${human}…`,
                    detail: tick,
                };
            }

            if (cs.flow === "azure" && step) {
                const label = AZURE_STEP_TITLE[step] ?? step;
                return {
                    title: `Current step: ${label}…`,
                    detail: productHint ? `${productHint} · ${tick}` : tick,
                };
            }
        }

        if (cs && typeof cs === "object" && cs.phase === "parallelValidateEnrich") {
            return {
                title: "Running parallel validate & enrich…",
                detail: productHint ? `${productHint} · This updates every 2s.` : "This updates every 2s.",
            };
        }
        if (cs && typeof cs === "object" && cs.phase === "singleStep" && !cs.waitingForCorrection) {
            return {
                title: "Running approval step…",
                detail: productHint ? `${productHint} · This updates every 2s.` : "This updates every 2s.",
            };
        }
        if (cs && typeof cs === "object" && typeof cs.completedSteps === "number" && cs.completedSteps > 0) {
            return {
                title: "Finishing up…",
                detail: "Sending notification email.",
            };
        }

        return {
            title: productHint
                ? `${productHint} automation is running…`
                : "Automation is running…",
            detail: "Steps execute in the cloud. Status refreshes every 2 seconds.",
        };
    }

    if (rs === "Completed") {
        return {
            title: "Completed successfully.",
            detail: "The workflow finished; you can close this page.",
        };
    }
    if (rs === "Failed") {
        return {
            title: "Failed — the workflow stopped with an error.",
            detail: "Check Azure logs for details.",
        };
    }
    if (rs === "Canceled" || rs === "Terminate" || rs === "Terminated") {
        return { title: "Orchestration was terminated.", detail: undefined };
    }

    return { title: `Status: ${rs}`, detail: undefined };
}

const UUID_PARAM =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function initialCorrelationFromUrl(): { id: string; resumeFromLink: boolean } {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const q = new URLSearchParams(search).get("correlationId")?.trim();
    if (q && UUID_PARAM.test(q)) {
        return { id: q, resumeFromLink: true };
    }
    return { id: crypto.randomUUID(), resumeFromLink: false };
}

export default function RequestForm() {
    const { id: correlationId, resumeFromLink } = useMemo(
        () => initialCorrelationFromUrl(),
        []
    );

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [product, setProduct] = useState<Product>("azure");
    const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
    const [message, setMessage] = useState("");

    const [poll, setPoll] = useState(false);
    const [orch, setOrch] = useState<OrchestrationStatusPayload | null>(null);

    const [corrName, setCorrName] = useState("");
    const [corrPhone, setCorrPhone] = useState("");
    const [corrEmail, setCorrEmail] = useState("");
    const [corrNote, setCorrNote] = useState("");
    const [corrSubmitting, setCorrSubmitting] = useState(false);

    const statusUrl = useCallback(() => {
        const q = `correlationId=${encodeURIComponent(correlationId)}`;
        return apiBase
            ? `${apiBase.replace(/\/$/, "")}/orchestration-status?${q}`
            : `/api/orchestration-status?${q}`;
    }, [correlationId, apiBase]);

    const correctionUrl = apiBase ? `${apiBase.replace(/\/$/, "")}/correction` : "/api/correction";

    useEffect(() => {
        if (resumeFromLink) {
            setPoll(true);
            setMessage("Resume link — checking workflow status…");
        }
    }, [resumeFromLink]);

    useEffect(() => {
        if (!poll) {
            return;
        }
        let cancelled = false;
        const tick = async () => {
            try {
                const res = await fetch(statusUrl());
                const data = await res.json().catch(() => ({}));
                if (!cancelled && res.ok) {
                    setOrch(data);
                }
            } catch {
                /* ignore transient errors while polling */
            }
        };
        void tick();
        const id = window.setInterval(tick, 2000);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [poll, statusUrl]);

    async function onSubmit(e: FormEvent) {
        e.preventDefault();
        setStatus("loading");
        setMessage("");
        try {
            const url = apiBase ? `${apiBase.replace(/\/$/, "")}/submit` : "/api/submit";
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    correlationId,
                    name,
                    email,
                    phone,
                    product,
                    correctionConfirmed: false,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus("err");
                setMessage(typeof data.error === "string" ? data.error : "Request failed");
                return;
            }
            setStatus("ok");
            setMessage("Accepted — workflow running. Waiting for steps…");
            setPoll(true);
            setCorrName(name);
            setCorrPhone(phone);
            setCorrEmail(email);
        } catch {
            setStatus("err");
            setMessage("Network error — is the API running?");
        }
    }

    async function onCorrectionSubmit(e: FormEvent) {
        e.preventDefault();
        setCorrSubmitting(true);
        try {
            const res = await fetch(correctionUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    correlationId,
                    correctionConfirmed: true,
                    name: corrName || undefined,
                    phone: corrPhone || undefined,
                    email: corrEmail || undefined,
                    correctionNote: corrNote || undefined,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMessage(typeof data.error === "string" ? data.error : "Correction failed");
                return;
            }
            setMessage("Correction sent — resuming workflow from failed step.");
        } catch {
            setMessage("Network error sending correction.");
        } finally {
            setCorrSubmitting(false);
        }
    }

    const waiting =
        orch?.customStatus &&
        typeof orch.customStatus === "object" &&
        orch.customStatus.waitingForCorrection === true;

    const done = orch?.runtimeStatus === "Completed" || orch?.runtimeStatus === "Failed";

    const automationLine = poll ? describeAutomationStatus(orch) : null;

    useEffect(() => {
        if (done && poll) {
            setPoll(false);
            if (orch?.runtimeStatus === "Completed") {
                setMessage("Workflow completed.");
            }
            if (orch?.runtimeStatus === "Failed") {
                setMessage("Workflow failed (see Azure logs).");
            }
        }
    }, [done, poll, orch?.runtimeStatus]);

    return (
        <>
            <h1>Request demo</h1>
            <section className="demo-guide" aria-label="How the demo flows work">
                <h2>Azure (order)</h2>
                <ol>
                    <li>
                        <strong>Validate</strong> and <strong>enrich</strong> run <em>at the same time</em>{" "}
                        (~4–5s each; you see one “parallel” step in the status bar). Both must pass.
                    </li>
                    <li>
                        <strong>Validate</strong> fails if the name has fewer than 2 characters.
                    </li>
                    <li>
                        <strong>Enrich</strong> fails if the name contains <code>BLOCK</code> (mock policy
                        block).
                    </li>
                    <li>
                        <strong>Approve</strong> runs after the parallel pair succeeds. It expects a
                        confirmed correction (<code>correctionConfirmed</code>) — the first run always
                        stops here so you can use the correction form and submit once.
                    </li>
                    <li>
                        <strong>Email</strong> is the last step (Azure Communication Services Email when
                        configured).
                    </li>
                </ol>
                <p className="mono-hint">
                    Demo: any step blocks → orchestration pauses, Service Bus may get a message, and the
                    form below asks for a fix.
                </p>

                <h2>Microsoft 365 (order)</h2>
                <ol>
                    <li>
                        <strong>Tenant readiness</strong> — fails if the name contains{" "}
                        <code>NOTENANT</code> (mock Entra check).
                    </li>
                    <li>
                        <strong>License / contact</strong> — fails if the phone has fewer than 10 digits.
                    </li>
                    <li>
                        <strong>Consent gate</strong> — same confirmation rule as Azure approve: submit a
                        correction with the checkbox so the workflow can continue.
                    </li>
                    <li>
                        <strong>Email</strong> last.
                    </li>
                </ol>
                <p className="note">
                    The bottom <strong>Automation</strong> strip polls every 2s and shows which step is
                    active. Each step waits ~4–5s in this demo so progress is visible.
                </p>
            </section>
            <p className="meta">Correlation ID: {correlationId}</p>
            <form onSubmit={onSubmit}>
                <label>
                    Name
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        autoComplete="name"
                    />
                    <span className="field-hint">
                        Azure: <code>BLOCK</code> blocks only the <strong>enrich</strong> step. Too-short
                        names block <strong>validate</strong>. M365: <code>NOTENANT</code> blocks{" "}
                        <strong>tenant readiness</strong>.
                    </span>
                </label>
                <label>
                    Email
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                    />
                </label>
                <label>
                    Phone
                    <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                        autoComplete="tel"
                    />
                </label>
                <fieldset>
                    <legend>Product</legend>
                    <label className="radio">
                        <input
                            type="radio"
                            name="product"
                            checked={product === "azure"}
                            onChange={() => setProduct("azure")}
                        />
                        Azure
                    </label>
                    <label className="radio">
                        <input
                            type="radio"
                            name="product"
                            checked={product === "m365"}
                            onChange={() => setProduct("m365")}
                        />
                        Microsoft 365
                    </label>
                </fieldset>
                <button type="submit" disabled={status === "loading"}>
                    {status === "loading" ? "Sending…" : "Submit"}
                </button>
            </form>

            {waiting && (
                <form className="correction" onSubmit={onCorrectionSubmit}>
                    <h2>Correction required</h2>
                    {orch?.customStatus?.aggregatedFailures &&
                    orch.customStatus.aggregatedFailures.length > 0 ? (
                        <div className="lede">
                            <p>
                                <strong>Parallel steps failed</strong> (validate + enrich) — fix all
                                issues below in one submission:
                            </p>
                            <ul className="failure-list">
                                {orch.customStatus.aggregatedFailures.map((f) => (
                                    <li key={f.step}>
                                        <strong>{f.step}</strong>: {f.error}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <p className="lede">
                            Step: <strong>{String(orch?.customStatus?.failedStep ?? "?")}</strong>
                            <br />
                            {String(orch?.customStatus?.reason ?? "")}
                        </p>
                    )}
                    <p className="hint">
                        <strong>Where it stopped:</strong>{" "}
                        {orch?.customStatus?.flow === "azure" &&
                        orch.customStatus.phase === "parallelValidateEnrich"
                            ? "Parallel pair — fix every listed failure, then submit once."
                            : orch?.customStatus?.flow === "azure" && orch.customStatus.failedStep === "approve"
                              ? "Risk approval — submit this form with confirmation checked."
                              : orch?.customStatus?.flow === "m365" && orch.customStatus.failedStep === "tenantReadiness"
                                ? "Tenant step — remove NOTENANT from name or fix as shown above."
                                : orch?.customStatus?.flow === "m365" && orch.customStatus.failedStep === "licenseCheck"
                                  ? "License/contact — use a phone with at least 10 digits."
                                  : orch?.customStatus?.flow === "m365" && orch.customStatus.failedStep === "consentGate"
                                    ? "Consent — submit with confirmation checked."
                                    : `Flow ${orch?.customStatus?.flow ?? "?"}, step ${String(orch?.customStatus?.failedStep ?? "?")}.`}
                        <br />
                        <span className="field-hint">
                            Flow <strong>{orch?.customStatus?.flow ?? "?"}</strong>
                            {orch?.customStatus?.phase === "parallelValidateEnrich" ? (
                                <> · phase <strong>parallel validate + enrich</strong></>
                            ) : orch?.customStatus?.failedStep ? (
                                <> · step <strong>{orch.customStatus.failedStep}</strong></>
                            ) : null}
                            .
                        </span>
                    </p>
                    <label>
                        Name
                        <input
                            value={corrName}
                            onChange={(e) => setCorrName(e.target.value)}
                            autoComplete="name"
                        />
                    </label>
                    <label>
                        Phone (optional update)
                        <input
                            type="tel"
                            value={corrPhone}
                            onChange={(e) => setCorrPhone(e.target.value)}
                            autoComplete="tel"
                        />
                    </label>
                    <label>
                        Email (optional update)
                        <input
                            type="email"
                            value={corrEmail}
                            onChange={(e) => setCorrEmail(e.target.value)}
                            autoComplete="email"
                        />
                    </label>
                    <label>
                        Note to approver
                        <input
                            value={corrNote}
                            onChange={(e) => setCorrNote(e.target.value)}
                            placeholder="Reason for override"
                        />
                    </label>
                    <label className="check">
                        <input type="checkbox" checked readOnly /> I confirm this correction (
                        <code>correctionConfirmed</code>)
                    </label>
                    <button type="submit" disabled={corrSubmitting}>
                        {corrSubmitting ? "Sending…" : "Submit correction & resume"}
                    </button>
                </form>
            )}

            {message && (
                <p className={`feedback ${status === "err" ? "error" : "success"}`}>{message}</p>
            )}

            {poll && automationLine && (
                <div className="automation-status-bar" role="status" aria-live="polite" aria-atomic="true">
                    <div className="automation-status-bar-inner">
                        <span className="automation-status-label">Automation</span>
                        <span className="automation-status-title">{automationLine.title}</span>
                        {automationLine.detail && (
                            <span className="automation-status-detail">{automationLine.detail}</span>
                        )}
                        {orch?.runtimeStatus && (
                            <span className="automation-status-raw">
                                <code>{orch.runtimeStatus}</code>
                            </span>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}

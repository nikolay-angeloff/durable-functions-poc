import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

type Product = "azure" | "m365";

type OrchestrationStatusPayload = {
    runtimeStatus?: string;
    customStatus?: {
        flow?: "azure" | "m365";
        waitingForCorrection?: boolean;
        phase?: "parallelValidateEnrich" | "singleStep";
        failedStep?: string;
        reason?: string;
        aggregatedFailures?: { step: string; error: string }[];
    };
};

export default function App() {
    const correlationId = useMemo(() => crypto.randomUUID(), []);

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
        <div className="card">
            <h1>Request demo</h1>
            <p className="lede">
                <strong>Azure</strong> flow: validate ∥ enrich (parallel, join) → approve (mock).{" "}
                <strong>M365</strong> flow: tenant readiness → license check → consent gate (mock).
                On failure, Service Bus gets a notification; fix data below.
            </p>
            <p className="meta">Correlation ID: {correlationId}</p>
            <form onSubmit={onSubmit}>
                <label>
                    Name — Azure: include <code>BLOCK</code> to fail enrich. M365: include{" "}
                    <code>NOTENANT</code> to fail tenant step.
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        autoComplete="name"
                    />
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
                        Flow: <strong>{orch?.customStatus?.flow ?? "?"}</strong>
                        {orch?.customStatus?.phase === "parallelValidateEnrich" ? (
                            <>
                                {" "}
                                · Phase: <strong>parallel validate + enrich</strong>
                            </>
                        ) : (
                            <>
                                {" "}
                                · Step:{" "}
                                <strong>{String(orch?.customStatus?.failedStep ?? "?")}</strong>
                            </>
                        )}
                        <br />
                        Azure: remove <code>BLOCK</code> from name or confirm risk step. M365: fix
                        phone digits (≥10) or remove <code>NOTENANT</code> / confirm consent.
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
            {poll && orch?.runtimeStatus && (
                <p className="meta">Orchestration: {orch.runtimeStatus}</p>
            )}
        </div>
    );
}

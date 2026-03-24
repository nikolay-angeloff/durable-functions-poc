import { FormEvent, lazy, Suspense, useCallback, useEffect, useState } from "react";

const InstanceDetailPanel = lazy(() => import("./InstanceDetailPanel"));

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const formAppBase = import.meta.env.VITE_FORM_APP_BASE_URL ?? "";

type InstanceRow = {
    instanceId: string;
    orchestratorName: string;
    runtimeStatus: string;
    createdTime: string;
    lastUpdatedTime: string;
    correlationId?: string;
    product?: string;
    email?: string;
    submitterName?: string;
    customStatus: unknown;
};

type MonitorPayload = {
    taskHubName?: string;
    count?: number;
    totalInHub?: number;
    instances?: InstanceRow[];
    error?: string;
};

function monitorUrl(limit: number): string {
    const base = apiBase ? `${apiBase.replace(/\/$/, "")}/orchestration-monitor` : "/api/orchestration-monitor";
    return `${base}?limit=${encodeURIComponent(String(limit))}`;
}

/** Resume link: form app is a separate Static Web App (VITE_FORM_APP_BASE_URL); local dev defaults to port 5173. */
function formResumeUrl(correlationId: string): string {
    const base = formAppBase.trim();
    if (base) {
        return `${base.replace(/\/$/, "")}/?correlationId=${encodeURIComponent(correlationId)}`;
    }
    return `http://localhost:5173/?correlationId=${encodeURIComponent(correlationId)}`;
}

export default function MonitorDashboard() {
    const [rows, setRows] = useState<InstanceRow[]>([]);
    const [meta, setMeta] = useState<{ taskHub?: string; total?: number }>({});
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [limit, setLimit] = useState(50);
    const [accessKey, setAccessKey] = useState(() => sessionStorage.getItem("monitorDashboardKey") ?? "");
    const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const headers: Record<string, string> = {};
            if (accessKey.trim()) {
                headers["X-Monitor-Key"] = accessKey.trim();
            }
            const res = await fetch(monitorUrl(limit), { headers });
            const data = (await res.json().catch(() => ({}))) as MonitorPayload;
            if (!res.ok) {
                setErr(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
                setRows([]);
                return;
            }
            setRows(data.instances ?? []);
            setMeta({ taskHub: data.taskHubName, total: data.totalInHub });
        } catch {
            setErr("Network error — is the API running?");
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [limit, accessKey]);

    useEffect(() => {
        void load();
    }, [load]);

    function persistKey(e: FormEvent) {
        e.preventDefault();
        sessionStorage.setItem("monitorDashboardKey", accessKey.trim());
        void load();
    }

    return (
        <>
            <h1>Durable orchestrations</h1>
            <p className="lede">
                Monitor app (separate site). Calls the same Function API as the form app.{" "}
                <strong>Open form</strong> links go to the form Static Web App (
                <code>VITE_FORM_APP_BASE_URL</code>).
            </p>

            <form className="monitor-toolbar" onSubmit={persistKey}>
                <label>
                    Limit
                    <input
                        type="number"
                        min={1}
                        max={200}
                        value={limit}
                        onChange={(e) => setLimit(Number(e.target.value) || 50)}
                    />
                </label>
                <label>
                    Access key (optional — if <code>MONITOR_DASHBOARD_KEY</code> is set on the API)
                    <input
                        type="password"
                        value={accessKey}
                        onChange={(e) => setAccessKey(e.target.value)}
                        placeholder="X-Monitor-Key"
                        autoComplete="off"
                    />
                </label>
                <button type="submit">Apply &amp; refresh</button>
                <button type="button" onClick={() => void load()} disabled={loading}>
                    {loading ? "Loading…" : "Refresh"}
                </button>
            </form>

            {meta.taskHub != null && (
                <p className="meta">
                    Task hub: <strong>{meta.taskHub}</strong>
                    {meta.total != null ? ` · total instances in hub: ${meta.total}` : ""}
                </p>
            )}

            {err && <p className="feedback error">{err}</p>}

            <div className="monitor-table-wrap">
                <table className="monitor-table">
                    <thead>
                        <tr>
                            <th>Status</th>
                            <th>Orchestrator</th>
                            <th>Product</th>
                            <th>Correlation</th>
                            <th>Email</th>
                            <th>Updated</th>
                            <th>Resume</th>
                            <th>Charts</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && !loading ? (
                            <tr>
                                <td colSpan={8} className="monitor-empty">
                                    No rows (or empty hub).
                                </td>
                            </tr>
                        ) : (
                            rows.map((r) => (
                                <tr
                                    key={r.instanceId}
                                    className={selectedInstanceId === r.instanceId ? "row-selected" : undefined}
                                >
                                    <td>
                                        <code>{r.runtimeStatus}</code>
                                    </td>
                                    <td>{r.orchestratorName}</td>
                                    <td>{r.product ?? "—"}</td>
                                    <td className="mono">{r.correlationId ?? "—"}</td>
                                    <td>{r.email ?? "—"}</td>
                                    <td className="nowrap">{new Date(r.lastUpdatedTime).toLocaleString()}</td>
                                    <td>
                                        {r.correlationId ? (
                                            <a href={formResumeUrl(r.correlationId)}>Open form</a>
                                        ) : (
                                            "—"
                                        )}
                                    </td>
                                    <td>
                                        <button
                                            type="button"
                                            className="btn-linkish"
                                            onClick={() =>
                                                setSelectedInstanceId((cur) =>
                                                    cur === r.instanceId ? null : r.instanceId
                                                )
                                            }
                                        >
                                            {selectedInstanceId === r.instanceId ? "Hide" : "View"}
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {selectedInstanceId && (
                <Suspense fallback={<p className="meta">Loading charts…</p>}>
                    <InstanceDetailPanel
                        instanceId={selectedInstanceId}
                        accessKey={accessKey}
                        onClose={() => setSelectedInstanceId(null)}
                    />
                </Suspense>
            )}
        </>
    );
}

import { useCallback, useEffect, useState } from "react";
import WorkflowFlowchart from "./WorkflowFlowchart";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

type TimelineRow = {
    eventId: number;
    eventType: number;
    label: string;
    timestamp: string;
    name?: string;
    detail?: string;
};

type DetailPayload = {
    error?: string;
    instanceId?: string;
    orchestratorName?: string;
    runtimeStatus?: string;
    customStatus?: unknown;
    historyEventCount?: number;
    parsed?: {
        timeline: TimelineRow[];
        activityDurations: { name: string; durationMs: number; taskScheduledEventId: number }[];
        flowSteps: string[];
        eventTimeline: { index: number; label: string; offsetMs: number }[];
    };
};

function detailUrl(instanceId: string): string {
    const base = apiBase
        ? `${apiBase.replace(/\/$/, "")}/orchestration-monitor-detail`
        : "/api/orchestration-monitor-detail";
    return `${base}?instanceId=${encodeURIComponent(instanceId)}`;
}

type Props = {
    instanceId: string;
    accessKey: string;
    onClose: () => void;
};

export default function InstanceDetailPanel({ instanceId, accessKey, onClose }: Props) {
    const [data, setData] = useState<DetailPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const headers: Record<string, string> = {};
            if (accessKey.trim()) {
                headers["X-Monitor-Key"] = accessKey.trim();
            }
            const res = await fetch(detailUrl(instanceId), { headers });
            const json = (await res.json().catch(() => ({}))) as DetailPayload;
            if (!res.ok) {
                setErr(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
                setData(null);
                return;
            }
            setData(json);
        } catch {
            setErr("Failed to load instance detail");
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [instanceId, accessKey]);

    useEffect(() => {
        void load();
    }, [load]);

    const barData =
        data?.parsed?.activityDurations.map((d) => ({
            name: d.name.length > 40 ? `${d.name.slice(0, 37)}…` : d.name,
            fullName: d.name,
            durationMs: d.durationMs,
        })) ?? [];

    const lineData = data?.parsed?.eventTimeline ?? [];

    return (
        <section className="detail-panel" aria-labelledby="detail-heading">
            <div className="detail-panel-head">
                <h2 id="detail-heading">Instance detail</h2>
                <p className="mono meta">{instanceId}</p>
                <button type="button" className="btn-secondary" onClick={onClose}>
                    Close
                </button>
                <button type="button" onClick={() => void load()} disabled={loading}>
                    {loading ? "Loading…" : "Reload detail"}
                </button>
            </div>

            {err && <p className="feedback error">{err}</p>}

            {loading && !data && <p className="feedback">Loading history…</p>}

            {data && (
                <>
                    <div className="detail-summary">
                        <p>
                            <strong>{data.orchestratorName}</strong> ·{" "}
                            <code>{data.runtimeStatus}</code> · {data.historyEventCount ?? 0} history
                            events
                        </p>
                        <pre className="custom-status-json">
                            {JSON.stringify(data.customStatus ?? null, null, 2)}
                        </pre>
                    </div>

                    <h3>Workflow map</h3>
                    <p className="lede small">
                        Template + live colours from history and custom status.{" "}
                        <a href="https://reactflow.dev/" rel="noreferrer">
                            React Flow
                        </a>
                        .
                    </p>
                    <WorkflowFlowchart
                        orchestratorName={data.orchestratorName}
                        runtimeStatus={data.runtimeStatus}
                        customStatus={data.customStatus}
                        flowSteps={data.parsed?.flowSteps ?? []}
                    />

                    <h3>Flow (where it passed)</h3>
                    <ol className="flow-steps">
                        {(data.parsed?.flowSteps ?? []).slice(0, 200).map((s, i) => (
                            <li key={`${i}-${s.slice(0, 24)}`}>{s}</li>
                        ))}
                    </ol>

                    {barData.length > 0 && (
                        <>
                            <h3>Activity duration (ms)</h3>
                            <div className="chart-wrap">
                                <ResponsiveContainer width="100%" height={Math.max(220, barData.length * 36)}>
                                    <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 16 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis type="number" unit=" ms" />
                                        <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                                        <Tooltip formatter={(v: number) => [`${v} ms`, "Duration"]} />
                                        <Bar dataKey="durationMs" fill="#0078d4" name="Duration" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </>
                    )}

                    {lineData.length > 1 && (
                        <>
                            <h3>History timeline (offset from start)</h3>
                            <p className="lede small">
                                Each point is one persisted history event; Y = milliseconds since first event.
                            </p>
                            <div className="chart-wrap chart-wrap-line">
                                <ResponsiveContainer width="100%" height={280}>
                                    <LineChart data={lineData} margin={{ left: 8, right: 16 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="index" label={{ value: "Event #", position: "insideBottom", offset: -4 }} />
                                        <YAxis type="number" unit=" ms" />
                                        <Tooltip
                                            formatter={(v: number) => [`${v} ms`, "Offset"]}
                                            labelFormatter={(i) => `Event index ${i}`}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="offsetMs"
                                            stroke="#0b6e4f"
                                            dot={false}
                                            name="Offset ms"
                                            strokeWidth={2}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </>
                    )}

                    <h3>Raw history (latest {Math.min(80, data.parsed?.timeline.length ?? 0)} rows)</h3>
                    <div className="timeline-table-wrap">
                        <table className="monitor-table timeline-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Type</th>
                                    <th>Label</th>
                                    <th>Name</th>
                                    <th>Time</th>
                                    <th>Detail</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(data.parsed?.timeline ?? []).slice(-80).map((row, idx) => (
                                    <tr key={`${row.eventId}-${idx}`}>
                                        <td>{row.eventId}</td>
                                        <td>{row.eventType}</td>
                                        <td>{row.label}</td>
                                        <td>{row.name ?? "—"}</td>
                                        <td className="nowrap">{new Date(row.timestamp).toLocaleString()}</td>
                                        <td className="detail-cell">{row.detail ?? "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </section>
    );
}

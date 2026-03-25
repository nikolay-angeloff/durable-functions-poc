import { useMemo } from "react";
import {
    Background,
    Controls,
    Handle,
    MarkerType,
    MiniMap,
    Position,
    ReactFlow,
    type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildWorkflowGraph, type StepStatus } from "./workflowFlowModel";

function StatusNode({ id, data }: NodeProps) {
    const { label, status } = data as { label: string; status: StepStatus };
    return (
        <div className={`wf-node wf-node--${status}`}>
            {id === "join" ? (
                <>
                    <Handle
                        id="in-v"
                        type="target"
                        position={Position.Top}
                        style={{ left: "28%" }}
                    />
                    <Handle
                        id="in-e"
                        type="target"
                        position={Position.Top}
                        style={{ left: "72%" }}
                    />
                </>
            ) : (
                <Handle type="target" position={Position.Top} />
            )}
            <div className="wf-node-label">{label}</div>
            <Handle type="source" position={Position.Bottom} />
        </div>
    );
}

const nodeTypes = { statusNode: StatusNode };

type Props = {
    orchestratorName?: string;
    runtimeStatus?: string;
    customStatus: unknown;
    flowSteps: string[];
};

export default function WorkflowFlowchart({
    orchestratorName,
    runtimeStatus,
    customStatus,
    flowSteps,
}: Props) {
    const graph = useMemo(
        () =>
            buildWorkflowGraph({
                orchestratorName,
                runtimeStatus,
                customStatus,
                flowSteps,
            }),
        [orchestratorName, runtimeStatus, customStatus, flowSteps]
    );

    if (!graph) {
        return (
            <p className="wf-unavailable">
                No flow template for <code>{orchestratorName ?? "(unknown)"}</code>. Known:{" "}
                <code>azureOrchestration</code>, <code>m365Orchestration</code>.
            </p>
        );
    }

    return (
        <div className="wf-wrap">
            <p className="wf-legend lede small">
                <span className="wf-legend-item wf-node--success">success</span>
                <span className="wf-legend-item wf-node--waiting">waiting (user / correction)</span>
                <span className="wf-legend-item wf-node--failed">failed</span>
                <span className="wf-legend-item wf-node--pending">not reached / pending</span>
            </p>
            <div className="wf-canvas" role="img" aria-label="Workflow flowchart">
                <ReactFlow
                    nodes={graph.nodes}
                    edges={graph.edges}
                    nodeTypes={nodeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.2, maxZoom: 1.25 }}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable={false}
                    panOnScroll
                    zoomOnScroll
                    defaultEdgeOptions={{
                        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
                    }}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background gap={14} size={1} />
                    <Controls showInteractive={false} />
                    <MiniMap
                        className="wf-minimap"
                        maskColor="rgba(0,0,0,0.12)"
                        nodeColor={(n) => {
                            const s = (n.data as { status?: StepStatus })?.status;
                            if (s === "success") {
                                return "#a7f3d0";
                            }
                            if (s === "waiting") {
                                return "#fed7aa";
                            }
                            if (s === "failed") {
                                return "#fecaca";
                            }
                            return "#e2e8f0";
                        }}
                    />
                </ReactFlow>
            </div>
        </div>
    );
}

export const DECISION_TOOL_REGISTRY_VERSION: "wr-decision-tool-registry-v1";
export const DECISION_TOOL_LAUNCH_VERSION: "wr-decision-tool-launch-v1";

export type DecisionTool = Readonly<{
  id: string;
  capabilityId: string;
  name: string;
  action: string;
  requiredGates: readonly string[];
  planned?: boolean;
  detail: string;
  registryVersion: string;
  ready: boolean;
  status: "Planned" | "Active" | "Preview gated";
  blockedBy: readonly string[];
}>;

export function buildParcelDecisionToolCatalog(gates?: Readonly<Record<string, boolean>>): DecisionTool[];
export function createDecisionToolLaunchRequest(tool: DecisionTool, parcel?: Record<string, any>): Readonly<{
  schemaVersion: string;
  toolId: string;
  capabilityId: string;
  action: string;
  parcelId: string;
  sourceCountyId: string;
}>;


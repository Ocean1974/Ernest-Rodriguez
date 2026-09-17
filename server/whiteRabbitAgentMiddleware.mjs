import { PARCEL_AGENTS, PARCEL_AGENT_VERSION, runLocalParcelAgent } from "../src/agents/parcelAgentRuntime.mjs";

const MAX_REQUEST_BYTES = 96 * 1024;
const MAX_TOOL_ROUNDS = 4;

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw Object.assign(new Error("Agent request is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function safeContext(input) {
  if (!input || typeof input !== "object" || !input.parcel || typeof input.parcel !== "object") {
    throw Object.assign(new Error("A parcel context is required"), { statusCode: 400 });
  }
  return JSON.parse(JSON.stringify(input).slice(0, MAX_REQUEST_BYTES));
}

const TOOLS = [
  {
    type: "function",
    name: "get_parcel_profile",
    description: "Return the verified county parcel identity, site, ownership, value, zoning label, and land-use facts supplied by White Rabbit.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "get_hbu_analysis",
    description: "Return the current White Rabbit highest-and-best-use screen and its missing evidence.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "get_underwriting_snapshot",
    description: "Return the current editable underwriting scenario and calculated metrics.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "get_due_diligence_evidence",
    description: "Return zoning, floodplain, permit, frontage, and missing-evidence status for the selected parcel.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

function toolResult(name, context) {
  if (name === "get_parcel_profile") return context.parcel;
  if (name === "get_hbu_analysis") return context.highestBestUse || { status: "not-available" };
  if (name === "get_underwriting_snapshot") return context.underwriting || { status: "not-available" };
  if (name === "get_due_diligence_evidence") return context.evidence;
  return { error: "Unknown tool" };
}

function outputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  return (response?.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

async function callResponsesApi({ apiKey, model, agent, message, context }) {
  const instructions = [
    `You are White Rabbit's ${agent.name}.`,
    "Analyze only the selected parcel. Use the supplied tools before making factual claims.",
    "Clearly separate verified facts, analyst assumptions, inferences, and missing evidence.",
    "Never claim a zoning entitlement, legal conclusion, valuation, or investment outcome is guaranteed.",
    "Answer concisely with: conclusion, evidence, missing evidence, and next actions.",
  ].join(" ");
  let response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, store: false, instructions, input: String(message || agent.starter), tools: TOOLS, tool_choice: "auto", max_tool_calls: 8 }),
  });
  if (!response.ok) throw new Error(`OpenAI Responses API returned ${response.status}`);
  let payload = await response.json();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const calls = (payload.output || []).filter((item) => item.type === "function_call");
    if (!calls.length) break;
    const input = calls.map((call) => ({
      type: "function_call_output",
      call_id: call.call_id,
      output: JSON.stringify(toolResult(call.name, context)),
    }));
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, store: false, instructions, previous_response_id: payload.id, input, tools: TOOLS, tool_choice: "auto", max_tool_calls: 8 }),
    });
    if (!response.ok) throw new Error(`OpenAI Responses API returned ${response.status}`);
    payload = await response.json();
  }

  const summary = outputText(payload);
  if (!summary) throw new Error("OpenAI Responses API returned no agent text");
  return {
    schemaVersion: PARCEL_AGENT_VERSION,
    agentId: agent.id,
    agentName: agent.name,
    mode: "openai-responses",
    summary,
    findings: [],
    nextActions: [],
    sources: [
      { label: "Parcel record", detail: `${context.parcel.sourceCountyId || "county source"} · ${context.parcel.id}` },
      context.evidence?.zoningVerified ? { label: "Zoning evidence", detail: context.parcel.zoning } : null,
      context.evidence?.permitCount ? { label: "Permit evidence", detail: `${context.evidence.permitCount} parcel-linked record(s)` } : null,
    ].filter(Boolean),
    missingEvidence: context.evidence?.missing || [],
    disclaimer: "Decision-support output only. Verify legal, physical, market, financial, title, and environmental evidence before acting.",
  };
}

export function createWhiteRabbitAgentPlugin() {
  return {
    name: "white-rabbit-agent-api",
    configureServer(server) {
      server.middlewares.use("/api/agents/respond", async (request, response) => {
        if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
        try {
          const body = await readJson(request);
          const context = safeContext(body.context);
          const agent = PARCEL_AGENTS.find((candidate) => candidate.id === body.agentId) || PARCEL_AGENTS[0];
          const message = String(body.message || agent.starter).slice(0, 4000);
          const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
          if (!apiKey) return sendJson(response, 200, runLocalParcelAgent({ agentId: agent.id, message, context }));
          const result = await callResponsesApi({
            apiKey,
            model: String(process.env.OPENAI_AGENT_MODEL || "gpt-5.4-mini"),
            agent,
            message,
            context,
          });
          return sendJson(response, 200, result);
        } catch (error) {
          const statusCode = Number(error?.statusCode) || 500;
          return sendJson(response, statusCode, { error: statusCode < 500 ? error.message : "Agent request failed" });
        }
      });
    },
  };
}

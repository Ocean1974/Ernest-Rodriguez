import { createOrchestratorRun } from "./savantOrchestrator.mjs";

export const SAVANT_EVENT_QUEUE_VERSION = "wr-savant-event-queue-v1";
export const SAVANT_EVENT_QUEUE_KEY = "real-estate-savant:agent-runs:v1";

function read(storage) {
  try { const value = JSON.parse(storage?.getItem(SAVANT_EVENT_QUEUE_KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}

export function enqueueSavantEvent(input = {}, storage = globalThis?.localStorage) {
  if (!storage) return { queued: false, duplicate: false, run: null };
  const runs = read(storage);
  const duplicate = runs.find((run) => run.eventId === input.eventId && run.eventType === input.eventType);
  if (duplicate) return { queued: false, duplicate: true, run: duplicate };
  const run = createOrchestratorRun(input);
  storage.setItem(SAVANT_EVENT_QUEUE_KEY, JSON.stringify([run, ...runs].slice(0, 1000)));
  return { queued: true, duplicate: false, run };
}

export function loadSavantRuns(storage = globalThis?.localStorage) { return read(storage); }

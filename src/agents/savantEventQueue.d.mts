export const SAVANT_EVENT_QUEUE_VERSION: "wr-savant-event-queue-v1";
export const SAVANT_EVENT_QUEUE_KEY: string;
export function enqueueSavantEvent(input?: Record<string, any>, storage?: Storage): Record<string, any>;
export function loadSavantRuns(storage?: Storage): Array<Record<string, any>>;

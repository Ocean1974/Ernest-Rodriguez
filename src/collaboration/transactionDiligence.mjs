import { createHash } from "node:crypto";

export const BUSINESS_CALENDAR_VERSION = "wr-business-calendar-v1";
export const DILIGENCE_TEMPLATE_TASK_VERSION = "wr-diligence-template-task-v1";
export const DILIGENCE_CHECKLIST_TEMPLATE_VERSION = "wr-diligence-checklist-template-v1";
export const DILIGENCE_EVIDENCE_RECEIPT_VERSION = "wr-diligence-evidence-receipt-v1";
export const DILIGENCE_CRITICAL_DATE_VERSION = "wr-diligence-critical-date-v1";
export const DILIGENCE_TASK_VERSION = "wr-diligence-task-v1";
export const DILIGENCE_HISTORY_EVENT_VERSION = "wr-diligence-history-event-v1";
export const DILIGENCE_WORKFLOW_VERSION = "wr-diligence-workflow-v1";
export const DILIGENCE_SLA_REPORT_VERSION = "wr-diligence-sla-report-v1";

const TASK_STATUSES = Object.freeze(["blocked", "ready", "in-progress", "completed", "waived"]);
const EVIDENCE_TYPES = Object.freeze(["document-version", "fact-promotion", "approval", "inspection", "artifact"]);

function required(value, name) { const normalized = String(value || "").trim(); if (!normalized) throw new TypeError(`${name} is required`); return normalized; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function dateOnly(value, name) { const normalized = String(value || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || new Date(`${normalized}T00:00:00.000Z`).toISOString().slice(0, 10) !== normalized) throw new TypeError(`${name} must be a valid YYYY-MM-DD date`); return normalized; }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
export function diligenceSha256(value) { return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest("hex"); }
function stableId(prefix, seed) { return `${prefix}_${diligenceSha256(seed).slice(0, 24)}`; }
function digest(value, name) { const normalized = required(value, name); if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`${name} must be a SHA-256 digest`); return normalized; }
function error(code, message) { const value = new Error(message); value.code = code; return value; }
function tenantError(message) { return error("WR_TENANT_ISOLATION_VIOLATION", message); }
function seal(input, body, field, code, label) { const value = diligenceSha256(body); if (input[field] && input[field] !== value) throw error(code, `${label} digest verification failed`); return Object.freeze({ ...body, [field]: value }); }

function localDateAdd(value, days) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function weekday(value) { return new Date(`${value}T00:00:00.000Z`).getUTCDay(); }

export function createBusinessCalendar(input = {}) {
  const holidays = [...new Set((input.holidays || []).map((item) => dateOnly(item, "holiday")))].sort();
  const weekendDays = [...new Set((input.weekendDays || [0, 6]).map(Number))].sort();
  if (!weekendDays.length || weekendDays.some((item) => !Number.isInteger(item) || item < 0 || item > 6)) throw new TypeError("weekendDays must contain weekday integers 0-6");
  const sourceAsOf = dateOnly(input.sourceAsOf, "sourceAsOf"); const validThrough = dateOnly(input.validThrough, "validThrough");
  if (validThrough < sourceAsOf) throw new TypeError("Business calendar validThrough cannot precede sourceAsOf");
  try { new Intl.DateTimeFormat("en-US", { timeZone: required(input.timeZone, "timeZone") }).format(new Date()); } catch { throw new TypeError("timeZone must be an IANA time zone"); }
  const sourceRef = required(input.sourceRef, "sourceRef"); if (!sourceRef.startsWith("calendar-ref:")) throw new TypeError("sourceRef must be an opaque calendar-ref:");
  const body = { schemaVersion: BUSINESS_CALENDAR_VERSION, id: String(input.id || stableId("business_calendar", `${input.jurisdiction}|${input.sourceVersion}|${sourceAsOf}`)), jurisdiction: required(input.jurisdiction, "jurisdiction"), timeZone: input.timeZone, weekendDays, holidays, sourceAuthority: required(input.sourceAuthority, "sourceAuthority"), sourceVersion: required(input.sourceVersion, "sourceVersion"), sourceRef, sourceAsOf, validThrough };
  return seal(input, body, "calendarSha256", "WR_BUSINESS_CALENDAR_INTEGRITY_FAILURE", "Business calendar");
}

function isBusinessDay(value, calendar) { return !calendar.weekendDays.includes(weekday(value)) && !calendar.holidays.includes(value); }

export function addBusinessDays(startDate, amount, calendarInput) {
  const calendar = createBusinessCalendar(calendarInput); let current = dateOnly(startDate, "startDate"); let remaining = Math.abs(Math.trunc(Number(amount) || 0)); const direction = Number(amount) < 0 ? -1 : 1;
  while (remaining > 0) { current = localDateAdd(current, direction); if (isBusinessDay(current, calendar)) remaining -= 1; }
  if (current > calendar.validThrough) throw error("WR_BUSINESS_CALENDAR_COVERAGE_INSUFFICIENT", `Business calendar does not cover ${current}`);
  return current;
}

function rollDate(value, convention, calendar) {
  if (isBusinessDay(value, calendar)) return value;
  const move = (direction) => { let result = value; do { result = localDateAdd(result, direction); } while (!isBusinessDay(result, calendar)); return result; };
  if (convention === "preceding") return move(-1);
  if (convention === "modified-following") { const following = move(1); return following.slice(0, 7) === value.slice(0, 7) ? following : move(-1); }
  return move(1);
}

function zonedLocalToUtc(localDate, localTime, timeZone) {
  const [year, month, day] = localDate.split("-").map(Number); const [hour, minute, second = 0] = localTime.split(":").map(Number);
  if (![hour, minute, second].every(Number.isFinite) || hour > 23 || minute > 59 || second > 59) throw new TypeError("deadlineLocalTime must be HH:mm or HH:mm:ss");
  const desired = Date.UTC(year, month - 1, day, hour, minute, second); let guess = desired;
  const format = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let index = 0; index < 3; index += 1) { const parts = Object.fromEntries(format.formatToParts(new Date(guess)).filter((item) => item.type !== "literal").map((item) => [item.type, Number(item.value)])); const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second); guess += desired - represented; }
  const check = Object.fromEntries(format.formatToParts(new Date(guess)).filter((item) => item.type !== "literal").map((item) => [item.type, Number(item.value)]));
  if ([check.year, check.month, check.day, check.hour, check.minute, check.second].join("|") !== [year, month, day, hour, minute, second].join("|")) throw error("WR_LOCAL_DEADLINE_INVALID", "Local deadline does not resolve uniquely in the configured time zone");
  return new Date(guess).toISOString();
}

function normalizeDeadlineRule(input) {
  if (!input) return null;
  const unit = ["calendar-days", "business-days"].includes(input.unit) ? input.unit : "calendar-days";
  return Object.freeze({ anchorId: required(input.anchorId, "deadlineRule.anchorId"), amount: Math.trunc(Number(input.amount) || 0), unit, rollConvention: ["following", "preceding", "modified-following"].includes(input.rollConvention) ? input.rollConvention : "following", deadlineLocalTime: String(input.deadlineLocalTime || "17:00:00") });
}

function normalizeEvidenceRequirement(input = {}, index = 0) { const type = EVIDENCE_TYPES.includes(input.type) ? input.type : "artifact"; return Object.freeze({ id: String(input.id || `evidence-${index + 1}`), type, minimumCount: Math.max(1, Math.trunc(Number(input.minimumCount) || 1)), description: required(input.description, `evidenceRequirements[${index}].description`) }); }

export function createDiligenceTemplateTask(input = {}) {
  const body = { schemaVersion: DILIGENCE_TEMPLATE_TASK_VERSION, id: required(input.id, "task.id"), title: required(input.title, "task.title"), phase: required(input.phase, "task.phase"), dependencyIds: [...new Set((input.dependencyIds || []).map(String).filter(Boolean))].sort(), deadlineRule: normalizeDeadlineRule(input.deadlineRule), evidenceRequirements: (input.evidenceRequirements || []).map(normalizeEvidenceRequirement), assigneeRole: required(input.assigneeRole, "task.assigneeRole"), waivable: input.waivable === true, critical: input.critical === true, reminderOffsetsSeconds: [...new Set((input.reminderOffsetsSeconds || [86400]).map((value) => Math.max(0, Math.trunc(Number(value) || 0))))].sort((a, b) => b - a), escalationAfterSeconds: Math.max(0, Math.trunc(Number(input.escalationAfterSeconds) || 0)) };
  if (body.dependencyIds.includes(body.id)) throw new TypeError("A diligence task cannot depend on itself");
  return seal(input, body, "taskSha256", "WR_DILIGENCE_TEMPLATE_TASK_INTEGRITY_FAILURE", "Diligence template task");
}

function validateDag(tasks) {
  const ids = new Set(tasks.map((item) => item.id)); if (ids.size !== tasks.length) throw new TypeError("Diligence template task IDs must be unique");
  for (const task of tasks) for (const dependencyId of task.dependencyIds) if (!ids.has(dependencyId)) throw new TypeError(`Unknown diligence task dependency: ${dependencyId}`);
  const visiting = new Set(), visited = new Set();
  const visit = (id) => { if (visiting.has(id)) throw error("WR_DILIGENCE_DEPENDENCY_CYCLE", `Diligence template contains a dependency cycle at ${id}`); if (visited.has(id)) return; visiting.add(id); for (const dep of tasks.find((item) => item.id === id).dependencyIds) visit(dep); visiting.delete(id); visited.add(id); };
  for (const task of tasks) visit(task.id);
}

export function createDiligenceChecklistTemplate(input = {}) {
  const tasks = (input.tasks || []).map(createDiligenceTemplateTask); if (!tasks.length) throw new TypeError("A diligence template requires at least one task"); validateDag(tasks);
  const body = { schemaVersion: DILIGENCE_CHECKLIST_TEMPLATE_VERSION, id: required(input.id, "template.id"), version: Math.max(1, Math.trunc(Number(input.version) || 1)), name: required(input.name, "template.name"), transactionType: required(input.transactionType, "transactionType"), jurisdiction: required(input.jurisdiction, "jurisdiction"), tasks, createdByUserId: required(input.createdByUserId, "createdByUserId"), createdAt: iso(input.createdAt, "createdAt") };
  return seal(input, body, "templateSha256", "WR_DILIGENCE_TEMPLATE_INTEGRITY_FAILURE", "Diligence checklist template");
}

export function createDiligenceEvidenceReceipt(input = {}) {
  const type = EVIDENCE_TYPES.includes(input.type) ? input.type : "artifact"; const verifiedAt = iso(input.verifiedAt, "verifiedAt"); const expiresAt = input.expiresAt ? iso(input.expiresAt, "expiresAt") : "";
  if (expiresAt && new Date(expiresAt) <= new Date(verifiedAt)) throw new TypeError("Evidence expiry must follow verification");
  const evidenceRef = required(input.evidenceRef, "evidenceRef"); if (!evidenceRef.startsWith("evidence-ref:")) throw new TypeError("evidenceRef must be opaque");
  const body = { schemaVersion: DILIGENCE_EVIDENCE_RECEIPT_VERSION, id: String(input.id || stableId("diligence_evidence", `${input.organizationId}|${input.taskId}|${evidenceRef}|${verifiedAt}`)), organizationId: required(input.organizationId, "organizationId"), dealId: required(input.dealId, "dealId"), workflowId: required(input.workflowId, "workflowId"), taskId: required(input.taskId, "taskId"), type, evidenceRef, evidenceSha256: digest(input.evidenceSha256, "evidenceSha256"), verifiedByUserId: required(input.verifiedByUserId, "verifiedByUserId"), verificationPolicyId: required(input.verificationPolicyId, "verificationPolicyId"), verifiedAt, expiresAt };
  return seal(input, body, "receiptSha256", "WR_DILIGENCE_EVIDENCE_INTEGRITY_FAILURE", "Diligence evidence receipt");
}

function criticalDate(input) { const body = { schemaVersion: DILIGENCE_CRITICAL_DATE_VERSION, taskId: required(input.taskId, "criticalDate.taskId"), anchorId: String(input.anchorId || ""), anchorDate: String(input.anchorDate || ""), localDueDate: String(input.localDueDate || ""), deadlineLocalTime: String(input.deadlineLocalTime || ""), timeZone: String(input.timeZone || ""), dueAt: String(input.dueAt || ""), status: ["calculated", "unknown-anchor", "not-applicable"].includes(input.status) ? input.status : "not-applicable", calendarId: String(input.calendarId || ""), calendarSha256: String(input.calendarSha256 || "") }; return seal(input, body, "criticalDateSha256", "WR_CRITICAL_DATE_INTEGRITY_FAILURE", "Critical date"); }

function calculateCriticalDate(task, anchors, calendar) {
  if (!task.deadlineRule) return criticalDate({ taskId: task.id, status: "not-applicable" });
  const anchorDate = anchors[task.deadlineRule.anchorId]; if (!anchorDate) return criticalDate({ taskId: task.id, anchorId: task.deadlineRule.anchorId, status: "unknown-anchor" });
  const normalizedAnchor = dateOnly(anchorDate, `anchors.${task.deadlineRule.anchorId}`); let localDueDate = task.deadlineRule.unit === "business-days" ? addBusinessDays(normalizedAnchor, task.deadlineRule.amount, calendar) : localDateAdd(normalizedAnchor, task.deadlineRule.amount);
  localDueDate = rollDate(localDueDate, task.deadlineRule.rollConvention, calendar); if (localDueDate > calendar.validThrough) throw error("WR_BUSINESS_CALENDAR_COVERAGE_INSUFFICIENT", `Business calendar does not cover ${localDueDate}`);
  return criticalDate({ taskId: task.id, anchorId: task.deadlineRule.anchorId, anchorDate: normalizedAnchor, localDueDate, deadlineLocalTime: task.deadlineRule.deadlineLocalTime, timeZone: calendar.timeZone, dueAt: zonedLocalToUtc(localDueDate, task.deadlineRule.deadlineLocalTime, calendar.timeZone), status: "calculated", calendarId: calendar.id, calendarSha256: calendar.calendarSha256 });
}

function historyEvent(input) { const body = { schemaVersion: DILIGENCE_HISTORY_EVENT_VERSION, id: required(input.id, "history.id"), organizationId: required(input.organizationId, "history.organizationId"), workflowId: required(input.workflowId, "history.workflowId"), taskId: String(input.taskId || ""), action: required(input.action, "history.action"), fromStatus: String(input.fromStatus || ""), toStatus: String(input.toStatus || ""), actorUserId: required(input.actorUserId, "history.actorUserId"), reason: String(input.reason || ""), evidenceReceiptSha256s: [...(input.evidenceReceiptSha256s || [])].map((item) => digest(item, "history.evidenceReceiptSha256")).sort(), occurredAt: iso(input.occurredAt, "history.occurredAt"), previousEventSha256: String(input.previousEventSha256 || "") }; return seal(input, body, "eventSha256", "WR_DILIGENCE_HISTORY_INTEGRITY_FAILURE", "Diligence history event"); }

function taskInstance(input) { const body = { schemaVersion: DILIGENCE_TASK_VERSION, id: required(input.id, "task.id"), templateTaskSha256: digest(input.templateTaskSha256, "task.templateTaskSha256"), title: required(input.title, "task.title"), phase: required(input.phase, "task.phase"), dependencyIds: [...(input.dependencyIds || [])].map(String).sort(), evidenceRequirements: (input.evidenceRequirements || []).map(normalizeEvidenceRequirement), assigneeRole: required(input.assigneeRole, "task.assigneeRole"), assigneeUserId: String(input.assigneeUserId || ""), waivable: input.waivable === true, critical: input.critical === true, reminderOffsetsSeconds: [...(input.reminderOffsetsSeconds || [])].map(Number).sort((a, b) => b - a), escalationAfterSeconds: Math.max(0, Number(input.escalationAfterSeconds) || 0), criticalDate: criticalDate(input.criticalDate), status: TASK_STATUSES.includes(input.status) ? input.status : "blocked", completedAt: String(input.completedAt || ""), completedByUserId: String(input.completedByUserId || ""), evidenceReceipts: (input.evidenceReceipts || []).map(createDiligenceEvidenceReceipt) }; return seal(input, body, "taskInstanceSha256", "WR_DILIGENCE_TASK_INTEGRITY_FAILURE", "Diligence task"); }

function verifyHistory(history, organizationId, workflowId) { let previous = ""; const taskStatus = new Map(); for (const raw of history) { const event = historyEvent(raw); if (event.organizationId !== organizationId || event.workflowId !== workflowId || event.previousEventSha256 !== previous) throw error("WR_DILIGENCE_HISTORY_INTEGRITY_FAILURE", "Diligence history chain is invalid"); previous = event.eventSha256; if (event.taskId && event.toStatus) taskStatus.set(event.taskId, event.toStatus); } return { events: history.map(historyEvent), head: previous, taskStatus }; }

export function createDiligenceWorkflow(input = {}) {
  const organizationId = required(input.organizationId, "organizationId"), id = required(input.id, "workflow.id"); const tasks = (input.tasks || []).map(taskInstance); const verified = verifyHistory(input.history || [], organizationId, id);
  validateDag(tasks);
  for (const task of tasks) if (verified.taskStatus.has(task.id) && verified.taskStatus.get(task.id) !== task.status) throw error("WR_DILIGENCE_HISTORY_INTEGRITY_FAILURE", `Task ${task.id} status does not match history`);
  const body = { schemaVersion: DILIGENCE_WORKFLOW_VERSION, id, organizationId, dealId: required(input.dealId, "dealId"), whiteRabbitPropertyId: required(input.whiteRabbitPropertyId, "whiteRabbitPropertyId"), templateId: required(input.templateId, "templateId"), templateSha256: digest(input.templateSha256, "templateSha256"), calendarId: required(input.calendarId, "calendarId"), calendarSha256: digest(input.calendarSha256, "calendarSha256"), anchors: Object.fromEntries(Object.entries(input.anchors || {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, dateOnly(value, `anchors.${key}`)])), revision: Math.max(1, Math.trunc(Number(input.revision) || 1)), tasks, history: verified.events, historyHeadSha256: verified.head, status: ["active", "completed", "cancelled"].includes(input.status) ? input.status : "active", createdByUserId: required(input.createdByUserId, "createdByUserId"), createdAt: iso(input.createdAt, "createdAt"), updatedAt: iso(input.updatedAt, "updatedAt") };
  return seal(input, body, "workflowSha256", "WR_DILIGENCE_WORKFLOW_INTEGRITY_FAILURE", "Diligence workflow");
}

function appendHistory(workflow, eventInput) { const event = historyEvent({ ...eventInput, id: eventInput.id || stableId("diligence_history", `${workflow.id}|${eventInput.taskId}|${eventInput.action}|${eventInput.occurredAt}|${workflow.historyHeadSha256}`), organizationId: workflow.organizationId, workflowId: workflow.id, previousEventSha256: workflow.historyHeadSha256 }); return { event, history: [...workflow.history, event] }; }

function appendHistorySequence(workflow, eventInputs) {
  let history = [...workflow.history], previousEventSha256 = workflow.historyHeadSha256, lastEvent = null;
  for (const eventInput of eventInputs) { lastEvent = historyEvent({ ...eventInput, id: eventInput.id || stableId("diligence_history", `${workflow.id}|${eventInput.taskId}|${eventInput.action}|${eventInput.occurredAt}|${previousEventSha256}`), organizationId: workflow.organizationId, workflowId: workflow.id, previousEventSha256 }); history.push(lastEvent); previousEventSha256 = lastEvent.eventSha256; }
  return { history, historyHeadSha256: previousEventSha256, lastEvent };
}

export function instantiateDiligenceWorkflow(input = {}) {
  const template = createDiligenceChecklistTemplate(input.template), calendar = createBusinessCalendar(input.calendar), organizationId = required(input.organizationId, "organizationId"), createdAt = iso(input.createdAt, "createdAt");
  if (template.jurisdiction !== calendar.jurisdiction) throw error("WR_DILIGENCE_CALENDAR_MISMATCH", "Checklist and business calendar jurisdictions do not match");
  const id = String(input.id || stableId("diligence_workflow", `${organizationId}|${input.dealId}|${template.templateSha256}|${createdAt}`)); let previous = ""; const history = [];
  const tasks = template.tasks.map((definition) => { const date = calculateCriticalDate(definition, input.anchors || {}, calendar); const status = definition.dependencyIds.length || date.status === "unknown-anchor" ? "blocked" : "ready"; const event = historyEvent({ id: stableId("diligence_history", `${id}|${definition.id}|initialized|${createdAt}`), organizationId, workflowId: id, taskId: definition.id, action: "task.initialized", fromStatus: "", toStatus: status, actorUserId: required(input.createdByUserId, "createdByUserId"), occurredAt: createdAt, previousEventSha256: previous }); previous = event.eventSha256; history.push(event); return taskInstance({ ...definition, templateTaskSha256: definition.taskSha256, criticalDate: date, status, assigneeUserId: input.assignments?.[definition.id] || "", evidenceReceipts: [] }); });
  return createDiligenceWorkflow({ id, organizationId, dealId: input.dealId, whiteRabbitPropertyId: input.whiteRabbitPropertyId, templateId: template.id, templateSha256: template.templateSha256, calendarId: calendar.id, calendarSha256: calendar.calendarSha256, anchors: input.anchors || {}, revision: 1, tasks, history, historyHeadSha256: previous, status: "active", createdByUserId: input.createdByUserId, createdAt, updatedAt: createdAt });
}

function assertMutation(workflow, context, grant) { if (context.organizationId !== workflow.organizationId) throw tenantError("Diligence mutation tenant does not match workflow"); if (!(context.grants || []).includes(grant)) throw error("WR_DILIGENCE_PERMISSION_DENIED", `${grant} grant is required`); if (Number(context.expectedRevision) !== workflow.revision) throw error("WR_REVISION_CONFLICT", `Diligence workflow revision conflict: expected ${context.expectedRevision}, found ${workflow.revision}`); required(context.actorUserId, "context.actorUserId"); const occurredAt = iso(context.occurredAt, "context.occurredAt"); if (new Date(occurredAt) < new Date(workflow.updatedAt)) throw error("WR_DILIGENCE_TIME_REGRESSION", "Diligence mutations must not move backward in time"); return occurredAt; }

function refreshDependents(tasks) { const statuses = new Map(tasks.map((item) => [item.id, item.status])); return tasks.map((task) => { if (!["blocked", "ready"].includes(task.status) || task.criticalDate.status === "unknown-anchor") return task; const ready = task.dependencyIds.every((id) => ["completed", "waived"].includes(statuses.get(id))); return taskInstance({ ...task, taskInstanceSha256: undefined, status: ready ? "ready" : "blocked" }); }); }

function resealWorkflow(workflow, changes) { return createDiligenceWorkflow({ ...workflow, ...changes, workflowSha256: undefined }); }

export function startDiligenceTask(workflowInput, taskId, context = {}) {
  const workflow = createDiligenceWorkflow(workflowInput), occurredAt = assertMutation(workflow, context, "diligence:write"); const index = workflow.tasks.findIndex((item) => item.id === taskId); if (index < 0) throw new TypeError(`Unknown diligence task: ${taskId}`); const current = workflow.tasks[index]; if (current.status !== "ready") throw error("WR_DILIGENCE_TASK_NOT_READY", "Only a ready diligence task can start");
  const tasks = [...workflow.tasks]; tasks[index] = taskInstance({ ...current, taskInstanceSha256: undefined, status: "in-progress" }); const appended = appendHistory(workflow, { taskId, action: "task.started", fromStatus: current.status, toStatus: "in-progress", actorUserId: context.actorUserId, occurredAt });
  return resealWorkflow(workflow, { revision: workflow.revision + 1, tasks, history: appended.history, historyHeadSha256: appended.event.eventSha256, updatedAt: occurredAt });
}

function validateCompletionEvidence(workflow, task, receiptsInput, now) {
  const receipts = receiptsInput.map(createDiligenceEvidenceReceipt); if (new Set(receipts.map((item) => item.receiptSha256)).size !== receipts.length) throw error("WR_DILIGENCE_EVIDENCE_DUPLICATE", "Duplicate evidence receipts cannot satisfy completion requirements"); for (const receipt of receipts) { if (receipt.organizationId !== workflow.organizationId) throw tenantError("Completion evidence belongs to another organization"); if (receipt.dealId !== workflow.dealId || receipt.workflowId !== workflow.id || receipt.taskId !== task.id) throw error("WR_DILIGENCE_EVIDENCE_SCOPE_MISMATCH", "Completion evidence is not scoped to this task"); if (new Date(receipt.verifiedAt) > new Date(now)) throw error("WR_DILIGENCE_EVIDENCE_FUTURE", "Future-verified evidence cannot satisfy completion"); if (receipt.expiresAt && new Date(receipt.expiresAt) <= new Date(now)) throw error("WR_DILIGENCE_EVIDENCE_EXPIRED", "Completion evidence is expired"); }
  for (const requirement of task.evidenceRequirements) if (receipts.filter((item) => item.type === requirement.type).length < requirement.minimumCount) throw error("WR_DILIGENCE_EVIDENCE_INCOMPLETE", `Task requires ${requirement.minimumCount} ${requirement.type} evidence item(s)`);
  return receipts;
}

export function completeDiligenceTask(workflowInput, taskId, receiptsInput = [], context = {}) {
  const workflow = createDiligenceWorkflow(workflowInput), occurredAt = assertMutation(workflow, context, "diligence:complete"); const index = workflow.tasks.findIndex((item) => item.id === taskId); if (index < 0) throw new TypeError(`Unknown diligence task: ${taskId}`); const current = workflow.tasks[index]; if (!["ready", "in-progress"].includes(current.status)) throw error("WR_DILIGENCE_TASK_NOT_READY", "Task dependencies or status do not permit completion");
  if (!current.dependencyIds.every((id) => ["completed", "waived"].includes(workflow.tasks.find((item) => item.id === id)?.status))) throw error("WR_DILIGENCE_DEPENDENCY_INCOMPLETE", "All task dependencies must be completed or waived"); const receipts = validateCompletionEvidence(workflow, current, receiptsInput, occurredAt);
  let tasks = [...workflow.tasks]; tasks[index] = taskInstance({ ...current, taskInstanceSha256: undefined, status: "completed", completedAt: occurredAt, completedByUserId: context.actorUserId, evidenceReceipts: receipts }); const beforeRefresh = new Map(tasks.map((item) => [item.id, item.status])); tasks = refreshDependents(tasks);
  const events = [{ taskId, action: "task.completed", fromStatus: current.status, toStatus: "completed", actorUserId: context.actorUserId, evidenceReceiptSha256s: receipts.map((item) => item.receiptSha256), occurredAt }, ...tasks.filter((item) => beforeRefresh.get(item.id) !== item.status).map((item) => ({ taskId: item.id, action: "task.unblocked", fromStatus: beforeRefresh.get(item.id), toStatus: item.status, actorUserId: context.actorUserId, occurredAt }))];
  const appended = appendHistorySequence(workflow, events); const complete = tasks.every((item) => ["completed", "waived"].includes(item.status));
  return resealWorkflow(workflow, { revision: workflow.revision + 1, tasks, history: appended.history, historyHeadSha256: appended.historyHeadSha256, status: complete ? "completed" : workflow.status, updatedAt: occurredAt });
}

export function waiveDiligenceTask(workflowInput, taskId, approvalReceiptsInput = [], context = {}) {
  const workflow = createDiligenceWorkflow(workflowInput), occurredAt = assertMutation(workflow, context, "diligence:waive"); const index = workflow.tasks.findIndex((item) => item.id === taskId); if (index < 0) throw new TypeError(`Unknown diligence task: ${taskId}`); const current = workflow.tasks[index]; if (!current.waivable || current.critical) throw error("WR_DILIGENCE_WAIVER_DENIED", "Critical or non-waivable tasks cannot be waived");
  const reason = required(context.reason, "context.reason"); const approvalReceipts = approvalReceiptsInput.map(createDiligenceEvidenceReceipt); if (approvalReceipts.length !== 1 || approvalReceipts[0].type !== "approval") throw error("WR_DILIGENCE_WAIVER_APPROVAL_REQUIRED", "A waiver requires exactly one approval evidence receipt"); validateCompletionEvidence(workflow, { ...current, evidenceRequirements: [{ id: "waiver-approval", type: "approval", minimumCount: 1, description: "Waiver approval" }] }, approvalReceipts, occurredAt); let tasks = [...workflow.tasks]; tasks[index] = taskInstance({ ...current, taskInstanceSha256: undefined, status: "waived", completedAt: occurredAt, completedByUserId: context.actorUserId, evidenceReceipts: approvalReceipts }); const beforeRefresh = new Map(tasks.map((item) => [item.id, item.status])); tasks = refreshDependents(tasks); const events = [{ taskId, action: "task.waived", fromStatus: current.status, toStatus: "waived", actorUserId: context.actorUserId, reason, evidenceReceiptSha256s: approvalReceipts.map((item) => item.receiptSha256), occurredAt }, ...tasks.filter((item) => beforeRefresh.get(item.id) !== item.status).map((item) => ({ taskId: item.id, action: "task.unblocked", fromStatus: beforeRefresh.get(item.id), toStatus: item.status, actorUserId: context.actorUserId, occurredAt }))]; const appended = appendHistorySequence(workflow, events);
  return resealWorkflow(workflow, { revision: workflow.revision + 1, tasks, history: appended.history, historyHeadSha256: appended.historyHeadSha256, updatedAt: occurredAt });
}

export function updateDiligenceAnchor(workflowInput, input = {}, context = {}) {
  const workflow = createDiligenceWorkflow(workflowInput), occurredAt = assertMutation(workflow, context, "diligence:calendar"); const template = createDiligenceChecklistTemplate(input.template), calendar = createBusinessCalendar(input.calendar);
  if (template.id !== workflow.templateId || template.templateSha256 !== workflow.templateSha256 || calendar.id !== workflow.calendarId || calendar.calendarSha256 !== workflow.calendarSha256) throw error("WR_DILIGENCE_CONFIGURATION_MISMATCH", "Anchor update requires the exact workflow template and calendar");
  const anchorId = required(input.anchorId, "anchorId"), anchorDate = dateOnly(input.anchorDate, "anchorDate"), anchors = { ...workflow.anchors, [anchorId]: anchorDate };
  let tasks = workflow.tasks.map((current) => { const definition = template.tasks.find((item) => item.id === current.id); if (!definition || definition.taskSha256 !== current.templateTaskSha256) throw error("WR_DILIGENCE_CONFIGURATION_MISMATCH", `Task ${current.id} does not match the workflow template`); if (["completed", "waived"].includes(current.status)) return current; return taskInstance({ ...current, taskInstanceSha256: undefined, criticalDate: calculateCriticalDate(definition, anchors, calendar) }); });
  const beforeRefresh = new Map(tasks.map((item) => [item.id, item.status])); tasks = refreshDependents(tasks); const events = [{ taskId: "", action: "anchor.updated", fromStatus: "", toStatus: "", actorUserId: context.actorUserId, reason: `${anchorId}=${anchorDate}`, occurredAt }, ...tasks.filter((item) => beforeRefresh.get(item.id) !== item.status).map((item) => ({ taskId: item.id, action: "task.unblocked", fromStatus: beforeRefresh.get(item.id), toStatus: item.status, actorUserId: context.actorUserId, occurredAt }))]; const appended = appendHistorySequence(workflow, events);
  return resealWorkflow(workflow, { revision: workflow.revision + 1, anchors, tasks, history: appended.history, historyHeadSha256: appended.historyHeadSha256, updatedAt: occurredAt });
}

export function evaluateDiligenceSla(workflowInput, options = {}) {
  const workflow = createDiligenceWorkflow(workflowInput), evaluatedAt = iso(options.evaluatedAt, "evaluatedAt"), now = new Date(evaluatedAt).getTime(); const findings = [];
  for (const task of workflow.tasks.filter((item) => !["completed", "waived"].includes(item.status) && item.criticalDate.status === "calculated")) { const due = new Date(task.criticalDate.dueAt).getTime(); const secondsToDue = Math.trunc((due - now) / 1000); let severity = "on-track", code = "on-track"; if (secondsToDue < -task.escalationAfterSeconds) { severity = "critical"; code = "overdue-escalation"; } else if (secondsToDue < 0) { severity = "breached"; code = "overdue"; } else if (task.reminderOffsetsSeconds.some((offset) => secondsToDue <= offset)) { severity = "warning"; code = "deadline-approaching"; } findings.push({ taskId: task.id, severity, code, dueAt: task.criticalDate.dueAt, secondsToDue }); }
  const rank = { "on-track": 0, warning: 1, breached: 2, critical: 3 }; const status = findings.reduce((value, item) => rank[item.severity] > rank[value] ? item.severity : value, "on-track"); const body = { schemaVersion: DILIGENCE_SLA_REPORT_VERSION, organizationId: workflow.organizationId, workflowId: workflow.id, workflowSha256: workflow.workflowSha256, evaluatedAt, status, findings };
  return Object.freeze({ ...body, reportSha256: diligenceSha256(body) });
}

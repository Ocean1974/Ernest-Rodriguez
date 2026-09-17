const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { buildRefreshPlan, validateSavantArtifacts } = require("./savant-maintenance-agent-lib.cjs");

const root = path.join(__dirname, "..");
const outputDir = path.join(root, "output");
const publicStatusFile = path.join(root, "public", "data", "savant-tools", "maintenance-status.json");
const historyFile = path.join(outputDir, "savant-maintenance-agent-runs.jsonl");
const lastGoodFile = path.join(outputDir, "savant-maintenance-agent-last-good.json");
const lockFile = path.join(outputDir, "savant-maintenance-agent.lock.json");
const args = new Set(process.argv.slice(2));
const validateOnly = args.has("--validate-only");
const skipFetch = args.has("--skip-fetch");
const daemon = args.has("--daemon");
const intervalHours = Math.max(1, Number(process.env.SAVANT_REFRESH_INTERVAL_HOURS || 24));
const lockMaxAgeHours = Math.max(1, Number(process.env.SAVANT_REFRESH_LOCK_MAX_AGE_HOURS || 8));

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function previousBaseline() {
  return fs.existsSync(lastGoodFile) ? JSON.parse(fs.readFileSync(lastGoodFile, "utf8")) : null;
}

function acquireLock(runId) {
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    const descriptor = fs.openSync(lockFile, "wx");
    fs.writeFileSync(descriptor, `${JSON.stringify({ runId, pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2)}\n`);
    fs.closeSync(descriptor);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    const ageHours = (Date.now() - new Date(existing.acquiredAt).getTime()) / 3600000;
    if (!Number.isFinite(ageHours) || ageHours <= lockMaxAgeHours) throw Object.assign(new Error(`Savant maintenance run is already active: ${existing.runId || "unknown"}`), { code: "WR_SAVANT_AGENT_LOCKED" });
    fs.unlinkSync(lockFile);
    acquireLock(runId);
  }
}

function releaseLock() {
  if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
}

function executable(command) {
  return process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
}

function executeStep(step) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(executable(step.command), step.args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const completedAt = new Date().toISOString();
  const record = {
    id: step.id,
    startedAt,
    completedAt,
    exitCode: result.status ?? 1,
    stdoutTail: String(result.stdout || "").slice(-4000),
    stderrTail: String(result.stderr || "").slice(-4000),
  };
  if (record.exitCode !== 0) throw Object.assign(new Error(`Savant maintenance step failed: ${step.id}`), { code: "WR_SAVANT_AGENT_STEP_FAILED", step: record });
  return record;
}

function persistStatus(status) {
  writeJsonAtomic(publicStatusFile, status);
  fs.appendFileSync(historyFile, `${JSON.stringify(status)}\n`);
  if (status.publishAuthorized) writeJsonAtomic(lastGoodFile, status);
}

function runOnce() {
  const startedAt = new Date().toISOString();
  const runId = `savant-refresh-${startedAt.replace(/[^0-9]/g, "").slice(0, 14)}-${process.pid}`;
  acquireLock(runId);
  const steps = [];
  try {
    if (!validateOnly) {
      for (const step of buildRefreshPlan({ skipFetch })) {
        process.stdout.write(`[${runId}] ${step.id}\n`);
        steps.push(executeStep(step));
      }
    }
    const validation = validateSavantArtifacts(root, { baseline: previousBaseline() });
    const status = { ...validation, runId, mode: validateOnly ? "validate-only" : skipFetch ? "rebuild-existing-snapshot" : "fetch-and-rebuild", startedAt, completedAt: new Date().toISOString(), steps };
    persistStatus(status);
    process.stdout.write(`${JSON.stringify({ runId, status: status.status, publishAuthorized: status.publishAuthorized, blockedGates: status.gates.filter((item) => item.status === "blocked").map((item) => item.id) }, null, 2)}\n`);
    return status.publishAuthorized ? 0 : 2;
  } catch (error) {
    const status = {
      schemaVersion: "wr-savant-maintenance-status-v1",
      agentId: "savant-data-maintenance-agent",
      runId,
      mode: validateOnly ? "validate-only" : skipFetch ? "rebuild-existing-snapshot" : "fetch-and-rebuild",
      startedAt,
      completedAt: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
      status: "failed",
      publishAuthorized: false,
      gates: [{ id: error.step?.id || "agent-run", status: "blocked", errorCode: error.code || "WR_SAVANT_AGENT_FAILURE", message: error.message }],
      metrics: {},
      sources: [],
      steps: [...steps, ...(error.step ? [error.step] : [])],
    };
    persistStatus(status);
    process.stderr.write(`${error.stack || error}\n`);
    return 1;
  } finally {
    releaseLock();
  }
}

async function main() {
  let exitCode = runOnce();
  if (!daemon) process.exitCode = exitCode;
  while (daemon) {
    await new Promise((resolve) => setTimeout(resolve, intervalHours * 3600000));
    exitCode = runOnce();
    process.exitCode = exitCode;
  }
}

main().catch((error) => {
  releaseLock();
  console.error(error);
  process.exitCode = 1;
});

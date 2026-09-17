const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const scriptPath = path.join(root, "scripts", "continue-tx-county-baseline.cjs");
const queuePath = path.join(root, "output", "texas-county-verification-queue", "texas-county-verification-queue.json");

const script = fs.readFileSync(scriptPath, "utf8");
const queue = JSON.parse(fs.readFileSync(queuePath, "utf8"));

const queueEntries = [];
for (const batch of [queue.activeBatch, ...(queue.batches || [])].filter(Boolean)) {
  if (!Array.isArray(batch.counties)) continue;
  for (const county of batch.counties) queueEntries.push(county);
}

const uniqueCountyIds = [...new Set(queueEntries.map((county) => county.countyId).filter(Boolean))];
const genericCountyIds = uniqueCountyIds.filter((id) => !id.includes("dallas") && id !== "harris-county-tx");

assert.strictEqual(queue.summary.texasTotal, 254, "Texas queue should still represent all 254 Texas counties");
assert.strictEqual(uniqueCountyIds.length, 253, "Queue should contain 253 non-DCAD Texas counties");
assert.strictEqual(genericCountyIds.length, 252, "Generic continuation should cover every queued Texas county except specialized Harris");
assert(script.includes("appendRemainingTexasQueueCounties();"), "Continuation script should auto-append the remaining Texas queue");
assert(script.includes('"harris-county-tx"'), "Continuation script should preserve Harris for its specialized adapter");
assert(script.includes('id.includes("dallas")'), "Continuation script should keep Dallas blocked from generic continuation");

console.log("Texas county continuation guard ok");

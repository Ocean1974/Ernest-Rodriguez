const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const bundled = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe")
  : "";
const candidates = [process.env.PYTHON, bundled, process.platform === "win32" ? "python.exe" : "python3"].filter(Boolean);
const args = process.argv.slice(2);

if (!args.length) {
  console.error("Usage: node scripts/run-python.cjs <script> [...args]");
  process.exit(2);
}

for (const executable of candidates) {
  if (path.isAbsolute(executable) && !fs.existsSync(executable)) continue;
  const result = spawnSync(executable, args, { stdio: "inherit" });
  if (!result.error) process.exit(result.status ?? 1);
  if (result.error.code !== "ENOENT") throw result.error;
}

console.error("Python 3 was not found. Set PYTHON or install python3.");
process.exit(1);

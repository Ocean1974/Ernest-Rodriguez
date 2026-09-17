import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/build-white-rabbit-dallas-parcels.cjs"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);

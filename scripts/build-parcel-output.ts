const { spawnSync } = require("child_process");

const steps = [
  ["node", ["scripts/unzip-data.ts"]],
  ["node", ["scripts/inspect-dcad-data.ts"]],
  ["node", ["scripts/build-pipeline-artifacts.cjs"]],
  ["node", ["scripts/build-white-rabbit-dallas-parcels.cjs"]],
  ["node", ["scripts/test-white-rabbit-dallas-parcels.cjs"]],
];

for (const [command, args] of steps) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("White Rabbit parcel output build completed.");

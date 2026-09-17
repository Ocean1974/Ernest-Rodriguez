const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const viteConfig = fs.readFileSync(path.join(root, "vite.config.mts"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const buildScript = fs.readFileSync(path.join(root, "scripts", "build-app-shell.cjs"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  css.includes('@import "tailwindcss" source("./");'),
  "Tailwind must scan the application source directory instead of the 32 GB workspace",
);
assert(viteConfig.includes("configResolved"), "Skipped-data asset copy must honor the resolved Vite output directory");
assert(viteConfig.includes("resolve(outputDirectory, \"assets\")"), "Skipped-data asset copy must target the selected build output");
assert(packageJson.scripts["build:verify"] === "node scripts/build-app-shell.cjs", "Package scripts must expose the app-shell verification build");
assert(packageJson.scripts.build === "node scripts/build-production-app.cjs", "Default production build must exclude county-scale public data");
assert(packageJson.scripts["build:with-data"] === "vite build", "Explicit legacy full-data build must remain available");
assert(buildScript.includes('WR_SKIP_PUBLIC_COPY: "1"'), "App-shell verification build must skip the 32 GB public-data copy");
assert(buildScript.includes('"output/app-shell-build"'), "App-shell verification build must not overwrite the production dist directory");

console.log("White Rabbit build scan scope tests passed.");

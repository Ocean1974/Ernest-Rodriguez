const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const viteCli = path.join(root, "node_modules", "vite", "bin", "vite.js");

execFileSync(process.execPath, [viteCli, "build", "--outDir", "output/app-shell-build", "--emptyOutDir"], {
  cwd: root,
  env: {
    ...process.env,
    WR_SKIP_PUBLIC_COPY: "1",
  },
  stdio: "inherit",
});

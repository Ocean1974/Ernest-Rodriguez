import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createWhiteRabbitAgentPlugin } from "./server/whiteRabbitAgentMiddleware.mjs";

const skipPublicCopy = process.env.WR_SKIP_PUBLIC_COPY === "1";

function copyPublicAssetsWhenSkippingData() {
  let outputDirectory = resolve(process.cwd(), "dist");
  return {
    name: "white-rabbit-copy-public-assets",
    apply: "build" as const,
    configResolved(config: { root: string; build: { outDir: string } }) {
      outputDirectory = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!skipPublicCopy) return;
      const source = resolve(process.cwd(), "public/assets");
      const destination = resolve(outputDirectory, "assets");
      if (existsSync(source)) cpSync(source, destination, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), createWhiteRabbitAgentPlugin(), copyPublicAssetsWhenSkippingData()],
  server: {
    proxy: {
      "/api/geocode": {
        target: "https://geocoding.geo.census.gov",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/geocode/, "/geocoder/locations/onelineaddress"),
      },
      "/api/geographies": {
        target: "https://geocoding.geo.census.gov",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/geographies/, "/geocoder/geographies/coordinates"),
      },
    },
  },
  build: {
    copyPublicDir: !skipPublicCopy,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "react";
          if (id.includes("node_modules/maplibre-gl")) return "maps";
          if (id.includes("node_modules/three") || id.includes("node_modules/@react-three")) return "three";
          return undefined;
        },
      },
    },
  },
});

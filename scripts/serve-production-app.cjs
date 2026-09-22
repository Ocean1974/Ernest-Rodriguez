const fs = require("fs");
const http = require("http");
const path = require("path");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function safeFile(root, pathname) {
  const base = path.resolve(root);
  const relative = decodeURIComponent(pathname).replace(/^[/\\]+/, "");
  const target = path.resolve(base, relative);
  return target === base || target.startsWith(`${base}${path.sep}`) ? target : null;
}

function sendFile(request, response, file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  response.statusCode = 200;
  response.setHeader("content-type", MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
  response.setHeader("content-length", stat.size);
  response.setHeader("cache-control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  fs.createReadStream(file).pipe(response);
  return true;
}

async function proxyCensus(request, response, pathname, fetchImpl) {
  const incoming = new URL(request.url, "http://127.0.0.1");
  const upstreamPath = pathname === "/api/geocode"
    ? "/geocoder/locations/onelineaddress"
    : "/geocoder/geographies/coordinates";
  const upstream = new URL(upstreamPath, "https://geocoding.geo.census.gov");
  incoming.searchParams.forEach((value, key) => upstream.searchParams.append(key, value));
  try {
    const result = await fetchImpl(upstream, {
      headers: { accept: "application/json", "user-agent": "Real-Estate-Savant/0.1" },
      signal: AbortSignal.timeout(12_000),
    });
    const body = Buffer.from(await result.arrayBuffer());
    response.statusCode = result.status;
    response.setHeader("content-type", result.headers.get("content-type") || "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(body);
  } catch (error) {
    response.statusCode = 502;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "Address service unavailable", detail: error instanceof Error ? error.message : String(error) }));
  }
}

function createProductionAppServer({ root = path.resolve(__dirname, ".."), fetchImpl = globalThis.fetch } = {}) {
  const distRoot = path.resolve(root, "dist");
  const dataRoot = path.resolve(root, "public", "data");
  return http.createServer(async (request, response) => {
    if (!request.url || !["GET", "HEAD"].includes(request.method || "")) {
      response.statusCode = 405;
      response.end("Method not allowed");
      return;
    }
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/geocode" || url.pathname === "/api/geographies") {
      await proxyCensus(request, response, url.pathname, fetchImpl);
      return;
    }
    if (url.pathname === "/data" || url.pathname.startsWith("/data/")) {
      const dataPath = safeFile(dataRoot, url.pathname.replace(/^\/data\/?/, ""));
      if (dataPath && sendFile(request, response, dataPath)) return;
      response.statusCode = 404;
      response.end("Data artifact not found");
      return;
    }
    const requestedFile = safeFile(distRoot, url.pathname === "/" ? "index.html" : url.pathname);
    if (requestedFile && sendFile(request, response, requestedFile)) return;
    const indexFile = safeFile(distRoot, "index.html");
    if (indexFile && sendFile(request, response, indexFile)) return;
    response.statusCode = 503;
    response.end("Production build not found. Run npm run build first.");
  });
}

if (require.main === module) {
  const host = process.env.WR_HOST || "127.0.0.1";
  const port = Number(process.env.WR_PORT || 5173);
  const server = createProductionAppServer();
  server.listen(port, host, () => {
    console.log(`Real Estate Savant production server: http://${host}:${port}/`);
    console.log("Serving the production UI from dist/ and parcel intelligence from public/data/.");
  });
}

module.exports = { createProductionAppServer, safeFile };

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProductionAppServer, safeFile } = require("../scripts/serve-production-app.cjs");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-server-"));
  fs.mkdirSync(path.join(root, "dist", "assets"), { recursive: true });
  fs.mkdirSync(path.join(root, "public", "data", "parcels"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist", "index.html"), "<main>Real Estate Savant</main>");
  fs.writeFileSync(path.join(root, "dist", "assets", "app.js"), "window.savant=true;");
  fs.writeFileSync(path.join(root, "public", "data", "parcels", "manifest.json"), JSON.stringify({ featureCount: 2 }));
  const proxied = [];
  const fetchImpl = async (url) => {
    proxied.push(String(url));
    return new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = createProductionAppServer({ root, fetchImpl });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal(await (await fetch(`${base}/`)).text(), "<main>Real Estate Savant</main>");
    assert.equal(await (await fetch(`${base}/assets/app.js`)).text(), "window.savant=true;");
    assert.deepEqual(await (await fetch(`${base}/data/parcels/manifest.json`)).json(), { featureCount: 2 });
    assert.equal((await fetch(`${base}/data/missing.json`)).status, 404);
    assert.equal((await fetch(`${base}/map/collin`)).status, 200);
    assert.equal((await fetch(`${base}/api/geocode?address=1+Main+St&benchmark=Public_AR_Current&format=json`)).status, 200);
    assert(proxied[0].startsWith("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?"));
    assert(proxied[0].includes("address=1+Main+St"));
    assert.equal(safeFile(path.join(root, "dist"), "../outside.txt"), null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("White Rabbit production app server tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

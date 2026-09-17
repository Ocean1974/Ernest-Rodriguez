const { spawn } = require("child_process");
const path = require("path");

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9337;
const profile = path.join(process.env.TEMP || "C:\\tmp", `white-rabbit-browser-${process.pid}`);
const appUrl = "http://127.0.0.1:5173/?parcel-interaction-verification=1";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll(action, timeoutMs = 30000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await wait(intervalMs);
  }
  throw lastError || new Error(`Timed out after ${timeoutMs}ms`);
}

async function run() {
  const edge = spawn(edgePath, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1600,1000",
    "--no-first-run",
    "--disable-default-apps",
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });

  try {
    await poll(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, 15000);
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" });
    if (!targetResponse.ok) throw new Error(`Unable to open verification tab: ${targetResponse.status}`);
    const target = await targetResponse.json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });

    let sequence = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
      return result.result.value;
    };

    await command("Runtime.enable");
    await poll(() => evaluate("document.readyState === 'complete'"), 20000);
    await poll(() => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('Enter Map')); if (!button) return false; button.click(); return true; })()`), 10000);
    await poll(() => evaluate(`(() => { const button = document.querySelector('button[aria-label="Enter Dallas parcel view"]'); if (!button) return false; button.click(); return true; })()`), 20000);

    const loaded = await poll(() => evaluate(`(() => {
      const map = window.__whiteRabbitMap;
      const records = window.__whiteRabbitParcelsRef?.current || [];
      if (!map || !map.loaded() || records.length < 20 || !map.getSource('wr-parcels')) return null;
      const sourceCount = map.querySourceFeatures('wr-parcels').length;
      if (!sourceCount) return null;
      return { records: records.length, sourceCount, renderedCount: map.queryRenderedFeatures({ layers: ['wr-parcels-fill'] }).length };
    })()`), 45000, 500);

    const hover = await poll(() => evaluate(`(() => {
      const map = window.__whiteRabbitMap;
      const parcel = (window.__whiteRabbitParcelsRef?.current || []).find((item) => Array.isArray(item.liveGeometry?.center));
      if (!map || !parcel) return null;
      map.jumpTo({ center: parcel.liveGeometry.center, zoom: 17, pitch: 35 });
      const point = map.project(parcel.liveGeometry.center);
      const canvas = map.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const clientX = rect.left + point.x;
      const clientY = rect.top + point.y;
      const target = document.elementFromPoint(clientX, clientY);
      return {
        account: parcel.accountNum || parcel.accountNumber,
        x: clientX,
        y: clientY,
        target: target ? target.tagName.toLowerCase() + '.' + target.className : '',
      };
    })()`), 10000);

    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: hover.x, y: hover.y });

    const popup = await poll(() => evaluate(`(() => {
      const popup = document.querySelector('[data-parcel-id]');
      return popup ? { parcelId: popup.dataset.parcelId, text: popup.textContent.trim().slice(0, 240) } : null;
    })()`), 10000);

    await evaluate(`(() => {
      const map = window.__whiteRabbitMap;
      const canvas = map.getCanvas();
      const parcel = (window.__whiteRabbitParcelsRef?.current || []).find((item) => String(item.accountNum || item.accountNumber) === ${JSON.stringify("__ACCOUNT__")});
      return Boolean(canvas && parcel);
    })()`.replace('"__ACCOUNT__"', JSON.stringify(hover.account)));
    await command("Input.dispatchMouseEvent", { type: "mousePressed", x: hover.x, y: hover.y, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: hover.x, y: hover.y, button: "left", clickCount: 1 });
    const clicked = true;
    const selection = await poll(() => evaluate(`(() => {
      const parcel = window.__whiteRabbitLastSelectedParcel;
      return parcel ? { account: parcel.accountNum || parcel.accountNumber, address: parcel.address || parcel.propertyAddress || '' } : null;
    })()`), 10000);

    socket.close();
    process.stdout.write(`${JSON.stringify({ loaded, hover, popup, clicked, selection }, null, 2)}\n`);
  } finally {
    edge.kill();
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

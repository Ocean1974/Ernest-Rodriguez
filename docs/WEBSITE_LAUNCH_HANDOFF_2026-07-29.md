# White Rabbit Website Launch Handoff

Date: July 29, 2026  
Workspace: `C:\Users\ernes\OneDrive\Desktop\The White Rabbit Project`

## Current state

- The website is available at `http://127.0.0.1:5173/`.
- It is being served from the existing `dist` production bundle with:

  ```powershell
  npm.cmd run preview -- --host 127.0.0.1 --port 5173 --strictPort
  ```

- The server was verified with three consecutive HTTP `200` responses.
- The listening process observed at handoff time was PID `38068`.
- Server logs:
  - `.vite-preview.stdout.log`
  - `.vite-preview.stderr.log`
- The served `dist/index.html` was last modified July 2, 2026 at 9:15:55 AM.

## What failed

The original Vite development server was started with:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

Vite printed that it was ready and listened on port `5173`, but HTTP requests connected and then returned no bytes until they timed out. The stale server process therefore made the browser appear to be pointed at a running site even though the page could not load.

The hung process was stopped and replaced with `vite preview`, which immediately served the production bundle successfully.

The exact source-level cause of the Vite development-server stall has not yet been proven. A likely area to investigate is first-request processing in the large workspace, including Tailwind's automatic source scan, but this remains a hypothesis.

## Quick recovery

First verify whether the site responds:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5173/" -TimeoutSec 5
```

If port `5173` is occupied by a nonresponsive process, identify the exact PID:

```powershell
netstat -ano | Select-String ":5173"
```

Stop only the verified White Rabbit server PID:

```powershell
Stop-Process -Id <verified-pid> -Force
```

Restart the stable production preview:

```powershell
Start-Process -FilePath npm.cmd `
  -ArgumentList @("run","preview","--","--host","127.0.0.1","--port","5173","--strictPort") `
  -WorkingDirectory "C:\Users\ernes\OneDrive\Desktop\The White Rabbit Project" `
  -WindowStyle Hidden
```

Open or refresh:

```text
http://127.0.0.1:5173/
```

## Important limitation

The current preview uses the July 2 production bundle. If source files have changed since that build, those changes are not reflected until a new production build succeeds:

```powershell
npm.cmd test
npm.cmd run build
```

After rebuilding, restart or refresh the preview and verify the landing page and Dallas parcel engine without changing the locked UI baseline.

## Recommended follow-up

1. Reproduce the development-server hang with timestamped logs.
2. Temporarily narrow Tailwind source detection to application source files and retest.
3. Check whether large `data`, `output`, `public/data`, restore, or generated artifact trees are being scanned or watched.
4. Confirm `GET /`, `/src/main.tsx`, and `/src/styles.css` response timing separately.
5. Preserve the production-preview command as the reliable launch path until development mode is fixed.

## Tooling note

The Codex in-app browser controller also failed to initialize during recovery with a local runtime error involving the `process` property. The site itself was reopened through the system browser, and direct HTTP checks confirmed that the server is healthy. This browser-control issue is separate from the Vite development-server stall.

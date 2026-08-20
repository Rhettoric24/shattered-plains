import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";

const root = process.cwd();
const require = createRequire(import.meta.url);
const previewUrl = "http://127.0.0.1:4180";

function runNode(args, options = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Child process stopped by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

async function previewIsReady() {
  try {
    const response = await fetch(previewUrl, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForPreview(server) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Preview server exited with code ${server.exitCode}.`);
    if (await previewIsReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Preview server did not become ready within 120 seconds.");
}

async function stopPreview(server) {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  const exited = await Promise.race([
    once(server, "exit").then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (exited || server.exitCode !== null) return;

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
  } else {
    server.kill("SIGKILL");
  }
}

const buildCode = await runNode([path.join(root, "scripts", "build-site.mjs")]);
if (buildCode !== 0) process.exit(buildCode);

let previewServer = null;
if (!(await previewIsReady())) {
  previewServer = spawn(process.execPath, [path.join(root, "outputs", "convex-static-server.js"), "dist"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  await waitForPreview(previewServer);
}

let testCode = 1;
try {
  const playwrightCli = require.resolve("@playwright/test/cli");
  testCode = await runNode([playwrightCli, "test", ...process.argv.slice(2)]);
} finally {
  await stopPreview(previewServer);
}

process.exitCode = testCode;

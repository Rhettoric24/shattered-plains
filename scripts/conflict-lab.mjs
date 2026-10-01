import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  absWorkingDir: root,
  entryPoints: [fileURLToPath(new URL("../lab/main.ts", import.meta.url))],
  tsconfigRaw: { compilerOptions: { target: "ES2022" } },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const assets = new Map([
  ["/", ["text/html", await readFile("lab/index.html")]],
  ["/lab.css", ["text/css", await readFile("lab/style.css")]],
  ["/lab.js", ["text/javascript", bundle.outputFiles[0].contents]],
]);
createServer((req, res) => {
  const asset = assets.get(req.url);
  if (!asset) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": asset[0],
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'",
  });
  res.end(asset[1]);
}).listen(4186, "127.0.0.1", () =>
  console.log(
    "Conflict Board Lab: http://127.0.0.1:4186 (local only; no Convex)",
  ),
);

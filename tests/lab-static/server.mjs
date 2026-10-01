// Test fixture: simulate Pages' project prefix, directory indexes and redirects.
// Serves only dist; never runs a build or contacts a backend.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../dist/", import.meta.url));
const prefix = "/shattered-plains/";
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:4187");
    if (!url.pathname.startsWith(prefix)) throw Error("Not found");
    let file = path.resolve(
      root,
      decodeURIComponent(url.pathname.slice(prefix.length)),
    );
    const relative = path.relative(root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw Error("Not found");
    if ((await stat(file)).isDirectory()) {
      if (!url.pathname.endsWith("/")) {
        res.writeHead(301, { Location: url.pathname + "/" + url.search });
        res.end();
        return;
      }
      file = path.join(file, "index.html");
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(4187, "127.0.0.1");

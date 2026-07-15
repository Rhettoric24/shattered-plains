const http = require("http");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(path.join(__dirname, ".."));
const distRoot = path.join(projectRoot, "dist");
const root = path.resolve(
  process.argv[2] || (fs.existsSync(distRoot) ? distRoot : projectRoot),
);
const port = Number(process.env.PORT || 4180);
const host = "127.0.0.1";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (url.pathname === "/outputs/convex-client.html") {
    response.writeHead(302, { Location: "/" });
    response.end();
    return;
  }

  if (url.pathname === "/") {
    const indexPath = path.join(root, "index.html");
    if (fs.existsSync(indexPath)) {
      fs.readFile(indexPath, (error, data) => {
        if (error) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        response.writeHead(200, { "Content-Type": contentTypes[".html"] });
        response.end(data);
      });
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Built site not found. Run `npm.cmd run build`, then restart the local server.");
    return;
  }

  const pathname = url.pathname;
  const requestedPath = path.resolve(root, "." + decodeURIComponent(pathname));

  if (!requestedPath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(requestedPath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(requestedPath)] || "application/octet-stream",
    });
    response.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`Shattered Plains Convex client: http://${host}:${port}/`);
  console.log(`Serving ${root}`);
});

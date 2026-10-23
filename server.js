
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 10000;
const ROOT = __dirname;

// يدعم وجود index.html في جذر المشروع أو داخل src
const candidates = [
  path.join(ROOT, "index.html"),
  path.join(ROOT, "src", "index.html"),
];

const indexPath = candidates.find((file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
});

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("OK");
  }

  if (req.url === "/" || req.url.startsWith("/?")) {
    if (!indexPath) {
      res.writeHead(500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      return res.end(
        "Dashboard file not found. Add index.html to the project root."
      );
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
    });

    return fs.createReadStream(indexPath).pipe(res);
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SHAR7 Dashboard listening on port ${PORT}`);
  console.log(`Dashboard file: ${indexPath || "NOT FOUND"}`);
});


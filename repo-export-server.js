const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = process.env.REPO_EXPORT_HOST || "0.0.0.0";
const PORT = Number(process.env.REPO_EXPORT_PORT || 8787);
const ROOT = process.cwd();
const EXPORT_DIR = path.join(ROOT, "exports");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType) {
  res.writeHead(statusCode, {
    "Content-Type": contentType || "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Access-Control-Allow-Origin": "*"
  });
  res.end(text);
}

function safeJoin(rootDir, reqPath) {
  const cleanPath = path.normalize(reqPath).replace(/^([.][.][/\\])+/, "");
  const fullPath = path.join(rootDir, cleanPath);
  if (!fullPath.startsWith(rootDir)) return null;
  return fullPath;
}

function sanitizeFileName(fileName) {
  const base = path.basename(String(fileName || "export.csv"));
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe.toLowerCase().endsWith(".csv") ? safe : safe + ".csv";
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 25 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function handleSaveCsv(req, res) {
  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const fileName = sanitizeFileName(body.fileName || "export.csv");
    const csvText = String(body.csvText || "");

    if (!csvText.trim()) {
      sendJson(res, 400, { ok: false, error: "csvText is required" });
      return;
    }

    await fs.promises.mkdir(EXPORT_DIR, { recursive: true });
    const outPath = path.join(EXPORT_DIR, fileName);
    await fs.promises.writeFile(outPath, csvText, "utf8");

    sendJson(res, 200, {
      ok: true,
      relativePath: path.relative(ROOT, outPath).split(path.sep).join("/"),
      absolutePath: outPath,
      bytes: Buffer.byteLength(csvText, "utf8")
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error && error.message ? error.message : String(error) });
  }
}

async function handleStatic(req, res, urlPath) {
  let reqPath = urlPath === "/" ? "/index.html" : urlPath;
  if (reqPath.endsWith("/")) reqPath += "index.html";

  const fsPath = safeJoin(ROOT, reqPath);
  if (!fsPath) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.promises.stat(fsPath);
    if (stat.isDirectory()) {
      sendText(res, 403, "Directory listing disabled");
      return;
    }
    const ext = path.extname(fsPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const data = await fs.promises.readFile(fsPath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Access-Control-Allow-Origin": "*"
    });
    res.end(data);
  } catch (error) {
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      root: ROOT,
      exportDir: EXPORT_DIR,
      port: PORT
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/save-csv") {
    await handleSaveCsv(req, res);
    return;
  }

  if (req.method === "GET") {
    await handleStatic(req, res, requestUrl.pathname);
    return;
  }

  sendText(res, 405, "Method not allowed");
});

server.listen(PORT, HOST, () => {
  console.log(`Repo export server listening on http://${HOST}:${PORT}`);
  console.log(`Serving static files from ${ROOT}`);
  console.log(`Writing CSV exports to ${EXPORT_DIR}`);
});

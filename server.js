const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { initDb, run, get, all } = require("./db");

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretFile = path.join(__dirname, "data", ".secret");
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, "utf8").trim();
  const secret = crypto.randomBytes(48).toString("hex");
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  // eslint-disable-next-line no-console
  console.log("[INIT] Session-Secret automatisch generiert und in data/.secret gespeichert.");
  return secret;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  session({
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
    },
  }),
);

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Nur Admin erlaubt." });
  }
  next();
}

// --- Calibre proxy helpers ---

function calibreGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https://") ? https : http;
    const req = mod.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: Buffer.concat(chunks),
        }),
      );
    });
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

function calibrePipe(url, expressRes) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https://") ? https : http;
    const req = mod.get(url, (calibreRes) => {
      expressRes.status(calibreRes.statusCode);
      const ct = calibreRes.headers["content-type"];
      if (ct) expressRes.set("Content-Type", ct);
      calibreRes.pipe(expressRes);
      calibreRes.on("end", resolve);
      calibreRes.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

async function getCalibreConfig() {
  const rows = await all(
    "SELECT key, value FROM settings WHERE key IN ('calibre_url','calibre_library')",
  );
  const cfg = {};
  rows.forEach((r) => {
    cfg[r.key] = r.value;
  });
  return {
    url: cfg.calibre_url ? cfg.calibre_url.replace(/\/$/, "") : null,
    library: cfg.calibre_library || "Calibre_Library",
  };
}

// --- Auth endpoints ---

app.get("/api/session", (req, res) => {
  if (!req.session.user) return res.json({ authenticated: false });
  return res.json({
    authenticated: true,
    user: {
      id: req.session.user.id,
      username: req.session.user.username,
      role: req.session.user.role,
    },
  });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Benutzername und Passwort sind Pflicht." });
  }
  const user = await get(
    "SELECT id, username, password_hash, role FROM users WHERE username = ?",
    [username],
  );
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Ungültige Zugangsdaten." });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role };
  return res.json({ success: true, user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// --- Settings endpoints ---

app.get("/api/settings", requireAuth, async (req, res) => {
  const rows = await all("SELECT key, value FROM settings");
  const settings = {};
  rows.forEach((r) => {
    settings[r.key] = r.value;
  });
  res.json(settings);
});

app.put("/api/settings/:key", requireAdmin, async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  const allowed = ["calibre_url", "calibre_library"];
  if (!allowed.includes(key)) {
    return res.status(400).json({ error: "Ungültiger Einstellungsschlüssel." });
  }
  await run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [
    key,
    String(value || "").trim(),
  ]);
  res.json({ ok: true });
});

// --- Sites endpoints ---

app.get("/api/sites", requireAuth, async (req, res) => {
  const sites = await all(
    `SELECT s.id, s.title, s.url, s.description, s.updated_at, u.username AS created_by
     FROM sites s LEFT JOIN users u ON u.id = s.created_by
     ORDER BY s.title ASC`,
  );
  res.json({ sites });
});

app.post("/api/sites", requireAdmin, async (req, res) => {
  const { title, url, description } = req.body;
  if (!title || !url) {
    return res.status(400).json({ error: "Titel und URL sind Pflicht." });
  }
  const result = await run(
    `INSERT INTO sites (title, url, description, created_by, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [title.trim(), url.trim(), (description || "").trim(), req.session.user.id],
  );
  const site = await get(
    "SELECT id, title, url, description, updated_at FROM sites WHERE id = ?",
    [result.id],
  );
  res.status(201).json({ site });
});

app.put("/api/sites/:id", requireAdmin, async (req, res) => {
  const { title, url, description } = req.body;
  const siteId = Number(req.params.id);
  if (!title || !url || !Number.isInteger(siteId)) {
    return res.status(400).json({ error: "Ungültige Eingaben." });
  }
  const result = await run(
    `UPDATE sites SET title=?, url=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [title.trim(), url.trim(), (description || "").trim(), siteId],
  );
  if (result.changes === 0) return res.status(404).json({ error: "Server nicht gefunden." });
  const site = await get(
    "SELECT id, title, url, description, updated_at FROM sites WHERE id = ?",
    [siteId],
  );
  res.json({ site });
});

app.delete("/api/sites/:id", requireAdmin, async (req, res) => {
  const siteId = Number(req.params.id);
  if (!Number.isInteger(siteId)) return res.status(400).json({ error: "Ungültige ID." });
  const result = await run("DELETE FROM sites WHERE id = ?", [siteId]);
  if (result.changes === 0) return res.status(404).json({ error: "Server nicht gefunden." });
  res.json({ success: true });
});

// --- User endpoints ---

app.get("/api/users", requireAdmin, async (req, res) => {
  const users = await all("SELECT id, username, role, created_at FROM users ORDER BY id ASC");
  res.json({ users });
});

app.post("/api/users", requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Benutzername und Passwort sind Pflicht." });
  }
  const normalizedRole = role === "admin" ? "admin" : "user";
  const exists = await get("SELECT id FROM users WHERE username = ?", [username.trim()]);
  if (exists) return res.status(409).json({ error: "Benutzername existiert bereits." });
  const hash = bcrypt.hashSync(password, 10);
  await run("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", [
    username.trim(),
    hash,
    normalizedRole,
  ]);
  res.status(201).json({ success: true });
});

// --- Calibre proxy endpoints ---

app.get("/api/calibre/search", requireAuth, async (req, res) => {
  const config = await getCalibreConfig();
  if (!config.url) return res.status(503).json({ error: "Calibre nicht konfiguriert." });

  const { query = "", num = 50, offset = 0, sort = "title" } = req.query;
  const url = `${config.url}/ajax/search?query=${encodeURIComponent(query)}&num=${encodeURIComponent(num)}&offset=${encodeURIComponent(offset)}&sort=${encodeURIComponent(sort)}&library_id=${encodeURIComponent(config.library)}`;

  try {
    const result = await calibreGet(url);
    if (result.status !== 200) return res.status(502).json({ error: "Calibre Fehler." });
    res.json(JSON.parse(result.buffer.toString("utf8")));
  } catch (e) {
    res.status(502).json({ error: "Calibre nicht erreichbar: " + e.message });
  }
});

app.get("/api/calibre/books", requireAuth, async (req, res) => {
  const config = await getCalibreConfig();
  if (!config.url) return res.status(503).json({ error: "Calibre nicht konfiguriert." });

  const { ids } = req.query;
  if (!ids || !/^\d+(,\d+)*$/.test(ids)) {
    return res.status(400).json({ error: "Ungültige IDs." });
  }

  const url = `${config.url}/ajax/books?ids=${ids}&library_id=${encodeURIComponent(config.library)}`;

  try {
    const result = await calibreGet(url);
    if (result.status !== 200) return res.status(502).json({ error: "Calibre Fehler." });
    const data = JSON.parse(result.buffer.toString("utf8"));
    Object.values(data).forEach((book) => {
      if (book) {
        book._calibre_url = config.url;
        book._library = config.library;
      }
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "Calibre nicht erreichbar: " + e.message });
  }
});

app.get("/api/calibre/cover/:id", requireAuth, async (req, res) => {
  const config = await getCalibreConfig();
  if (!config.url) return res.status(503).end();

  if (!/^\d+$/.test(req.params.id)) return res.status(400).end();

  const url = `${config.url}/get/cover/${req.params.id}/${encodeURIComponent(config.library)}`;
  try {
    await calibrePipe(url, res);
  } catch (e) {
    if (!res.headersSent) res.status(502).end();
  }
});

// --- Static fallback ---

app.get("/test", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "test.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Server läuft auf http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Fehler beim Start:", error);
    process.exit(1);
  });

const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { initDb, run, get, all } = require("./db");

// ─── Session secret ───────────────────────────────────────────────────────────

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretFile = path.join(__dirname, "data", ".secret");
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, "utf8").trim();
  const secret = crypto.randomBytes(48).toString("hex");
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  // eslint-disable-next-line no-console
  console.log("[INIT] Session-Secret generiert und in data/.secret gespeichert.");
  return secret;
}

// ─── Multer / file uploads ────────────────────────────────────────────────────

const uploadsDir = path.join(__dirname, "public", "uploads", "servers");
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `server-${req.params.id}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Nur Bilddateien erlaubt."));
    }
    cb(null, true);
  },
});

// ─── Express setup ────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  session({
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  }),
);
app.use(express.static(path.join(__dirname, "public")));

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Nicht angemeldet." });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin")
    return res.status(403).json({ error: "Nur Admin erlaubt." });
  next();
}

// ─── Calibre proxy helpers ────────────────────────────────────────────────────

function calibreGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https://") ? https : http;
    const req = mod.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }),
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
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

// ─── Access check helper ──────────────────────────────────────────────────────

async function checkServerAccess(serverId, userId, isAdminUser) {
  const server = await get("SELECT * FROM servers WHERE id = ?", [serverId]);
  if (!server) return null;
  if (isAdminUser) return server;
  if (server.visible_to_all) return server;
  const row = await get(
    "SELECT 1 FROM server_access WHERE server_id = ? AND user_id = ?",
    [serverId, userId],
  );
  return row ? server : null;
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═════════════════════════════════════════════════════════════════════════════

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
  if (!username || !password)
    return res.status(400).json({ error: "Benutzername und Passwort sind Pflicht." });

  const user = await get(
    "SELECT id, username, password_hash, role FROM users WHERE username = ?",
    [username],
  );
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: "Ungültige Zugangsdaten." });

  req.session.user = { id: user.id, username: user.username, role: user.role };
  return res.json({ success: true, user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ═════════════════════════════════════════════════════════════════════════════
// USER ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.get("/api/users", requireAdmin, async (req, res) => {
  const users = await all("SELECT id, username, role, created_at FROM users ORDER BY id ASC");
  res.json({ users });
});

app.post("/api/users", requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Benutzername und Passwort sind Pflicht." });

  const normalizedRole = role === "admin" ? "admin" : "user";
  const exists = await get("SELECT id FROM users WHERE username = ?", [username.trim()]);
  if (exists) return res.status(409).json({ error: "Benutzername existiert bereits." });

  const hash = bcrypt.hashSync(password, 10);
  const result = await run(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
    [username.trim(), hash, normalizedRole],
  );
  res.status(201).json({ success: true, id: result.id });
});

app.delete("/api/users/:id", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: "Ungültige ID." });
  if (userId === req.session.user.id)
    return res.status(400).json({ error: "Eigenes Konto kann nicht gelöscht werden." });

  const result = await run("DELETE FROM users WHERE id = ?", [userId]);
  if (result.changes === 0) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  res.json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// SERVER ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.get("/api/servers", requireAuth, async (req, res) => {
  const { id: userId, role } = req.session.user;
  const isAdminUser = role === "admin";

  let servers;
  if (isAdminUser) {
    servers = await all(`
      SELECT s.*, u.username AS created_by_name
      FROM servers s
      LEFT JOIN users u ON u.id = s.created_by
      ORDER BY s.sort_order ASC, s.title ASC
    `);
    for (const s of servers) {
      const rows = await all("SELECT user_id FROM server_access WHERE server_id = ?", [s.id]);
      s.allowed_user_ids = rows.map((r) => r.user_id);
    }
  } else {
    servers = await all(
      `SELECT s.*, u.username AS created_by_name
       FROM servers s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.visible_to_all = 1
          OR EXISTS (
            SELECT 1 FROM server_access sa
            WHERE sa.server_id = s.id AND sa.user_id = ?
          )
       ORDER BY s.sort_order ASC, s.title ASC`,
      [userId],
    );
  }

  res.json({ servers });
});

app.post("/api/servers", requireAdmin, async (req, res) => {
  const { title, url, description, type, calibre_library } = req.body;
  if (!title || !url) return res.status(400).json({ error: "Titel und URL sind Pflicht." });

  const serverType = type === "calibre" ? "calibre" : "generic";
  const result = await run(
    `INSERT INTO servers (title, url, description, type, calibre_library, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      title.trim(),
      url.trim(),
      (description || "").trim(),
      serverType,
      serverType === "calibre" ? (calibre_library || "").trim() : null,
      req.session.user.id,
    ],
  );

  const server = await get("SELECT * FROM servers WHERE id = ?", [result.id]);
  res.status(201).json({ server });
});

app.put("/api/servers/:id", requireAdmin, async (req, res) => {
  const serverId = Number(req.params.id);
  if (!Number.isInteger(serverId)) return res.status(400).json({ error: "Ungültige ID." });

  const { title, url, description, type, calibre_library } = req.body;
  if (!title || !url) return res.status(400).json({ error: "Titel und URL sind Pflicht." });

  const serverType = type === "calibre" ? "calibre" : "generic";
  const result = await run(
    `UPDATE servers
     SET title = ?, url = ?, description = ?, type = ?, calibre_library = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      title.trim(),
      url.trim(),
      (description || "").trim(),
      serverType,
      serverType === "calibre" ? (calibre_library || "").trim() : null,
      serverId,
    ],
  );

  if (result.changes === 0) return res.status(404).json({ error: "Server nicht gefunden." });
  const server = await get("SELECT * FROM servers WHERE id = ?", [serverId]);
  res.json({ server });
});

app.delete("/api/servers/:id", requireAdmin, async (req, res) => {
  const serverId = Number(req.params.id);
  if (!Number.isInteger(serverId)) return res.status(400).json({ error: "Ungültige ID." });

  const server = await get("SELECT image_path FROM servers WHERE id = ?", [serverId]);
  if (server?.image_path) {
    fs.unlink(path.join(__dirname, "public", server.image_path), () => {});
  }

  const result = await run("DELETE FROM servers WHERE id = ?", [serverId]);
  if (result.changes === 0) return res.status(404).json({ error: "Server nicht gefunden." });
  res.json({ success: true });
});

// Image upload
app.post("/api/servers/:id/image", requireAdmin, upload.single("image"), async (req, res) => {
  const serverId = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: "Kein Bild hochgeladen." });

  const server = await get("SELECT image_path FROM servers WHERE id = ?", [serverId]);
  if (server?.image_path) {
    fs.unlink(path.join(__dirname, "public", server.image_path), () => {});
  }

  const imagePath = `/uploads/servers/${req.file.filename}`;
  await run("UPDATE servers SET image_path = ? WHERE id = ?", [imagePath, serverId]);
  res.json({ image_path: imagePath });
});

// Image delete
app.delete("/api/servers/:id/image", requireAdmin, async (req, res) => {
  const serverId = Number(req.params.id);
  const server = await get("SELECT image_path FROM servers WHERE id = ?", [serverId]);
  if (!server) return res.status(404).json({ error: "Server nicht gefunden." });

  if (server.image_path) {
    fs.unlink(path.join(__dirname, "public", server.image_path), () => {});
    await run("UPDATE servers SET image_path = NULL WHERE id = ?", [serverId]);
  }
  res.json({ success: true });
});

// Visibility get
app.get("/api/servers/:id/visibility", requireAdmin, async (req, res) => {
  const serverId = Number(req.params.id);
  const server = await get("SELECT visible_to_all FROM servers WHERE id = ?", [serverId]);
  if (!server) return res.status(404).json({ error: "Server nicht gefunden." });

  const rows = await all("SELECT user_id FROM server_access WHERE server_id = ?", [serverId]);
  res.json({ visible_to_all: Boolean(server.visible_to_all), user_ids: rows.map((r) => r.user_id) });
});

// Visibility set
app.put("/api/servers/:id/visibility", requireAdmin, async (req, res) => {
  const serverId = Number(req.params.id);
  const { visible_to_all, user_ids } = req.body;

  await run("UPDATE servers SET visible_to_all = ? WHERE id = ?", [visible_to_all ? 1 : 0, serverId]);
  await run("DELETE FROM server_access WHERE server_id = ?", [serverId]);

  if (!visible_to_all && Array.isArray(user_ids)) {
    for (const uid of user_ids) {
      const n = Number(uid);
      if (Number.isInteger(n)) {
        await run(
          "INSERT OR IGNORE INTO server_access (server_id, user_id) VALUES (?, ?)",
          [serverId, n],
        );
      }
    }
  }

  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// CALIBRE PROXY ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.get("/api/servers/:id/calibre/search", requireAuth, async (req, res) => {
  const serverId = Number(req.params.id);
  const server = await checkServerAccess(
    serverId,
    req.session.user.id,
    req.session.user.role === "admin",
  );
  if (!server || server.type !== "calibre")
    return res.status(404).json({ error: "Calibre-Server nicht gefunden." });

  const baseUrl = server.url.replace(/\/$/, "");
  const library = server.calibre_library
    ? `/${encodeURIComponent(server.calibre_library)}`
    : "";
  const q = req.query.query || "";
  const num = Math.min(Number(req.query.num) || 50, 200);
  const sort = req.query.sort || "title";

  const url = `${baseUrl}${library}/ajax/search?query=${encodeURIComponent(q)}&num=${num}&sort=${sort}&sort_order=asc`;

  try {
    const { status, buffer } = await calibreGet(url);
    res.status(status).type("json").send(buffer);
  } catch {
    res.status(502).json({ error: "Calibre-Server nicht erreichbar." });
  }
});

app.get("/api/servers/:id/calibre/books", requireAuth, async (req, res) => {
  const serverId = Number(req.params.id);
  const server = await checkServerAccess(
    serverId,
    req.session.user.id,
    req.session.user.role === "admin",
  );
  if (!server || server.type !== "calibre")
    return res.status(404).json({ error: "Calibre-Server nicht gefunden." });

  const baseUrl = server.url.replace(/\/$/, "");
  const library = server.calibre_library
    ? `/${encodeURIComponent(server.calibre_library)}`
    : "";
  const ids = req.query.ids || "";

  const url = `${baseUrl}${library}/ajax/books?ids=${ids}`;

  try {
    const { status, buffer } = await calibreGet(url);
    res.status(status).type("json").send(buffer);
  } catch {
    res.status(502).json({ error: "Calibre-Server nicht erreichbar." });
  }
});

app.get("/api/servers/:id/calibre/cover/:bookId", requireAuth, async (req, res) => {
  const serverId = Number(req.params.id);
  const server = await checkServerAccess(
    serverId,
    req.session.user.id,
    req.session.user.role === "admin",
  );
  if (!server || server.type !== "calibre")
    return res.status(404).json({ error: "Calibre-Server nicht gefunden." });

  const bookId = Number(req.params.bookId);
  if (!Number.isInteger(bookId)) return res.status(400).end();

  const baseUrl = server.url.replace(/\/$/, "");
  const url = `${baseUrl}/get/cover/${bookId}/${bookId}`;

  try {
    await calibrePipe(url, res);
  } catch {
    res.status(502).end();
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// SPA FALLBACK
// ═════════════════════════════════════════════════════════════════════════════

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ═════════════════════════════════════════════════════════════════════════════
// START
// ═════════════════════════════════════════════════════════════════════════════

initDb()
  .then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Server läuft auf http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Fehler beim Start:", err);
    process.exit(1);
  });

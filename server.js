const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { initDb, run, get, all } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me-in-production",
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

app.get("/api/session", (req, res) => {
  if (!req.session.user) {
    return res.json({ authenticated: false });
  }

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

  const user = await get("SELECT id, username, password_hash, role FROM users WHERE username = ?", [
    username,
  ]);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Ungültige Zugangsdaten." });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
  };

  return res.json({ success: true, user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get("/api/sites", requireAuth, async (req, res) => {
  const sites = await all(
    `SELECT s.id, s.title, s.url, s.description, s.updated_at, u.username AS created_by
     FROM sites s
     LEFT JOIN users u ON u.id = s.created_by
     ORDER BY s.updated_at DESC`,
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

  const site = await get("SELECT id, title, url, description, updated_at FROM sites WHERE id = ?", [
    result.id,
  ]);

  res.status(201).json({ site });
});

app.put("/api/sites/:id", requireAdmin, async (req, res) => {
  const { title, url, description } = req.body;
  const siteId = Number(req.params.id);

  if (!title || !url || !Number.isInteger(siteId)) {
    return res.status(400).json({ error: "Ungültige Eingaben." });
  }

  const result = await run(
    `UPDATE sites
     SET title = ?, url = ?, description = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [title.trim(), url.trim(), (description || "").trim(), siteId],
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: "Website nicht gefunden." });
  }

  const site = await get("SELECT id, title, url, description, updated_at FROM sites WHERE id = ?", [siteId]);
  res.json({ site });
});

app.delete("/api/sites/:id", requireAdmin, async (req, res) => {
  const siteId = Number(req.params.id);
  if (!Number.isInteger(siteId)) {
    return res.status(400).json({ error: "Ungültige ID." });
  }

  const result = await run("DELETE FROM sites WHERE id = ?", [siteId]);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Website nicht gefunden." });
  }

  res.json({ success: true });
});

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
  if (exists) {
    return res.status(409).json({ error: "Benutzername existiert bereits." });
  }

  const hash = bcrypt.hashSync(password, 10);
  await run("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", [
    username.trim(),
    hash,
    normalizedRole,
  ]);

  res.status(201).json({ success: true });
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

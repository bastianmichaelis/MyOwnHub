const path = require("path");
const express = require("express");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3010;
const LOGIN_USER = process.env.LOGIN_USER || "admin";
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || require("crypto").randomBytes(32).toString("hex");

if (!LOGIN_PASSWORD) {
  console.error("FEHLER: Umgebungsvariable LOGIN_PASSWORD ist nicht gesetzt!");
  process.exit(1);
}

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 Tage
  },
}));

// ── Auth middleware ──────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.redirect("/login");
}

// ── Login routes ─────────────────────────────────────────────

app.get("/login", (req, res) => {
  if (req.session && req.session.loggedIn) return res.redirect("/");
  res.sendFile(path.join(__dirname, "login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === LOGIN_USER && password === LOGIN_PASSWORD) {
    req.session.loggedIn = true;
    req.session.user = username;
    res.redirect("/");
  } else {
    res.redirect("/login?error=1");
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ── Protected static files ───────────────────────────────────

app.use(requireAuth, express.static(path.join(__dirname, "public")));

app.get("*", requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`MyOwnHub läuft auf http://localhost:${PORT}`);
});

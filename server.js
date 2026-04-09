/**
 * Minimal static file server for MyOwnHub PWA.
 * All app logic runs in the browser – this just serves the static files.
 * After installing the PWA on your device, the app works fully offline.
 */
const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`MyOwnHub läuft auf http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log("Öffne diese URL im Safari auf dem iPhone, dann: Teilen → Zum Home-Bildschirm");
});

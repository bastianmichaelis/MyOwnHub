/* global fetch */
"use strict";

let sessionUser = null;
let allServers = [];
let allUsers = [];
let currentCalibreServer = null;
let messageTimer = null;

// ═══════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════

boot();

async function boot() {
  const session = await api("/api/session");
  if (session.authenticated) {
    sessionUser = session.user;
    showApp();
    await loadServers();
    if (isAdmin()) await loadUsers();
  } else {
    showLogin();
  }
}

// ═══════════════════════════════════════════════════════════════
// Login / Logout
// ═══════════════════════════════════════════════════════════════

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const data = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (data.error) return notify(data.error, true);
  sessionUser = data.user;
  showApp();
  await loadServers();
  if (isAdmin()) await loadUsers();
  notify("Erfolgreich eingeloggt.");
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  sessionUser = null;
  allServers = [];
  allUsers = [];
  showLogin();
});

// ═══════════════════════════════════════════════════════════════
// Panel visibility
// ═══════════════════════════════════════════════════════════════

function showLogin() {
  document.getElementById("login-panel").classList.remove("hidden");
  document.getElementById("app-panel").classList.add("hidden");
}

function showApp() {
  document.getElementById("login-panel").classList.add("hidden");
  document.getElementById("app-panel").classList.remove("hidden");
  document.getElementById("current-user").textContent = sessionUser.username;
  document.getElementById("current-role").textContent = sessionUser.role;
  if (isAdmin()) {
    document.querySelectorAll(".admin-only").forEach((el) => el.classList.remove("hidden"));
  }
  switchView("hub");
}

// ═══════════════════════════════════════════════════════════════
// Navigation
// ═══════════════════════════════════════════════════════════════

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

function switchView(name) {
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name),
  );
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("active", v.id === `view-${name}`),
  );
}

function switchAdminTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab),
  );
  document.querySelectorAll(".tab-content").forEach((c) =>
    c.classList.toggle("active", c.id === `tab-${tab}`),
  );
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchAdminTab(btn.dataset.tab));
});

// ═══════════════════════════════════════════════════════════════
// Service grid
// ═══════════════════════════════════════════════════════════════

async function loadServers() {
  const data = await api("/api/servers");
  if (data.error) return notify(data.error, true);
  allServers = data.servers;
  renderServiceGrid();
  if (isAdmin()) renderServerAdminList();
}

function renderServiceGrid() {
  const grid = document.getElementById("service-grid");
  grid.innerHTML = "";

  if (allServers.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-msg";
    p.textContent = isAdmin()
      ? "Noch keine Server. Im Admin-Bereich hinzufügen."
      : "Keine Server verfügbar.";
    grid.appendChild(p);
    return;
  }

  for (const server of allServers) {
    grid.appendChild(createServerCard(server));
  }
}

function createServerCard(server) {
  const card = document.createElement("div");
  card.className = "service-card";
  card.dataset.id = server.id;

  // ── Image / avatar ──
  const imgWrap = document.createElement("div");
  imgWrap.className = "card-img-wrap";
  if (server.image_path) {
    const img = document.createElement("img");
    img.src = server.image_path;
    img.alt = server.title;
    img.className = "card-img";
    img.addEventListener("error", () => {
      imgWrap.innerHTML = "";
      imgWrap.appendChild(makeLetterAvatar(server.title));
    });
    imgWrap.appendChild(img);
  } else {
    imgWrap.appendChild(makeLetterAvatar(server.title));
  }

  // ── Info ──
  const cardInfo = document.createElement("div");
  cardInfo.className = "card-info";

  const titleRow = document.createElement("div");
  titleRow.className = "card-title-row";

  const titleEl = document.createElement("span");
  titleEl.className = "card-title";
  titleEl.textContent = server.title;
  titleRow.appendChild(titleEl);

  if (server.type === "calibre") {
    const badge = document.createElement("span");
    badge.className = "type-badge calibre-badge";
    badge.textContent = "Calibre";
    titleRow.appendChild(badge);
  }

  if (isAdmin() && !server.visible_to_all) {
    const vBadge = document.createElement("span");
    vBadge.className = "type-badge restricted-badge";
    vBadge.title = `Eingeschränkt: ${server.allowed_user_ids?.length || 0} Benutzer`;
    vBadge.textContent = "Eingeschränkt";
    titleRow.appendChild(vBadge);
  }

  cardInfo.appendChild(titleRow);

  if (server.description) {
    const desc = document.createElement("p");
    desc.className = "card-desc";
    desc.textContent = server.description;
    cardInfo.appendChild(desc);
  }

  // ── Header row ──
  const header = document.createElement("div");
  header.className = "card-header";
  header.append(imgWrap, cardInfo);

  // ── Actions ──
  const actions = document.createElement("div");
  actions.className = "card-actions";

  if (server.type === "generic") {
    const openBtn = document.createElement("a");
    openBtn.href = server.url;
    openBtn.target = "_blank";
    openBtn.rel = "noopener noreferrer";
    openBtn.className = "btn-primary btn-sm";
    openBtn.textContent = "Öffnen";
    actions.appendChild(openBtn);
  } else if (server.type === "calibre") {
    const extBtn = document.createElement("a");
    extBtn.href = server.url;
    extBtn.target = "_blank";
    extBtn.rel = "noopener noreferrer";
    extBtn.className = "btn-secondary btn-sm";
    extBtn.textContent = "Calibre öffnen";
    actions.appendChild(extBtn);

    const browseBtn = document.createElement("button");
    browseBtn.type = "button";
    browseBtn.className = "btn-primary btn-sm";
    browseBtn.textContent = "Bibliothek";
    browseBtn.addEventListener("click", () => openCalibreModal(server));
    actions.appendChild(browseBtn);
  }

  if (isAdmin()) {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-edit btn-sm";
    editBtn.textContent = "Bearbeiten";
    editBtn.addEventListener("click", () => {
      startEditServer(server);
      switchView("admin");
      switchAdminTab("servers");
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-danger btn-sm";
    delBtn.title = "Löschen";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`"${server.title}" wirklich löschen?`)) return;
      const result = await api(`/api/servers/${server.id}`, { method: "DELETE" });
      if (result.error) return notify(result.error, true);
      await loadServers();
      notify("Server gelöscht.");
    });

    actions.append(editBtn, delBtn);
  }

  card.append(header, actions);
  return card;
}

function makeLetterAvatar(title) {
  const div = document.createElement("div");
  div.className = "letter-avatar";
  div.textContent = (title || "?").charAt(0).toUpperCase();
  div.style.setProperty("--avatar-hue", String(stringToHue(title)));
  return div;
}

function stringToHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

// ═══════════════════════════════════════════════════════════════
// Calibre modal
// ═══════════════════════════════════════════════════════════════

function openCalibreModal(server) {
  currentCalibreServer = server;
  document.getElementById("calibre-modal-title").textContent = server.title;
  document.getElementById("calibre-search").value = "";
  document.getElementById("book-grid").innerHTML = "";
  document.getElementById("calibre-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  loadCalibreBooks("");
}

function closeCalibreModal() {
  document.getElementById("calibre-modal").classList.add("hidden");
  document.body.style.overflow = "";
  currentCalibreServer = null;
}

document.getElementById("calibre-modal-close").addEventListener("click", closeCalibreModal);
document.querySelector(".modal-backdrop").addEventListener("click", closeCalibreModal);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCalibreModal();
});

document.getElementById("calibre-search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!currentCalibreServer) return;
  loadCalibreBooks(document.getElementById("calibre-search").value.trim());
});

async function loadCalibreBooks(query) {
  if (!currentCalibreServer) return;
  const status = document.getElementById("calibre-status");
  const grid = document.getElementById("book-grid");
  status.textContent = "Lade Bücher…";
  grid.innerHTML = "";

  const searchData = await api(
    `/api/servers/${currentCalibreServer.id}/calibre/search?query=${encodeURIComponent(query)}&num=50&sort=title`,
  );

  if (searchData.error) {
    status.textContent = "Fehler: " + searchData.error;
    return;
  }

  const ids = searchData.book_ids || [];
  if (ids.length === 0) {
    status.textContent = query ? "Keine Bücher gefunden." : "Bibliothek ist leer.";
    return;
  }

  const total = searchData.total_num || ids.length;
  status.textContent = `${total} ${total === 1 ? "Buch" : "Bücher"}`;

  const booksData = await api(
    `/api/servers/${currentCalibreServer.id}/calibre/books?ids=${ids.join(",")}`,
  );

  if (booksData.error) {
    status.textContent = "Fehler beim Laden: " + booksData.error;
    return;
  }

  const serverId = currentCalibreServer.id;
  const serverUrl = currentCalibreServer.url.replace(/\/$/, "");

  for (const id of ids) {
    const book = booksData[String(id)];
    if (!book) continue;
    grid.appendChild(createBookCard(id, book, serverId, serverUrl));
  }
}

function createBookCard(bookId, book, serverId, serverUrl) {
  const card = document.createElement("div");
  card.className = "book-card";
  card.title = book.title || "Unbekannt";
  card.addEventListener("click", () => {
    window.open(`${serverUrl}/browse/book/${bookId}`, "_blank", "noopener,noreferrer");
  });

  const coverWrap = document.createElement("div");
  coverWrap.className = "book-cover-wrap";

  const img = document.createElement("img");
  img.className = "book-cover";
  img.loading = "lazy";
  img.alt = book.title || "";
  img.src = `/api/servers/${serverId}/calibre/cover/${bookId}`;
  img.addEventListener("error", () => {
    img.style.display = "none";
    const ph = document.createElement("div");
    ph.className = "book-cover-placeholder";
    ph.textContent = "📚";
    coverWrap.appendChild(ph);
  });
  coverWrap.appendChild(img);

  const info = document.createElement("div");
  info.className = "book-info";

  const title = document.createElement("div");
  title.className = "book-title";
  title.textContent = book.title || "Unbekannt";

  const authors = document.createElement("div");
  authors.className = "book-authors";
  authors.textContent = Array.isArray(book.authors) ? book.authors.join(", ") : "";

  info.append(title, authors);
  card.append(coverWrap, info);
  return card;
}

// ═══════════════════════════════════════════════════════════════
// Admin: Users
// ═══════════════════════════════════════════════════════════════

async function loadUsers() {
  const data = await api("/api/users");
  if (data.error) return notify(data.error, true);
  allUsers = data.users;
  renderUserList();
}

function renderUserList() {
  const list = document.getElementById("user-list");
  list.innerHTML = "";
  allUsers.forEach((u) => {
    const li = document.createElement("li");
    li.className = "admin-list-item";

    const info = document.createElement("span");
    info.innerHTML = `<strong>${escapeHtml(u.username)}</strong>&nbsp;<span class="role-badge">${u.role}</span>`;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-danger btn-sm";
    del.textContent = "✕";
    del.title = "Benutzer löschen";
    del.disabled = u.id === sessionUser.id;
    del.addEventListener("click", async () => {
      if (!confirm(`Benutzer "${u.username}" löschen?`)) return;
      const result = await api(`/api/users/${u.id}`, { method: "DELETE" });
      if (result.error) return notify(result.error, true);
      await loadUsers();
      notify("Benutzer gelöscht.");
    });

    li.append(info, del);
    list.appendChild(li);
  });
}

document.getElementById("user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("new-username").value.trim();
  const password = document.getElementById("new-password").value;
  const role = document.getElementById("new-role").value;
  const result = await api("/api/users", {
    method: "POST",
    body: JSON.stringify({ username, password, role }),
  });
  if (result.error) return notify(result.error, true);
  document.getElementById("user-form").reset();
  await loadUsers();
  notify("Benutzer angelegt.");
});

// ═══════════════════════════════════════════════════════════════
// Admin: Server form
// ═══════════════════════════════════════════════════════════════

document.getElementById("server-type").addEventListener("change", (e) => {
  document.getElementById("calibre-library-field").classList.toggle(
    "hidden",
    e.target.value !== "calibre",
  );
});

document.getElementById("server-visible-all").addEventListener("change", (e) => {
  document.getElementById("user-access-list").classList.toggle("hidden", e.target.checked);
});

document.getElementById("server-image-delete").addEventListener("click", async () => {
  const serverId = document.getElementById("edit-server-id").value;
  if (!serverId) return;
  const result = await api(`/api/servers/${serverId}/image`, { method: "DELETE" });
  if (result.error) return notify(result.error, true);
  document.getElementById("server-image-preview").classList.add("hidden");
  document.getElementById("server-image-current").src = "";
  const s = allServers.find((x) => x.id === Number(serverId));
  if (s) s.image_path = null;
  notify("Bild entfernt.");
});

document.getElementById("server-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("edit-server-id").value;
  const payload = {
    title: document.getElementById("server-title").value.trim(),
    url: document.getElementById("server-url").value.trim(),
    description: document.getElementById("server-description").value.trim(),
    type: document.getElementById("server-type").value,
    calibre_library: document.getElementById("server-calibre-library").value.trim(),
  };

  const endpoint = id ? `/api/servers/${id}` : "/api/servers";
  const method = id ? "PUT" : "POST";
  const result = await api(endpoint, { method, body: JSON.stringify(payload) });
  if (result.error) return notify(result.error, true);

  const serverId = id ? Number(id) : result.server.id;

  // Upload image if selected
  const imageFile = document.getElementById("server-image").files[0];
  if (imageFile) {
    const formData = new FormData();
    formData.append("image", imageFile);
    const imgRes = await fetch(`/api/servers/${serverId}/image`, {
      method: "POST",
      body: formData,
    });
    const imgData = await imgRes.json().catch(() => ({ error: "Upload-Fehler." }));
    if (imgData.error) notify("Bild-Upload fehlgeschlagen: " + imgData.error, true);
  }

  // Set visibility
  const visibleAll = document.getElementById("server-visible-all").checked;
  const userIds = [];
  if (!visibleAll) {
    document.querySelectorAll("#user-checkboxes input:checked").forEach((cb) => {
      userIds.push(Number(cb.value));
    });
  }
  await api(`/api/servers/${serverId}/visibility`, {
    method: "PUT",
    body: JSON.stringify({ visible_to_all: visibleAll, user_ids: userIds }),
  });

  resetServerForm();
  await loadServers();
  notify(id ? "Server aktualisiert." : "Server hinzugefügt.");
});

document.getElementById("server-reset").addEventListener("click", resetServerForm);

function renderUserCheckboxes(server) {
  const container = document.getElementById("user-checkboxes");
  container.innerHTML = "";

  const nonAdminUsers = allUsers.filter((u) => u.id !== sessionUser.id);

  if (nonAdminUsers.length === 0) {
    container.innerHTML = '<p class="field-hint muted">Keine weiteren Benutzer vorhanden.</p>';
    return;
  }

  nonAdminUsers.forEach((u) => {
    const label = document.createElement("label");
    label.className = "checkbox-label";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = u.id;

    if (server?.allowed_user_ids?.includes(u.id)) cb.checked = true;

    label.append(cb, document.createTextNode(` ${u.username} (${u.role})`));
    container.appendChild(label);
  });
}

function startEditServer(server) {
  document.getElementById("edit-server-id").value = String(server.id);
  document.getElementById("server-title").value = server.title;
  document.getElementById("server-url").value = server.url;
  document.getElementById("server-description").value = server.description || "";
  document.getElementById("server-type").value = server.type;
  document.getElementById("server-calibre-library").value = server.calibre_library || "";
  document.getElementById("calibre-library-field").classList.toggle(
    "hidden",
    server.type !== "calibre",
  );

  const visibleAll = Boolean(server.visible_to_all);
  document.getElementById("server-visible-all").checked = visibleAll;
  document.getElementById("user-access-list").classList.toggle("hidden", visibleAll);
  renderUserCheckboxes(server);

  // Image preview
  const preview = document.getElementById("server-image-preview");
  const imgEl = document.getElementById("server-image-current");
  if (server.image_path) {
    imgEl.src = server.image_path;
    preview.classList.remove("hidden");
  } else {
    preview.classList.add("hidden");
    imgEl.src = "";
  }

  document.getElementById("server-form-title").textContent = "Server bearbeiten";
  document.getElementById("server-submit").textContent = "Aktualisieren";
  document.getElementById("server-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetServerForm() {
  document.getElementById("edit-server-id").value = "";
  document.getElementById("server-form").reset();
  document.getElementById("calibre-library-field").classList.add("hidden");
  document.getElementById("user-access-list").classList.add("hidden");
  document.getElementById("server-visible-all").checked = true;
  document.getElementById("server-image-preview").classList.add("hidden");
  document.getElementById("server-image-current").src = "";
  document.getElementById("server-form-title").textContent = "Server hinzufügen";
  document.getElementById("server-submit").textContent = "Speichern";
}

// ─── Server admin list ────────────────────────────────────────

function renderServerAdminList() {
  const list = document.getElementById("server-admin-list");
  list.innerHTML = "";

  if (allServers.length === 0) {
    list.innerHTML = '<p class="empty-msg">Keine Server vorhanden.</p>';
    return;
  }

  for (const server of allServers) {
    const item = document.createElement("div");
    item.className = "server-admin-item";

    const left = document.createElement("div");
    left.className = "server-admin-info";

    const thumb = document.createElement("div");
    thumb.className = "server-admin-thumb";
    if (server.image_path) {
      const img = document.createElement("img");
      img.src = server.image_path;
      img.alt = "";
      thumb.appendChild(img);
    } else {
      thumb.appendChild(makeLetterAvatar(server.title));
    }

    const text = document.createElement("div");
    text.className = "server-admin-text";

    const nameRow = document.createElement("div");
    nameRow.innerHTML = `<strong>${escapeHtml(server.title)}</strong> <span class="type-badge">${server.type}</span>`;

    const urlEl = document.createElement("div");
    urlEl.className = "text-muted text-sm";
    urlEl.textContent = server.url;

    const visEl = document.createElement("div");
    visEl.className = "text-muted text-sm";
    visEl.textContent = server.visible_to_all
      ? "Für alle sichtbar"
      : `Eingeschränkt (${server.allowed_user_ids?.length || 0} Benutzer)`;

    text.append(nameRow, urlEl, visEl);
    left.append(thumb, text);

    const actions = document.createElement("div");
    actions.className = "server-admin-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-edit btn-sm";
    editBtn.textContent = "Bearbeiten";
    editBtn.addEventListener("click", () => startEditServer(server));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-danger btn-sm";
    delBtn.textContent = "Löschen";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`"${server.title}" wirklich löschen?`)) return;
      const result = await api(`/api/servers/${server.id}`, { method: "DELETE" });
      if (result.error) return notify(result.error, true);
      await loadServers();
      notify("Server gelöscht.");
    });

    actions.append(editBtn, delBtn);
    item.append(left, actions);
    list.appendChild(item);
  }
}

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════

function isAdmin() {
  return sessionUser?.role === "admin";
}

function notify(text, isError = false) {
  const el = document.getElementById("message");
  el.textContent = text;
  el.className = `global-message${isError ? " error" : ""} show`;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => el.classList.remove("show"), 4000);
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({ error: "Ungültige Serverantwort." }));
  if (!res.ok && !data.error) return { error: "Serverfehler." };
  return data;
}

function escapeHtml(v) {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

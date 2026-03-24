let sessionUser = null;
let sites = [];
let messageTimer = null;

boot();

// === Boot ===

async function boot() {
  const session = await api("/api/session");
  if (session.authenticated) {
    sessionUser = session.user;
    showApp();
    await loadSites();
    if (isAdmin()) await loadUsers();
  } else {
    showLogin();
  }
}

// === Login / Logout ===

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
  await loadSites();
  if (isAdmin()) await loadUsers();
  notify("Erfolgreich eingeloggt.");
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  sessionUser = null;
  sites = [];
  showLogin();
});

// === Panel visibility ===

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

// === Navigation ===

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    switchView(view);
    if (view === "calibre") loadCalibre();
    if (view === "settings") loadSettings();
  });
});

function switchView(name) {
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name),
  );
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("active", v.id === `view-${name}`),
  );
}

// === Hub – service grid ===

async function loadSites() {
  const data = await api("/api/sites");
  if (data.error) return notify(data.error, true);
  sites = data.sites;
  renderServiceGrid();
}

function renderServiceGrid() {
  const grid = document.getElementById("service-grid");
  grid.innerHTML = "";

  if (sites.length === 0) {
    const msg = document.createElement("p");
    msg.className = "empty-msg";
    msg.textContent = isAdmin()
      ? "Noch keine Server. Im Admin-Bereich hinzufügen."
      : "Keine Server vorhanden.";
    grid.appendChild(msg);
    return;
  }

  for (const site of sites) {
    grid.appendChild(createServiceCard(site));
  }
}

function createServiceCard(site) {
  const card = document.createElement("div");
  card.className = "service-card";

  let safeUrl = "#";
  let origin = "";
  try {
    const parsed = new URL(site.url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      safeUrl = site.url;
      origin = parsed.origin;
    }
  } catch (_) {}

  const firstLetter = site.title.charAt(0).toUpperCase();

  const link = document.createElement("a");
  link.className = "service-card-link";
  link.href = safeUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  const iconWrap = document.createElement("div");
  iconWrap.className = "service-icon-wrap";

  const letter = document.createElement("div");
  letter.className = "service-letter";
  letter.textContent = firstLetter;

  const favicon = document.createElement("img");
  favicon.className = "service-favicon";
  favicon.loading = "lazy";
  favicon.alt = "";
  if (origin) favicon.src = `${origin}/favicon.ico`;
  favicon.addEventListener("error", () => {
    favicon.style.display = "none";
  });

  iconWrap.append(letter, favicon);

  const name = document.createElement("div");
  name.className = "service-name";
  name.textContent = site.title;

  link.append(iconWrap, name);

  if (site.description) {
    const desc = document.createElement("div");
    desc.className = "service-desc";
    desc.textContent = site.description;
    link.appendChild(desc);
  }

  card.appendChild(link);

  if (isAdmin()) {
    const actions = document.createElement("div");
    actions.className = "service-card-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn-edit";
    editBtn.type = "button";
    editBtn.textContent = "Bearbeiten";
    editBtn.addEventListener("click", () => {
      startEditSite(site);
      switchView("admin");
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn-danger";
    delBtn.type = "button";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`"${site.title}" löschen?`)) return;
      const result = await api(`/api/sites/${site.id}`, { method: "DELETE" });
      if (result.error) return notify(result.error, true);
      await loadSites();
      notify("Server gelöscht.");
    });

    actions.append(editBtn, delBtn);
    card.appendChild(actions);
  }

  return card;
}

// === Admin – users ===

async function loadUsers() {
  const data = await api("/api/users");
  if (data.error) return notify(data.error, true);
  const userList = document.getElementById("user-list");
  userList.innerHTML = "";
  data.users.forEach((u) => {
    const li = document.createElement("li");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = u.username;

    const badge = document.createElement("span");
    badge.className = "role-badge";
    badge.textContent = u.role;

    li.append(nameSpan, badge);
    userList.appendChild(li);
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

// === Admin – sites form ===

document.getElementById("site-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("edit-site-id").value;
  const payload = {
    title: document.getElementById("site-title").value.trim(),
    url: document.getElementById("site-url").value.trim(),
    description: document.getElementById("site-description").value.trim(),
  };
  const endpoint = id ? `/api/sites/${id}` : "/api/sites";
  const method = id ? "PUT" : "POST";
  const result = await api(endpoint, { method, body: JSON.stringify(payload) });
  if (result.error) return notify(result.error, true);
  resetSiteForm();
  await loadSites();
  notify(id ? "Server aktualisiert." : "Server hinzugefügt.");
});

document.getElementById("site-reset").addEventListener("click", resetSiteForm);

function startEditSite(site) {
  document.getElementById("edit-site-id").value = String(site.id);
  document.getElementById("site-title").value = site.title;
  document.getElementById("site-url").value = site.url;
  document.getElementById("site-description").value = site.description || "";
  document.getElementById("site-form-title").textContent = "Server bearbeiten";
  document.getElementById("site-submit").textContent = "Aktualisieren";
}

function resetSiteForm() {
  document.getElementById("edit-site-id").value = "";
  document.getElementById("site-form").reset();
  document.getElementById("site-form-title").textContent = "Server hinzufügen";
  document.getElementById("site-submit").textContent = "Speichern";
}

// === Calibre ===

document.getElementById("calibre-search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  loadCalibre(document.getElementById("calibre-search").value.trim());
});

async function loadCalibre(query = "") {
  const status = document.getElementById("calibre-status");
  const grid = document.getElementById("book-grid");
  status.textContent = "Lade Bücher…";
  grid.innerHTML = "";

  const searchData = await api(
    `/api/calibre/search?query=${encodeURIComponent(query)}&num=50&sort=title`,
  );

  if (searchData.error) {
    if (searchData.error.includes("nicht konfiguriert")) {
      if (isAdmin()) {
        status.innerHTML = "";
        const msg = document.createTextNode("Calibre nicht konfiguriert. ");
        const btn = document.createElement("button");
        btn.className = "link-btn";
        btn.type = "button";
        btn.textContent = "Einstellungen öffnen →";
        btn.addEventListener("click", () => switchView("settings"));
        status.append(msg, btn);
      } else {
        status.textContent = "Calibre nicht konfiguriert.";
      }
    } else {
      status.textContent = "Fehler: " + searchData.error;
    }
    return;
  }

  const { ids, total_num } = searchData;

  if (!ids || ids.length === 0) {
    status.textContent = query ? "Keine Bücher gefunden." : "Bibliothek ist leer.";
    return;
  }

  const plural = total_num !== 1 ? "Bücher" : "Buch";
  status.textContent = `${total_num} ${plural} ${query ? "gefunden" : "in der Bibliothek"}`;

  const booksData = await api(`/api/calibre/books?ids=${ids.join(",")}`);
  if (booksData.error) {
    status.textContent = "Fehler beim Laden der Bücher: " + booksData.error;
    return;
  }

  for (const id of ids) {
    const book = booksData[String(id)];
    if (!book) continue;
    grid.appendChild(createBookCard(id, book));
  }
}

function createBookCard(id, book) {
  const card = document.createElement("div");
  card.className = "book-card";

  const calibreUrl = book._calibre_url || "";
  const library = encodeURIComponent(book._library || "Calibre_Library");
  const formats = (book.formats || []).map((f) => f.toLowerCase()).filter((f) => /^[a-z0-9]+$/.test(f));
  const authors = Array.isArray(book.authors) ? book.authors.join(", ") : String(book.authors || "");
  const title = String(book.title || "Unbekannt");

  const coverImg = document.createElement("img");
  coverImg.className = "book-cover";
  coverImg.loading = "lazy";
  coverImg.alt = title;
  coverImg.src = `/api/calibre/cover/${id}`;
  coverImg.addEventListener("error", () => {
    const placeholder = document.createElement("div");
    placeholder.className = "book-cover-placeholder";
    placeholder.textContent = "📚";
    coverImg.replaceWith(placeholder);
  });

  const info = document.createElement("div");
  info.className = "book-info";

  const titleEl = document.createElement("div");
  titleEl.className = "book-title";
  titleEl.textContent = title;

  const authorEl = document.createElement("div");
  authorEl.className = "book-author";
  authorEl.textContent = authors;

  const formatsEl = document.createElement("div");
  formatsEl.className = "book-formats";

  for (const fmt of formats) {
    const a = document.createElement("a");
    a.className = "format-badge";
    a.href = `${calibreUrl}/get/${fmt}/${id}/${library}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = fmt.toUpperCase();
    formatsEl.appendChild(a);
  }

  info.append(titleEl, authorEl, formatsEl);
  card.append(coverImg, info);
  return card;
}

// === Settings ===

async function loadSettings() {
  const data = await api("/api/settings");
  if (data.error) return;
  document.getElementById("calibre-url-input").value = data.calibre_url || "";
  document.getElementById("calibre-library-input").value = data.calibre_library || "";
}

document.getElementById("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const calibreUrl = document.getElementById("calibre-url-input").value.trim();
  const calibreLibrary = document.getElementById("calibre-library-input").value.trim();

  const [r1, r2] = await Promise.all([
    api("/api/settings/calibre_url", { method: "PUT", body: JSON.stringify({ value: calibreUrl }) }),
    api("/api/settings/calibre_library", {
      method: "PUT",
      body: JSON.stringify({ value: calibreLibrary || "Calibre_Library" }),
    }),
  ]);

  if (r1.error || r2.error) return notify(r1.error || r2.error, true);
  notify("Einstellungen gespeichert.");
});

// === Helpers ===

function isAdmin() {
  return sessionUser?.role === "admin";
}

function notify(text, isError = false) {
  if (messageTimer) clearTimeout(messageTimer);
  const msg = document.getElementById("message");
  msg.textContent = text;
  msg.className = `global-message visible${isError ? " error" : " success"}`;
  messageTimer = setTimeout(() => {
    msg.className = "global-message";
  }, 3500);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({ error: "Ungültige Serverantwort." }));
  if (!response.ok && !data.error) return { error: "Serverfehler." };
  return data;
}

const loginPanel = document.getElementById("login-panel");
const appPanel = document.getElementById("app-panel");
const adminArea = document.getElementById("admin-area");
const message = document.getElementById("message");

const currentUser = document.getElementById("current-user");
const currentRole = document.getElementById("current-role");

const loginForm = document.getElementById("login-form");
const logoutBtn = document.getElementById("logout-btn");

const userForm = document.getElementById("user-form");
const userList = document.getElementById("user-list");

const siteForm = document.getElementById("site-form");
const siteList = document.getElementById("site-list");
const editSiteId = document.getElementById("edit-site-id");
const siteTitle = document.getElementById("site-title");
const siteUrl = document.getElementById("site-url");
const siteDescription = document.getElementById("site-description");
const siteReset = document.getElementById("site-reset");

let sessionUser = null;
let sites = [];

boot();

async function boot() {
  const session = await api("/api/session");
  if (session.authenticated) {
    sessionUser = session.user;
    showApp();
    await loadSites();
    if (isAdmin()) {
      await loadUsers();
    }
  } else {
    showLogin();
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
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
  if (isAdmin()) {
    await loadUsers();
  }
  notify("Erfolgreich eingeloggt.");
});

logoutBtn.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  sessionUser = null;
  sites = [];
  showLogin();
  notify("Abgemeldet.");
});

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = document.getElementById("new-username").value.trim();
  const password = document.getElementById("new-password").value;
  const role = document.getElementById("new-role").value;

  const result = await api("/api/users", {
    method: "POST",
    body: JSON.stringify({ username, password, role }),
  });

  if (result.error) return notify(result.error, true);

  userForm.reset();
  await loadUsers();
  notify("User wurde angelegt.");
});

siteForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    title: siteTitle.value.trim(),
    url: siteUrl.value.trim(),
    description: siteDescription.value.trim(),
  };

  const id = editSiteId.value;
  const endpoint = id ? `/api/sites/${id}` : "/api/sites";
  const method = id ? "PUT" : "POST";

  const result = await api(endpoint, {
    method,
    body: JSON.stringify(payload),
  });

  if (result.error) return notify(result.error, true);

  resetSiteForm();
  await loadSites();
  notify(id ? "Website aktualisiert." : "Website angelegt.");
});

siteReset.addEventListener("click", () => {
  resetSiteForm();
});

function renderSites() {
  siteList.innerHTML = "";

  if (sites.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Noch keine Websites in der Datenbank.";
    siteList.appendChild(li);
    return;
  }

  for (const site of sites) {
    const li = document.createElement("li");

    const left = document.createElement("div");
    left.innerHTML = `<strong>${escapeHtml(site.title)}</strong><br>
      <a href="${escapeHtml(site.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(site.url)}</a><br>
      <span class="site-meta">${escapeHtml(site.description || "")}</span>`;

    li.appendChild(left);

    if (isAdmin()) {
      const actions = document.createElement("div");
      actions.className = "actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "Bearbeiten";
      editBtn.addEventListener("click", () => startEdit(site));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "Löschen";
      delBtn.className = "btn-danger";
      delBtn.addEventListener("click", async () => {
        const result = await api(`/api/sites/${site.id}`, { method: "DELETE" });
        if (result.error) return notify(result.error, true);
        await loadSites();
        notify("Website gelöscht.");
      });

      actions.append(editBtn, delBtn);
      li.appendChild(actions);
    }

    siteList.appendChild(li);
  }
}

async function loadSites() {
  const data = await api("/api/sites");
  if (data.error) return notify(data.error, true);
  sites = data.sites;
  renderSites();
}

async function loadUsers() {
  const data = await api("/api/users");
  if (data.error) return notify(data.error, true);

  userList.innerHTML = "";
  data.users.forEach((user) => {
    const li = document.createElement("li");
    li.textContent = `${user.username} (${user.role})`;
    userList.appendChild(li);
  });
}

function startEdit(site) {
  editSiteId.value = String(site.id);
  siteTitle.value = site.title;
  siteUrl.value = site.url;
  siteDescription.value = site.description || "";
  document.getElementById("site-submit").textContent = "Website aktualisieren";
}

function resetSiteForm() {
  editSiteId.value = "";
  siteForm.reset();
  document.getElementById("site-submit").textContent = "Website speichern";
}

function showLogin() {
  loginPanel.classList.remove("hidden");
  appPanel.classList.add("hidden");
  adminArea.classList.add("hidden");
}

function showApp() {
  loginPanel.classList.add("hidden");
  appPanel.classList.remove("hidden");
  currentUser.textContent = sessionUser.username;
  currentRole.textContent = sessionUser.role;

  if (isAdmin()) {
    adminArea.classList.remove("hidden");
  } else {
    adminArea.classList.add("hidden");
  }
}

function isAdmin() {
  return sessionUser?.role === "admin";
}

function notify(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#dc2626" : "#374151";
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

  if (!response.ok && !data.error) {
    return { error: "Serverfehler." };
  }

  return data;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

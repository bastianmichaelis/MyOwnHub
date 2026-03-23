const STORAGE_KEY = "my-web-hub-sites";

const form = document.getElementById("site-form");
const nameInput = document.getElementById("name");
const urlInput = document.getElementById("url");
const list = document.getElementById("site-list");
const emptyState = document.getElementById("empty-state");
const clearAllBtn = document.getElementById("clear-all");
const template = document.getElementById("site-item-template");

let sites = loadSites();
renderSites();

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = nameInput.value.trim();
  const normalizedUrl = normalizeUrl(urlInput.value.trim());

  if (!name || !normalizedUrl) {
    return;
  }

  sites.unshift({
    id: crypto.randomUUID(),
    name,
    url: normalizedUrl,
  });

  saveSites();
  renderSites();
  form.reset();
  nameInput.focus();
});

clearAllBtn.addEventListener("click", () => {
  if (sites.length === 0) {
    return;
  }

  sites = [];
  saveSites();
  renderSites();
});

function renderSites() {
  list.innerHTML = "";

  for (const site of sites) {
    const fragment = template.content.cloneNode(true);
    const item = fragment.querySelector(".site-item");
    const link = fragment.querySelector(".site-link");
    const deleteBtn = fragment.querySelector(".delete-btn");

    link.href = site.url;
    link.textContent = `${site.name} · ${site.url}`;

    deleteBtn.addEventListener("click", () => {
      sites = sites.filter((entry) => entry.id !== site.id);
      saveSites();
      renderSites();
    });

    item.dataset.id = site.id;
    list.appendChild(fragment);
  }

  emptyState.style.display = sites.length === 0 ? "block" : "none";
}

function loadSites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (site) =>
        site &&
        typeof site.id === "string" &&
        typeof site.name === "string" &&
        typeof site.url === "string",
    );
  } catch {
    return [];
  }
}

function saveSites() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sites));
}

function normalizeUrl(url) {
  if (!url) return "";

  const withProtocol = /^(https?:)?\/\//i.test(url) ? url : `https://${url}`;

  try {
    return new URL(withProtocol).toString();
  } catch {
    return "";
  }
}

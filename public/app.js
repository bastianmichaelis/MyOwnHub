"use strict";

let _websites = [];
let _toastTimer = null;
let _installPrompt = null;

document.addEventListener("DOMContentLoaded", async () => {
  registerSW();
  wireInstallPrompt();
  await refresh();
  render();
  wireModal();
});

// ── Service Worker ─────────────────────────────────────────

function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW:", e));
  }
}

// ── PWA Install ────────────────────────────────────────────

function wireInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    _installPrompt = e;
    document.getElementById("install-btn").classList.remove("hidden");
  });

  document.getElementById("install-btn").addEventListener("click", async () => {
    if (!_installPrompt) return;
    _installPrompt.prompt();
    const { outcome } = await _installPrompt.userChoice;
    if (outcome === "accepted") {
      document.getElementById("install-btn").classList.add("hidden");
      _installPrompt = null;
    }
  });

  window.addEventListener("appinstalled", () => {
    document.getElementById("install-btn").classList.add("hidden");
    _installPrompt = null;
    toast("App installiert!");
  });
}

// ── Data ───────────────────────────────────────────────────

async function refresh() {
  _websites = await getAllWebsites();
  _websites.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

// ── Render ─────────────────────────────────────────────────

function render() {
  const grid = document.getElementById("websites-grid");
  const empty = document.getElementById("websites-empty");
  grid.innerHTML = "";

  if (_websites.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const site of _websites) {
    grid.appendChild(createCard(site));
  }
}

function createCard(site) {
  const card = document.createElement("div");
  card.className = "service-card";

  const header = document.createElement("div");
  header.className = "card-header";

  const imgWrap = document.createElement("div");
  imgWrap.className = "card-img-wrap";
  if (site.image_b64) {
    const img = document.createElement("img");
    img.src = site.image_b64;
    img.alt = site.title;
    img.className = "card-img";
    img.addEventListener("error", () => {
      imgWrap.innerHTML = "";
      imgWrap.appendChild(makeLetterAvatar(site.title));
    });
    imgWrap.appendChild(img);
  } else {
    imgWrap.appendChild(makeLetterAvatar(site.title));
  }

  const info = document.createElement("div");
  info.className = "card-info";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = site.title;
  info.appendChild(title);
  if (site.description) {
    const desc = document.createElement("p");
    desc.className = "card-desc";
    desc.textContent = site.description;
    info.appendChild(desc);
  }

  header.append(imgWrap, info);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const openBtn = document.createElement("a");
  openBtn.href = site.url;
  openBtn.target = "_blank";
  openBtn.rel = "noopener noreferrer";
  openBtn.className = "btn-primary btn-sm";
  openBtn.textContent = "Öffnen";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn-edit btn-sm";
  editBtn.textContent = "Bearbeiten";
  editBtn.addEventListener("click", () => openModal(site));

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn-danger btn-sm";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`"${site.title}" löschen?`)) return;
    await deleteWebsite(site.id);
    await refresh();
    render();
    toast("Website gelöscht.");
  });

  actions.append(openBtn, editBtn, delBtn);
  card.append(header, actions);
  return card;
}

// ── Modal ──────────────────────────────────────────────────

function wireModal() {
  document.getElementById("add-website-btn").addEventListener("click", () => openModal(null));
  document.getElementById("website-modal-close").addEventListener("click", closeModal);
  document.getElementById("website-modal-cancel").addEventListener("click", closeModal);
  document.querySelector("#website-modal .modal-backdrop").addEventListener("click", closeModal);

  document.getElementById("ws-image-remove").addEventListener("click", () => {
    document.getElementById("ws-image-preview").classList.add("hidden");
    document.getElementById("ws-image-current").src = "";
    document.getElementById("ws-image").value = "";
  });

  document.getElementById("ws-fetch-favicon").addEventListener("click", async () => {
    const url = document.getElementById("ws-url").value.trim();
    if (!url) { toast("Bitte zuerst eine URL eingeben.", true); return; }
    const favicon = await fetchFavicon(url);
    if (favicon) {
      document.getElementById("ws-image-current").src = favicon;
      document.getElementById("ws-image-preview").classList.remove("hidden");
      toast("Favicon geladen.");
    } else {
      toast("Kein Favicon gefunden.", true);
    }
  });

  document.getElementById("website-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("ws-id").value;
    const title = document.getElementById("ws-title").value.trim();
    const url = document.getElementById("ws-url").value.trim();
    const description = document.getElementById("ws-description").value.trim();

    let image_b64 = id
      ? (_websites.find((s) => s.id === Number(id))?.image_b64 ?? null)
      : null;

    if (document.getElementById("ws-image-preview").classList.contains("hidden")) {
      image_b64 = null;
    } else {
      const src = document.getElementById("ws-image-current").src;
      if (src && src.startsWith("data:")) image_b64 = src;
    }

    const imgFile = document.getElementById("ws-image").files[0];
    if (imgFile) {
      image_b64 = await imageFileToBase64(imgFile, 256);
    }

    const data = { title, url, description, image_b64 };

    if (id) {
      await updateWebsite(Number(id), data);
      toast("Website aktualisiert.");
    } else {
      data.sort_order = _websites.length;
      data.added_at = new Date().toISOString();
      await addWebsite(data);
      toast("Website gespeichert.");
    }

    closeModal();
    await refresh();
    render();
  });
}

function openModal(site) {
  document.getElementById("ws-id").value = site ? site.id : "";
  document.getElementById("ws-url").value = site?.url ?? "";
  document.getElementById("ws-title").value = site?.title ?? "";
  document.getElementById("ws-description").value = site?.description ?? "";
  document.getElementById("ws-image").value = "";

  const preview = document.getElementById("ws-image-preview");
  const img = document.getElementById("ws-image-current");
  if (site?.image_b64) {
    img.src = site.image_b64;
    preview.classList.remove("hidden");
  } else {
    preview.classList.add("hidden");
    img.src = "";
  }

  document.getElementById("website-modal-title").textContent = site
    ? "Website bearbeiten"
    : "Website hinzufügen";
  document.getElementById("website-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  document.getElementById("website-modal").classList.add("hidden");
  document.body.style.overflow = "";
}

// ── Favicon fetch ──────────────────────────────────────────

async function fetchFavicon(url) {
  try {
    const origin = new URL(url).origin;
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(origin)}&sz=64`;
    const res = await fetch(faviconUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ── Utilities ──────────────────────────────────────────────

function makeLetterAvatar(title) {
  const div = document.createElement("div");
  div.className = "letter-avatar";
  div.textContent = (title || "?").charAt(0).toUpperCase();
  div.style.setProperty("--avatar-hue", String(stringToHue(title || "")));
  return div;
}

function stringToHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

async function imageFileToBase64(file, maxPx) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function toast(text, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

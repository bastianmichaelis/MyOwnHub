"use strict";

// ═══════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════

let _books = [];
let _shortcuts = [];
let _currentView = "library";
let _toastTimer = null;
let _installPrompt = null;

// ═══════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", async () => {
  registerSW();
  wireInstallPrompt();
  await Promise.all([refreshBooks(), refreshShortcuts()]);
  renderCurrentView();
  wireNav();
  wireUpload();
  wireSearch();
  wireShortcutModal();
  wireBookEditModal();
});

function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW:", e));
  }
}

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

// ═══════════════════════════════════════════════════════════════
// Data helpers
// ═══════════════════════════════════════════════════════════════

async function refreshBooks() {
  _books = await getAllBooks();
  _books.sort((a, b) => (a.title || "").localeCompare(b.title || "", "de"));
}

async function refreshShortcuts() {
  _shortcuts = await getAllShortcuts();
  _shortcuts.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

// ═══════════════════════════════════════════════════════════════
// Navigation
// ═══════════════════════════════════════════════════════════════

function wireNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}

function switchView(name) {
  _currentView = name;
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name),
  );
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("active", v.id === `view-${name}`),
  );
  document.getElementById("upload-label").classList.toggle("hidden", name !== "library");
  document.getElementById("add-shortcut-btn").classList.toggle("hidden", name !== "websites");
  renderCurrentView();
}

function renderCurrentView() {
  if (_currentView === "library") renderLibrary(_books);
  if (_currentView === "websites") renderShortcuts(_shortcuts);
}

// ═══════════════════════════════════════════════════════════════
// Library view
// ═══════════════════════════════════════════════════════════════

function renderLibrary(books) {
  const grid = document.getElementById("book-grid");
  const empty = document.getElementById("library-empty");
  grid.innerHTML = "";

  if (books.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const book of books) {
    grid.appendChild(createBookCard(book));
  }
}

function createBookCard(book) {
  const card = document.createElement("div");
  card.className = "book-card";

  // Cover
  const coverWrap = document.createElement("div");
  coverWrap.className = "book-cover-wrap";
  if (book.cover_b64) {
    const img = document.createElement("img");
    img.className = "book-cover";
    img.src = book.cover_b64;
    img.alt = book.title;
    img.loading = "lazy";
    coverWrap.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "book-cover-placeholder";
    ph.setAttribute("aria-hidden", "true");
    ph.textContent = book.format === "pdf" ? "📄" : "📚";
    coverWrap.appendChild(ph);
  }

  // Badge
  if (book.format === "pdf") {
    const badge = document.createElement("span");
    badge.className = "format-badge";
    badge.textContent = "PDF";
    coverWrap.appendChild(badge);
  }

  // Open on cover click
  coverWrap.addEventListener("click", () => openBook(book.id));

  // Info
  const info = document.createElement("div");
  info.className = "book-info";

  const title = document.createElement("div");
  title.className = "book-title";
  title.textContent = book.title || "Unbekannt";

  const authors = document.createElement("div");
  authors.className = "book-authors";
  authors.textContent = Array.isArray(book.authors) ? book.authors.join(", ") : "";

  // Actions (long-press menu or buttons)
  const actions = document.createElement("div");
  actions.className = "book-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "book-action-btn";
  editBtn.title = "Bearbeiten";
  editBtn.innerHTML = "&#9998;";
  editBtn.addEventListener("click", (e) => { e.stopPropagation(); openBookEditModal(book); });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "book-action-btn danger";
  delBtn.title = "Löschen";
  delBtn.innerHTML = "&#x2715;";
  delBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(`"${book.title}" wirklich löschen?`)) return;
    await deleteBook(book.id);
    await deleteBookFile(book.id);
    await refreshBooks();
    renderLibrary(filterBooks(document.getElementById("book-search").value));
    toast("Buch gelöscht.");
  });

  actions.append(editBtn, delBtn);
  info.append(title, authors);
  card.append(coverWrap, info, actions);
  return card;
}

function filterBooks(query) {
  if (!query.trim()) return _books;
  const q = query.toLowerCase();
  return _books.filter(
    (b) =>
      (b.title || "").toLowerCase().includes(q) ||
      (b.authors || []).join(" ").toLowerCase().includes(q),
  );
}

// ═══════════════════════════════════════════════════════════════
// Search
// ═══════════════════════════════════════════════════════════════

function wireSearch() {
  const input = document.getElementById("book-search");
  input.addEventListener("input", () => renderLibrary(filterBooks(input.value)));
}

// ═══════════════════════════════════════════════════════════════
// Upload
// ═══════════════════════════════════════════════════════════════

function wireUpload() {
  const input = document.getElementById("book-upload");
  input.addEventListener("change", async () => {
    const files = Array.from(input.files);
    if (!files.length) return;
    input.value = "";
    await importFiles(files);
  });
}

async function importFiles(files) {
  const overlay = document.getElementById("upload-overlay");
  const status = document.getElementById("upload-status");
  overlay.classList.remove("hidden");

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    status.textContent = `Importiere ${i + 1} / ${files.length}: ${file.name}`;
    try {
      const meta = await parseBookFile(file);
      if (meta.cover_b64) {
        meta.cover_b64 = await resizeCover(meta.cover_b64, 400);
      }
      const ab = await file.arrayBuffer();
      const id = await addBook(meta);
      await saveBookFile(id, ab);
      ok++;
    } catch (e) {
      console.error("Import error:", e);
      fail++;
    }
  }

  overlay.classList.add("hidden");
  await refreshBooks();
  renderLibrary(_books);
  if (fail === 0) toast(`${ok} Buch${ok !== 1 ? "er" : ""} importiert.`);
  else toast(`${ok} importiert, ${fail} fehlgeschlagen.`, true);
}

// ═══════════════════════════════════════════════════════════════
// Book edit modal
// ═══════════════════════════════════════════════════════════════

function wireBookEditModal() {
  document.getElementById("book-edit-close").addEventListener("click", closeBookEditModal);
  document.getElementById("book-edit-cancel").addEventListener("click", closeBookEditModal);
  document.querySelector("#book-edit-modal .modal-backdrop").addEventListener("click", closeBookEditModal);

  document.getElementById("book-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = Number(document.getElementById("be-id").value);
    const title = document.getElementById("be-title").value.trim();
    const authors = document.getElementById("be-authors").value
      .split(",").map((a) => a.trim()).filter(Boolean);

    const patch = { title, authors };

    const coverFile = document.getElementById("be-cover").files[0];
    if (coverFile) {
      patch.cover_b64 = await imageFileToBase64(coverFile, 400);
    }

    await updateBook(id, patch);
    closeBookEditModal();
    await refreshBooks();
    renderLibrary(filterBooks(document.getElementById("book-search").value));
    toast("Buch aktualisiert.");
  });
}

function openBookEditModal(book) {
  document.getElementById("be-id").value = book.id;
  document.getElementById("be-title").value = book.title || "";
  document.getElementById("be-authors").value = (book.authors || []).join(", ");
  document.getElementById("be-cover").value = "";

  const preview = document.getElementById("be-cover-preview");
  const img = document.getElementById("be-cover-current");
  if (book.cover_b64) {
    img.src = book.cover_b64;
    preview.classList.remove("hidden");
  } else {
    preview.classList.add("hidden");
  }

  document.getElementById("book-edit-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeBookEditModal() {
  document.getElementById("book-edit-modal").classList.add("hidden");
  document.body.style.overflow = "";
}

// ═══════════════════════════════════════════════════════════════
// Shortcuts view
// ═══════════════════════════════════════════════════════════════

function renderShortcuts(shortcuts) {
  const grid = document.getElementById("shortcuts-grid");
  const empty = document.getElementById("shortcuts-empty");
  grid.innerHTML = "";

  if (shortcuts.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const sc of shortcuts) {
    grid.appendChild(createShortcutCard(sc));
  }
}

function createShortcutCard(sc) {
  const card = document.createElement("div");
  card.className = "service-card";

  const header = document.createElement("div");
  header.className = "card-header";

  // Image / avatar
  const imgWrap = document.createElement("div");
  imgWrap.className = "card-img-wrap";
  if (sc.image_b64) {
    const img = document.createElement("img");
    img.src = sc.image_b64;
    img.alt = sc.title;
    img.className = "card-img";
    img.addEventListener("error", () => {
      imgWrap.innerHTML = "";
      imgWrap.appendChild(makeLetterAvatar(sc.title));
    });
    imgWrap.appendChild(img);
  } else {
    imgWrap.appendChild(makeLetterAvatar(sc.title));
  }

  const info = document.createElement("div");
  info.className = "card-info";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = sc.title;
  info.appendChild(title);
  if (sc.description) {
    const desc = document.createElement("p");
    desc.className = "card-desc";
    desc.textContent = sc.description;
    info.appendChild(desc);
  }

  header.append(imgWrap, info);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const openBtn = document.createElement("a");
  openBtn.href = sc.url;
  openBtn.target = "_blank";
  openBtn.rel = "noopener noreferrer";
  openBtn.className = "btn-primary btn-sm";
  openBtn.textContent = "Öffnen";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn-edit btn-sm";
  editBtn.textContent = "Bearbeiten";
  editBtn.addEventListener("click", () => openShortcutModal(sc));

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn-danger btn-sm";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`"${sc.title}" löschen?`)) return;
    await deleteShortcut(sc.id);
    await refreshShortcuts();
    renderShortcuts(_shortcuts);
    toast("Website gelöscht.");
  });

  actions.append(openBtn, editBtn, delBtn);
  card.append(header, actions);
  return card;
}

// ═══════════════════════════════════════════════════════════════
// Shortcut modal
// ═══════════════════════════════════════════════════════════════

function wireShortcutModal() {
  document.getElementById("add-shortcut-btn").addEventListener("click", () => openShortcutModal(null));
  document.getElementById("shortcut-modal-close").addEventListener("click", closeShortcutModal);
  document.getElementById("shortcut-modal-cancel").addEventListener("click", closeShortcutModal);
  document.querySelector("#shortcut-modal .modal-backdrop").addEventListener("click", closeShortcutModal);

  document.getElementById("sc-image-remove").addEventListener("click", () => {
    document.getElementById("sc-image-preview").classList.add("hidden");
    document.getElementById("sc-image-current").src = "";
    document.getElementById("sc-image").value = "";
  });

  document.getElementById("sc-fetch-favicon").addEventListener("click", async () => {
    const url = document.getElementById("sc-url").value.trim();
    if (!url) { toast("Bitte zuerst eine URL eingeben.", true); return; }
    const favicon = await fetchFavicon(url);
    if (favicon) {
      document.getElementById("sc-image-current").src = favicon;
      document.getElementById("sc-image-preview").classList.remove("hidden");
      toast("Favicon geladen.");
    } else {
      toast("Kein Favicon gefunden.", true);
    }
  });

  document.getElementById("shortcut-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("sc-id").value;
    const title = document.getElementById("sc-title").value.trim();
    const url = document.getElementById("sc-url").value.trim();
    const description = document.getElementById("sc-description").value.trim();

    let image_b64 = id
      ? (_shortcuts.find((s) => s.id === Number(id))?.image_b64 ?? null)
      : null;

    if (document.getElementById("sc-image-preview").classList.contains("hidden")) {
      image_b64 = null;
    } else {
      const currentSrc = document.getElementById("sc-image-current").src;
      if (currentSrc && currentSrc.startsWith("data:")) image_b64 = currentSrc;
    }

    const imgFile = document.getElementById("sc-image").files[0];
    if (imgFile) {
      image_b64 = await imageFileToBase64(imgFile, 256);
    }

    const data = { title, url, description, image_b64 };

    if (id) {
      await updateShortcut(Number(id), data);
      toast("Website aktualisiert.");
    } else {
      data.sort_order = _shortcuts.length;
      data.added_at = new Date().toISOString();
      await addShortcut(data);
      toast("Website gespeichert.");
    }

    closeShortcutModal();
    await refreshShortcuts();
    renderShortcuts(_shortcuts);
  });
}

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

function openShortcutModal(sc) {
  document.getElementById("sc-id").value = sc ? sc.id : "";
  document.getElementById("sc-url").value = sc?.url ?? "";
  document.getElementById("sc-title").value = sc?.title ?? "";
  document.getElementById("sc-description").value = sc?.description ?? "";
  document.getElementById("sc-image").value = "";

  const preview = document.getElementById("sc-image-preview");
  const img = document.getElementById("sc-image-current");
  if (sc?.image_b64) {
    img.src = sc.image_b64;
    preview.classList.remove("hidden");
  } else {
    preview.classList.add("hidden");
    img.src = "";
  }

  document.getElementById("shortcut-modal-title").textContent = sc
    ? "Website bearbeiten"
    : "Website hinzufügen";
  document.getElementById("shortcut-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeShortcutModal() {
  document.getElementById("shortcut-modal").classList.add("hidden");
  document.body.style.overflow = "";
}

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════

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

function toast(text, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

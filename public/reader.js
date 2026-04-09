/**
 * reader.js – epub.js reader UI + PDF opener.
 * Depends on epub.min.js (window.ePub) and db-browser.js.
 */

let _book = null;
let _rendition = null;
let _fontSize = 100; // percent
let _swipeStartX = 0;
let _swipeStartY = 0;
const SWIPE_THRESHOLD = 40;

// ─── Public API ───────────────────────────────────────────────

async function openBook(bookId) {
  const meta = await getBook(bookId);
  if (!meta) return;

  // Update last_read
  await updateBook(bookId, { last_read: Date.now() });

  const arrayBuffer = await loadBookFile(bookId);
  if (!arrayBuffer) {
    alert("Buch-Datei nicht gefunden. Bitte erneut importieren.");
    return;
  }

  if (meta.format === "pdf") {
    openPdf(arrayBuffer, meta.filename);
    return;
  }

  openEpubReader(bookId, meta, arrayBuffer);
}

function closeReader() {
  _destroyEpub();
  document.getElementById("reader-modal").classList.add("hidden");
  document.body.style.overflow = "";
}

// ─── PDF ─────────────────────────────────────────────────────

function openPdf(arrayBuffer, filename) {
  const blob = new Blob([arrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  // On iOS Safari, window.open() works better than click-download
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    // Fallback: trigger download
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ─── EPUB Reader ──────────────────────────────────────────────

async function openEpubReader(bookId, meta, arrayBuffer) {
  _destroyEpub();
  _fontSize = 100;

  const modal = document.getElementById("reader-modal");
  const viewer = document.getElementById("reader-viewer");
  const titleEl = document.getElementById("reader-title");

  titleEl.textContent = meta.title || "Lesen";
  viewer.innerHTML = "";

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  _book = ePub(arrayBuffer.slice(0));
  _rendition = _book.renderTo(viewer, {
    width: viewer.clientWidth || window.innerWidth,
    height: viewer.clientHeight || (window.innerHeight - 52),
    spread: "none",
    minSpreadWidth: 9999,
    flow: "paginated",
  });

  // Restore last position
  if (meta.read_position) {
    await _rendition.display(meta.read_position);
  } else {
    await _rendition.display();
  }

  _applyFontSize();

  // Save position as user navigates
  _rendition.on("relocated", (location) => {
    updateBook(bookId, { read_position: location.start.cfi });
  });

  // Keyboard navigation
  _rendition.on("keyup", (e) => {
    if (e.key === "ArrowRight") _rendition.next();
    if (e.key === "ArrowLeft") _rendition.prev();
  });

  // Touch navigation (works inside epub.js iframe)
  _rendition.on("touchstart", (e) => {
    _swipeStartX = e.changedTouches[0].clientX;
    _swipeStartY = e.changedTouches[0].clientY;
  });
  _rendition.on("touchend", (e) => {
    const dx = _swipeStartX - e.changedTouches[0].clientX;
    const dy = Math.abs(_swipeStartY - e.changedTouches[0].clientY);
    if (Math.abs(dx) > SWIPE_THRESHOLD && dy < 80) {
      if (dx > 0) _rendition.next();
      else _rendition.prev();
    }
  });
}

function _destroyEpub() {
  if (_rendition) { try { _rendition.destroy(); } catch (_) {} _rendition = null; }
  if (_book)      { try { _book.destroy(); }      catch (_) {} _book = null; }
}

// ─── Font size ───────────────────────────────────────────────

function _applyFontSize() {
  if (!_rendition) return;
  _rendition.themes.fontSize(`${_fontSize}%`);
}

function readerFontLarger() {
  _fontSize = Math.min(200, _fontSize + 10);
  _applyFontSize();
}

function readerFontSmaller() {
  _fontSize = Math.max(60, _fontSize - 10);
  _applyFontSize();
}

// ─── Wire up static buttons ───────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("reader-close").addEventListener("click", closeReader);
  document.getElementById("reader-prev").addEventListener("click", () => _rendition?.prev());
  document.getElementById("reader-next").addEventListener("click", () => _rendition?.next());
  document.getElementById("reader-font-minus").addEventListener("click", readerFontSmaller);
  document.getElementById("reader-font-plus").addEventListener("click", readerFontLarger);

  // Close on backdrop click
  document.getElementById("reader-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeReader();
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (document.getElementById("reader-modal").classList.contains("hidden")) return;
    if (e.key === "Escape") closeReader();
    if (e.key === "ArrowRight") _rendition?.next();
    if (e.key === "ArrowLeft") _rendition?.prev();
  });

  // Touch swipe on the modal backdrop (outside iframe)
  const modal = document.getElementById("reader-modal");
  modal.addEventListener("touchstart", (e) => {
    _swipeStartX = e.touches[0].clientX;
    _swipeStartY = e.touches[0].clientY;
  }, { passive: true });
  modal.addEventListener("touchend", (e) => {
    const dx = _swipeStartX - e.changedTouches[0].clientX;
    const dy = Math.abs(_swipeStartY - e.changedTouches[0].clientY);
    if (Math.abs(dx) > SWIPE_THRESHOLD && dy < 80) {
      if (dx > 0) _rendition?.next();
      else _rendition?.prev();
    }
  });
});

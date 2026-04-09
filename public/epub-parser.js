/**
 * epub-parser.js – Extract metadata + cover from EPUB/PDF files.
 * Depends on epub.min.js being loaded (provides window.ePub).
 */

async function parseBookFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "epub") return parseEpub(file);
  if (ext === "pdf") return parsePdf(file);
  throw new Error(`Nicht unterstütztes Format: .${ext}`);
}

async function parseEpub(file) {
  const arrayBuffer = await file.arrayBuffer();

  // ePub() accepts an ArrayBuffer directly
  const book = ePub(arrayBuffer.slice(0));
  await book.ready;

  const meta = book.packaging.metadata;

  let cover_b64 = null;
  try {
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      const res = await fetch(coverUrl);
      const blob = await res.blob();
      cover_b64 = await blobToDataUrl(blob);
    }
  } catch (_) {
    // No cover – fine
  }

  book.destroy();

  return {
    title: (meta.title || "").trim() || file.name.replace(/\.epub$/i, ""),
    authors: meta.creator
      ? [meta.creator].flat().map((a) => a.trim()).filter(Boolean)
      : [],
    cover_b64,
    language: meta.language || "",
    description: meta.description || "",
    format: "epub",
    size: file.size,
    filename: file.name,
    added_at: Date.now(),
    last_read: null,
    read_position: null,
  };
}

async function parsePdf(file) {
  // No metadata extraction for PDFs – use filename as title
  return {
    title: file.name.replace(/\.pdf$/i, ""),
    authors: [],
    cover_b64: null,
    format: "pdf",
    size: file.size,
    filename: file.name,
    added_at: Date.now(),
    last_read: null,
    read_position: null,
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Resize an image data-URL to max 400px on the longest side, return new data-URL */
async function resizeCover(dataUrl, maxSize = 400) {
  if (!dataUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => resolve(dataUrl); // fallback: use original
    img.src = dataUrl;
  });
}

/** Convert a user-chosen image File to a resized base64 cover */
async function imageFileToBase64(file, maxSize = 400) {
  const dataUrl = await blobToDataUrl(file);
  return resizeCover(dataUrl, maxSize);
}

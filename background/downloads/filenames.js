import { DOWNLOADS_SUBDIRECTORY } from "../../shared/constants.js";
import { FALLBACK_EXTENSION, SUPPORTED_EXTENSIONS } from "./constants.js";

const MAX_FILENAME_BASE_LENGTH = 72;

function extensionFromDataUrl(url) {
  const raw = String(url || "").trim();
  const match = raw.match(/^data:([^;,]+)[;,]/i);
  const mimeType = String(match?.[1] || "").toLowerCase();

  if (mimeType.includes("image/jpeg")) {
    return "jpg";
  }
  if (mimeType.includes("image/png")) {
    return "png";
  }
  if (mimeType.includes("image/webp")) {
    return "webp";
  }
  if (mimeType.includes("image/gif")) {
    return "gif";
  }
  if (mimeType.includes("image/svg")) {
    return "svg";
  }
  if (mimeType.includes("image/avif")) {
    return "avif";
  }

  return FALLBACK_EXTENSION;
}

function isNonPathLikeSource(url) {
  const raw = String(url || "").trim().toLowerCase();
  return raw.startsWith("data:") || raw.startsWith("blob:") || raw.startsWith("filesystem:");
}

function trimBaseName(value, fallback = "imatge") {
  const base = sanitizeArchiveSegment(value).slice(0, MAX_FILENAME_BASE_LENGTH);
  return base || fallback;
}

export function getFileExtension(url) {
  if (/^data:/i.test(String(url || "").trim())) {
    return extensionFromDataUrl(url);
  }

  try {
    const parsed = new URL(url);
    const rawName = parsed.pathname.split("/").pop() || "";
    const extension = rawName.includes(".")
      ? rawName.split(".").pop().toLowerCase()
      : "";
    return SUPPORTED_EXTENSIONS.has(extension) ? extension : FALLBACK_EXTENSION;
  } catch {
    return FALLBACK_EXTENSION;
  }
}

export function buildFilename(url, index) {
  const extension = getFileExtension(url);
  if (isNonPathLikeSource(url)) {
    return `captura_${String(index + 1).padStart(2, "0")}.${extension}`;
  }
  return `imatge_${String(index + 1).padStart(2, "0")}.${extension}`;
}

export function buildArchiveFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `imatges_${stamp}.zip`;
}

export function buildCaptureFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `captura_${stamp}.png`;
}

export function buildFullPageCaptureFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `pagina_${stamp}.png`;
}

export function buildBlockCaptureFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `bloc_${stamp}.png`;
}

export function buildUpscaledFilename(url, index, factor) {
  if (isNonPathLikeSource(url)) {
    return `captura_${String(index + 1).padStart(2, "0")}_ampliada_${factor}x.png`;
  }

  try {
    const parsed = new URL(url);
    const rawName = parsed.pathname.split("/").pop() || "";
    const baseName = trimBaseName(rawName.replace(/\.[^.]+$/, ""), `imatge_${index + 1}`);
    return `${String(index + 1).padStart(2, "0")}_${baseName}_ampliada_${factor}x.png`;
  } catch {
    return `imatge_${String(index + 1).padStart(2, "0")}_ampliada_${factor}x.png`;
  }
}

export function buildUpscaledPngFilename(filename, factor) {
  return filename.replace(/\.png$/i, `_ampliada_${factor}x.png`);
}

export function sanitizeArchiveSegment(value) {
  const normalized = value.normalize("NFKD").replace(/[^\x20-\x7e]+/g, "");
  const sanitized = normalized
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .trim();
  return sanitized || "imatge";
}

export function buildArchiveEntryName(url, index) {
  const extension = getFileExtension(url);
  if (isNonPathLikeSource(url)) {
    return `${String(index + 1).padStart(2, "0")}_captura.${extension}`;
  }

  try {
    const parsed = new URL(url);
    const rawName = parsed.pathname.split("/").pop() || "";
    const nameWithoutExtension = rawName.replace(/\.[^.]+$/, "");
    const baseName = trimBaseName(nameWithoutExtension, `imatge_${index + 1}`);
    return `${String(index + 1).padStart(2, "0")}_${baseName}.${extension}`;
  } catch {
    return buildFilename(url, index);
  }
}

export function buildUpscaledArchiveEntryName(url, index, factor) {
  if (isNonPathLikeSource(url)) {
    return `${String(index + 1).padStart(2, "0")}_captura_ampliada_${factor}x.png`;
  }

  try {
    const parsed = new URL(url);
    const rawName = parsed.pathname.split("/").pop() || "";
    const nameWithoutExtension = rawName.replace(/\.[^.]+$/, "");
    const baseName = trimBaseName(nameWithoutExtension, `imatge_${index + 1}`);
    return `${String(index + 1).padStart(2, "0")}_${baseName}_ampliada_${factor}x.png`;
  } catch {
    return buildUpscaledFilename(url, index, factor);
  }
}

export function normalizeDownloadLocationOptions(options = {}) {
  return {
    saveAs: options?.saveAs === true,
  };
}

export function buildDownloadTargetFilename(filename, options = {}) {
  const downloadLocation = normalizeDownloadLocationOptions(options);

  if (downloadLocation.saveAs) {
    return filename;
  }

  return `${DOWNLOADS_SUBDIRECTORY}/${filename}`;
}

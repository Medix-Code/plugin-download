import { DOWNLOADS_SUBDIRECTORY } from "../../shared/constants.js";
import { FALLBACK_EXTENSION, SUPPORTED_EXTENSIONS } from "./constants.js";

export function getFileExtension(url) {
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
  try {
    const parsed = new URL(url);
    const rawName = parsed.pathname.split("/").pop() || "";
    const baseName = sanitizeArchiveSegment(rawName.replace(/\.[^.]+$/, ""));
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

  try {
    const parsed = new URL(url);
    const rawName = parsed.pathname.split("/").pop() || "";
    const nameWithoutExtension = rawName.replace(/\.[^.]+$/, "");
    const baseName = sanitizeArchiveSegment(nameWithoutExtension);
    return `${String(index + 1).padStart(2, "0")}_${baseName}.${extension}`;
  } catch {
    return buildFilename(url, index);
  }
}

export function buildUpscaledArchiveEntryName(url, index, factor) {
  try {
    const parsed = new URL(url);
    const rawName = parsed.pathname.split("/").pop() || "";
    const nameWithoutExtension = rawName.replace(/\.[^.]+$/, "");
    const baseName = sanitizeArchiveSegment(nameWithoutExtension);
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

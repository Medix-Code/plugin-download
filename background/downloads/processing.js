import { debugLog } from "../../shared/logger.js";
import { getErrorMessage } from "../../shared/errors.js";
import {
  buildArchiveEntryName,
  buildFilename,
  buildUpscaledArchiveEntryName,
  buildUpscaledFilename,
} from "./filenames.js";
import { isUpscaleSupportedUrl, normalizeUpscaleOptions } from "./core.js";

export async function fetchBytesViaTab(tabId, url) {
  const targetWorld = /^(blob:|filesystem:)/i.test(String(url || ""))
    ? "MAIN"
    : "ISOLATED";
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: targetWorld,
    func: async (fetchUrl) => {
      try {
        const response = await fetch(fetchUrl, { credentials: "include" });
        if (!response.ok) {
          return { ok: false, status: response.status };
        }
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return {
          ok: true,
          base64: btoa(binary),
          contentType: response.headers.get("content-type") || "",
        };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    args: [url],
  });

  const result = results?.[0]?.result;
  if (!result?.ok) {
    throw new Error(
      `No s'ha pogut llegir ${url} (${result?.status ?? result?.error ?? "error via tab"}).`,
    );
  }

  const binary = atob(result.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const mimeType = result.contentType || "application/octet-stream";
  return new Blob([bytes], { type: mimeType });
}

function extensionFromMimeType(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();

  if (normalized.includes("image/jpeg")) {
    return "jpg";
  }
  if (normalized.includes("image/png")) {
    return "png";
  }
  if (normalized.includes("image/webp")) {
    return "webp";
  }
  if (normalized.includes("image/gif")) {
    return "gif";
  }
  if (normalized.includes("image/svg")) {
    return "svg";
  }
  if (normalized.includes("image/avif")) {
    return "avif";
  }

  return "";
}

function normalizeFilenameByBlobMimeType(filename, blob) {
  const rawName = String(filename || "").trim();
  if (!rawName) {
    return filename;
  }

  const extension = rawName.includes(".")
    ? rawName.split(".").pop()?.toLowerCase() || ""
    : "";

  if (extension !== "bin") {
    return filename;
  }

  const inferredExtension = extensionFromMimeType(blob?.type || "");
  if (!inferredExtension) {
    return filename;
  }

  return rawName.replace(/\.bin$/i, `.${inferredExtension}`);
}

export async function upscaleImageBlob(blob, factor) {
  const bitmap = await createImageBitmap(blob);
  const targetWidth = Math.max(1, Math.round(bitmap.width * factor));
  const targetHeight = Math.max(1, Math.round(bitmap.height * factor));
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close?.();
    throw new Error("No s'ha pogut crear el canvas per fer l'upscale.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close?.();
  return canvas.convertToBlob({ type: "image/png" });
}

export async function buildProcessedDownload(url, index, options = {}) {
  const upscale = normalizeUpscaleOptions(options.upscale);
  const archiveEntry = options.archiveEntry === true;
  const tabId = typeof options.tabId === "number" ? options.tabId : null;

  let sourceBlob;

  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`No s'ha pogut llegir ${url} (${response.status}).`);
    }
    sourceBlob = await response.blob();
  } catch (fetchError) {
    if (tabId !== null) {
      debugLog("fetch directe fallat, intentant via tab", {
        url,
        tabId,
        error: getErrorMessage(fetchError),
      });
      try {
        sourceBlob = await fetchBytesViaTab(tabId, url);
      } catch (tabError) {
        throw new Error(
          `No s'ha pogut llegir ${url}. (${getErrorMessage(tabError)})`,
        );
      }
    } else {
      throw fetchError;
    }
  }

  const canUpscale = upscale.enabled && isUpscaleSupportedUrl(url);
  const finalBlob = canUpscale
    ? await upscaleImageBlob(sourceBlob, upscale.factor)
    : sourceBlob;
  const filename = canUpscale
    ? archiveEntry
      ? buildUpscaledArchiveEntryName(url, index, upscale.factor)
      : buildUpscaledFilename(url, index, upscale.factor)
    : archiveEntry
      ? buildArchiveEntryName(url, index)
      : buildFilename(url, index);
  const normalizedFilename = normalizeFilenameByBlobMimeType(filename, finalBlob);

  return {
    filename: normalizedFilename,
    blob: finalBlob,
    upscaled: canUpscale,
  };
}

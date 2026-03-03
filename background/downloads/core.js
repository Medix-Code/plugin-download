import { getErrorMessage } from "../../shared/errors.js";
import { debugLog, emitPluginLog } from "../../shared/logger.js";
import {
  DOWNLOAD_OBSERVE_TIMEOUT_STANDARD_MS,
  OFFSCREEN_CLEANUP_DELAY_MS,
  UPSCALE_SUPPORTED_EXTENSIONS,
} from "./constants.js";
import {
  buildDownloadTargetFilename,
  getFileExtension,
  normalizeDownloadLocationOptions,
} from "./filenames.js";
import {
  createOffscreenObjectUrlFromBlob,
  revokeOffscreenObjectUrl,
} from "../offscreen.js";

export function normalizeUpscaleOptions(options = {}) {
  const enabled = options?.enabled === true;
  const factor = options?.factor === 4 ? 4 : 2;

  return {
    enabled,
    factor,
  };
}

export function isUpscaleSupportedUrl(url) {
  return UPSCALE_SUPPORTED_EXTENSIONS.has(getFileExtension(url));
}

function isUserCancellationErrorMessage(message = "") {
  const normalized = String(message).toLowerCase();
  return (
    normalized.includes("user canceled") ||
    normalized.includes("cancelled") ||
    normalized.includes("canceled")
  );
}

function requestChromeDownload(downloadOptions) {
  const {
    label: _label,
    sourceKind: _sourceKind,
    cleanupToken: _cleanupToken,
    ...chromeDownloadOptions
  } = downloadOptions;

  return new Promise((resolve, reject) => {
    chrome.downloads.download(chromeDownloadOptions, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (typeof downloadId !== "number") {
        reject(new Error("Chrome no ha retornat cap downloadId."));
        return;
      }

      resolve(downloadId);
    });
  });
}

function searchDownloadById(downloadId) {
  return new Promise((resolve, reject) => {
    chrome.downloads.search({ id: downloadId }, (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(Array.isArray(items) ? items[0] || null : null);
    });
  });
}

function observeDownloadOutcome(downloadId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;

    function finish(status, item) {
      if (settled) return;
      settled = true;
      clearTimeout(timerId);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve({ status, item });
    }

    function onChanged(delta) {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") {
        searchDownloadById(downloadId).then((item) => finish("complete", item));
      } else if (delta.state?.current === "interrupted") {
        searchDownloadById(downloadId).then((item) =>
          finish("interrupted", item),
        );
      }
    }

    chrome.downloads.onChanged.addListener(onChanged);

    searchDownloadById(downloadId).then((item) => {
      if (!item) {
        finish("missing", null);
        return;
      }
      if (item.state === "complete") {
        finish("complete", item);
      } else if (item.state === "interrupted") {
        finish("interrupted", item);
      }
    });

    const timerId = setTimeout(() => {
      searchDownloadById(downloadId).then((item) => finish("timeout", item));
    }, timeoutMs);
  });
}

function buildAttemptList(filename, downloadLocation) {
  const fallbackFilename = buildDownloadTargetFilename(filename, {
    saveAs: false,
  });

  const attempts = [];

  if (downloadLocation.saveAs) {
    attempts.push({
      label: "save_as",
      filename,
      saveAs: true,
    });
  }

  attempts.push({
    label: "subfolder",
    filename: fallbackFilename,
    saveAs: false,
  });

  if (fallbackFilename !== filename) {
    attempts.push({
      label: "root",
      filename,
      saveAs: false,
    });
  }

  return attempts;
}

function scheduleTokenCleanup(token) {
  if (!token) {
    return;
  }

  setTimeout(() => {
    void revokeOffscreenObjectUrl(token);
  }, OFFSCREEN_CLEANUP_DELAY_MS);
}

async function runDownloadAttempts({
  filename,
  operation,
  downloadLocation,
  createSourceForAttempt,
  onBeforeAttempt,
  onAttemptError,
}) {
  const attempts = buildAttemptList(filename, downloadLocation);
  const errors = [];

  for (const attempt of attempts) {
    let source = null;

    try {
      source = await createSourceForAttempt(attempt);

      if (onBeforeAttempt) {
        await onBeforeAttempt({ attempt, source });
      }

      const downloadId = await requestChromeDownload({
        url: source.url,
        filename: attempt.filename,
        conflictAction: "uniquify",
        saveAs: attempt.saveAs,
        sourceKind: source.sourceKind,
        label: attempt.label,
      });

      emitPluginLog("info", "Descarrega iniciada.", {
        downloadId,
        operation,
        attempt: attempt.label,
        filename: attempt.filename,
        sourceKind: source.sourceKind,
      });

      if (attempt.saveAs) {
        emitPluginLog(
          "info",
          "Dialeg de guardar sol-licitat. Si no surt, revisa la configuracio de descàrregues del navegador.",
          {
            operation,
            filename: attempt.filename,
          },
        );
      }

      if (attempt.saveAs) {
        if (errors.length > 0) {
          emitPluginLog("warn", "Descarrega recuperada amb fallback.", {
            operation,
            usedAttempt: attempt.label,
            filename: attempt.filename,
            previousErrors: errors,
          });
        }

        scheduleTokenCleanup(source.cleanupToken);

        return {
          downloadId,
          attempt: attempt.label,
          saveAsUsed: true,
          pendingUserAction: true,
        };
      }

      const timeoutMs = DOWNLOAD_OBSERVE_TIMEOUT_STANDARD_MS;
      const outcome = await observeDownloadOutcome(downloadId, timeoutMs);

      if (outcome.status === "complete") {
        emitPluginLog("info", "Descarrega completada.", {
          downloadId,
          operation,
          attempt: attempt.label,
          filename: attempt.filename,
          sourceKind: source.sourceKind,
        });
      } else if (outcome.status === "interrupted") {
        throw new Error(
          `Descarrega interrompuda (${outcome.item?.error || "interrupted"}).`,
        );
      } else if (outcome.status === "missing") {
        throw new Error("No s'ha trobat la descarrega iniciada.");
      } else if (outcome.status === "timeout") {
        const bytesReceived = Number(outcome.item?.bytesReceived || 0);

        if (bytesReceived <= 0) {
          throw new Error("La descarrega no avanca (timeout).");
        }

        emitPluginLog(
          "warn",
          "Descarrega en curs (sense confirmacio final immediata).",
          {
            downloadId,
            operation,
            attempt: attempt.label,
            filename: attempt.filename,
            sourceKind: source.sourceKind,
            bytesReceived,
          },
        );
      }

      if (errors.length > 0) {
        emitPluginLog("warn", "Descarrega recuperada amb fallback.", {
          operation,
          usedAttempt: attempt.label,
          filename: attempt.filename,
          previousErrors: errors,
        });
      }

      scheduleTokenCleanup(source.cleanupToken);

      return {
        downloadId,
        attempt: attempt.label,
        saveAsUsed: attempt.saveAs,
      };
    } catch (error) {
      if (source?.cleanupNow) {
        await source.cleanupNow();
      }

      const message = getErrorMessage(error);
      errors.push(`${attempt.label}: ${message}`);
      const wasUserCancellation = isUserCancellationErrorMessage(message);

      emitPluginLog(wasUserCancellation ? "warn" : "error", "Error iniciant descarrega.", {
        operation,
        attempt: attempt.label,
        filename: attempt.filename,
        saveAs: attempt.saveAs,
        message,
      });

      if (onAttemptError) {
        await onAttemptError({ attempt, source, error });
      }

      if (wasUserCancellation) {
        throw new Error("Has cancel-lat la finestra de guardar.");
      }
    }
  }

  throw new Error(errors.join(" | "));
}

function focusWindowIfPossible(windowId) {
  if (!Number.isInteger(windowId)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    chrome.windows.update(windowId, { focused: true }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

export async function downloadFromUrlWithFallback(url, filename, options = {}) {
  const downloadLocation = normalizeDownloadLocationOptions(options);
  const operation = options.operation || "Descarrega";
  const sourceKind = options.sourceKind || "direct";
  const cleanupToken = options.cleanupToken || null;
  const windowId = Number.isInteger(options.windowId) ? options.windowId : null;

  const result = await runDownloadAttempts({
    filename,
    operation,
    downloadLocation,
    onBeforeAttempt: async ({ attempt }) => {
      if (attempt.saveAs) {
        await focusWindowIfPossible(windowId);
      }
    },
    createSourceForAttempt: async () => ({
      url,
      sourceKind,
      cleanupToken,
    }),
  });

  if (cleanupToken) {
    scheduleTokenCleanup(cleanupToken);
  }

  return result;
}

export async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return `data:${blob.type};base64,${btoa(binary)}`;
}

export async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

export async function downloadBlobWithFallback(blob, filename, options = {}) {
  const downloadLocation = normalizeDownloadLocationOptions(options);
  const operation = options.operation || "Descarrega";
  const windowId = Number.isInteger(options.windowId) ? options.windowId : null;

  return runDownloadAttempts({
    filename,
    operation,
    downloadLocation,
    onBeforeAttempt: async ({ attempt }) => {
      if (attempt.saveAs) {
        await focusWindowIfPossible(windowId);
      }
    },
    createSourceForAttempt: async (attempt) => {
      try {
        const offscreenObject = await createOffscreenObjectUrlFromBlob(blob);
        return {
          url: offscreenObject.objectUrl,
          sourceKind: "generated_blob",
          cleanupToken: offscreenObject.token,
          cleanupNow: async () => {
            await revokeOffscreenObjectUrl(offscreenObject.token);
          },
        };
      } catch (error) {
        debugLog("offscreen no disponible, fallback a data URL", {
          message: getErrorMessage(error),
        });
        return {
          url: await blobToDataUrl(blob),
          sourceKind: "generated_data_url",
        };
      }
    },
  });
}

export function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

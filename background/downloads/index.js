import { emitPluginLog } from "../../shared/logger.js";
import { getErrorMessage } from "../../shared/errors.js";
import {
  buildArchiveFilename,
  buildBlockCaptureFilename,
  buildCaptureFilename,
  buildFilename,
  buildFullPageCaptureFilename,
  buildUpscaledPngFilename,
  normalizeDownloadLocationOptions,
} from "./filenames.js";
import {
  dataUrlToBlob,
  downloadBlobWithFallback,
  downloadFromUrlWithFallback,
  normalizeUpscaleOptions,
} from "./core.js";
import { createZipArchive } from "./zip.js";
import { buildProcessedDownload, upscaleImageBlob } from "./processing.js";

export {
  buildBlockCaptureFilename,
  buildCaptureFilename,
  buildFullPageCaptureFilename,
  normalizeUpscaleOptions,
};

async function queueIndividualDownloads(urls, options = {}) {
  for (const [index, url] of urls.entries()) {
    await downloadFromUrlWithFallback(url, buildFilename(url, index), options);
  }
}

export async function downloadCaptureBlob(blob, filename, options = {}) {
  const upscale = normalizeUpscaleOptions(options.upscale);
  const downloadLocation = normalizeDownloadLocationOptions(options);
  const operation = options.operation || "Captura";

  if (upscale.enabled) {
    const upscaledBlob = await upscaleImageBlob(blob, upscale.factor);
    const upscaledFilename = buildUpscaledPngFilename(filename, upscale.factor);
    await downloadBlobWithFallback(upscaledBlob, upscaledFilename, {
      ...downloadLocation,
      operation,
      windowId: options.windowId,
    });
    return {
      upscaled: true,
      factor: upscale.factor,
      filename: upscaledFilename,
    };
  }

  await downloadBlobWithFallback(blob, filename, {
    ...downloadLocation,
    operation,
    windowId: options.windowId,
  });
  return {
    upscaled: false,
    factor: upscale.factor,
    filename,
  };
}

export async function downloadCaptureDataUrl(dataUrl, filename, options = {}) {
  const blob = await dataUrlToBlob(dataUrl);
  return downloadCaptureBlob(blob, filename, options);
}

export async function downloadImages(urls, options = {}) {
  const preferArchive = options.preferArchive !== false;
  const upscale = normalizeUpscaleOptions(options.upscale);
  const downloadLocation = normalizeDownloadLocationOptions(options);
  const operation = options.operation || "Descarregar imatges";
  const tabId = typeof options.tabId === "number" ? options.tabId : null;
  const windowId = typeof options.windowId === "number" ? options.windowId : null;

  if (urls.length > 1 && preferArchive) {
    try {
      const entries = [];
      let upscaledCount = 0;

      for (const [index, url] of urls.entries()) {
        const processed = await buildProcessedDownload(url, index, {
          archiveEntry: true,
          upscale,
          tabId,
        });

        entries.push({
          name: processed.filename,
          bytes: new Uint8Array(await processed.blob.arrayBuffer()),
        });

        if (processed.upscaled) {
          upscaledCount += 1;
        }
      }

      const archiveFilename = buildArchiveFilename();
      const archiveBlob = createZipArchive(entries);
      await downloadBlobWithFallback(archiveBlob, archiveFilename, {
        ...downloadLocation,
        operation,
        windowId,
      });
      return {
        count: urls.length,
        mode: "zip",
        filename: archiveFilename,
        upscaledCount,
      };
    } catch (error) {
      emitPluginLog("error", "No s'ha pogut crear el ZIP.", {
        operation,
        count: urls.length,
        message: getErrorMessage(error),
      });
      throw new Error(`No s'ha pogut crear el ZIP. ${getErrorMessage(error)}`);
    }
  }

  if (urls.length === 1 && upscale.enabled) {
    try {
      const processed = await buildProcessedDownload(urls[0], 0, {
        archiveEntry: false,
        upscale,
        tabId,
      });
      await downloadBlobWithFallback(processed.blob, processed.filename, {
        ...downloadLocation,
        operation,
        windowId,
      });
      return {
        count: 1,
        mode: "individual",
        upscaledCount: processed.upscaled ? 1 : 0,
      };
    } catch (error) {
      emitPluginLog(
        "error",
        "Error fent l'ampliacio local; fallback a l'original.",
        {
          operation,
          message: getErrorMessage(error),
          url: urls[0],
        },
      );
      await queueIndividualDownloads(urls, {
        ...downloadLocation,
        operation,
        windowId,
      });
      return {
        count: 1,
        mode: "individual",
        fallbackFromUpscale: true,
        upscaleError: getErrorMessage(error),
        upscaledCount: 0,
      };
    }
  }

  await queueIndividualDownloads(urls, {
    ...downloadLocation,
    operation,
    windowId,
  });
  return {
    count: urls.length,
    mode: "individual",
    upscaledCount: 0,
  };
}

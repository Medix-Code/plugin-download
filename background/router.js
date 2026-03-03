import { ACTIONS, hasAction, isInteger, isObject } from "../shared/messages.js";
import { debugError, debugLog, emitPluginLog } from "../shared/logger.js";
import { getErrorMessage } from "../shared/errors.js";
import { downloadImages } from "./downloads/index.js";
import {
  captureVisibleTabAndDownload,
  injectElementSelectionOverlay,
  notifyElementCaptureCancelled,
  runElementCaptureSelection,
  runFullPageCapture,
  focusTabWindow,
} from "./capture/index.js";
import {
  buildExpandedPopupUrl,
  createFallbackExpandedWindow,
  createMaximizedExpandedWindow,
} from "./windows/index.js";

function hasValidSelection(message) {
  const selection = message?.selection;
  return (
    isObject(selection) &&
    Number.isFinite(selection.left) &&
    Number.isFinite(selection.top) &&
    Number.isFinite(selection.width) &&
    Number.isFinite(selection.height) &&
    Number.isFinite(selection.viewportWidth) &&
    Number.isFinite(selection.viewportHeight)
  );
}

export function startBackgroundRouter() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (hasAction(message, ACTIONS.DOWNLOAD_IMAGES) && Array.isArray(message.urls)) {
      debugLog("missatge downloadImages", {
        count: message.urls.length,
        preferArchive: message.preferArchive !== false,
      });

      downloadImages(message.urls, {
        preferArchive: message.preferArchive !== false,
        saveAs: message.saveAs === true,
        operation: "Descarregar imatges",
        upscale: message.upscale,
        tabId: isInteger(message.tabId) ? message.tabId : null,
        windowId: isInteger(message.windowId) ? message.windowId : null,
      })
        .then((result) => {
          sendResponse({
            ok: true,
            count: result.count,
            mode: result.mode,
            filename: result.filename,
            fallbackFromArchive: Boolean(result.fallbackFromArchive),
            archiveError: result.archiveError,
            fallbackFromUpscale: Boolean(result.fallbackFromUpscale),
            upscaleError: result.upscaleError,
            upscaledCount: result.upscaledCount || 0,
          });
        })
        .catch((error) => {
          emitPluginLog("error", "Error a downloadImages.", {
            message: getErrorMessage(error),
          });
          sendResponse({ ok: false, error: error.message });
        });

      return true;
    }

    if (hasAction(message, ACTIONS.CAPTURE_VISIBLE_TAB) && isInteger(message.windowId)) {
      debugLog("missatge captureVisibleTab", {
        windowId: message.windowId,
        saveAs: message.saveAs === true,
        upscale: message.upscale,
      });

      captureVisibleTabAndDownload(message.windowId, {
        saveAs: message.saveAs === true,
        operation: "Captura vista",
        upscale: message.upscale,
      })
        .then((result) => {
          sendResponse({
            ok: true,
            count: 1,
            upscaled: result.upscaled,
            upscaleFactor: result.factor,
          });
        })
        .catch((error) => {
          emitPluginLog("error", "Error a Captura vista.", {
            message: getErrorMessage(error),
          });
          sendResponse({ ok: false, error: error.message });
        });

      return true;
    }

    if (
      hasAction(message, ACTIONS.CAPTURE_FULL_PAGE) &&
      isInteger(message.tabId) &&
      isInteger(message.windowId)
    ) {
      debugLog("missatge captureFullPage", {
        tabId: message.tabId,
        windowId: message.windowId,
        hideFixedSticky: message.hideFixedSticky !== false,
        saveAs: message.saveAs === true,
        upscale: message.upscale,
      });

      runFullPageCapture(message.tabId, message.windowId, {
        hideFixedSticky: message.hideFixedSticky !== false,
        saveAs: message.saveAs === true,
        operation: "Captura pagina",
        upscale: message.upscale,
      })
        .then((result) => {
          sendResponse({
            ok: true,
            count: 1,
            segments: result.segmentCount,
            retries: result.retries,
            skippedDuplicatePositions: result.skippedDuplicatePositions,
            upscaled: result.upscaled,
            upscaleFactor: result.upscaleFactor,
          });
        })
        .catch((error) => {
          emitPluginLog("error", "Error a Captura pagina.", {
            message: getErrorMessage(error),
          });
          sendResponse({ ok: false, error: error.message });
        });

      return true;
    }

    if (
      hasAction(message, ACTIONS.START_ELEMENT_CAPTURE_FLOW) &&
      isInteger(message.tabId)
    ) {
      debugLog("missatge startElementCaptureFlow", {
        tabId: message.tabId,
        windowId: message.windowId,
        saveAs: message.saveAs === true,
        upscale: message.upscale,
      });

      injectElementSelectionOverlay(message.tabId, {
        saveAs: message.saveAs === true,
        upscale: message.upscale,
      })
        .then(() => {
          if (isInteger(message.windowId)) {
            return focusTabWindow(message.tabId, message.windowId);
          }
          return undefined;
        })
        .then(() => {
          debugLog("captura bloc preparada, esperant clic d'usuari");
          sendResponse({ ok: true, started: true });
        })
        .catch((error) => {
          emitPluginLog("error", "Error iniciant Captura bloc.", {
            message: getErrorMessage(error),
          });
          sendResponse({ ok: false, error: error.message });
        });

      return true;
    }

    if (hasAction(message, ACTIONS.ELEMENT_SELECTED_FOR_CAPTURE)) {
      debugLog("missatge elementSelectedForCapture", {
        cancelled: Boolean(message.cancelled),
        hasSelection: Boolean(message.selection),
        tabId: sender.tab?.id,
        saveAs: message.saveAs === true,
        upscale: message.upscale,
      });

      if (message.cancelled) {
        if (sender.tab?.id && sender.tab.windowId) {
          notifyElementCaptureCancelled(sender.tab.id, sender.tab.windowId);
        }

        sendResponse({ ok: true, cancelled: true });
        return false;
      }

      if (!hasValidSelection(message) || !sender.tab?.id || !sender.tab.windowId) {
        sendResponse({ ok: true, cancelled: true });
        return false;
      }

      runElementCaptureSelection(
        sender.tab.id,
        sender.tab.windowId,
        message.selection,
        {
          saveAs: message.saveAs === true,
          operation: "Captura bloc",
          upscale: message.upscale,
          windowId: sender.tab.windowId,
        },
      )
        .then((result) => {
          sendResponse({
            ok: true,
            upscaled: result.upscaled,
            upscaleFactor: result.factor,
          });
        })
        .catch((error) => {
          emitPluginLog("error", "Error capturant el bloc.", {
            message: getErrorMessage(error),
          });
          chrome.runtime.sendMessage(
            {
              action: ACTIONS.ELEMENT_CAPTURE_STATUS,
              status: {
                tabId: sender.tab.id,
                windowId: sender.tab.windowId,
                phase: "error",
                error: error.message,
              },
            },
            () => {
              void chrome.runtime.lastError;
            },
          );
          sendResponse({ ok: false, error: error.message });
        });

      return true;
    }

    if (
      hasAction(message, ACTIONS.OPEN_EXPANDED_POPUP) &&
      isInteger(message.tabId) &&
      isInteger(message.windowId)
    ) {
      const popupUrl = buildExpandedPopupUrl(message.tabId, message.windowId, {
        hideFixedSticky: message.hideFixedSticky !== false,
        upscaleEnabled: message.upscaleEnabled === true,
        upscaleFactor: message.upscaleFactor === 4 ? 4 : 2,
        saveAs: message.saveAs === true,
      });

      createMaximizedExpandedWindow({
        url: popupUrl,
      })
        .catch((error) => {
          debugError(
            "no s'ha pogut obrir maximitzada, fallback a finestra gran",
            error,
          );
          return createFallbackExpandedWindow({
            url: popupUrl,
          });
        })
        .then((createdWindow) => {
          debugLog("finestra gran oberta", {
            windowId: createdWindow.id,
            state: createdWindow.state,
          });
          sendResponse({
            ok: true,
            windowId: createdWindow.id,
            state: createdWindow.state || "normal",
          });
        })
        .catch((error) => {
          emitPluginLog("error", "Error obrint la finestra gran.", {
            message: getErrorMessage(error),
          });
          sendResponse({
            ok: false,
            error: error.message,
          });
        });

      return true;
    }

    return false;
  });
}

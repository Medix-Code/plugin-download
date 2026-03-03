import { ACTIONS } from "../shared/messages.js";

export function registerRuntimeEvents(state, elements, renderer, logs) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === ACTIONS.PLUGIN_LOG_ENTRY && message.entry) {
      logs.register(message.entry);
      return;
    }

    if (message?.action === ACTIONS.FULL_PAGE_CAPTURE_PROGRESS) {
      const progress = message.progress;

      if (
        !progress ||
        (Number.isInteger(state.sourceTabId) &&
          progress.tabId !== state.sourceTabId) ||
        (Number.isInteger(state.sourceWindowId) &&
          progress.windowId !== state.sourceWindowId)
      ) {
        return;
      }

      if (progress.phase === "started") {
        state.fullPageCaptureId = progress.captureId;
        renderer.setFullPageProgress(progress);
        return;
      }

      if (
        state.fullPageCaptureId &&
        progress.captureId !== state.fullPageCaptureId
      ) {
        return;
      }

      renderer.setFullPageProgress(progress);

      if (progress.phase === "done" || progress.phase === "error") {
        state.fullPageCaptureId = null;
      }
      return;
    }

    if (message?.action !== ACTIONS.ELEMENT_CAPTURE_STATUS) {
      return;
    }

    const captureStatus = message.status;

    if (
      !captureStatus ||
      (Number.isInteger(state.sourceTabId) &&
        captureStatus.tabId !== state.sourceTabId) ||
      (Number.isInteger(state.sourceWindowId) &&
        captureStatus.windowId !== state.sourceWindowId)
    ) {
      return;
    }

    state.elementCaptureInProgress = false;
    elements.captureElementButton.disabled = false;

    if (captureStatus.phase === "cancelled") {
      elements.statusMessage.textContent = "Captura de bloc cancel-lada.";
      return;
    }

    if (captureStatus.phase === "done") {
      elements.statusMessage.textContent = "Bloc capturat i guardat.";
      return;
    }

    if (captureStatus.phase === "error") {
      elements.statusMessage.textContent =
        captureStatus.error || "No s'ha pogut guardar la captura de bloc.";
      logs.push("error", elements.statusMessage.textContent, {
        message: captureStatus.error || "",
      });
    }
  });
}

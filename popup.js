import { debugLog } from "./shared/logger.js";
import { elements, queryParamFlags, urlParams } from "./popup/dom.js";
import { initializeStateFromUrl, state } from "./popup/state.js";
import {
  applyInitialSettingsToDom,
  loadSavedSettings,
  saveSettings,
  updateDownloadLocationUi,
} from "./popup/settings.js";
import { createLogsController } from "./popup/logs.js";
import { createRenderer } from "./popup/render.js";
import { createPopupActions } from "./popup/actions.js";
import { registerRuntimeEvents } from "./popup/runtime-events.js";

initializeStateFromUrl(urlParams);
applyInitialSettingsToDom(state, elements);

const logs = createLogsController(state, elements);
const renderer = createRenderer(state, elements);
const actions = createPopupActions(state, elements, renderer, logs);

registerRuntimeEvents(state, elements, renderer, logs);

elements.hideFixedStickyCheckbox.addEventListener("change", () => {
  state.hideFixedSticky = elements.hideFixedStickyCheckbox.checked;
  saveSettings(elements, logs);
});

elements.selectAllButton.addEventListener("click", () => {
  const nextSelectedUrls = new Set(state.selectedUrls);

  for (const image of renderer.getVisibleImages()) {
    nextSelectedUrls.add(image.url);
  }

  state.selectedUrls = nextSelectedUrls;
  renderer.renderAll();
});

elements.clearButton.addEventListener("click", () => {
  const visibleUrls = new Set(renderer.getVisibleImages().map((image) => image.url));
  state.selectedUrls = new Set(
    Array.from(state.selectedUrls).filter((url) => !visibleUrls.has(url)),
  );
  renderer.renderAll();
});

elements.downloadButton.addEventListener("click", () => {
  actions.downloadSelected();
});

elements.openWindowButton.addEventListener("click", () => {
  actions.openExpandedWindow();
});

elements.captureElementButton.addEventListener("click", () => {
  actions.startElementCaptureFlow();
});

elements.analyzeElementButton.addEventListener("click", () => {
  actions.analyzeElement();
});

elements.refreshButton.addEventListener("click", () => {
  actions.loadImages();
});

elements.paginationPrevButton.addEventListener("click", () => {
  state.currentPage = Math.max(1, state.currentPage - 1);
  renderer.renderAll();
});

elements.paginationNextButton.addEventListener("click", () => {
  state.currentPage += 1;
  renderer.renderAll();
});

elements.clearLogsButton.addEventListener("click", () => {
  logs.clear();
});

elements.closePreviewButton.addEventListener("click", () => {
  renderer.closePreview();
});

elements.copyAnalysisButton.addEventListener("click", () => {
  actions.copyElementAnalysis();
});

elements.saveAnalysisButton.addEventListener("click", () => {
  actions.saveElementAnalysis();
});

elements.clearAnalysisButton.addEventListener("click", () => {
  actions.clearElementAnalysis();
});

elements.previewModal.addEventListener("click", (event) => {
  if (event.target === elements.previewModal) {
    renderer.closePreview();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.previewModal.hidden) {
    renderer.closePreview();
  }
});

Promise.allSettled([
  loadSavedSettings(state, elements, queryParamFlags, logs),
  logs.load(),
]).finally(() => {
  updateDownloadLocationUi(state, elements);
  renderer.clearElementAnalysis();
  state.currentPage = 1;
  debugLog("popup bootstrap complet");
  actions.loadImages();
});

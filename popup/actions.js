import { ACTIONS } from "../shared/messages.js";
import { debugError, debugLog } from "../shared/logger.js";
import { getErrorMessage } from "../shared/errors.js";
import { DOWNLOADS_SUBDIRECTORY } from "../shared/constants.js";
import { getFilteredImages } from "./filters.js";
import { collectImagesFromPage } from "./injected/collect-images.js";
import { selectAndAnalyzeElement } from "./injected/analyze-element.js";

export function createPopupActions(state, elements, renderer, logs) {
  function isTransparentColor(value) {
    const normalized = String(value || "")
      .replace(/\s+/g, "")
      .toLowerCase();
    return (
      normalized === "transparent" ||
      normalized === "rgba(0,0,0,0)" ||
      normalized === "rgba(255,255,255,0)"
    );
  }

  function pickStyleValue(key, value) {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    if (key === "backgroundImage" && trimmed === "none") {
      return null;
    }

    if ((key === "color" || key === "backgroundColor") && isTransparentColor(trimmed)) {
      return null;
    }

    if (key === "borderRadius" && trimmed === "0px") {
      return null;
    }

    if (key === "boxShadow" && trimmed === "none") {
      return null;
    }

    if (key === "opacity" && trimmed === "1") {
      return null;
    }

    if (key === "letterSpacing" && trimmed === "normal") {
      return null;
    }

    if (key === "textTransform" && trimmed === "none") {
      return null;
    }

    if (key === "textAlign" && trimmed === "start") {
      return null;
    }

    return trimmed;
  }

  function compactElementAnalysis(rawAnalysis) {
    const element = rawAnalysis?.element || {};
    const styles = rawAnalysis?.styles || {};
    const assets = rawAnalysis?.assets || {};
    const typography = rawAnalysis?.typography || {};
    const textPreview = String(element.textPreview || "").trim();
    const sampleTexts = Array.isArray(typography.sampleTexts)
      ? typography.sampleTexts.filter(Boolean).slice(0, 6)
      : [];
    const hasText = textPreview.length > 0 || sampleTexts.length > 0;

    const summary = {
      capturedAt: rawAnalysis?.capturedAt || new Date().toISOString(),
      page: {
        url: rawAnalysis?.page?.url || "",
        title: rawAnalysis?.page?.title || "",
      },
      element: {
        tagName: element.tagName || "",
        selector: element.selector || "",
        rect: element.rect || {},
      },
    };

    if (element.id) {
      summary.element.id = element.id;
    }

    if (element.className) {
      summary.element.className = element.className;
    }

    if (hasText) {
      summary.content = {};

      if (textPreview) {
        summary.content.textPreview = textPreview;
      }

      if (sampleTexts.length > 0) {
        summary.content.sampleTexts = sampleTexts;
      }
    }

    const compactAssets = {};
    const imageUrls = Array.isArray(assets.imageUrls)
      ? assets.imageUrls.filter(Boolean).slice(0, 12)
      : [];
    const backgroundImageUrls = Array.isArray(assets.backgroundImageUrls)
      ? assets.backgroundImageUrls.filter(Boolean).slice(0, 12)
      : [];

    if (imageUrls.length > 0) {
      compactAssets.imageUrls = imageUrls;
    }

    if (backgroundImageUrls.length > 0) {
      compactAssets.backgroundImageUrls = backgroundImageUrls;
    }

    if (assets.hasGradientBackground === true) {
      compactAssets.hasGradientBackground = true;
    }

    if (Object.keys(compactAssets).length > 0) {
      summary.assets = compactAssets;
    }

    const styleKeys = [
      "color",
      "backgroundColor",
      "backgroundImage",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      "textTransform",
      "textAlign",
      "borderRadius",
      "boxShadow",
      "opacity",
    ];
    const compactStyles = {};

    for (const key of styleKeys) {
      const value = pickStyleValue(key, styles[key]);
      if (value) {
        compactStyles[key] = value;
      }
    }

    if (Object.keys(compactStyles).length > 0) {
      summary.styles = compactStyles;
    }

    if (hasText) {
      const compactTypography = {};
      const fontFamilies = Array.isArray(typography.fontFamilies)
        ? typography.fontFamilies.filter(Boolean).slice(0, 8)
        : [];
      const fontSizes = Array.isArray(typography.fontSizes)
        ? typography.fontSizes.filter(Boolean).slice(0, 8)
        : [];
      const fontWeights = Array.isArray(typography.fontWeights)
        ? typography.fontWeights.filter(Boolean).slice(0, 8)
        : [];
      const textColors = Array.isArray(typography.textColors)
        ? typography.textColors.filter((value) => !isTransparentColor(value)).slice(0, 8)
        : [];

      if (fontFamilies.length > 0) {
        compactTypography.fontFamilies = fontFamilies;
      }

      if (fontSizes.length > 0) {
        compactTypography.fontSizes = fontSizes;
      }

      if (fontWeights.length > 0) {
        compactTypography.fontWeights = fontWeights;
      }

      if (textColors.length > 0) {
        compactTypography.textColors = textColors;
      }

      if (Object.keys(compactTypography).length > 0) {
        summary.typography = compactTypography;
      }
    }

    return summary;
  }

  function buildAnalysisFilename() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${DOWNLOADS_SUBDIRECTORY}/analisi_bloc_${stamp}.json`;
  }

  function getAnalysisPayload() {
    if (!state.elementAnalysis) {
      return null;
    }

    return JSON.stringify(state.elementAnalysis, null, 2);
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  async function getSourceTab() {
    if (Number.isInteger(state.sourceTabId)) {
      return chrome.tabs.get(state.sourceTabId);
    }

    return getActiveTab();
  }

  async function getSourceContext() {
    const tab = await getSourceTab();

    if (!tab?.id || !Number.isInteger(tab.windowId)) {
      throw new Error("No s'ha pogut detectar la pestanya activa.");
    }

    state.sourceTabId = tab.id;
    state.sourceWindowId = tab.windowId;
    state.sourceTabUrl = tab.url || "";
    renderer.updateSourceSite(state.sourceTabUrl);
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url || "",
    };
  }

  async function loadImages() {
    elements.statusMessage.textContent = "Escanejant la pestanya actual...";
    elements.imageList.replaceChildren();
    elements.downloadButton.disabled = true;

    try {
      const { tabId } = await getSourceContext();

      const [{ result: images = [] } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        func: collectImagesFromPage,
      });

      state.images = images;
      state.selectedUrls = new Set(images.map((image) => image.url));
      state.analyzedImageUrls = new Set();
      state.activeExtension = "all";
      state.activeSizeKey = "all";
      state.activeScope = "all";
      state.currentPage = 1;
      renderer.clearElementAnalysis();
      elements.statusMessage.textContent = `${images.length} imatges trobades a la pestanya actual.`;
      renderer.renderAll();
    } catch (error) {
      state.images = [];
      state.selectedUrls = new Set();
      state.analyzedImageUrls = new Set();
      state.activeExtension = "all";
      state.activeSizeKey = "all";
      state.activeScope = "all";
      state.currentPage = 1;
      renderer.clearElementAnalysis();
      elements.statusMessage.textContent =
        "No s'ha pogut llegir aquesta pestanya. Prova una web normal, no chrome://.";
      renderer.renderAll();
      debugError("error carregant les imatges", error);
      logs.reportError("No s'ha pogut llegir aquesta pestanya.", error);
    }
  }

  async function downloadSelected() {
    const urls = state.images
      .map((image) => image.url)
      .filter((url) => state.selectedUrls.has(url));

    if (urls.length === 0) {
      return;
    }

    elements.downloadButton.disabled = true;
    const shouldUseArchive = urls.length > 1;
    const preferArchive = shouldUseArchive;

    elements.statusMessage.textContent = shouldUseArchive
      ? `Preparant ZIP de ${urls.length} imatges...`
      : "Descarregant la imatge seleccionada...";

    try {
      const sourceContext = await getSourceContext();
      const response = await chrome.runtime.sendMessage({
        action: ACTIONS.DOWNLOAD_IMAGES,
        urls,
        preferArchive,
        saveAs: false,
        upscale: {
          enabled: false,
          factor: 2,
        },
        tabId: sourceContext.tabId,
        windowId: sourceContext.windowId,
      });

      if (!response?.ok) {
        throw new Error(
          response?.error || "No s'ha pogut iniciar la descarrega.",
        );
      }

      const count = response.count ?? urls.length;

      if (response.mode === "zip") {
        elements.statusMessage.textContent = `ZIP preparat amb ${count} imatges.`;
      } else if (count === 1) {
        elements.statusMessage.textContent = "Imatge enviada a descarrega.";
      } else {
        elements.statusMessage.textContent = `${count} imatges enviades a descarrega.`;
      }
    } catch (error) {
      elements.statusMessage.textContent =
        error instanceof Error && error.message
          ? error.message
          : "Hi ha hagut un error iniciant les descarregues.";
      debugError("error descarregant la seleccio", error);
      logs.push("error", elements.statusMessage.textContent, {
        message: getErrorMessage(error),
        count: urls.length,
      });
    } finally {
      renderer.updateSelectionCount();
    }
  }

  async function startElementCaptureFlow() {
    debugLog("startElementCaptureFlow: inici");
    elements.captureElementButton.disabled = true;
    elements.statusMessage.textContent =
      "Ara clica un bloc de la pagina per guardar-lo com a PNG.";

    try {
      const { tabId, windowId } = await getSourceContext();

      const response = await chrome.runtime.sendMessage({
        action: ACTIONS.START_ELEMENT_CAPTURE_FLOW,
        tabId,
        windowId,
        saveAs: false,
        upscale: {
          enabled: false,
          factor: 2,
        },
      });

      if (!response?.ok) {
        throw new Error(
          response?.error || "No s'ha pogut iniciar la captura del bloc.",
        );
      }

      state.elementCaptureInProgress = true;
      debugLog("startElementCaptureFlow: preparat, mantenint finestra oberta");
      elements.statusMessage.textContent =
        "Mode captura actiu. Clica un bloc de la pagina o prem Esc per cancel-lar. La finestra del plugin es mantindra oberta.";
    } catch (error) {
      state.elementCaptureInProgress = false;
      elements.captureElementButton.disabled = false;
      elements.statusMessage.textContent =
        error instanceof Error && error.message
          ? error.message
          : "No s'ha pogut iniciar la captura del bloc.";
      debugError("error iniciant la captura del bloc", error);
      logs.reportError(elements.statusMessage.textContent, error);
    }
  }

  async function openExpandedWindow() {
    debugLog("openExpandedWindow: inici");
    elements.openWindowButton.disabled = true;

    try {
      const { tabId, windowId } = await getSourceContext();
      const response = await chrome.runtime.sendMessage({
        action: ACTIONS.OPEN_EXPANDED_POPUP,
        tabId,
        windowId,
        hideFixedSticky: elements.hideFixedStickyCheckbox.checked,
        upscaleEnabled: false,
        upscaleFactor: 2,
        saveAs: false,
      });

      if (!response?.ok) {
        throw new Error(
          response?.error || "No s'ha pogut obrir la finestra gran.",
        );
      }

      debugLog("openExpandedWindow: ok");
      window.close();
    } catch (error) {
      elements.openWindowButton.disabled = false;
      elements.statusMessage.textContent = "No s'ha pogut obrir la finestra gran.";
      debugError("error obrint la finestra gran", error);
      logs.reportError("No s'ha pogut obrir la finestra gran.", error);
    }
  }

  async function analyzeElement() {
    debugLog("analyzeElement: inici");
    elements.analyzeElementButton.disabled = true;
    elements.statusMessage.textContent =
      "Analisi activa. Clica un bloc de la pagina o prem Esc per cancel-lar.";

    try {
      const { tabId } = await getSourceContext();
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        func: selectAndAnalyzeElement,
      });

      if (!result || result.cancelled) {
        elements.statusMessage.textContent = "Analisi de bloc cancel-lada.";
        return;
      }

      if (result.error) {
        throw new Error(result.error);
      }

      if (!result.analysis) {
        throw new Error("No s'ha pogut analitzar el bloc seleccionat.");
      }

      const compactAnalysis = compactElementAnalysis(result.analysis);
      const analysisAssets = compactAnalysis.assets || {};
      const analysisUrls = new Set([
        ...(analysisAssets.imageUrls || []),
        ...(analysisAssets.backgroundImageUrls || []),
      ]);
      const knownUrls = new Set(state.images.map((image) => image.url));
      const nextSelectedUrls = new Set(state.selectedUrls);
      let matchedCount = 0;

      for (const url of analysisUrls) {
        if (!knownUrls.has(url)) {
          continue;
        }

        nextSelectedUrls.add(url);
        matchedCount += 1;
      }

      state.analyzedImageUrls = analysisUrls;
      state.selectedUrls = nextSelectedUrls;
      state.activeScope = matchedCount > 0 ? "analysis" : "all";
      state.currentPage = 1;

      renderer.renderElementAnalysis(compactAnalysis);
      renderer.renderAll();
      elements.statusMessage.textContent =
        matchedCount > 0
          ? `Bloc analitzat: ${matchedCount} imatges detectades i marcades.`
          : "Bloc analitzat. No s'han trobat imatges del bloc a la llista.";
    } catch (error) {
      elements.statusMessage.textContent =
        error instanceof Error && error.message
          ? error.message
          : "No s'ha pogut analitzar el bloc.";
      debugError("error analitzant bloc", error);
      logs.reportError(elements.statusMessage.textContent, error);
    } finally {
      elements.analyzeElementButton.disabled = false;
    }
  }

  async function copyElementAnalysis() {
    const payload = getAnalysisPayload();

    if (!payload) {
      elements.statusMessage.textContent = "No hi ha cap analisi per copiar.";
      return;
    }

    try {
      await navigator.clipboard.writeText(payload);
      elements.statusMessage.textContent = "Analisi copiada al porta-retalls.";
    } catch (error) {
      elements.statusMessage.textContent = "No s'ha pogut copiar l'analisi.";
      debugError("error copiant analisi", error);
      logs.reportError(elements.statusMessage.textContent, error);
    }
  }

  async function saveElementAnalysis() {
    const payload = getAnalysisPayload();

    if (!payload) {
      elements.statusMessage.textContent = "No hi ha cap analisi per guardar.";
      return;
    }

    const blob = new Blob([payload], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);

    try {
      const downloadId = await chrome.downloads.download({
        url: objectUrl,
        filename: buildAnalysisFilename(),
        conflictAction: "uniquify",
        saveAs: false,
      });

      if (!Number.isInteger(downloadId)) {
        throw new Error("Chrome no ha retornat cap downloadId.");
      }

      elements.statusMessage.textContent =
        "Analisi guardada a Downloads/Image Picker/.";
    } catch (error) {
      elements.statusMessage.textContent = "No s'ha pogut guardar l'analisi.";
      debugError("error guardant analisi", error);
      logs.reportError(elements.statusMessage.textContent, error);
    } finally {
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 1200);
    }
  }

  function clearElementAnalysis() {
    state.analyzedImageUrls = new Set();
    state.activeScope = "all";
    state.currentPage = 1;
    renderer.clearElementAnalysis();
    renderer.renderAll();
    elements.statusMessage.textContent = "Analisi netejada.";
  }

  return {
    getSourceContext,
    loadImages,
    downloadSelected,
    startElementCaptureFlow,
    openExpandedWindow,
    analyzeElement,
    copyElementAnalysis,
    saveElementAnalysis,
    clearElementAnalysis,
    getFilteredImages: () => getFilteredImages(state),
  };
}

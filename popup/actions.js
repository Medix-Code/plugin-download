import { ACTIONS } from "../shared/messages.js";
import { debugError, debugLog } from "../shared/logger.js";
import { getErrorMessage } from "../shared/errors.js";
import { DOWNLOADS_SUBDIRECTORY } from "../shared/constants.js";
import { getFilteredImages } from "./filters.js";
import { collectImagesFromPage } from "./injected/collect-images.js";
import { selectAndAnalyzeElement } from "./injected/analyze-element.js";

export function createPopupActions(state, elements, renderer, logs) {
  function extractFirstCssUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }

    const match = raw.match(/url\((['"]?)(.*?)\1\)/i);
    if (!match?.[2]) {
      return "";
    }

    return match[2].trim();
  }

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

    if ((key === "backgroundImage" || key === "maskImage") && trimmed === "none") {
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
      "maskImage",
      "maskSize",
      "maskPosition",
      "maskRepeat",
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

  function buildTemplateFilename() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${DOWNLOADS_SUBDIRECTORY}/plantilla_mockup_${stamp}.json`;
  }

  function getAnalysisEditorText() {
    if (!elements.analysisOutput) {
      return "";
    }

    if (typeof elements.analysisOutput.value === "string") {
      return elements.analysisOutput.value;
    }

    return elements.analysisOutput.textContent || "";
  }

  function getCurrentAnalysisObject(options = {}) {
    const { reportErrors = false, operation = "utilitzar el JSON" } = options;
    const payload = getAnalysisEditorText().trim();

    if (!payload) {
      return null;
    }

    try {
      const parsed = JSON.parse(payload);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("El JSON ha de tenir un objecte a l'arrel.");
      }

      return parsed;
    } catch (error) {
      if (reportErrors) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "JSON invalid";
        const statusText = `JSON invalid: ${message}`;
        elements.statusMessage.textContent = statusText;
        logs.push("error", `No s'ha pogut ${operation}.`, { message });
      }
      return null;
    }
  }

  function getAnalysisPayload() {
    const payload = getAnalysisEditorText().trim();
    return payload || null;
  }

  function collectAnalysisAssetUrls(rawAnalysis, compactAnalysis) {
    const urls = new Set();
    const compactAssets = compactAnalysis?.assets || {};
    const rawAssets = rawAnalysis?.assets || {};
    const rawLayers = Array.isArray(rawAnalysis?.layers) ? rawAnalysis.layers : [];

    for (const source of [
      ...(compactAssets.imageUrls || []),
      ...(compactAssets.backgroundImageUrls || []),
      ...(rawAssets.imageUrls || []),
      ...(rawAssets.backgroundImageUrls || []),
    ]) {
      if (source) {
        urls.add(source);
      }
    }

    for (const layer of rawLayers) {
      if (layer?.imageUrl) {
        urls.add(layer.imageUrl);
      }

      if (Array.isArray(layer?.sources)) {
        for (const source of layer.sources) {
          if (source) {
            urls.add(source);
          }
        }
      }

      if (Array.isArray(layer?.backgroundImageUrls)) {
        for (const url of layer.backgroundImageUrls) {
          if (url) {
            urls.add(url);
          }
        }
      }

      const maskSource = extractFirstCssUrl(layer?.maskImage);
      if (maskSource) {
        urls.add(maskSource);
      }

      if (layer?.maskSource) {
        urls.add(layer.maskSource);
      }
    }

    return urls;
  }

  function isTemplateLike(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    if (!Array.isArray(value.layers)) {
      return false;
    }

    if (Number.isFinite(Number(value?.canvas?.width))) {
      return true;
    }

    if (Number.isFinite(Number(value?.element?.size?.width))) {
      return true;
    }

    return Number.isFinite(Number(value?.templateVersion));
  }

  function cloneTemplate(template) {
    return {
      ...template,
      layers: Array.isArray(template?.layers)
        ? template.layers.map((layer) => ({
            ...layer,
            sources: Array.isArray(layer?.sources) ? [...layer.sources] : [],
          }))
        : [],
      replaceableLayers: Array.isArray(template?.replaceableLayers)
        ? template.replaceableLayers.map((layer) => ({
            ...layer,
            sources: Array.isArray(layer?.sources) ? [...layer.sources] : [],
          }))
        : [],
    };
  }

  function applyAssetOverridesToTemplate(baseTemplate, analysisObject) {
    const nextTemplate = cloneTemplate(baseTemplate);
    const imageUrls = Array.isArray(analysisObject?.assets?.imageUrls)
      ? analysisObject.assets.imageUrls.filter(
          (url) => typeof url === "string" && /^https?:\/\//i.test(url),
        )
      : [];

    if (imageUrls.length === 0) {
      return nextTemplate;
    }

    let cursor = 0;

    for (const layer of nextTemplate.layers) {
      if (
        !Array.isArray(layer?.sources) ||
        layer.sources.length === 0 ||
        cursor >= imageUrls.length
      ) {
        continue;
      }

      layer.sources = [imageUrls[cursor]];
      cursor += 1;
    }

    if (Array.isArray(nextTemplate.replaceableLayers)) {
      nextTemplate.replaceableLayers = nextTemplate.replaceableLayers.map((entry) => {
        const matchedLayer = nextTemplate.layers.find((layer) => layer?.id === entry?.id);
        return {
          ...entry,
          sources: Array.isArray(matchedLayer?.sources)
            ? [...matchedLayer.sources]
            : Array.isArray(entry?.sources)
              ? [...entry.sources]
              : [],
        };
      });
    }

    return nextTemplate;
  }

  function getPreviewImageUrlsFromAnalysis(analysis) {
    return getPreviewAssetItemsFromAnalysis(analysis);
  }

  function getPreviewAssetItemsFromAnalysis(rawAnalysis, compactAnalysis = rawAnalysis) {
    if (!rawAnalysis || typeof rawAnalysis !== "object") {
      return [];
    }

    const itemsByKey = new Map();
    const pushItem = (key, item) => {
      if (!key || itemsByKey.has(key)) {
        return;
      }
      itemsByKey.set(key, item);
    };
    const addUrlItem = (url, label = "") => {
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
        return;
      }
      pushItem(`url:${url}`, {
        key: `url:${url}`,
        url,
        previewUrl: url,
        label,
      });
    };

    const compactAssets = compactAnalysis?.assets || {};
    const rawAssets = rawAnalysis?.assets || {};
    for (const source of [
      ...(compactAssets.imageUrls || []),
      ...(compactAssets.backgroundImageUrls || []),
      ...(rawAssets.imageUrls || []),
      ...(rawAssets.backgroundImageUrls || []),
    ]) {
      addUrlItem(source, "asset");
    }

    const rawLayers = Array.isArray(rawAnalysis?.layers) ? rawAnalysis.layers : [];
    for (const layer of rawLayers) {
      if (layer?.imageUrl) {
        addUrlItem(layer.imageUrl, "image");
      }

      if (Array.isArray(layer?.sources)) {
        for (const source of layer.sources) {
          addUrlItem(source, "layer");
        }
      }

      if (Array.isArray(layer?.backgroundImageUrls)) {
        for (const source of layer.backgroundImageUrls) {
          addUrlItem(source, "background");
        }
      }

      const maskUrl = extractFirstCssUrl(layer?.maskImage) || layer?.maskSource || "";
      if (!maskUrl || !/^https?:\/\//i.test(maskUrl)) {
        continue;
      }

      const fillColor = pickStyleValue("backgroundColor", layer?.backgroundColor || "");
      if (fillColor) {
        pushItem(`mask:${maskUrl}|${fillColor}`, {
          key: `mask:${maskUrl}|${fillColor}`,
          url: maskUrl,
          previewUrl: "",
          kind: "mask-color",
          maskUrl,
          fillColor,
          label: "forma",
        });
      } else {
        addUrlItem(maskUrl, "mask");
      }
    }

    return Array.from(itemsByKey.values()).slice(0, 40);
  }

  function collectTemplateAssetUrls(templateObject) {
    const urls = new Set();
    const layers = Array.isArray(templateObject?.layers) ? templateObject.layers : [];

    for (const layer of layers) {
      if (Array.isArray(layer?.sources)) {
        for (const source of layer.sources) {
          if (source && /^https?:\/\//i.test(String(source))) {
            urls.add(source);
          }
        }
      }

      if (typeof layer?.imageUrl === "string" && /^https?:\/\//i.test(layer.imageUrl)) {
        urls.add(layer.imageUrl);
      }

      if (typeof layer?.maskSource === "string" && /^https?:\/\//i.test(layer.maskSource)) {
        urls.add(layer.maskSource);
      }

      const maskUrl = extractFirstCssUrl(layer?.maskImage);
      if (maskUrl && /^https?:\/\//i.test(maskUrl)) {
        urls.add(maskUrl);
      }
    }

    return urls;
  }

  function resolveTemplateFromAnalysisObject(analysisObject) {
    if (!analysisObject || typeof analysisObject !== "object" || Array.isArray(analysisObject)) {
      return null;
    }

    if (isTemplateLike(analysisObject)) {
      return analysisObject;
    }

    if (Array.isArray(analysisObject.layers)) {
      return buildMockupTemplate(analysisObject);
    }

    if (state.rawElementAnalysis && typeof state.rawElementAnalysis === "object") {
      const baseTemplate = buildMockupTemplate(state.rawElementAnalysis);
      return applyAssetOverridesToTemplate(baseTemplate, analysisObject);
    }

    return null;
  }

  function buildMockupTemplate(rawAnalysis) {
    const sourceElement = rawAnalysis?.element || {};
    const sourceRect = sourceElement.rect || {};
    const layers = (Array.isArray(rawAnalysis?.layers) ? rawAnalysis.layers : []).map(
      (layer, index) => {
        const sources = [
          layer?.imageUrl,
          ...(Array.isArray(layer?.backgroundImageUrls) ? layer.backgroundImageUrls : []),
        ].filter(Boolean);
        const maskSource = extractFirstCssUrl(layer?.maskImage);

        return {
          id: layer?.id || `layer_${index + 1}`,
          role: layer?.role || "unknown",
          selector: layer?.selector || "",
          tagName: layer?.tagName || "",
          rect: layer?.relativeRect || layer?.rect || {},
          layoutWidth: Number.isFinite(Number(layer?.layoutWidth))
            ? Number(layer.layoutWidth)
            : undefined,
          layoutHeight: Number.isFinite(Number(layer?.layoutHeight))
            ? Number(layer.layoutHeight)
            : undefined,
          zIndex: Number.isFinite(layer?.zIndex) ? layer.zIndex : 0,
          opacity: layer?.opacity || "1",
          transform: layer?.transform || "none",
          transformOrigin: layer?.transformOrigin || "",
          blendMode: layer?.blendMode || "normal",
          borderRadius: layer?.borderRadius || "0px",
          objectFit: layer?.objectFit || "fill",
          objectPosition: layer?.objectPosition || "50% 50%",
          backgroundSize: layer?.backgroundSize || "",
          backgroundPosition: layer?.backgroundPosition || "",
          backgroundRepeat: layer?.backgroundRepeat || "",
          textColor: layer?.textColor || "",
          fontFamily: layer?.fontFamily || "",
          fontSize: layer?.fontSize || "",
          fontWeight: layer?.fontWeight || "",
          fontStyle: layer?.fontStyle || "",
          lineHeight: layer?.lineHeight || "",
          letterSpacing: layer?.letterSpacing || "",
          textAlign: layer?.textAlign || "",
          backgroundColor: layer?.backgroundColor || "",
          backgroundImage: layer?.backgroundImage || "",
          text: layer?.text || "",
          maskImage: layer?.maskImage || "",
          maskSize: layer?.maskSize || "",
          maskPosition: layer?.maskPosition || "",
          maskRepeat: layer?.maskRepeat || "",
          maskSource,
          sources,
          replaceable: sources.length > 0,
        };
      },
    );

    const replaceableLayers = layers
      .filter((layer) => layer.replaceable)
      .map((layer) => ({
        id: layer.id,
        selector: layer.selector,
        role: layer.role,
        sources: layer.sources,
      }));

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const layer of layers) {
      const rect = layer?.rect || {};
      const x = Number(rect.x);
      const y = Number(rect.y);
      const width = Number(rect.width);
      const height = Number(rect.height);

      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    }

    const contentBounds =
      Number.isFinite(minX) &&
      Number.isFinite(minY) &&
      Number.isFinite(maxX) &&
      Number.isFinite(maxY)
        ? {
            x: Math.round(minX),
            y: Math.round(minY),
            width: Math.max(0, Math.round(maxX - minX)),
            height: Math.max(0, Math.round(maxY - minY)),
          }
        : {
            x: 0,
            y: 0,
            width: Number.isFinite(sourceRect.width) ? sourceRect.width : 0,
            height: Number.isFinite(sourceRect.height) ? sourceRect.height : 0,
          };

    const canvasWidth = Math.max(
      1,
      Number.isFinite(sourceRect.width) ? Math.round(sourceRect.width) : contentBounds.width,
    );
    const canvasHeight = Math.max(
      1,
      Number.isFinite(sourceRect.height) ? Math.round(sourceRect.height) : contentBounds.height,
    );

    return {
      templateVersion: 1,
      exportedAt: new Date().toISOString(),
      source: {
        url: rawAnalysis?.page?.url || "",
        title: rawAnalysis?.page?.title || "",
      },
      element: {
        selector: sourceElement.selector || "",
        tagName: sourceElement.tagName || "",
        size: {
          width: Number.isFinite(sourceRect.width) ? sourceRect.width : 0,
          height: Number.isFinite(sourceRect.height) ? sourceRect.height : 0,
        },
      },
      canvas: {
        width: canvasWidth,
        height: canvasHeight,
        contentBounds,
      },
      styles: rawAnalysis?.styles || {},
      typography: rawAnalysis?.typography || {},
      layers,
      replaceableLayers,
      notes: [
        "Aquesta plantilla no es PSD; serveix com a mapa de capes i assets.",
        "Les capes replaceable=true son les que pots substituir en eines externes.",
      ],
    };
  }

  function escapeXml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function buildSvgPreviewDataUrl(template) {
    if (!template || typeof template !== "object") {
      return "";
    }

    const width = Math.max(
      1,
      Number(template?.canvas?.width || template?.element?.size?.width || 0),
    );
    const height = Math.max(
      1,
      Number(template?.canvas?.height || template?.element?.size?.height || 0),
    );
    const layers = Array.isArray(template.layers) ? template.layers : [];
    const sorted = layers
      .map((layer, index) => ({
        layer,
        index,
        zIndex: Number.isFinite(layer?.zIndex) ? layer.zIndex : 0,
      }))
      .sort((left, right) => {
        if (left.zIndex !== right.zIndex) {
          return left.zIndex - right.zIndex;
        }
        return left.index - right.index;
      });

    const defs = [
      `<clipPath id="preview_canvas_clip"><rect x="0" y="0" width="${width}" height="${height}" /></clipPath>`,
    ];
    const nodes = [];

    for (const { layer, index } of sorted) {
      const rect = layer?.rect || {};
      const x = Number(rect.x);
      const y = Number(rect.y);
      const w = Number(rect.width);
      const h = Number(rect.height);
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(w) ||
        !Number.isFinite(h) ||
        w <= 0 ||
        h <= 0
      ) {
        continue;
      }

      const sources = Array.isArray(layer?.sources) ? layer.sources : [];
      const sourceHref =
        (sources.find((source) => typeof source === "string" && source) || "") ||
        (typeof layer?.imageUrl === "string" ? layer.imageUrl : "");
      const backgroundColor = String(layer?.backgroundColor || "").trim();
      const text = String(layer?.text || "").trim();
      const maskSource = extractFirstCssUrl(layer?.maskImage) || layer?.maskSource || "";
      const opacity = Math.max(0, Math.min(1, Number(layer?.opacity || 1)));
      const opacityAttr = opacity < 1 ? ` opacity="${opacity}"` : "";
      const maskId = maskSource ? `preview_mask_${index + 1}` : "";
      const maskAttr = maskSource ? ` mask="url(#${maskId})"` : "";

      if (maskSource) {
        defs.push(
          `<mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}" style="mask-type: alpha;"><image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" href="${escapeXml(maskSource)}" /></mask>`,
        );
      }

      if (
        backgroundColor &&
        backgroundColor !== "transparent" &&
        backgroundColor !== "rgba(0, 0, 0, 0)"
      ) {
        nodes.push(
          `<rect id="layer_bg_${index + 1}" x="${x}" y="${y}" width="${w}" height="${h}" fill="${escapeXml(backgroundColor)}"${maskAttr}${opacityAttr} />`,
        );
      }

      if (sourceHref) {
        nodes.push(
          `<image id="layer_img_${index + 1}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"${maskAttr}${opacityAttr} href="${escapeXml(sourceHref)}" />`,
        );
      }

      if (text) {
        const fontSize = Math.max(10, Number.parseFloat(layer?.fontSize || "16"));
        const textColor = String(layer?.textColor || "").trim() || "#111111";
        nodes.push(
          `<text id="layer_text_${index + 1}" x="${x}" y="${y + fontSize}" font-size="${fontSize}" fill="${escapeXml(textColor)}"${opacityAttr}>${escapeXml(text)}</text>`,
        );
      }
    }

    const svg = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<defs>${defs.join("")}</defs>`,
      '<g clip-path="url(#preview_canvas_clip)">',
      ...nodes,
      "</g>",
      "</svg>",
    ].join("\n");

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function getTemplatePayload() {
    const analysis = getCurrentAnalysisObject({
      reportErrors: true,
      operation: "exportar la plantilla",
    });
    if (!analysis) {
      return null;
    }

    const template = resolveTemplateFromAnalysisObject(analysis);
    if (!template) {
      elements.statusMessage.textContent =
        "El JSON actual no te prou dades per generar plantilla.";
      logs.push("error", "No s'ha pogut exportar la plantilla.", {
        message: "JSON sense capes ni base de plantilla",
      });
      return null;
    }

    return JSON.stringify(template, null, 2);
  }

  function getTemplateObject() {
    const analysis = getCurrentAnalysisObject({
      reportErrors: true,
      operation: "generar la plantilla",
    });
    if (!analysis) {
      return null;
    }

    const template = resolveTemplateFromAnalysisObject(analysis);
    if (!template) {
      elements.statusMessage.textContent =
        "El JSON actual no te prou dades per generar plantilla.";
      logs.push("error", "No s'ha pogut generar la plantilla.", {
        message: "JSON sense capes ni base de plantilla",
      });
      return null;
    }

    return template;
  }

  function collectBlockDownloadUrls(templateObject) {
    if (!templateObject) {
      return [];
    }

    const urls = collectTemplateAssetUrls(templateObject);

    return Array.from(urls).filter(
      (url) => typeof url === "string" && /^https?:\/\//i.test(url),
    );
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
      state.rawElementAnalysis = null;
      state.elementSvgPreviewUrl = "";
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
      state.rawElementAnalysis = null;
      state.elementSvgPreviewUrl = "";
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
    if (state.analysisInProgress) {
      return;
    }

    const setAnalyzeButtonActive = (active) => {
      state.analysisInProgress = active;
      elements.analyzeElementButton.classList.toggle("secondary-button--active", active);
      elements.analyzeElementButton.setAttribute("aria-pressed", active ? "true" : "false");
    };

    debugLog("analyzeElement: inici");
    setAnalyzeButtonActive(true);
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

      state.rawElementAnalysis = result.analysis;
      state.elementSvgPreviewUrl = buildSvgPreviewDataUrl(
        buildMockupTemplate(result.analysis),
      );
      const compactAnalysis = compactElementAnalysis(result.analysis);
      const analysisUrls = collectAnalysisAssetUrls(result.analysis, compactAnalysis);
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

      renderer.renderElementAnalysis(compactAnalysis, {
        previewUrls: getPreviewAssetItemsFromAnalysis(result.analysis, compactAnalysis),
      });
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
      setAnalyzeButtonActive(false);
    }
  }

  function handleAnalysisEditorInput() {
    if (!state.elementAnalysis) {
      return;
    }

    const payload = getAnalysisEditorText().trim();
    if (!payload) {
      state.elementSvgPreviewUrl = "";
      renderer.renderAnalysisDetectedAssets([]);
      renderer.renderAnalysisSvgPreview();
      elements.copyAnalysisButton.disabled = true;
      elements.saveAnalysisButton.disabled = true;
      elements.saveTemplateButton.disabled = true;
      elements.downloadBlockBundleButton.disabled = true;
      return;
    }

    elements.copyAnalysisButton.disabled = false;
    elements.saveAnalysisButton.disabled = false;

    const parsed = getCurrentAnalysisObject({ reportErrors: false });
    if (!parsed) {
      state.elementSvgPreviewUrl = "";
      renderer.renderAnalysisDetectedAssets([]);
      renderer.renderAnalysisSvgPreview();
      elements.saveTemplateButton.disabled = true;
      elements.downloadBlockBundleButton.disabled = true;
      return;
    }

    elements.saveTemplateButton.disabled = false;
    elements.downloadBlockBundleButton.disabled = false;

    const template = resolveTemplateFromAnalysisObject(parsed);
    if (template) {
      state.elementSvgPreviewUrl = buildSvgPreviewDataUrl(template);
    } else {
      state.elementSvgPreviewUrl = "";
    }

    renderer.renderAnalysisDetectedAssets(getPreviewImageUrlsFromAnalysis(parsed));
    renderer.renderAnalysisSvgPreview();
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

  async function saveMockupTemplate() {
    const payload = getTemplatePayload();

    if (!payload) {
      elements.statusMessage.textContent = "No hi ha cap analisi per exportar plantilla.";
      return;
    }

    const blob = new Blob([payload], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);

    try {
      const downloadId = await chrome.downloads.download({
        url: objectUrl,
        filename: buildTemplateFilename(),
        conflictAction: "uniquify",
        saveAs: false,
      });

      if (!Number.isInteger(downloadId)) {
        throw new Error("Chrome no ha retornat cap downloadId.");
      }

      elements.statusMessage.textContent =
        "Plantilla mockup guardada a Downloads/Image Picker/.";
    } catch (error) {
      elements.statusMessage.textContent = "No s'ha pogut guardar la plantilla mockup.";
      debugError("error guardant plantilla mockup", error);
      logs.reportError(elements.statusMessage.textContent, error);
    } finally {
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 1200);
    }
  }

  async function downloadBlockBundle() {
    const templateObject = getTemplateObject();

    if (!templateObject) {
      elements.statusMessage.textContent = "No hi ha cap analisi de bloc per exportar.";
      return;
    }

    const urls = collectBlockDownloadUrls(templateObject);

    if (urls.length === 0) {
      elements.statusMessage.textContent =
        "No s'han detectat imatges HTTP/HTTPS dins del bloc analitzat.";
      return;
    }

    elements.downloadBlockBundleButton.disabled = true;
    elements.statusMessage.textContent = `Preparant ZIP del bloc (${urls.length} imatges + plantilla JSON/SVG)...`;

    try {
      const sourceContext = await getSourceContext();
      const response = await chrome.runtime.sendMessage({
        action: ACTIONS.DOWNLOAD_IMAGES,
        urls,
        preferArchive: true,
        saveAs: false,
        archiveTemplate: templateObject,
        operation: "Descarrega bloc",
        upscale: {
          enabled: false,
          factor: 2,
        },
        tabId: sourceContext.tabId,
        windowId: sourceContext.windowId,
      });

      if (!response?.ok) {
        throw new Error(
          response?.error || "No s'ha pogut crear el ZIP del bloc.",
        );
      }

      const count = response.count ?? urls.length;
      elements.statusMessage.textContent =
        `Bloc exportat: ZIP amb plantilla JSON/SVG + ${count} imatges.`;
    } catch (error) {
      elements.statusMessage.textContent =
        error instanceof Error && error.message
          ? error.message
          : "No s'ha pogut exportar el bloc en ZIP.";
      debugError("error exportant bloc en zip", error);
      logs.push("error", elements.statusMessage.textContent, {
        message: getErrorMessage(error),
        count: urls.length,
      });
    } finally {
      elements.downloadBlockBundleButton.disabled = !state.elementAnalysis;
    }
  }

  function clearElementAnalysis() {
    state.rawElementAnalysis = null;
    state.elementSvgPreviewUrl = "";
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
    saveMockupTemplate,
    downloadBlockBundle,
    handleAnalysisEditorInput,
    clearElementAnalysis,
    getFilteredImages: () => getFilteredImages(state),
  };
}

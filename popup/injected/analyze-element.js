export function selectAndAnalyzeElement() {
  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function toArray(set, limit = 20) {
    return Array.from(set).filter(Boolean).slice(0, limit);
  }

  function getClassName(element) {
    if (!element) {
      return "";
    }

    if (typeof element.className === "string") {
      return normalizeWhitespace(element.className);
    }

    if (typeof element.className?.baseVal === "string") {
      return normalizeWhitespace(element.className.baseVal);
    }

    return "";
  }

  function buildSimpleSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    const parts = [];
    let current = element;
    let depth = 0;

    while (
      current &&
      current.nodeType === Node.ELEMENT_NODE &&
      current !== document.documentElement &&
      depth < 4
    ) {
      const tag = current.tagName.toLowerCase();
      const className = getClassName(current)
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((name) => `.${CSS.escape(name)}`)
        .join("");
      let nth = "";
      const parent = current.parentElement;

      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName,
        );

        if (siblings.length > 1) {
          nth = `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }

      parts.unshift(`${tag}${className}${nth}`);
      current = parent;
      depth += 1;
    }

    return parts.join(" > ");
  }

  function collectUrlsFromBackground(backgroundImage, destination) {
    if (!backgroundImage || backgroundImage === "none") {
      return;
    }

    for (const match of backgroundImage.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
      try {
        destination.add(new URL(match[2], window.location.href).href);
      } catch {
        // Ignore malformed URLs.
      }
    }
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

  function toAbsoluteRect(rect) {
    return {
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function toRelativeRect(rect, rootRect) {
    return {
      x: Math.round(rect.left - rootRect.left),
      y: Math.round(rect.top - rootRect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function normalizeUrl(value) {
    if (!value) {
      return "";
    }

    try {
      return new URL(value, window.location.href).href;
    } catch {
      return "";
    }
  }

  function parseZIndex(value) {
    if (!value || value === "auto") {
      return 0;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parsePixelDimensions(value) {
    const match = String(value || "").match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
    if (!match) {
      return null;
    }

    const width = Number.parseInt(match[1], 10);
    const height = Number.parseInt(match[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }

    return { width, height };
  }

  function extractPlaceitTokenFromUploadUrl(value) {
    const normalized = normalizeUrl(value);
    if (!normalized) {
      return "";
    }

    try {
      const parsed = new URL(normalized);
      const host = String(parsed.hostname || "").toLowerCase();
      if (!host.includes("placeit-user-uploads")) {
        return "";
      }

      const token = parsed.pathname.split("/").filter(Boolean)[0] || "";
      return token.trim();
    } catch {
      return "";
    }
  }

  function collectPlaceitCustomGraphics(rootElement) {
    const uploadsByToken = new Map();
    const registerUploadUrl = (rawUrl) => {
      const normalized = normalizeUrl(rawUrl);
      if (!normalized) {
        return;
      }

      let parsed;
      try {
        parsed = new URL(normalized);
      } catch {
        return;
      }

      const host = String(parsed.hostname || "").toLowerCase();
      if (!host.includes("placeit-user-uploads")) {
        return;
      }

      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length < 2) {
        return;
      }

      const token = String(segments[0] || "").trim().toLowerCase();
      const fileName = String(segments[segments.length - 1] || "").trim().toLowerCase();
      if (!token || !fileName) {
        return;
      }

      const current = uploadsByToken.get(token) || {
        token,
        all: new Set(),
        userImageUrl: "",
        thumbnailUrl: "",
      };
      current.all.add(normalized);

      if (fileName === "user_image.png" || fileName === "user-image.png") {
        current.userImageUrl = normalized;
      }
      if (fileName === "thumbnail.png") {
        current.thumbnailUrl = normalized;
      }

      uploadsByToken.set(token, current);
    };

    const parseSrcsetUrls = (value) => {
      const parts = String(value || "").split(",");
      for (const part of parts) {
        const [candidate] = String(part).trim().split(/\s+/);
        if (candidate) {
          registerUploadUrl(candidate);
        }
      }
    };

    const uploadNodes = document.querySelectorAll(
      [
        "img[src*='placeit-user-uploads']",
        "img[data-src*='placeit-user-uploads']",
        "source[srcset*='placeit-user-uploads']",
        "[style*='placeit-user-uploads']",
        "a[href*='placeit-user-uploads']",
      ].join(", "),
    );
    for (const node of uploadNodes) {
      if (!(node instanceof Element)) {
        continue;
      }

      if (node instanceof HTMLImageElement) {
        registerUploadUrl(node.currentSrc || node.src || "");
        registerUploadUrl(node.getAttribute("data-src") || "");
        parseSrcsetUrls(node.getAttribute("srcset") || "");
      } else if (node instanceof HTMLSourceElement) {
        parseSrcsetUrls(node.srcset || "");
      } else {
        registerUploadUrl(node.getAttribute("href") || "");
        registerUploadUrl(node.getAttribute("data-src") || "");
      }

      const inlineStyle = node.getAttribute("style") || "";
      for (const match of inlineStyle.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
        registerUploadUrl(match[2] || "");
      }
    }

    const tokensByKey = new Map();
    const addToken = (key, token) => {
      const normalizedKey = String(key || "").trim().toLowerCase();
      const normalizedToken = String(token || "").trim();
      if (!normalizedKey || !normalizedToken) {
        return;
      }
      tokensByKey.set(normalizedKey, normalizedToken);
    };

    const addTokensFromRawUrl = (rawUrl) => {
      if (!rawUrl) {
        return;
      }

      try {
        const parsed = new URL(rawUrl, window.location.href);
        for (const [key, value] of parsed.searchParams.entries()) {
          if (/^customg_\d+$/i.test(key)) {
            addToken(key, value);
          }
        }
      } catch {
        // Ignore invalid URLs.
      }
    };

    addTokensFromRawUrl(window.location.href);

    const links = [
      ...document.querySelectorAll("a[href*='customG_'], a[data-href*='customG_']"),
    ].slice(0, 120);
    for (const link of links) {
      if (!(link instanceof Element)) {
        continue;
      }
      addTokensFromRawUrl(link.getAttribute("href") || "");
      addTokensFromRawUrl(link.getAttribute("data-href") || "");
    }

    const inputNodes = [
      ...document.querySelectorAll("input[id^='inputcustomG_'][id$='-file-input']"),
    ].slice(0, 12);
    const items = [];

    for (const input of inputNodes) {
      if (!(input instanceof HTMLInputElement)) {
        continue;
      }

      const id = String(input.id || "").trim();
      const keyMatch = id.match(/^input(customG_\d+)-file-input$/i);
      const key = keyMatch ? keyMatch[1] : "";
      const tokenFromParam = key ? tokensByKey.get(key.toLowerCase()) || "" : "";
      const escapedInputId =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(id)
          : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      const control =
        input.closest(".custom-graphic-control, .input-file-control, .form-group") ||
        rootElement.querySelector(`[data-drop-target-id="${escapedInputId}"]`)?.closest(
          ".custom-graphic-control, .input-file-control, .form-group",
        ) ||
        input.parentElement ||
        null;
      const previewNode =
        control?.querySelector(".file-input-preview img, .image-container img, img") || null;
      const previewUrl = normalizeUrl(
        previewNode instanceof HTMLImageElement
          ? previewNode.currentSrc || previewNode.src
          : "",
      );
      const tokenFromPreview = extractPlaceitTokenFromUploadUrl(previewUrl);
      const token = tokenFromParam || tokenFromPreview || "";
      const fallbackPreviewUrl = token
        ? `https://placeit-user-uploads.s3-accelerate.amazonaws.com/${encodeURIComponent(token)}/thumbnail.png`
        : "";
      const tokenUploads = token ? uploadsByToken.get(token.toLowerCase()) : null;
      const userImageUrl = tokenUploads?.userImageUrl || "";
      const observedThumbnailUrl = tokenUploads?.thumbnailUrl || "";
      const dimensions = parsePixelDimensions(
        control?.querySelector(".file-upload-label__pixels-dimensions")?.textContent ||
          control?.textContent ||
          "",
      );
      const sources = new Set();

      if (userImageUrl) {
        sources.add(userImageUrl);
      }

      if (previewUrl) {
        sources.add(previewUrl);
      }

      if (observedThumbnailUrl) {
        sources.add(observedThumbnailUrl);
      }

      if (fallbackPreviewUrl) {
        sources.add(fallbackPreviewUrl);
      }

      items.push({
        key,
        inputId: id,
        token,
        previewUrl,
        pixelWidth: dimensions?.width || 0,
        pixelHeight: dimensions?.height || 0,
        sources: toArray(sources, 6),
      });
    }

    if (items.length === 0 && tokensByKey.size > 0) {
      for (const [key, token] of tokensByKey.entries()) {
        const fallbackPreviewUrl = `https://placeit-user-uploads.s3-accelerate.amazonaws.com/${encodeURIComponent(token)}/thumbnail.png`;
        const tokenUploads = uploadsByToken.get(String(token).toLowerCase());
        const userImageUrl = tokenUploads?.userImageUrl || "";
        const observedThumbnailUrl = tokenUploads?.thumbnailUrl || "";
        const sources = [];
        if (userImageUrl) {
          sources.push(userImageUrl);
        }
        if (observedThumbnailUrl) {
          sources.push(observedThumbnailUrl);
        } else {
          sources.push(fallbackPreviewUrl);
        }
        items.push({
          key,
          inputId: "",
          token,
          previewUrl: observedThumbnailUrl || fallbackPreviewUrl,
          pixelWidth: 0,
          pixelHeight: 0,
          sources,
        });
      }
    }

    return items.slice(0, 12);
  }

  function collectPlaceitV4Metadata() {
    const stageData = window._stageData?.stage_data || null;
    const smartObjectV4Id = normalizeWhitespace(
      stageData?.smart_object_v4_id ||
        window.smartTemplateData?.id ||
        window.structureData?.id ||
        "",
    );

    if (!smartObjectV4Id) {
      return null;
    }

    const baseUrl = `https://nice-assets-1-p.cdn.aws.placeit.net/smart_templates/${encodeURIComponent(smartObjectV4Id)}`;
    const previewImageValue =
      window.smartTemplateData?.previewImage?.value ||
      window.smartTemplateData?.previewImage ||
      stageData?.preview_image_path_s3 ||
      stageData?.preview_image_path ||
      "";
    const previewImageUrl =
      typeof previewImageValue === "string" && previewImageValue.trim()
        ? normalizeUrl(
            previewImageValue.startsWith("http")
              ? previewImageValue
              : `${baseUrl}/${previewImageValue.replace(/^\/+/, "")}`,
          )
        : "";

    return {
      smartObjectV4Id,
      uiJsonUrl: `${baseUrl}/ui.json`,
      structureJsonUrl: `${baseUrl}/structure.json`,
      stageImageUrl: normalizeUrl(stageData?.image || ""),
      previewImageUrl,
      uiData:
        window.smartTemplateData &&
        typeof window.smartTemplateData === "object" &&
        !Array.isArray(window.smartTemplateData)
          ? window.smartTemplateData
          : null,
      structureData:
        window.structureData &&
        typeof window.structureData === "object" &&
        !Array.isArray(window.structureData)
          ? window.structureData
          : null,
    };
  }

  function readCanvasDataUrl(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      return "";
    }

    const width = Number(canvas.width || 0);
    const height = Number(canvas.height || 0);
    if (width <= 0 || height <= 0) {
      return "";
    }

    try {
      const dataUrl = canvas.toDataURL("image/png");
      return /^data:image\//i.test(dataUrl) ? dataUrl : "";
    } catch {
      // Tainted canvas or blocked read; ignore silently.
      return "";
    }
  }

  function isFinitePositiveNumber(value) {
    return Number.isFinite(value) && value > 0;
  }

  function getDirectTextSnippet(node) {
    if (!(node instanceof Element)) {
      return "";
    }

    const chunks = [];
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        chunks.push(child.textContent || "");
        continue;
      }

      if (child.nodeType === Node.ELEMENT_NODE && child instanceof Element) {
        if (child.tagName.toLowerCase() === "br") {
          chunks.push("\n");
        }
      }
    }

    const raw = chunks.join("");
    if (!raw.trim()) {
      return "";
    }

    const lines = raw
      .split(/\r?\n/)
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);

    return lines.join("\n").slice(0, 220);
  }

  function getNormalizedMultilineText(value) {
    const raw = String(value || "");
    if (!raw.trim()) {
      return "";
    }

    const lines = raw
      .split(/\r?\n/)
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);

    return lines.join("\n").slice(0, 220);
  }

  function collectLayers(rootElement) {
    const rootRect = rootElement.getBoundingClientRect();
    const nodes = [rootElement, ...rootElement.querySelectorAll("*")].slice(0, 1200);
    const layers = [];
    const blockedDescendants = new WeakSet();

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];

      if (!(node instanceof Element)) {
        continue;
      }
      if (blockedDescendants.has(node)) {
        continue;
      }

      const nodeStyle = window.getComputedStyle(node);
      if (
        nodeStyle.display === "none" ||
        nodeStyle.visibility === "hidden" ||
        Number.parseFloat(nodeStyle.opacity || "1") <= 0
      ) {
        continue;
      }

      const nodeRect = node.getBoundingClientRect();
      if (nodeRect.width < 2 || nodeRect.height < 2) {
        continue;
      }
      const computedWidth = Number.parseFloat(String(nodeStyle.width || "").replace("px", ""));
      const computedHeight = Number.parseFloat(String(nodeStyle.height || "").replace("px", ""));

      const backgroundUrls = new Set();
      collectUrlsFromBackground(nodeStyle.backgroundImage, backgroundUrls);

      const isCanvasElement = node instanceof HTMLCanvasElement;
      let imageUrl = "";
      if (node instanceof HTMLImageElement) {
        imageUrl = normalizeUrl(node.currentSrc || node.src);
      } else if (isCanvasElement) {
        imageUrl = readCanvasDataUrl(node);
      }

      const directText = getDirectTextSnippet(node);
      let text = directText;
      let textStyle = nodeStyle;
      let shouldBlockDescendants = false;

      if (!text) {
        const editableChild = node.querySelector(
          ":scope > p[contenteditable], :scope > div[contenteditable]",
        );

        if (editableChild instanceof Element) {
          const editableText = getNormalizedMultilineText(
            editableChild.innerText || editableChild.textContent || "",
          );

          if (editableText) {
            text = editableText;
            const preferredTextNode =
              editableChild.querySelector("span, strong, em, b, i") || editableChild;
            textStyle = window.getComputedStyle(preferredTextNode);
            shouldBlockDescendants = true;
          }
        }
      }

      const hasGradient = /gradient\(/i.test(nodeStyle.backgroundImage || "");
      const hasBackgroundColor = !isTransparentColor(nodeStyle.backgroundColor);
      const hasBackgroundImage = backgroundUrls.size > 0;
      const hasImage = Boolean(imageUrl) || isCanvasElement;
      const hasText = Boolean(text);
      const isRoot = node === rootElement;

      if (
        !isRoot &&
        !hasImage &&
        !hasBackgroundImage &&
        !hasGradient &&
        !hasBackgroundColor &&
        !hasText
      ) {
        continue;
      }

      const layer = {
        id: `layer_${layers.length + 1}`,
        role: isRoot
          ? "root"
          : hasImage
            ? "image"
            : hasBackgroundImage || hasGradient
              ? "background"
              : hasText
                ? "text"
                : "shape",
        tagName: node.tagName.toLowerCase(),
        selector: buildSimpleSelector(node),
        className: getClassName(node),
        domOrder: index,
        zIndex: parseZIndex(nodeStyle.zIndex),
        opacity: nodeStyle.opacity,
        transform: nodeStyle.transform,
        transformOrigin: nodeStyle.transformOrigin,
        blendMode: nodeStyle.mixBlendMode,
        borderRadius: nodeStyle.borderRadius,
        objectFit: nodeStyle.objectFit,
        objectPosition: nodeStyle.objectPosition,
        backgroundSize: nodeStyle.backgroundSize,
        backgroundPosition: nodeStyle.backgroundPosition,
        backgroundRepeat: nodeStyle.backgroundRepeat,
        textColor: textStyle.color,
        fontFamily: textStyle.fontFamily,
        fontSize: textStyle.fontSize,
        fontWeight: textStyle.fontWeight,
        fontStyle: textStyle.fontStyle,
        lineHeight: textStyle.lineHeight,
        letterSpacing: textStyle.letterSpacing,
        textAlign: textStyle.textAlign,
        rect: toAbsoluteRect(nodeRect),
        relativeRect: toRelativeRect(nodeRect, rootRect),
        layoutWidth: Number.isFinite(computedWidth) && computedWidth > 0
          ? Math.round(computedWidth * 1000) / 1000
          : Math.round(nodeRect.width * 1000) / 1000,
        layoutHeight: Number.isFinite(computedHeight) && computedHeight > 0
          ? Math.round(computedHeight * 1000) / 1000
          : Math.round(nodeRect.height * 1000) / 1000,
      };

      if (hasImage && imageUrl) {
        layer.imageUrl = imageUrl;
      }

      if (isCanvasElement) {
        layer.imageSourceType = "canvas";
        layer.canvasReadable = Boolean(imageUrl);
        const canvasWidth = Number(node.width || 0);
        const canvasHeight = Number(node.height || 0);
        if (isFinitePositiveNumber(canvasWidth) && isFinitePositiveNumber(canvasHeight)) {
          layer.canvasWidth = Math.round(canvasWidth);
          layer.canvasHeight = Math.round(canvasHeight);
        }
      }

      if (hasBackgroundColor) {
        layer.backgroundColor = nodeStyle.backgroundColor;
      }

      if (nodeStyle.backgroundImage && nodeStyle.backgroundImage !== "none") {
        layer.backgroundImage = nodeStyle.backgroundImage.slice(0, 500);
      }

      if (hasBackgroundImage) {
        layer.backgroundImageUrls = toArray(backgroundUrls, 6);
      }

      if (nodeStyle.maskImage && nodeStyle.maskImage !== "none") {
        layer.maskImage = nodeStyle.maskImage.slice(0, 500);
        layer.maskSize = nodeStyle.maskSize || "";
        layer.maskPosition = nodeStyle.maskPosition || "";
        layer.maskRepeat = nodeStyle.maskRepeat || "";
      }

      if (hasText) {
        layer.text = text;
      }

      if (shouldBlockDescendants) {
        for (const descendant of node.querySelectorAll("*")) {
          blockedDescendants.add(descendant);
        }
      }

      layers.push(layer);
    }

    layers.sort((left, right) => {
      if (left.zIndex !== right.zIndex) {
        return left.zIndex - right.zIndex;
      }

      return left.domOrder - right.domOrder;
    });

    return layers.slice(0, 240);
  }

  function extractElementAnalysis(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const text = normalizeWhitespace(element.innerText || element.textContent || "");
    const fontFamilies = new Set();
    const fontSizes = new Set();
    const fontWeights = new Set();
    const textColors = new Set();
    const sampleTexts = [];
    const imageUrls = new Set();
    const backgroundImageUrls = new Set();
    const placeitCustomGraphicUrls = new Set();
    const placeitV4 = collectPlaceitV4Metadata();
    let hasCanvasLayer = false;
    let hasReadableCanvasLayer = false;
    const nodes = [element, ...element.querySelectorAll("*")].slice(0, 500);
    const placeitCustomGraphics = collectPlaceitCustomGraphics(element);

    for (const node of nodes) {
      if (!(node instanceof Element)) {
        continue;
      }

      const nodeStyle = window.getComputedStyle(node);
      fontFamilies.add(normalizeWhitespace(nodeStyle.fontFamily));
      fontSizes.add(nodeStyle.fontSize);
      fontWeights.add(nodeStyle.fontWeight);
      textColors.add(nodeStyle.color);
      collectUrlsFromBackground(nodeStyle.backgroundImage, backgroundImageUrls);

      if (node instanceof HTMLImageElement) {
        const rawUrl = node.currentSrc || node.src;
        if (rawUrl) {
          try {
            imageUrls.add(new URL(rawUrl, window.location.href).href);
          } catch {
            // Ignore malformed URLs.
          }
        }
      } else if (node instanceof HTMLCanvasElement) {
        hasCanvasLayer = true;
        const canvasUrl = readCanvasDataUrl(node);
        if (canvasUrl) {
          hasReadableCanvasLayer = true;
        }
      }

      if (sampleTexts.length < 12) {
        const snippet = normalizeWhitespace(node.textContent || "");
        if (snippet && !sampleTexts.includes(snippet)) {
          sampleTexts.push(snippet.slice(0, 220));
        }
      }
    }

    for (const graphic of placeitCustomGraphics) {
      if (graphic?.previewUrl) {
        placeitCustomGraphicUrls.add(graphic.previewUrl);
      }

      if (Array.isArray(graphic?.sources)) {
        for (const source of graphic.sources) {
          if (source) {
            placeitCustomGraphicUrls.add(source);
          }
        }
      }
    }

    return {
      capturedAt: new Date().toISOString(),
      page: {
        url: window.location.href,
        title: document.title || "",
      },
      element: {
        tagName: element.tagName.toLowerCase(),
        id: element.id || "",
        className: getClassName(element),
        selector: buildSimpleSelector(element),
        rect: {
          x: Math.round(rect.left + window.scrollX),
          y: Math.round(rect.top + window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        textPreview: text.slice(0, 500),
      },
      captureSelection: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        viewportWidth: Math.max(1, Math.round(window.innerWidth || 0)),
        viewportHeight: Math.max(1, Math.round(window.innerHeight || 0)),
      },
      styles: {
        color: style.color,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        maskImage: style.maskImage,
        maskSize: style.maskSize,
        maskPosition: style.maskPosition,
        maskRepeat: style.maskRepeat,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        textTransform: style.textTransform,
        textAlign: style.textAlign,
        border: style.border,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        opacity: style.opacity,
      },
      typography: {
        fontFamilies: toArray(fontFamilies, 24),
        fontSizes: toArray(fontSizes, 24),
        fontWeights: toArray(fontWeights, 24),
        textColors: toArray(textColors, 24),
        sampleTexts: sampleTexts.slice(0, 12),
      },
      assets: {
        imageUrls: toArray(imageUrls, 40),
        backgroundImageUrls: toArray(backgroundImageUrls, 40),
        placeitCustomGraphicUrls: toArray(placeitCustomGraphicUrls, 24),
        customGraphics: placeitCustomGraphics.map((entry) => ({
          key: entry?.key || "",
          inputId: entry?.inputId || "",
          token: entry?.token || "",
          previewUrl: entry?.previewUrl || "",
          pixelWidth: Number.isFinite(entry?.pixelWidth) ? entry.pixelWidth : 0,
          pixelHeight: Number.isFinite(entry?.pixelHeight) ? entry.pixelHeight : 0,
          sources: Array.isArray(entry?.sources) ? entry.sources.filter(Boolean).slice(0, 6) : [],
        })),
        hasPlaceitCustomGraphic: placeitCustomGraphics.length > 0,
        hasGradientBackground: /gradient\(/i.test(style.backgroundImage || ""),
        hasCanvasLayer,
        hasReadableCanvasLayer,
        hasUnreadableCanvasLayer: hasCanvasLayer && !hasReadableCanvasLayer,
      },
      placeitV4,
      layers: collectLayers(element),
      rawHtmlSnippet: element.outerHTML.slice(0, 2400),
    };
  }

  return new Promise((resolve) => {
    if (window.__imageDownloaderCleanupSelection) {
      window.__imageDownloaderCleanupSelection();
    }

    if (window.__imageDownloaderCleanupInspector) {
      window.__imageDownloaderCleanupInspector();
    }

    const overlayAttr = "data-image-downloader-analysis-ui";
    const SELECTABLE_ATTRIBUTE = "data-image-downloader-analysis-selectable";
    const CURRENT_ATTRIBUTE = "data-image-downloader-analysis-current";
    const MIN_SELECTABLE_SIZE = 48;
    const MAX_SELECTABLE_MARKERS = 220;

    document.getElementById("__image_downloader_analysis_selectable_style")?.remove();
    const selectableStyle = document.createElement("style");
    selectableStyle.id = "__image_downloader_analysis_selectable_style";
    selectableStyle.textContent = `
      [${SELECTABLE_ATTRIBUTE}="1"] {
        outline: 2px dashed rgba(45, 212, 191, 0.95) !important;
        outline-offset: -1px !important;
        cursor: crosshair !important;
      }

      [${CURRENT_ATTRIBUTE}="1"] {
        outline: 2px solid #22d3c5 !important;
        box-shadow: inset 0 0 0 1px rgba(34, 211, 197, 0.45) !important;
      }
    `;
    document.documentElement.append(selectableStyle);

    const highlight = document.createElement("div");
    highlight.style.position = "fixed";
    highlight.style.zIndex = "2147483647";
    highlight.style.pointerEvents = "none";
    highlight.style.border = "2px solid #22d3c5";
    highlight.style.borderRadius = "10px";
    highlight.style.background = "rgba(34, 211, 197, 0.12)";
    highlight.style.boxShadow = "0 0 0 1px rgba(16, 185, 129, 0.45) inset";
    highlight.setAttribute(overlayAttr, "1");

    const label = document.createElement("div");
    label.style.position = "fixed";
    label.style.zIndex = "2147483647";
    label.style.pointerEvents = "none";
    label.style.padding = "6px 10px";
    label.style.borderRadius = "999px";
    label.style.background = "#052b32";
    label.style.color = "#d1fae5";
    label.style.font = "12px Arial, sans-serif";
    label.style.boxShadow = "0 10px 24px rgba(0, 0, 0, 0.32)";
    label.setAttribute(overlayAttr, "1");

    const hint = document.createElement("div");
    hint.style.position = "fixed";
    hint.style.left = "50%";
    hint.style.bottom = "16px";
    hint.style.transform = "translateX(-50%)";
    hint.style.zIndex = "2147483647";
    hint.style.pointerEvents = "none";
    hint.style.padding = "8px 12px";
    hint.style.borderRadius = "999px";
    hint.style.background = "#0f172a";
    hint.style.color = "#e2e8f0";
    hint.style.font = "12px Arial, sans-serif";
    hint.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.35)";
    hint.textContent =
      "Analisi activa: clica directament el quadradet del bloc. Esc per cancel-lar.";
    hint.setAttribute(overlayAttr, "1");

    let currentElement = null;
    let previousCurrentElement = null;
    const outlinedElements = new Set();
    let settled = false;
    let scheduledRefresh = null;
    const previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";

    function isSelectableElement(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      if (
        element === document.documentElement ||
        element === document.body ||
        element.hasAttribute(overlayAttr)
      ) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width < MIN_SELECTABLE_SIZE || rect.height < MIN_SELECTABLE_SIZE) {
        return false;
      }

      if (
        rect.bottom <= 0 ||
        rect.right <= 0 ||
        rect.top >= window.innerHeight ||
        rect.left >= window.innerWidth
      ) {
        return false;
      }

      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) < 0.05
      ) {
        return false;
      }

      return true;
    }

    function clearSelectableOutlines() {
      for (const element of outlinedElements) {
        element.removeAttribute(SELECTABLE_ATTRIBUTE);
        element.removeAttribute(CURRENT_ATTRIBUTE);
      }

      outlinedElements.clear();
    }

    function refreshSelectableOutlines() {
      clearSelectableOutlines();

      let count = 0;
      for (const element of document.querySelectorAll("*")) {
        if (count >= MAX_SELECTABLE_MARKERS) {
          break;
        }

        if (!isSelectableElement(element)) {
          continue;
        }

        element.setAttribute(SELECTABLE_ATTRIBUTE, "1");
        outlinedElements.add(element);
        count += 1;
      }
    }

    function scheduleOutlineRefresh() {
      if (scheduledRefresh !== null) {
        return;
      }

      scheduledRefresh = requestAnimationFrame(() => {
        scheduledRefresh = null;
        refreshSelectableOutlines();

        if (currentElement) {
          updateHighlight(currentElement);
        }
      });
    }

    function getCandidateElement(target) {
      let candidate = target;

      while (
        candidate &&
        candidate !== document.body &&
        candidate !== document.documentElement
      ) {
        if (candidate.getAttribute(SELECTABLE_ATTRIBUTE) === "1") {
          return candidate;
        }

        candidate = candidate.parentElement;
      }

      return isSelectableElement(target) ? target : null;
    }

    function updateHighlight(element) {
      if (!element) {
        return;
      }

      currentElement = getCandidateElement(element);
      if (!currentElement) {
        return;
      }

      if (previousCurrentElement && previousCurrentElement !== currentElement) {
        previousCurrentElement.removeAttribute(CURRENT_ATTRIBUTE);
      }
      currentElement.setAttribute(CURRENT_ATTRIBUTE, "1");
      previousCurrentElement = currentElement;

      const rect = currentElement.getBoundingClientRect();
      highlight.style.left = `${rect.left}px`;
      highlight.style.top = `${rect.top}px`;
      highlight.style.width = `${Math.max(1, rect.width)}px`;
      highlight.style.height = `${Math.max(1, rect.height)}px`;
      label.textContent = `${currentElement.tagName.toLowerCase()} · ${Math.round(rect.width)} x ${Math.round(rect.height)}`;
      label.style.left = `${Math.max(8, rect.left)}px`;
      label.style.top = `${Math.max(8, rect.top - 34)}px`;
    }

    function cleanup() {
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", scheduleOutlineRefresh, true);
      window.removeEventListener("resize", scheduleOutlineRefresh, true);
      if (scheduledRefresh !== null) {
        cancelAnimationFrame(scheduledRefresh);
      }
      highlight.remove();
      label.remove();
      hint.remove();
      clearSelectableOutlines();
      selectableStyle.remove();
      document.documentElement.style.cursor = previousCursor;
      delete window.__imageDownloaderCleanupInspector;
    }

    function resolveOnce(payload) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(payload);
    }

    function handleMouseMove(event) {
      updateHighlight(document.elementFromPoint(event.clientX, event.clientY));
    }

    function handleClick(event) {
      event.preventDefault();
      event.stopPropagation();
      updateHighlight(document.elementFromPoint(event.clientX, event.clientY));
      const candidate = currentElement;

      if (!candidate) {
        resolveOnce({ cancelled: true });
        return;
      }

      try {
        const analysis = extractElementAnalysis(candidate);
        resolveOnce({
          cancelled: false,
          analysis,
        });
      } catch (error) {
        resolveOnce({
          cancelled: false,
          error: String(error),
        });
      }
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      resolveOnce({ cancelled: true });
    }

    window.__imageDownloaderCleanupInspector = () => {
      resolveOnce({ cancelled: true });
    };

    document.body.append(highlight, label, hint);
    refreshSelectableOutlines();
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", scheduleOutlineRefresh, true);
    window.addEventListener("resize", scheduleOutlineRefresh, true);
  });
}

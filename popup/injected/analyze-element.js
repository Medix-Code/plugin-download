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
    const nodes = [element, ...element.querySelectorAll("*")].slice(0, 500);

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
      }

      if (sampleTexts.length < 12) {
        const snippet = normalizeWhitespace(node.textContent || "");
        if (snippet && !sampleTexts.includes(snippet)) {
          sampleTexts.push(snippet.slice(0, 220));
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
      styles: {
        color: style.color,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
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
        hasGradientBackground: /gradient\(/i.test(style.backgroundImage || ""),
      },
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
    hint.textContent = "Analisi activa: clica un element. Esc per cancel-lar.";
    hint.setAttribute(overlayAttr, "1");

    let currentElement = null;
    let settled = false;
    const previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";

    function getCandidateElement(event) {
      let candidate = document.elementFromPoint(event.clientX, event.clientY);

      while (
        candidate &&
        candidate instanceof Element &&
        candidate.hasAttribute(overlayAttr)
      ) {
        candidate = candidate.parentElement;
      }

      while (
        candidate &&
        candidate instanceof Element &&
        (candidate === document.documentElement || candidate === document.body)
      ) {
        candidate = null;
      }

      return candidate instanceof Element ? candidate : null;
    }

    function updateHighlight(element) {
      if (!(element instanceof Element)) {
        return;
      }

      currentElement = element;
      const rect = element.getBoundingClientRect();
      highlight.style.left = `${rect.left}px`;
      highlight.style.top = `${rect.top}px`;
      highlight.style.width = `${Math.max(1, rect.width)}px`;
      highlight.style.height = `${Math.max(1, rect.height)}px`;
      label.textContent = `${element.tagName.toLowerCase()} · ${Math.round(rect.width)} x ${Math.round(rect.height)}`;
      label.style.left = `${Math.max(8, rect.left)}px`;
      label.style.top = `${Math.max(8, rect.top - 34)}px`;
    }

    function cleanup() {
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      highlight.remove();
      label.remove();
      hint.remove();
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
      const candidate = getCandidateElement(event);
      if (candidate) {
        updateHighlight(candidate);
      }
    }

    function handleClick(event) {
      event.preventDefault();
      event.stopPropagation();
      const candidate = getCandidateElement(event) || currentElement;

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
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
  });
}

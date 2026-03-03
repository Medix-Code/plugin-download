import { ACTIONS } from "../../shared/messages.js";
import { debugLog } from "../../shared/logger.js";
import {
  buildBlockCaptureFilename,
  buildCaptureFilename,
  buildFullPageCaptureFilename,
  downloadCaptureBlob,
  downloadCaptureDataUrl,
  normalizeUpscaleOptions,
} from "../downloads/index.js";
import { wait } from "../downloads/core.js";

const CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS = 550;
const FULL_PAGE_CAPTURE_MAX_ATTEMPTS = 3;
const BLOCK_CAPTURE_TRIM_CSS_PX = 1;
const TILE_SIGNATURE_SAMPLE_SIZE = 16;
const BLANK_TILE_VARIANCE_THRESHOLD = 6;
const BLANK_TILE_LUMA_MIN = 8;
const BLANK_TILE_LUMA_MAX = 247;
const DUPLICATE_CAPTURE_MIN_DELTA_RATIO = 0.25;

let lastCaptureVisibleTabAt = 0;

function buildCaptureSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sendFullPageProgress(progress) {
  chrome.runtime.sendMessage(
    {
      action: ACTIONS.FULL_PAGE_CAPTURE_PROGRESS,
      progress,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
}

function sendElementCaptureStatus(status) {
  chrome.runtime.sendMessage(
    {
      action: ACTIONS.ELEMENT_CAPTURE_STATUS,
      status,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
}

export function focusTabWindow(tabId, windowId) {
  return new Promise((resolve, reject) => {
    chrome.windows.update(windowId, { focused: true }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      chrome.tabs.update(tabId, { active: true }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  });
}

function buildCapturePositions(totalSize, viewportSize) {
  if (
    !Number.isFinite(totalSize) ||
    !Number.isFinite(viewportSize) ||
    totalSize <= viewportSize
  ) {
    return [0];
  }

  const positions = [];

  for (let offset = 0; offset < totalSize; offset += viewportSize) {
    positions.push(offset);
  }

  positions.push(Math.max(0, totalSize - viewportSize));
  return Array.from(new Set(positions)).sort((left, right) => left - right);
}

function captureVisibleTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        reject(
          new Error(
            chrome.runtime.lastError?.message ||
              "No s'ha pogut capturar la pestanya visible.",
          ),
        );
        return;
      }

      resolve(dataUrl);
    });
  });
}

async function captureVisibleTabRateLimited(windowId) {
  const elapsed = Date.now() - lastCaptureVisibleTabAt;

  if (elapsed < CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS) {
    await wait(CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS - elapsed);
  }

  const dataUrl = await captureVisibleTab(windowId);
  lastCaptureVisibleTabAt = Date.now();
  return dataUrl;
}

function getFullPageCaptureMetrics(hideFixedSticky = true) {
  const scrollingElement =
    document.scrollingElement || document.documentElement;
  const doc = document.documentElement;
  const body = document.body;
  const hiddenElements = [];
  const originalScrollBehavior = doc.style.scrollBehavior;
  const style = document.createElement("style");

  style.id = "__image_downloader_fullpage_style";
  style.textContent = `
    html, body {
      scroll-behavior: auto !important;
    }

    [data-image-downloader-fixed-hidden="true"] {
      visibility: hidden !important;
    }

    *,
    *::before,
    *::after {
      transition: none !important;
      animation: none !important;
      caret-color: transparent !important;
    }
  `;
  document.documentElement.append(style);

  if (hideFixedSticky) {
    for (const element of document.querySelectorAll("*")) {
      const computedStyle = window.getComputedStyle(element);

      if (
        (computedStyle.position === "fixed" ||
          computedStyle.position === "sticky") &&
        computedStyle.display !== "none" &&
        computedStyle.visibility !== "hidden"
      ) {
        element.setAttribute("data-image-downloader-fixed-hidden", "true");
        hiddenElements.push(element);
      }
    }
  }

  const cleanup = () => {
    for (const element of hiddenElements) {
      element.removeAttribute("data-image-downloader-fixed-hidden");
    }

    style.remove();
    doc.style.scrollBehavior = originalScrollBehavior;
    delete window.__imageDownloaderFullPageCleanup;
  };

  window.__imageDownloaderFullPageCleanup = cleanup;

  return {
    originalScrollX: window.scrollX,
    originalScrollY: window.scrollY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    totalWidth: Math.max(
      scrollingElement.scrollWidth,
      doc.scrollWidth,
      body ? body.scrollWidth : 0,
      window.innerWidth,
    ),
    totalHeight: Math.max(
      scrollingElement.scrollHeight,
      doc.scrollHeight,
      body ? body.scrollHeight : 0,
      window.innerHeight,
    ),
  };
}

async function scrollPageForCapture(targetX, targetY) {
  window.scrollTo(targetX, targetY);

  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });

  return {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}

async function analyzeCapturedBitmap(bitmap) {
  const canvas = new OffscreenCanvas(
    TILE_SIGNATURE_SAMPLE_SIZE,
    TILE_SIGNATURE_SAMPLE_SIZE,
  );
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return {
      signature: `fallback-${bitmap.width}x${bitmap.height}`,
      blankLike: false,
      variance: 0,
      meanLuma: 0,
      alphaCoverage: 1,
    };
  }

  context.drawImage(
    bitmap,
    0,
    0,
    TILE_SIGNATURE_SAMPLE_SIZE,
    TILE_SIGNATURE_SAMPLE_SIZE,
  );
  const imageData = context.getImageData(
    0,
    0,
    TILE_SIGNATURE_SAMPLE_SIZE,
    TILE_SIGNATURE_SAMPLE_SIZE,
  ).data;
  const pixelCount = TILE_SIGNATURE_SAMPLE_SIZE * TILE_SIGNATURE_SAMPLE_SIZE;
  let hash = 2166136261;
  let alphaCount = 0;
  let lumaSum = 0;
  let lumaSquaredSum = 0;

  for (let index = 0; index < imageData.length; index += 4) {
    const red = imageData[index];
    const green = imageData[index + 1];
    const blue = imageData[index + 2];
    const alpha = imageData[index + 3];
    const luma =
      (0.2126 * red + 0.7152 * green + 0.0722 * blue) * (alpha / 255);

    if (alpha > 10) {
      alphaCount += 1;
    }

    lumaSum += luma;
    lumaSquaredSum += luma * luma;
    hash ^= ((red >> 4) << 8) ^ ((green >> 4) << 4) ^ (blue >> 4);
    hash = Math.imul(hash, 16777619);
  }

  const meanLuma = lumaSum / pixelCount;
  const variance = lumaSquaredSum / pixelCount - meanLuma * meanLuma;
  const alphaCoverage = alphaCount / pixelCount;
  const blankLike =
    alphaCoverage < 0.08 ||
    (variance < BLANK_TILE_VARIANCE_THRESHOLD &&
      (meanLuma <= BLANK_TILE_LUMA_MIN || meanLuma >= BLANK_TILE_LUMA_MAX));

  return {
    signature: String(hash >>> 0),
    blankLike,
    variance,
    meanLuma,
    alphaCoverage,
  };
}

function getSuspiciousCaptureReasons({
  diagnostics,
  previousTile,
  viewportWidth,
  viewportHeight,
  scrollX,
  scrollY,
}) {
  const reasons = [];

  if (diagnostics.blankLike) {
    reasons.push("blank_like");
  }

  if (
    previousTile &&
    previousTile.diagnostics.signature === diagnostics.signature
  ) {
    const deltaX = Math.abs(scrollX - previousTile.scrollX);
    const deltaY = Math.abs(scrollY - previousTile.scrollY);

    if (
      deltaX >= viewportWidth * DUPLICATE_CAPTURE_MIN_DELTA_RATIO ||
      deltaY >= viewportHeight * DUPLICATE_CAPTURE_MIN_DELTA_RATIO
    ) {
      reasons.push("duplicate_like");
    }
  }

  return reasons;
}

async function scrollSourceTab(tabId, targetX, targetY) {
  const [{ result: scrolled } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: scrollPageForCapture,
    args: [targetX, targetY],
  });

  return {
    scrollX: Math.round(scrolled?.scrollX ?? targetX),
    scrollY: Math.round(scrolled?.scrollY ?? targetY),
    viewportWidth: Math.round(scrolled?.viewportWidth ?? 0),
    viewportHeight: Math.round(scrolled?.viewportHeight ?? 0),
  };
}

async function captureTileWithRetries({
  tabId,
  windowId,
  scrollX,
  scrollY,
  metrics,
  previousTile,
}) {
  let retriesUsed = 0;

  for (
    let attempt = 1;
    attempt <= FULL_PAGE_CAPTURE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    if (attempt > 1) {
      retriesUsed += 1;
      await scrollSourceTab(tabId, scrollX, scrollY);
      await wait(180 * attempt);
    }

    const visibleCapture = await captureVisibleTabRateLimited(windowId);
    const response = await fetch(visibleCapture);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const diagnostics = await analyzeCapturedBitmap(bitmap);
    const suspiciousReasons = getSuspiciousCaptureReasons({
      diagnostics,
      previousTile,
      viewportWidth: metrics.viewportWidth,
      viewportHeight: metrics.viewportHeight,
      scrollX,
      scrollY,
    });

    if (
      suspiciousReasons.length === 0 ||
      attempt === FULL_PAGE_CAPTURE_MAX_ATTEMPTS
    ) {
      return {
        bitmap,
        diagnostics,
        retriesUsed,
        suspiciousReasons,
      };
    }

    debugLog("tile sospitosa, reintentant", {
      scrollX,
      scrollY,
      attempt,
      suspiciousReasons,
      signature: diagnostics.signature,
    });
    bitmap.close?.();
  }

  throw new Error("No s'ha pogut capturar el tile de pagina.");
}

function restoreFullPageAfterCapture(scrollX, scrollY) {
  window.scrollTo(scrollX, scrollY);
  window.__imageDownloaderFullPageCleanup?.();
  return true;
}

async function cropCapturedArea(dataUrl, selection) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const scaleX = bitmap.width / selection.viewportWidth;
  const scaleY = bitmap.height / selection.viewportHeight;
  const maxTrimX = Math.max(0, (selection.width - 2) / 2);
  const maxTrimY = Math.max(0, (selection.height - 2) / 2);
  const trimX = Math.min(BLOCK_CAPTURE_TRIM_CSS_PX, maxTrimX);
  const trimY = Math.min(BLOCK_CAPTURE_TRIM_CSS_PX, maxTrimY);
  const left = Math.max(0, selection.left + trimX);
  const top = Math.max(0, selection.top + trimY);
  const right = Math.min(
    selection.viewportWidth,
    selection.left + selection.width - trimX,
  );
  const bottom = Math.min(
    selection.viewportHeight,
    selection.top + selection.height - trimY,
  );
  const sourceX = Math.ceil(left * scaleX);
  const sourceY = Math.ceil(top * scaleY);
  const sourceRight = Math.max(sourceX + 1, Math.floor(right * scaleX));
  const sourceBottom = Math.max(sourceY + 1, Math.floor(bottom * scaleY));
  const sourceWidth = Math.max(1, sourceRight - sourceX);
  const sourceHeight = Math.max(1, sourceBottom - sourceY);
  const canvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("No s'ha pogut crear el canvas de retall.");
  }

  debugLog("cropCapturedArea", {
    trimX,
    trimY,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
  });

  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );
  bitmap.close?.();

  return canvas.convertToBlob({ type: "image/png" });
}

async function blobToDataUrl(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

function removeHoverShield() {
  window.__imageDownloaderHoverShield?.remove();
  delete window.__imageDownloaderHoverShield;
}

function setupElementSelectionOverlay(captureOptions = {}) {
  const ELEMENT_SELECTED_ACTION = "elementSelectedForCapture";
  const SELECTABLE_ATTRIBUTE = "data-image-downloader-selectable";
  const CURRENT_ATTRIBUTE = "data-image-downloader-current";
  const OVERLAY_UI_ATTRIBUTE = "data-image-downloader-overlay-ui";
  const MIN_SELECTABLE_SIZE = 48;
  const MAX_SELECTABLE_MARKERS = 220;
  const pageDebugPrefix = "Descarregador d'Imatges:";
  const pageDebugLog = (...args) => {
    console.log(pageDebugPrefix, "[overlay]", ...args);
  };
  const removeOverlayHoverShield = () => {
    window.__imageDownloaderHoverShield?.remove();
    delete window.__imageDownloaderHoverShield;
  };

  if (window.__imageDownloaderCleanupSelection) {
    window.__imageDownloaderCleanupSelection();
  }

  removeOverlayHoverShield();
  pageDebugLog("overlay injectat");
  const selectableStyle = document.createElement("style");
  selectableStyle.id = "__image_downloader_selectable_style";
  selectableStyle.textContent = `
    [${SELECTABLE_ATTRIBUTE}="1"] {
      outline: 2px dashed rgba(125, 211, 252, 0.9) !important;
      outline-offset: -1px !important;
      cursor: crosshair !important;
    }

    [${CURRENT_ATTRIBUTE}="1"] {
      outline: 2px solid #14b8a6 !important;
      box-shadow: inset 0 0 0 1px rgba(20, 184, 166, 0.45) !important;
    }
  `;
  document.documentElement.append(selectableStyle);

  const highlight = document.createElement("div");
  highlight.style.position = "fixed";
  highlight.style.zIndex = "2147483647";
  highlight.style.pointerEvents = "none";
  highlight.style.border = "2px solid #14b8a6";
  highlight.style.borderRadius = "12px";
  highlight.style.background = "rgba(20, 184, 166, 0.08)";
  highlight.setAttribute(OVERLAY_UI_ATTRIBUTE, "1");

  const label = document.createElement("div");
  label.style.position = "fixed";
  label.style.zIndex = "2147483647";
  label.style.pointerEvents = "none";
  label.style.padding = "6px 10px";
  label.style.borderRadius = "999px";
  label.style.background = "#0f172a";
  label.style.color = "#e2e8f0";
  label.style.font = "12px Arial, sans-serif";
  label.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.35)";
  label.setAttribute(OVERLAY_UI_ATTRIBUTE, "1");

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
    "Mode captura: clica directament el quadradet del bloc. Esc per cancel-lar.";
  hint.setAttribute(OVERLAY_UI_ATTRIBUTE, "1");

  let currentElement = null;
  let previousCurrentElement = null;
  const outlinedElements = new Set();
  const previousCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = "crosshair";

  function isSelectableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    if (
      element === document.documentElement ||
      element === document.body ||
      element.hasAttribute(OVERLAY_UI_ATTRIBUTE)
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

    pageDebugLog("quadradets visibles", { count });
  }

  let scheduledRefresh = null;
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

  function cleanup() {
    pageDebugLog("overlay cleanup");
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("scroll", scheduleOutlineRefresh, true);
    window.removeEventListener("resize", scheduleOutlineRefresh, true);
    highlight.remove();
    label.remove();
    hint.remove();
    clearSelectableOutlines();
    selectableStyle.remove();
    document.documentElement.style.cursor = previousCursor;
    delete window.__imageDownloaderCleanupSelection;
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
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    label.textContent = `${currentElement.tagName.toLowerCase()} · ${Math.round(rect.width)} x ${Math.round(rect.height)}`;
    label.style.left = `${Math.max(8, rect.left)}px`;
    label.style.top = `${Math.max(8, rect.top - 34)}px`;
  }

  function handleMouseMove(event) {
    updateHighlight(document.elementFromPoint(event.clientX, event.clientY));
  }

  function handleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    updateHighlight(document.elementFromPoint(event.clientX, event.clientY));

    if (!currentElement) {
      pageDebugLog("clic sense element");
      cleanup();
      chrome.runtime.sendMessage({
        action: ELEMENT_SELECTED_ACTION,
        cancelled: true,
      });
      return;
    }

    const rect = currentElement.getBoundingClientRect();
    pageDebugLog("element seleccionat", {
      tagName: currentElement.tagName,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    cleanup();
    const hoverShield = document.createElement("div");
    hoverShield.style.position = "fixed";
    hoverShield.style.inset = "0";
    hoverShield.style.zIndex = "2147483646";
    hoverShield.style.pointerEvents = "auto";
    hoverShield.style.background = "transparent";
    hoverShield.style.cursor = "default";
    document.body.append(hoverShield);
    window.__imageDownloaderHoverShield = hoverShield;

    chrome.runtime.sendMessage({
      action: ELEMENT_SELECTED_ACTION,
      saveAs: captureOptions?.saveAs === true,
      upscale: captureOptions?.upscale || {},
      selection: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      },
    });
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape") {
      return;
    }

    pageDebugLog("captura bloc cancel-lada amb Escape");
    event.preventDefault();
    cleanup();
    chrome.runtime.sendMessage({
      action: ELEMENT_SELECTED_ACTION,
      cancelled: true,
    });
  }

  window.__imageDownloaderCleanupSelection = cleanup;
  document.body.append(highlight, label, hint);
  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("scroll", scheduleOutlineRefresh, true);
  window.addEventListener("resize", scheduleOutlineRefresh, true);
  refreshSelectableOutlines();
  updateHighlight(
    document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2),
  );
  return true;
}

export async function injectElementSelectionOverlay(tabId, options = {}) {
  debugLog("injectElementSelectionOverlay", { tabId, options });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: setupElementSelectionOverlay,
    args: [options],
  });
  debugLog("overlay injectat correctament", { tabId });
}

export async function runElementCaptureSelection(
  tabId,
  windowId,
  selection,
  options = {},
) {
  debugLog("runElementCaptureSelection", {
    tabId,
    windowId,
    selection,
    options,
  });
  await wait(120);

  try {
    const fullCapture = await captureVisibleTabRateLimited(windowId);
    const croppedBlob = await cropCapturedArea(fullCapture, selection);
    const result = await downloadCaptureBlob(
      croppedBlob,
      buildBlockCaptureFilename(),
      {
        ...options,
        operation: options.operation || "Captura bloc",
        windowId,
      },
    );
    debugLog("captura de bloc completada", result);
    sendElementCaptureStatus({
      tabId,
      windowId,
      phase: "done",
      upscaled: result.upscaled,
      upscaleFactor: result.factor,
      filename: result.filename,
    });
    return result;
  } finally {
    await chrome.scripting
      .executeScript({
        target: { tabId },
        func: removeHoverShield,
      })
      .catch(() => {});
  }
}

export async function runFullPageCapture(tabId, windowId, options = {}) {
  const captureId = buildCaptureSessionId();
  const hideFixedSticky = options.hideFixedSticky !== false;
  const upscale = normalizeUpscaleOptions(options.upscale);

  debugLog("runFullPageCapture", {
    tabId,
    windowId,
    captureId,
    hideFixedSticky,
    upscale,
  });
  await focusTabWindow(tabId, windowId);

  const [{ result: metrics } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: getFullPageCaptureMetrics,
    args: [hideFixedSticky],
  });

  if (!metrics) {
    throw new Error("No s'ha pogut preparar la captura de pagina.");
  }

  const xPositions = buildCapturePositions(
    metrics.totalWidth,
    metrics.viewportWidth,
  );
  const yPositions = buildCapturePositions(
    metrics.totalHeight,
    metrics.viewportHeight,
  );
  const capturedTiles = new Set();
  const totalTiles = xPositions.length * yPositions.length;
  let canvas = null;
  let context = null;
  let scaleX = 1;
  let scaleY = 1;
  let segmentCount = 0;
  let processedTiles = 0;
  let retries = 0;
  let skippedDuplicatePositions = 0;
  let previousTile = null;

  sendFullPageProgress({
    captureId,
    tabId,
    windowId,
    phase: "started",
    current: 0,
    total: totalTiles,
    retries,
    skippedDuplicatePositions,
    message: "Preparant captura de pagina...",
  });

  try {
    for (const targetScrollY of yPositions) {
      for (const targetScrollX of xPositions) {
        const scrolled = await scrollSourceTab(
          tabId,
          targetScrollX,
          targetScrollY,
        );
        const actualScrollX = scrolled.scrollX;
        const actualScrollY = scrolled.scrollY;
        const tileKey = `${actualScrollX}:${actualScrollY}`;

        if (capturedTiles.has(tileKey)) {
          processedTiles += 1;
          skippedDuplicatePositions += 1;
          sendFullPageProgress({
            captureId,
            tabId,
            windowId,
            phase: "capturing",
            current: processedTiles,
            total: totalTiles,
            retries,
            skippedDuplicatePositions,
            message: "Saltant una posicio repetida...",
          });
          continue;
        }

        const tileCapture = await captureTileWithRetries({
          tabId,
          windowId,
          scrollX: actualScrollX,
          scrollY: actualScrollY,
          metrics,
          previousTile,
        });
        const bitmap = tileCapture.bitmap;

        retries += tileCapture.retriesUsed;

        if (!canvas) {
          scaleX = bitmap.width / metrics.viewportWidth;
          scaleY = bitmap.height / metrics.viewportHeight;
          canvas = new OffscreenCanvas(
            Math.max(1, Math.round(metrics.totalWidth * scaleX)),
            Math.max(1, Math.round(metrics.totalHeight * scaleY)),
          );
          context = canvas.getContext("2d");

          if (!context) {
            throw new Error(
              "No s'ha pogut crear el canvas final de la pagina.",
            );
          }
        }

        const visibleWidth = Math.min(
          metrics.viewportWidth,
          metrics.totalWidth - actualScrollX,
        );
        const visibleHeight = Math.min(
          metrics.viewportHeight,
          metrics.totalHeight - actualScrollY,
        );
        const sourceWidth = Math.max(1, Math.round(visibleWidth * scaleX));
        const sourceHeight = Math.max(1, Math.round(visibleHeight * scaleY));
        const destinationX = Math.round(actualScrollX * scaleX);
        const destinationY = Math.round(actualScrollY * scaleY);

        context.drawImage(
          bitmap,
          0,
          0,
          sourceWidth,
          sourceHeight,
          destinationX,
          destinationY,
          sourceWidth,
          sourceHeight,
        );

        capturedTiles.add(tileKey);
        segmentCount += 1;
        processedTiles += 1;
        previousTile = {
          scrollX: actualScrollX,
          scrollY: actualScrollY,
          diagnostics: tileCapture.diagnostics,
        };
        bitmap.close?.();

        sendFullPageProgress({
          captureId,
          tabId,
          windowId,
          phase: "capturing",
          current: processedTiles,
          total: totalTiles,
          retries,
          skippedDuplicatePositions,
          message: `Capturant pagina... ${processedTiles}/${totalTiles}`,
        });
      }
    }

    if (!canvas) {
      throw new Error("No s'ha pogut construir la captura de pagina.");
    }

    sendFullPageProgress({
      captureId,
      tabId,
      windowId,
      phase: "stitching",
      current: totalTiles,
      total: totalTiles,
      retries,
      skippedDuplicatePositions,
      message: "Cosint la captura final...",
    });

    const finalBlob = await canvas.convertToBlob({ type: "image/png" });
    const downloadResult = await downloadCaptureBlob(
      finalBlob,
      buildFullPageCaptureFilename(),
      {
        saveAs: options.saveAs === true,
        upscale,
        operation: options.operation || "Captura pagina",
        windowId,
      },
    );
    debugLog("captura de pagina completada", {
      segmentCount,
      retries,
      skippedDuplicatePositions,
      downloadResult,
    });
    sendFullPageProgress({
      captureId,
      tabId,
      windowId,
      phase: "done",
      current: totalTiles,
      total: totalTiles,
      retries,
      skippedDuplicatePositions,
      message: "Captura de pagina completada.",
    });
    return {
      segmentCount,
      retries,
      skippedDuplicatePositions,
      upscaled: downloadResult.upscaled,
      upscaleFactor: downloadResult.factor,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    sendFullPageProgress({
      captureId,
      tabId,
      windowId,
      phase: "error",
      current: processedTiles,
      total: totalTiles,
      retries,
      skippedDuplicatePositions,
      message: `Error durant la captura de pagina. ${errorMessage}`,
    });
    throw error;
  } finally {
    await chrome.scripting
      .executeScript({
        target: { tabId },
        func: restoreFullPageAfterCapture,
        args: [metrics.originalScrollX, metrics.originalScrollY],
      })
      .catch(() => {});
  }
}

export async function captureVisibleTabAndDownload(windowId, options = {}) {
  const dataUrl = await captureVisibleTabRateLimited(windowId);
  return downloadCaptureDataUrl(dataUrl, buildCaptureFilename(), {
    saveAs: options.saveAs === true,
    operation: options.operation || "Captura vista",
    upscale: options.upscale,
    windowId,
  });
}

export async function captureVisibleTabSnapshot(windowId, selection = null) {
  const fullCapture = await captureVisibleTabRateLimited(windowId);

  if (!selection) {
    return fullCapture;
  }

  const croppedBlob = await cropCapturedArea(fullCapture, selection);
  return blobToDataUrl(croppedBlob);
}

export function notifyElementCaptureCancelled(tabId, windowId) {
  sendElementCaptureStatus({
    tabId,
    windowId,
    phase: "cancelled",
  });
}

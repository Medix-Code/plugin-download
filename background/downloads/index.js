import { emitPluginLog } from "../../shared/logger.js";
import { getErrorMessage } from "../../shared/errors.js";
import {
  buildArchiveFilename,
  buildBlockCaptureFilename,
  buildCaptureFilename,
  buildFilename,
  buildFullPageCaptureFilename,
  getFileExtension,
  buildUpscaledPngFilename,
  normalizeDownloadLocationOptions,
  sanitizeArchiveSegment,
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

function normalizeArchiveExtraEntries(entries = []) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const encoder = new TextEncoder();
  const normalized = [];

  for (const [index, entry] of entries.entries()) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.name !== "string" ||
      typeof entry.text !== "string"
    ) {
      continue;
    }

    const rawName = entry.name.trim();
    const safeName = rawName ? sanitizeArchiveSegment(rawName) : `fitxer_${index + 1}.txt`;

    normalized.push({
      name: safeName,
      bytes: new Uint8Array(encoder.encode(entry.text)),
    });
  }

  return normalized;
}

function normalizeArchiveTemplate(template) {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    return null;
  }

  return template;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildHrefAttributes(value) {
  const escaped = escapeXml(value);
  return `href="${escaped}" xlink:href="${escaped}"`;
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getFirstKnownSource(sources, sourceToFilenameMap) {
  if (!Array.isArray(sources)) {
    return "";
  }

  for (const source of sources) {
    if (typeof source !== "string" || !source) {
      continue;
    }

    if (sourceToFilenameMap.has(source)) {
      return sourceToFilenameMap.get(source) || "";
    }
  }

  return "";
}

function buildSvgIdToken(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+/, "")
    .slice(0, 72);

  if (normalized) {
    return normalized;
  }

  return String(fallback || "layer");
}

function extractFirstUrlFromCssValue(value) {
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

function extractAttributeValue(rawAttributes, attributeName) {
  const source = String(rawAttributes || "");
  const pattern = new RegExp(
    `${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i",
  );
  const match = source.match(pattern);
  if (!match) {
    return "";
  }
  return String(match[1] || match[2] || "").trim();
}

function parseSvgLength(value) {
  const parsed = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseSvgViewBox(value) {
  const parts = String(value || "")
    .trim()
    .split(/[\s,]+/)
    .map((token) => Number.parseFloat(token))
    .filter((token) => Number.isFinite(token));

  if (parts.length !== 4) {
    return null;
  }

  const [minX, minY, width, height] = parts;
  if (width <= 0 || height <= 0) {
    return null;
  }

  return { minX, minY, width, height };
}

function parseSvgDocument(svgText) {
  const source = String(svgText || "").trim();
  if (!source) {
    return null;
  }

  const match = source.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
  if (!match) {
    return null;
  }

  const rawAttributes = match[1] || "";
  const rawBody = (match[2] || "").trim();
  if (!rawBody) {
    return null;
  }

  const viewBoxRaw = extractAttributeValue(rawAttributes, "viewBox");
  const parsedViewBox = parseSvgViewBox(viewBoxRaw);
  const widthFromAttr = parseSvgLength(extractAttributeValue(rawAttributes, "width"));
  const heightFromAttr = parseSvgLength(extractAttributeValue(rawAttributes, "height"));

  const minX = parsedViewBox ? parsedViewBox.minX : 0;
  const minY = parsedViewBox ? parsedViewBox.minY : 0;
  const width = parsedViewBox ? parsedViewBox.width : widthFromAttr || 1;
  const height = parsedViewBox ? parsedViewBox.height : heightFromAttr || 1;
  const viewBox = `${minX} ${minY} ${width} ${height}`;

  return {
    body: rawBody,
    viewBox,
  };
}

function getEmbeddedSvgAsset({
  href,
  idPrefix,
  sourceToSvgTextMap,
  defs,
  embeddedSvgRegistry,
}) {
  const key = String(href || "").trim();
  if (!key) {
    return null;
  }

  const cached = embeddedSvgRegistry.get(key);
  if (cached) {
    return cached;
  }

  const svgText = sourceToSvgTextMap.get(key);
  if (typeof svgText !== "string" || !/<svg[\s>]/i.test(svgText)) {
    return null;
  }

  const parsed = parseSvgDocument(svgText);
  if (!parsed) {
    return null;
  }

  const symbolId = `${buildSvgIdToken(idPrefix, "asset")}_symbol`;
  defs.push(`<symbol id="${symbolId}" viewBox="${parsed.viewBox}">${parsed.body}</symbol>`);

  const info = {
    symbolId,
    viewBox: parsed.viewBox,
  };
  embeddedSvgRegistry.set(key, info);
  return info;
}

function getMaskPreserveAspectRatio(maskSizeValue) {
  const normalized = String(maskSizeValue || "").toLowerCase();
  if (normalized.includes("contain")) {
    return "xMidYMid meet";
  }
  if (normalized.includes("cover")) {
    return "xMidYMid slice";
  }
  return "none";
}

function parseRadiusToken(token, size) {
  const raw = String(token || "").trim();
  if (!raw) {
    return 0;
  }

  if (/%$/i.test(raw)) {
    const parsedPercent = Number.parseFloat(raw.replace(/%$/i, "").trim());
    if (!Number.isFinite(parsedPercent) || parsedPercent <= 0) {
      return 0;
    }
    return (size * parsedPercent) / 100;
  }

  if (/px$/i.test(raw)) {
    const parsedPx = Number.parseFloat(raw.replace(/px$/i, "").trim());
    if (!Number.isFinite(parsedPx) || parsedPx <= 0) {
      return 0;
    }
    return parsedPx;
  }

  const parsedNumber = Number.parseFloat(raw);
  if (!Number.isFinite(parsedNumber) || parsedNumber <= 0) {
    return 0;
  }
  return parsedNumber;
}

function extractRadius(borderRadiusValue, width, height, options = {}) {
  const raw = String(borderRadiusValue || "").trim();
  if (!raw || raw === "0" || raw === "0px") {
    return { rx: 0, ry: 0 };
  }

  const radiusPart = raw.split("/")[0].trim();
  const tokens = radiusPart.split(/\s+/).filter(Boolean);
  const firstToken = tokens[0] || "";

  let rx = parseRadiusToken(firstToken, width);
  let ry = parseRadiusToken(firstToken, height);

  if (!Number.isFinite(rx) || rx <= 0 || !Number.isFinite(ry) || ry <= 0) {
    return { rx: 0, ry: 0 };
  }

  if (options.allowLarge !== true) {
    const minSide = Math.max(1, Math.min(width, height));
    const safeMax = minSide * 0.2;
    if (rx > safeMax || ry > safeMax) {
      return { rx: 0, ry: 0 };
    }
  }

  rx = Math.max(0, Math.min(rx, width / 2));
  ry = Math.max(0, Math.min(ry, height / 2));
  return { rx, ry };
}

function parsePx(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value || "").replace("px", "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSvgColor(value) {
  const color = String(value || "").trim();
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") {
    return "";
  }
  return color;
}

function rgbToHexHint(colorValue) {
  const rgb = parseColorToRgbComponents(colorValue);
  if (!rgb) {
    return "color";
  }
  const toHex = (value) => Math.round(value).toString(16).padStart(2, "0");
  return `${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function extractLayerNameHint(layer, fallbackIndex = 0) {
  const rawId = String(layer?.id || "").trim();
  if (rawId && !/^layer_\d+$/i.test(rawId)) {
    return sanitizeArchiveSegment(rawId).slice(0, 40) || `item${fallbackIndex + 1}`;
  }

  const selector = String(layer?.selector || "");
  const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch?.[1]) {
    return sanitizeArchiveSegment(idMatch[1]).slice(0, 40) || `item${fallbackIndex + 1}`;
  }

  const nthMatches = [...selector.matchAll(/nth-of-type\((\d+)\)/g)];
  const lastNth = nthMatches.length > 0 ? nthMatches[nthMatches.length - 1]?.[1] : "";
  if (lastNth) {
    return `item${lastNth}`;
  }

  const tagName = String(layer?.tagName || "").trim().toLowerCase();
  if (tagName) {
    return `${tagName}${fallbackIndex + 1}`;
  }

  return `item${fallbackIndex + 1}`;
}

function resolveMappedSourceHref(rawHref, sourceToFilenameMap) {
  const source = String(rawHref || "").trim();
  if (!source) {
    return "";
  }
  if (sourceToFilenameMap.has(source)) {
    return sourceToFilenameMap.get(source) || source;
  }
  return source;
}

function buildDuplicateMaskLayerEntries(
  template,
  sourceToFilenameMap,
  sourceToSvgTextMap,
) {
  const layers = Array.isArray(template?.layers) ? template.layers : [];
  if (layers.length === 0) {
    return [];
  }

  const encoder = new TextEncoder();
  const maskUsage = new Map();
  for (const layer of layers) {
    const rawMaskHref = extractFirstUrlFromCssValue(layer?.maskImage);
    if (!rawMaskHref) {
      continue;
    }
    maskUsage.set(rawMaskHref, (maskUsage.get(rawMaskHref) || 0) + 1);
  }

  const createdNames = new Set();
  const entries = [];

  for (const [index, layer] of layers.entries()) {
    const rawMaskHref = extractFirstUrlFromCssValue(layer?.maskImage);
    if (!rawMaskHref) {
      continue;
    }

    const occurrences = Number(maskUsage.get(rawMaskHref) || 0);
    if (occurrences <= 1) {
      continue;
    }

    const mappedMaskHref = resolveMappedSourceHref(rawMaskHref, sourceToFilenameMap);
    const maskSvgText =
      sourceToSvgTextMap.get(mappedMaskHref) || sourceToSvgTextMap.get(rawMaskHref) || "";
    if (!maskSvgText) {
      continue;
    }

    const parsedMask = parseSvgDocument(maskSvgText);
    if (!parsedMask) {
      continue;
    }

    const rect = layer?.rect || {};
    const width = Math.max(1, Math.round(toFiniteNumber(rect.width, 0)));
    const height = Math.max(1, Math.round(toFiniteNumber(rect.height, 0)));
    const fill = normalizeSvgColor(layer?.backgroundColor) || "#000000";
    const opacity = Math.max(0, Math.min(1, toFiniteNumber(layer?.opacity, 1)));
    const opacityAttr = opacity < 1 ? ` opacity="${opacity}"` : "";
    const preserveAspectRatio = getMaskPreserveAspectRatio(layer?.maskSize);
    const symbolId = `shape_${index + 1}_symbol`;

    const shapeDefs = [];
    const tintFilter = buildAlphaTintFilter(fill, shapeDefs, `shape_${index + 1}`);
    shapeDefs.push(`<symbol id="${symbolId}" viewBox="${parsedMask.viewBox}">${parsedMask.body}</symbol>`);
    const shapeNode = tintFilter
      ? `<svg x="0" y="0" width="${width}" height="${height}" viewBox="${parsedMask.viewBox}" preserveAspectRatio="${preserveAspectRatio}"${opacityAttr}><use ${buildHrefAttributes(`#${symbolId}`)} filter="${tintFilter}" /></svg>`
      : `<svg x="0" y="0" width="${width}" height="${height}" viewBox="${parsedMask.viewBox}" preserveAspectRatio="${preserveAspectRatio}"${opacityAttr}><use ${buildHrefAttributes(`#${symbolId}`)} style="fill:${escapeXml(fill)};" /></svg>`;

    const svgText = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<defs>${shapeDefs.join("")}</defs>`,
      shapeNode,
      "</svg>",
    ].join("\n");

    const maskBaseName = sanitizeArchiveSegment(
      rawMaskHref.split("/").pop()?.replace(/\.[^.]+$/, "") || "shape",
    );
    const layerHint = extractLayerNameHint(layer, index);
    const colorHint = rgbToHexHint(fill);
    const sizeHint = `${width}x${height}`;
    let filename = `${String(index + 1).padStart(2, "0")}_${maskBaseName}_${layerHint}_${sizeHint}_${colorHint}.svg`;
    if (filename.length > 120) {
      filename = `${String(index + 1).padStart(2, "0")}_${maskBaseName}_${layerHint}_${colorHint}.svg`;
    }
    if (createdNames.has(filename)) {
      filename = `${String(index + 1).padStart(2, "0")}_${maskBaseName}_${layerHint}_${colorHint}_${createdNames.size + 1}.svg`;
    }
    createdNames.add(filename);

    entries.push({
      name: filename,
      bytes: new Uint8Array(encoder.encode(svgText)),
    });
  }

  return entries;
}

function extractGradientColors(backgroundImageValue) {
  const value = String(backgroundImageValue || "").trim();
  if (!value) {
    return [];
  }

  const matches = value.match(
    /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|\b[a-zA-Z]+\b/g,
  );
  if (!matches) {
    return [];
  }

  const blacklisted = new Set([
    "linear-gradient",
    "radial-gradient",
    "circle",
    "ellipse",
    "closest-side",
    "closest-corner",
    "farthest-side",
    "farthest-corner",
    "at",
    "to",
    "top",
    "right",
    "bottom",
    "left",
    "center",
    "deg",
  ]);

  return matches
    .map((token) => token.trim())
    .filter((token) => {
      if (!token) {
        return false;
      }
      const normalized = token.toLowerCase();
      if (blacklisted.has(normalized)) {
        return false;
      }
      if (/^\d/.test(normalized)) {
        return false;
      }
      return true;
    })
    .slice(0, 6);
}

function buildGradientFill(backgroundImageValue, defs, idPrefix) {
  const value = String(backgroundImageValue || "").trim();
  if (!value || !/gradient\(/i.test(value)) {
    return "";
  }

  const colors = extractGradientColors(value);
  if (colors.length < 2) {
    return "";
  }

  const gradientId = `${idPrefix}_grad`;
  const stops = colors
    .map((color, index) => {
      const offset =
        colors.length === 1 ? 0 : Math.round((index / (colors.length - 1)) * 100);
      return `<stop offset="${offset}%" stop-color="${escapeXml(color)}" />`;
    })
    .join("");

  if (/radial-gradient\(/i.test(value)) {
    defs.push(`<radialGradient id="${gradientId}" cx="50%" cy="50%" r="70%">${stops}</radialGradient>`);
  } else {
    defs.push(`<linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">${stops}</linearGradient>`);
  }

  return `url(#${gradientId})`;
}

function parseColorToRgbComponents(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return null;
  }

  const rgbMatch = raw.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+\s*)?\)$/i,
  );
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    if ([r, g, b].every((channel) => Number.isFinite(channel))) {
      return {
        r: Math.max(0, Math.min(255, r)),
        g: Math.max(0, Math.min(255, g)),
        b: Math.max(0, Math.min(255, b)),
      };
    }
  }

  const hexMatch = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: Number.parseInt(`${hex[0]}${hex[0]}`, 16),
        g: Number.parseInt(`${hex[1]}${hex[1]}`, 16),
        b: Number.parseInt(`${hex[2]}${hex[2]}`, 16),
      };
    }
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }

  return null;
}

function buildAlphaTintFilter(fillColor, defs, idPrefix) {
  const rgb = parseColorToRgbComponents(fillColor);
  if (!rgb) {
    return "";
  }

  const filterId = `${idPrefix}_alpha_tint`;
  const r = (rgb.r / 255).toFixed(6);
  const g = (rgb.g / 255).toFixed(6);
  const b = (rgb.b / 255).toFixed(6);
  defs.push(
    `<filter id="${filterId}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 1 0" /></filter>`,
  );
  return `url(#${filterId})`;
}

function buildMaskLumaSafeFilter(defs, idPrefix) {
  const filterId = `${idPrefix}_mask_luma`;
  defs.push(
    `<filter id="${filterId}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0" /></filter>`,
  );
  return `url(#${filterId})`;
}

function resolveTemplateCanvasSize(template) {
  const layers = Array.isArray(template?.layers) ? template.layers : [];
  const elementSize = template?.element?.size || {};
  const canvasSize = template?.canvas || {};

  let width = Math.max(
    1,
    Math.round(
      toFiniteNumber(
        canvasSize.width,
        toFiniteNumber(elementSize.width, 0),
      ),
    ),
  );
  let height = Math.max(
    1,
    Math.round(
      toFiniteNumber(
        canvasSize.height,
        toFiniteNumber(elementSize.height, 0),
      ),
    ),
  );

  if (width <= 1 || height <= 1) {
    let maxX = 0;
    let maxY = 0;
    for (const layer of layers) {
      const rect = layer?.rect || {};
      const x = toFiniteNumber(rect.x, 0);
      const y = toFiniteNumber(rect.y, 0);
      const w = toFiniteNumber(rect.width, 0);
      const h = toFiniteNumber(rect.height, 0);
      maxX = Math.max(maxX, x + Math.max(0, w));
      maxY = Math.max(maxY, y + Math.max(0, h));
    }
    width = Math.max(width, Math.round(maxX), 1);
    height = Math.max(height, Math.round(maxY), 1);
  }

  return { width, height };
}

function getImagePreserveAspectRatio(objectFitValue) {
  const objectFit = String(objectFitValue || "").toLowerCase();
  if (objectFit === "contain") {
    return "xMidYMid meet";
  }
  if (objectFit === "cover") {
    return "xMidYMid slice";
  }
  return "none";
}

function resolveLayerSourceHref(layer, sourceToFilenameMap) {
  const sourceFromList = getFirstKnownSource(layer?.sources, sourceToFilenameMap);
  if (sourceFromList) {
    return sourceFromList;
  }

  if (typeof layer?.imageUrl === "string" && layer.imageUrl) {
    return sourceToFilenameMap.get(layer.imageUrl) || layer.imageUrl;
  }

  return "";
}

function getLayerRect(layer) {
  const rect = layer?.rect || {};
  const x = toFiniteNumber(rect.x, 0);
  const y = toFiniteNumber(rect.y, 0);
  const width = Math.max(0, toFiniteNumber(rect.width, 0));
  const height = Math.max(0, toFiniteNumber(rect.height, 0));

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x,
    y,
    width,
    height,
    area: width * height,
    centerX: x + width / 2,
    centerY: y + height / 2,
  };
}

function getSelectorParentKey(selectorValue) {
  const selector = String(selectorValue || "").trim();
  if (!selector) {
    return "";
  }

  const separator = " > ";
  const cutIndex = selector.lastIndexOf(separator);
  if (cutIndex <= 0) {
    return selector;
  }

  return selector.slice(0, cutIndex).trim();
}

function getIntersectionArea(leftRect, rightRect) {
  const x1 = Math.max(leftRect.x, rightRect.x);
  const y1 = Math.max(leftRect.y, rightRect.y);
  const x2 = Math.min(leftRect.x + leftRect.width, rightRect.x + rightRect.width);
  const y2 = Math.min(leftRect.y + leftRect.height, rightRect.y + rightRect.height);

  if (x2 <= x1 || y2 <= y1) {
    return 0;
  }

  return (x2 - x1) * (y2 - y1);
}

function isPointInsideRect(x, y, rect) {
  return (
    x >= rect.x &&
    y >= rect.y &&
    x <= rect.x + rect.width &&
    y <= rect.y + rect.height
  );
}

function detectEditableMockupPair(template, sourceToFilenameMap) {
  const layers = Array.isArray(template?.layers) ? template.layers : [];
  const imageCandidates = layers
    .map((layer, index) => {
      const sourceHref = resolveLayerSourceHref(layer, sourceToFilenameMap);
      if (!sourceHref) {
        return null;
      }

      const rect = getLayerRect(layer);
      if (!rect) {
        return null;
      }

      const { rx, ry } = extractRadius(layer?.borderRadius, rect.width, rect.height, {
        allowLarge: true,
      });

      return {
        layer,
        index,
        sourceHref,
        rect,
        parentKey: getSelectorParentKey(layer?.selector),
        radiusAvg: (rx + ry) / 2,
        isReplaceable: layer?.replaceable === true,
      };
    })
    .filter(Boolean);

  if (imageCandidates.length < 2) {
    return null;
  }

  let bestPair = null;

  for (let i = 0; i < imageCandidates.length; i += 1) {
    for (let j = 0; j < imageCandidates.length; j += 1) {
      if (i === j) {
        continue;
      }

      const screen = imageCandidates[i];
      const frame = imageCandidates[j];

      if (screen.rect.area <= 0 || frame.rect.area <= 0) {
        continue;
      }

      if (frame.rect.area <= screen.rect.area * 1.01) {
        continue;
      }

      const intersectionArea = getIntersectionArea(screen.rect, frame.rect);
      if (intersectionArea <= 0) {
        continue;
      }

      const overlapOnScreen = intersectionArea / Math.max(1, screen.rect.area);
      if (overlapOnScreen < 0.45) {
        continue;
      }

      const areaRatio = frame.rect.area / Math.max(1, screen.rect.area);
      const centerInside = isPointInsideRect(
        screen.rect.centerX,
        screen.rect.centerY,
        frame.rect,
      );
      const sameParent =
        Boolean(screen.parentKey) &&
        Boolean(frame.parentKey) &&
        screen.parentKey === frame.parentKey;
      const nearSize = areaRatio >= 1.02 && areaRatio <= 1.45;
      const screenLooksRounded =
        screen.radiusAvg >= 14 ||
        screen.radiusAvg >= Math.min(screen.rect.width, screen.rect.height) * 0.06;
      const frameLooksFlat = frame.radiusAvg <= screen.radiusAvg + 2;

      let score = overlapOnScreen * 4;
      if (centerInside) {
        score += 1.4;
      }
      if (sameParent) {
        score += 0.9;
      }
      if (nearSize) {
        score += 1.1;
      } else if (areaRatio <= 2.8) {
        score += 0.4;
      }
      if (screenLooksRounded) {
        score += 0.5;
      }
      if (frameLooksFlat) {
        score += 0.25;
      }
      if (screen.isReplaceable) {
        score += 0.35;
      }

      if (!bestPair || score > bestPair.score) {
        bestPair = {
          score,
          screen,
          frame,
          overlapOnScreen,
          areaRatio,
          sameParent,
        };
      }
    }
  }

  if (!bestPair || bestPair.score < 3.1) {
    return null;
  }

  return bestPair;
}

function buildEditableMockupSvgText(template, sourceToFilenameMap, detectedPair) {
  if (!detectedPair) {
    return "";
  }

  const { width, height } = resolveTemplateCanvasSize(template);
  const screen = detectedPair.screen;
  const frame = detectedPair.frame;
  const contentBounds = template?.canvas?.contentBounds || {};
  const offsetX = toFiniteNumber(contentBounds.x, 0);
  const offsetY = toFiniteNumber(contentBounds.y, 0);
  const screenRect = {
    ...screen.rect,
    x: screen.rect.x - offsetX,
    y: screen.rect.y - offsetY,
  };
  const frameRect = {
    ...frame.rect,
    x: frame.rect.x - offsetX,
    y: frame.rect.y - offsetY,
  };
  const screenIdToken = buildSvgIdToken(screen.layer?.id || "screen", "screen");
  const frameIdToken = buildSvgIdToken(frame.layer?.id || "frame", "frame");
  const screenClipId = `${screenIdToken}_editable_clip`;
  const canvasClipId = "editable_canvas_clip";
  const { rx, ry } = extractRadius(
    screen.layer?.borderRadius,
    screenRect.width,
    screenRect.height,
    { allowLarge: true },
  );
  const radiusAttrs = rx > 0 || ry > 0 ? ` rx="${rx}" ry="${ry}"` : "";
  const screenLabel = escapeXml(screen.layer?.selector || screen.layer?.id || "screen");
  const frameLabel = escapeXml(frame.layer?.selector || frame.layer?.id || "frame");
  const screenPreserveAspectRatio = getImagePreserveAspectRatio(screen.layer?.objectFit);
  const framePreserveAspectRatio = getImagePreserveAspectRatio(frame.layer?.objectFit);
  const title = escapeXml(template?.source?.title || "mockup editable");
  const sourceUrl = escapeXml(template?.source?.url || "");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "<metadata>",
    `<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${title}</dc:title>`,
    `<dc:source xmlns:dc="http://purl.org/dc/elements/1.1/">${sourceUrl}</dc:source>`,
    '<dc:description xmlns:dc="http://purl.org/dc/elements/1.1/">Edita la capa replaceable_screen per substituir la captura interna del mockup.</dc:description>',
    "</metadata>",
    "<defs>",
    `<clipPath id="${canvasClipId}"><rect x="0" y="0" width="${width}" height="${height}" /></clipPath>`,
    `<clipPath id="${screenClipId}"><rect x="${screenRect.x}" y="${screenRect.y}" width="${screenRect.width}" height="${screenRect.height}"${radiusAttrs} /></clipPath>`,
    "</defs>",
    `<g clip-path="url(#${canvasClipId})">`,
    `<g id="replaceable_screen" inkscape:label="replaceable_screen" data-replaceable="true" data-layer-id="${escapeXml(String(screen.layer?.id || ""))}" data-layer-selector="${screenLabel}">`,
    `<image id="${screenIdToken}_image" x="${screenRect.x}" y="${screenRect.y}" width="${screenRect.width}" height="${screenRect.height}" preserveAspectRatio="${screenPreserveAspectRatio}" clip-path="url(#${screenClipId})" ${buildHrefAttributes(screen.sourceHref)} />`,
    "</g>",
    `<g id="mockup_frame" inkscape:label="mockup_frame" data-layer-id="${escapeXml(String(frame.layer?.id || ""))}" data-layer-selector="${frameLabel}">`,
    `<image id="${frameIdToken}_image" x="${frameRect.x}" y="${frameRect.y}" width="${frameRect.width}" height="${frameRect.height}" preserveAspectRatio="${framePreserveAspectRatio}" ${buildHrefAttributes(frame.sourceHref)} />`,
    "</g>",
    "</g>",
    "</svg>",
  ].join("\n");
}

function buildTemplateSvgText(
  template,
  sourceToFilenameMap,
  sourceToSvgTextMap = new Map(),
) {
  const layers = Array.isArray(template?.layers) ? template.layers : [];
  const { width, height } = resolveTemplateCanvasSize(template);
  const contentBounds = template?.canvas?.contentBounds || {};
  const offsetX = toFiniteNumber(contentBounds.x, 0);
  const offsetY = toFiniteNumber(contentBounds.y, 0);

  const sortedLayers = layers
    .map((layer, index) => ({
      layer,
      index,
      zIndex: toFiniteNumber(layer?.zIndex, 0),
    }))
    .sort((left, right) => {
      if (left.zIndex !== right.zIndex) {
        return left.zIndex - right.zIndex;
      }
      return left.index - right.index;
    });

  const defs = [];
  const nodes = [];
  const renderedKeys = new Set();
  const embeddedSvgRegistry = new Map();

  for (const { layer, index } of sortedLayers) {
    const rect = layer?.rect || {};
    const x = toFiniteNumber(rect.x, 0) - offsetX;
    const y = toFiniteNumber(rect.y, 0) - offsetY;
    const w = Math.max(0, toFiniteNumber(rect.width, 0));
    const h = Math.max(0, toFiniteNumber(rect.height, 0));
    if (w <= 0 || h <= 0) {
      continue;
    }
    if (x >= width || y >= height || x + w <= 0 || y + h <= 0) {
      continue;
    }

    const role = String(layer?.role || "unknown");
    const sourceHref = resolveLayerSourceHref(layer, sourceToFilenameMap);
    const rawLayerId = String(layer?.id || `layer_${index + 1}`);
    const idToken = buildSvgIdToken(rawLayerId, `layer_${index + 1}`);
    const id = escapeXml(rawLayerId);
    const backgroundColor = normalizeSvgColor(layer?.backgroundColor);
    const backgroundImage = String(layer?.backgroundImage || "").trim();
    const backgroundGradientFill = buildGradientFill(
      backgroundImage,
      defs,
      `${idToken}_bg`,
    );
    const rawMaskHref = extractFirstUrlFromCssValue(layer?.maskImage);
    const maskHref =
      rawMaskHref && sourceToFilenameMap.has(rawMaskHref)
        ? sourceToFilenameMap.get(rawMaskHref) || rawMaskHref
        : rawMaskHref;
    const text = String(layer?.text || "").trim();
    const hasImage = Boolean(sourceHref);
    const hasBackground = Boolean(backgroundColor || backgroundGradientFill);
    const hasText = Boolean(text);
    if (!hasImage && !hasBackground && !hasText) {
      continue;
    }

    const label = escapeXml(layer?.selector || role);
    const opacity = Math.max(0, Math.min(1, toFiniteNumber(layer?.opacity, 1)));
    const opacityAttr = opacity < 1 ? ` opacity="${opacity}"` : "";
    const dedupeKey = `${sourceHref || "none"}|${backgroundColor || "none"}|${backgroundImage || "none"}|${maskHref || "none"}|${text || "none"}|${Math.round(x)}|${Math.round(y)}|${Math.round(w)}|${Math.round(h)}|${Math.round(opacity * 1000)}`;

    if (renderedKeys.has(dedupeKey)) {
      continue;
    }
    renderedKeys.add(dedupeKey);

    const groupNodes = [];
    let layerMaskAttr = "";
    let hasVectorMask = false;
    let vectorMaskInfo = null;
    let vectorMaskPreserveAspectRatio = "none";

    if (maskHref) {
      const maskId = `${idToken}_mask`;
      const maskPreserveAspectRatio = getMaskPreserveAspectRatio(layer?.maskSize);
      const maskLumaSafeFilter = buildMaskLumaSafeFilter(defs, `${idToken}_mask`);
      const vectorMaskAsset = getEmbeddedSvgAsset({
        href: maskHref,
        idPrefix: `${idToken}_mask`,
        sourceToSvgTextMap,
        defs,
        embeddedSvgRegistry,
      });

      if (vectorMaskAsset) {
        hasVectorMask = true;
        vectorMaskInfo = vectorMaskAsset;
        vectorMaskPreserveAspectRatio = maskPreserveAspectRatio;
        defs.push(
          `<mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}" style="mask-type: alpha;"><svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${vectorMaskAsset.viewBox}" preserveAspectRatio="${maskPreserveAspectRatio}"><use ${buildHrefAttributes(`#${vectorMaskAsset.symbolId}`)} filter="${maskLumaSafeFilter}" /></svg></mask>`,
        );
      } else {
        defs.push(
          `<mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}" style="mask-type: alpha;"><image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${maskPreserveAspectRatio}" ${buildHrefAttributes(maskHref)} filter="${maskLumaSafeFilter}" /></mask>`,
        );
      }
      layerMaskAttr = ` mask="url(#${maskId})"`;
    }

    if (hasBackground) {
      const fill = backgroundGradientFill || backgroundColor;
      let backgroundRenderedAsVector = false;
      const canRenderVectorColoredShape =
        hasVectorMask &&
        !hasImage &&
        Boolean(vectorMaskInfo) &&
        typeof fill === "string" &&
        !fill.startsWith("url(#");

      if (canRenderVectorColoredShape) {
        const tintFilter = buildAlphaTintFilter(fill, defs, `${idToken}_vector`);
        if (tintFilter) {
          groupNodes.push(
            `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${vectorMaskInfo.viewBox}" preserveAspectRatio="${vectorMaskPreserveAspectRatio}"><use ${buildHrefAttributes(`#${vectorMaskInfo.symbolId}`)} filter="${tintFilter}" /></svg>`,
          );
        } else {
          groupNodes.push(
            `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${vectorMaskInfo.viewBox}" preserveAspectRatio="${vectorMaskPreserveAspectRatio}"><use ${buildHrefAttributes(`#${vectorMaskInfo.symbolId}`)} style="fill:${escapeXml(fill)};" /></svg>`,
          );
        }
        backgroundRenderedAsVector = true;
      }

      if (!backgroundRenderedAsVector) {
        const shouldRenderMaskedColorAsTintedImage =
          Boolean(maskHref) &&
          !hasVectorMask &&
          !hasImage &&
          typeof fill === "string" &&
          !fill.startsWith("url(#");

        if (shouldRenderMaskedColorAsTintedImage) {
          const tintFilter = buildAlphaTintFilter(fill, defs, `${idToken}_mask`);
          if (tintFilter) {
            const maskPreserveAspectRatio = getMaskPreserveAspectRatio(layer?.maskSize);
            groupNodes.push(
              `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${maskPreserveAspectRatio}" ${buildHrefAttributes(maskHref)} filter="${tintFilter}" />`,
            );
          } else {
            const { rx, ry } = extractRadius(layer?.borderRadius, w, h, {
              allowLarge: true,
            });
            const radiusAttrs =
              rx > 0 || ry > 0 ? ` rx="${rx}" ry="${ry}"` : "";
            groupNodes.push(
              `<rect x="${x}" y="${y}" width="${w}" height="${h}"${radiusAttrs}${layerMaskAttr} fill="${escapeXml(fill)}" />`,
            );
          }
        } else {
          const { rx, ry } = extractRadius(layer?.borderRadius, w, h, {
            allowLarge: true,
          });
          const radiusAttrs =
            rx > 0 || ry > 0 ? ` rx="${rx}" ry="${ry}"` : "";
          groupNodes.push(
            `<rect x="${x}" y="${y}" width="${w}" height="${h}"${radiusAttrs}${layerMaskAttr} fill="${escapeXml(fill)}" />`,
          );
        }
      }
    }

    if (hasImage) {
      const preserveAspectRatio = getImagePreserveAspectRatio(layer?.objectFit);

      const { rx, ry } = extractRadius(layer?.borderRadius, w, h, {
        allowLarge: false,
      });
      let clipPathAttr = "";

      if (rx > 0 || ry > 0) {
        const clipId = `${idToken}_clip`;
        defs.push(
          `<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${ry}" /></clipPath>`,
        );
        clipPathAttr = ` clip-path="url(#${clipId})"`;
      }

      const vectorSourceAsset = getEmbeddedSvgAsset({
        href: sourceHref,
        idPrefix: `${idToken}_image`,
        sourceToSvgTextMap,
        defs,
        embeddedSvgRegistry,
      });

      if (vectorSourceAsset) {
        groupNodes.push(
          `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${vectorSourceAsset.viewBox}" preserveAspectRatio="${preserveAspectRatio}"${clipPathAttr}${layerMaskAttr}><use ${buildHrefAttributes(`#${vectorSourceAsset.symbolId}`)} /></svg>`,
        );
      } else {
        groupNodes.push(
          `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${preserveAspectRatio}" ${buildHrefAttributes(sourceHref)}${clipPathAttr}${layerMaskAttr} />`,
        );
      }
    }

    if (hasText) {
      const textColor = normalizeSvgColor(layer?.textColor) || "#111111";
      const tokens = text.split(/\s+/).filter(Boolean);
      const textLines =
        tokens.length >= 2 && tokens.length <= 6 ? tokens : [text];
      const lineCount = textLines.length;
      const rawFontSize = Math.max(10, Math.round(parsePx(layer?.fontSize, 16)));
      const maxFontSizeByBox = Math.max(10, Math.floor((h * 0.88) / lineCount));
      const fontSize = Math.max(10, Math.min(rawFontSize, maxFontSizeByBox));
      const rawLineHeight = Math.max(fontSize, Math.round(parsePx(layer?.lineHeight, fontSize)));
      const maxLineHeightByBox = Math.max(fontSize, Math.floor((h * 0.92) / lineCount));
      const lineHeight = Math.max(fontSize, Math.min(rawLineHeight, maxLineHeightByBox));
      const fontWeight = escapeXml(layer?.fontWeight || "400");
      const fontFamily = escapeXml(layer?.fontFamily || "sans-serif");
      const textAlign = String(layer?.textAlign || "").toLowerCase();
      const isCenter = textAlign === "center";
      const isRight = textAlign === "right" || textAlign === "end";
      const anchor = isCenter ? "middle" : isRight ? "end" : "start";
      const textX = isCenter ? x + w / 2 : isRight ? x + w : x;
      const firstLineY = y + lineHeight;
      const tspans = textLines
        .map((line, lineIndex) => {
          const dy = lineIndex === 0 ? 0 : lineHeight;
          return `<tspan x="${textX}" dy="${dy}">${escapeXml(line)}</tspan>`;
        })
        .join("");

      groupNodes.push(
        `<text x="${textX}" y="${firstLineY}" text-anchor="${anchor}" fill="${escapeXml(textColor)}" font-size="${fontSize}" font-weight="${fontWeight}" font-family="${fontFamily}">${tspans}</text>`,
      );
    }

    nodes.push(
      `<g id="${id}" data-role="${escapeXml(role)}" inkscape:label="${label}"${opacityAttr}>${groupNodes.join("")}</g>`,
    );
  }

  const canvasClipId = "canvas_clip";
  defs.unshift(
    `<clipPath id="${canvasClipId}"><rect x="0" y="0" width="${width}" height="${height}" /></clipPath>`,
  );

  const title = escapeXml(template?.source?.title || "mockup template");
  const sourceUrl = escapeXml(template?.source?.url || "");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "<metadata>",
    `<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${title}</dc:title>`,
    `<dc:source xmlns:dc="http://purl.org/dc/elements/1.1/">${sourceUrl}</dc:source>`,
    "</metadata>",
    defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "",
    `<g clip-path="url(#${canvasClipId})">`,
    ...nodes,
    "</g>",
    "</svg>",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTemplateArchiveEntries(
  template,
  sourceToFilenameMap,
  sourceToSvgTextMap = new Map(),
) {
  const normalizedTemplate = normalizeArchiveTemplate(template);
  if (!normalizedTemplate) {
    return [];
  }

  const encoder = new TextEncoder();
  const detectedPair = detectEditableMockupPair(
    normalizedTemplate,
    sourceToFilenameMap,
  );
  const editableSvg = buildEditableMockupSvgText(
    normalizedTemplate,
    sourceToFilenameMap,
    detectedPair,
  );
  let templateForArchive = normalizedTemplate;

  if (detectedPair) {
    const screenRadius = extractRadius(
      detectedPair.screen.layer?.borderRadius,
      detectedPair.screen.rect.width,
      detectedPair.screen.rect.height,
      { allowLarge: true },
    );
    templateForArchive = {
      ...normalizedTemplate,
      editableMockup: {
        detected: true,
        svgFilename: "mockup_editable.svg",
        screenLayerId: detectedPair.screen.layer?.id || "",
        frameLayerId: detectedPair.frame.layer?.id || "",
        screenSelector: detectedPair.screen.layer?.selector || "",
        frameSelector: detectedPair.frame.layer?.selector || "",
        screenRect: {
          x: Math.round(detectedPair.screen.rect.x),
          y: Math.round(detectedPair.screen.rect.y),
          width: Math.round(detectedPair.screen.rect.width),
          height: Math.round(detectedPair.screen.rect.height),
        },
        frameRect: {
          x: Math.round(detectedPair.frame.rect.x),
          y: Math.round(detectedPair.frame.rect.y),
          width: Math.round(detectedPair.frame.rect.width),
          height: Math.round(detectedPair.frame.rect.height),
        },
        screenClipRadius: {
          rx: Math.round(screenRadius.rx * 100) / 100,
          ry: Math.round(screenRadius.ry * 100) / 100,
        },
        screenAsset: detectedPair.screen.sourceHref,
        frameAsset: detectedPair.frame.sourceHref,
      },
    };
  } else {
    templateForArchive = {
      ...normalizedTemplate,
      editableMockup: {
        detected: false,
        svgFilename: "mockup_editable.svg",
        reason:
          "No s'ha pogut detectar automaticament una parella screen/frame compatible.",
      },
    };
  }

  const templateJson = JSON.stringify(templateForArchive, null, 2);
  const templateSvg = buildTemplateSvgText(
    normalizedTemplate,
    sourceToFilenameMap,
    sourceToSvgTextMap,
  );
  const duplicateMaskLayerEntries = buildDuplicateMaskLayerEntries(
    normalizedTemplate,
    sourceToFilenameMap,
    sourceToSvgTextMap,
  );

  const entries = [
    {
      name: "plantilla_mockup.json",
      bytes: new Uint8Array(encoder.encode(templateJson)),
    },
    {
      name: "plantilla_mockup.svg",
      bytes: new Uint8Array(encoder.encode(templateSvg)),
    },
    ...duplicateMaskLayerEntries,
  ];

  if (editableSvg) {
    entries.push({
      name: "mockup_editable.svg",
      bytes: new Uint8Array(encoder.encode(editableSvg)),
    });
  }

  return entries;
}

function buildTemplateEntryFilename(originalName, index) {
  const baseName = sanitizeArchiveSegment(String(originalName || "").replace(/\.[^.]+$/, ""));
  return `${String(index + 1).padStart(2, "0")}_${baseName}.png`;
}

function isSvgTemplateAsset(url, blob) {
  const extension = getFileExtension(url);
  if (extension === "svg") {
    return true;
  }

  const mimeType = String(blob?.type || "").toLowerCase();
  if (mimeType.includes("image/svg")) {
    return true;
  }

  return false;
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
  const archiveExtraEntries = normalizeArchiveExtraEntries(options.archiveExtraEntries);
  const archiveTemplate = normalizeArchiveTemplate(options.archiveTemplate);
  const shouldArchive =
    preferArchive &&
    (urls.length > 1 || archiveExtraEntries.length > 0 || archiveTemplate !== null);

  if (shouldArchive) {
    try {
      const entries = [];
      const sourceToFilenameMap = new Map();
      const sourceToSvgTextMap = new Map();
      let upscaledCount = 0;
      let pngConvertedCount = 0;

      for (const [index, url] of urls.entries()) {
        const processed = await buildProcessedDownload(url, index, {
          archiveEntry: true,
          upscale,
          tabId,
        });

        let entryBlob = processed.blob;
        let entryName = processed.filename;

        if (archiveTemplate !== null && !isSvgTemplateAsset(url, processed.blob)) {
          try {
            entryBlob = await upscaleImageBlob(processed.blob, 1);
            entryName = buildTemplateEntryFilename(processed.filename, index);
            pngConvertedCount += 1;
          } catch {
            entryBlob = processed.blob;
            entryName = processed.filename;
          }
        }

        entries.push({
          name: entryName,
          bytes: new Uint8Array(await entryBlob.arrayBuffer()),
        });
        if (!sourceToFilenameMap.has(url)) {
          sourceToFilenameMap.set(url, entryName);
        }
        if (archiveTemplate !== null && isSvgTemplateAsset(url, processed.blob)) {
          try {
            const svgText = await processed.blob.text();
            if (/<svg[\s>]/i.test(svgText)) {
              sourceToSvgTextMap.set(url, svgText);
              sourceToSvgTextMap.set(entryName, svgText);
            }
          } catch {
            // Ignore invalid SVG payloads and keep image fallback in template export.
          }
        }

        if (processed.upscaled) {
          upscaledCount += 1;
        }
      }

      entries.push(
        ...buildTemplateArchiveEntries(
          archiveTemplate,
          sourceToFilenameMap,
          sourceToSvgTextMap,
        ),
      );
      entries.push(...archiveExtraEntries);

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
        archiveExtraEntriesCount: archiveExtraEntries.length,
        archiveTemplateIncluded: Boolean(archiveTemplate),
        pngConvertedCount,
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

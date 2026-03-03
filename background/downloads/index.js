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

function extractRadiusPx(borderRadiusValue, width, height) {
  const raw = String(borderRadiusValue || "").trim();
  if (!raw || raw === "0" || raw === "0px") {
    return 0;
  }

  const firstToken = raw.split(/\s|\/+/).find(Boolean) || "";
  const hasPxUnit = /px$/i.test(firstToken);
  if (!hasPxUnit) {
    return 0;
  }

  const parsed = Number.parseFloat(firstToken.replace(/px$/i, "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  const minSide = Math.max(1, Math.min(width, height));
  const safeMax = minSide * 0.2;

  // Ignore very large radii (often used as masks on parent wrappers) to avoid
  // over-rounding assets like phone mockups.
  if (parsed > safeMax) {
    return 0;
  }

  return Math.max(0, Math.min(parsed, width / 2, height / 2));
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

function buildTemplateSvgText(template, sourceToFilenameMap) {
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

  for (const { layer, index } of sortedLayers) {
    const rect = layer?.rect || {};
    const x = toFiniteNumber(rect.x, 0);
    const y = toFiniteNumber(rect.y, 0);
    const w = Math.max(0, toFiniteNumber(rect.width, 0));
    const h = Math.max(0, toFiniteNumber(rect.height, 0));
    if (w <= 0 || h <= 0) {
      continue;
    }
    if (x >= width || y >= height || x + w <= 0 || y + h <= 0) {
      continue;
    }

    const role = String(layer?.role || "unknown");
    const sourceHref =
      getFirstKnownSource(layer?.sources, sourceToFilenameMap) ||
      (typeof layer?.imageUrl === "string" ? layer.imageUrl : "");
    const backgroundColor = normalizeSvgColor(layer?.backgroundColor);
    const text = String(layer?.text || "").trim();
    const hasImage = Boolean(sourceHref);
    const hasBackground = Boolean(backgroundColor);
    const hasText = Boolean(text);
    if (!hasImage && !hasBackground && !hasText) {
      continue;
    }

    const id = escapeXml(layer?.id || `layer_${index + 1}`);
    const label = escapeXml(layer?.selector || role);
    const opacity = Math.max(0, Math.min(1, toFiniteNumber(layer?.opacity, 1)));
    const opacityAttr = opacity < 1 ? ` opacity="${opacity}"` : "";
    const dedupeKey = `${sourceHref || "none"}|${backgroundColor || "none"}|${text || "none"}|${Math.round(x)}|${Math.round(y)}|${Math.round(w)}|${Math.round(h)}|${Math.round(opacity * 1000)}`;

    if (renderedKeys.has(dedupeKey)) {
      continue;
    }
    renderedKeys.add(dedupeKey);

    const groupNodes = [];

    if (hasBackground) {
      groupNodes.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escapeXml(backgroundColor)}" />`,
      );
    }

    if (hasImage) {
      const preserveAspectRatio =
        String(layer?.objectFit || "").toLowerCase() === "contain"
          ? "xMidYMid meet"
          : String(layer?.objectFit || "").toLowerCase() === "cover"
            ? "xMidYMid slice"
            : "none";

      const radiusPx = extractRadiusPx(layer?.borderRadius, w, h);
      let clipPathAttr = "";

      if (radiusPx > 0) {
        const clipId = `${id}_clip`;
        defs.push(
          `<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radiusPx}" ry="${radiusPx}" /></clipPath>`,
        );
        clipPathAttr = ` clip-path="url(#${clipId})"`;
      }

      groupNodes.push(
        `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${preserveAspectRatio}" href="${escapeXml(sourceHref)}"${clipPathAttr} />`,
      );
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
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
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

function buildTemplateArchiveEntries(template, sourceToFilenameMap) {
  const normalizedTemplate = normalizeArchiveTemplate(template);
  if (!normalizedTemplate) {
    return [];
  }

  const encoder = new TextEncoder();
  const templateJson = JSON.stringify(normalizedTemplate, null, 2);
  const templateSvg = buildTemplateSvgText(normalizedTemplate, sourceToFilenameMap);

  return [
    {
      name: "plantilla_mockup.json",
      bytes: new Uint8Array(encoder.encode(templateJson)),
    },
    {
      name: "plantilla_mockup.svg",
      bytes: new Uint8Array(encoder.encode(templateSvg)),
    },
  ];
}

function buildTemplateEntryFilename(originalName, index) {
  const baseName = sanitizeArchiveSegment(String(originalName || "").replace(/\.[^.]+$/, ""));
  return `${String(index + 1).padStart(2, "0")}_${baseName}.png`;
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

        if (archiveTemplate !== null) {
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

        if (processed.upscaled) {
          upscaledCount += 1;
        }
      }

      entries.push(...buildTemplateArchiveEntries(archiveTemplate, sourceToFilenameMap));
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

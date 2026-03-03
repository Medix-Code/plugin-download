import {
  getAvailableExtensions,
  getFilteredImages,
  getPagination,
  getSourceLabel,
} from "./filters.js";
import { SIZE_FILTERS } from "./state.js";

function getDisplayName(url) {
  try {
    const parsed = new URL(url);
    const rawName = parsed.pathname.split("/").pop();
    return rawName || parsed.hostname;
  } catch {
    return url;
  }
}

function getDisplayPath(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function getDomainLabel(url) {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname || parsed.origin || url;
  } catch {
    return url;
  }
}

export function createRenderer(state, elements) {
  function updateSourceSite(url) {
    const domainLabel = getDomainLabel(url);

    if (!domainLabel) {
      elements.sourceSite.hidden = true;
      elements.sourceSiteValue.textContent = "";
      return;
    }

    elements.sourceSiteValue.textContent = domainLabel;
    elements.sourceSite.title = url;
    elements.sourceSite.hidden = false;
  }

  function updateSelectionCount() {
    const pagination = getPagination(state);
    state.currentPage = pagination.currentPage;
    const totalSelectedCount = state.selectedUrls.size;
    const visibleUrls = new Set(pagination.pageItems.map((image) => image.url));
    const visibleCount = pagination.pageItems.length;
    let visibleSelectedCount = 0;

    for (const url of state.selectedUrls) {
      if (visibleUrls.has(url)) {
        visibleSelectedCount += 1;
      }
    }

    if (
      state.activeExtension === "all" &&
      state.activeSizeKey === "all" &&
      state.activeScope === "all"
    ) {
      elements.selectionCount.textContent = `${totalSelectedCount} seleccionades · Pag ${pagination.currentPage}/${pagination.totalPages}`;
    } else {
      elements.selectionCount.textContent = `${visibleSelectedCount}/${visibleCount} visibles · ${totalSelectedCount} totals seleccionades`;
    }

    elements.downloadButton.disabled = totalSelectedCount === 0;
  }

  function renderScopeFilters(renderAll) {
    elements.scopeFilterBar.replaceChildren();

    const allCount = getFilteredImages(state, {
      extension: "all",
      sizeKey: "all",
      imageScope: "all",
    }).length;
    const analysisCount = getFilteredImages(state, {
      extension: "all",
      sizeKey: "all",
      imageScope: "analysis",
    }).length;

    const scopeFilters = [
      {
        key: "all",
        label: `Totes fonts (${allCount})`,
        disabled: false,
      },
      {
        key: "analysis",
        label: `Bloc analitzat (${analysisCount})`,
        disabled: analysisCount === 0,
      },
    ];

    for (const filter of scopeFilters) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "filter-pill";
      button.textContent = filter.label;
      button.disabled = filter.disabled;
      button.classList.toggle("filter-pill--active", state.activeScope === filter.key);
      button.addEventListener("click", () => {
        state.activeScope = filter.key;
        state.activeExtension = "all";
        state.currentPage = 1;
        renderAll();
      });
      elements.scopeFilterBar.append(button);
    }
  }

  function normalizePreviewAssets(assets = []) {
    const normalized = [];
    const seen = new Set();

    for (const entry of Array.isArray(assets) ? assets : []) {
      if (typeof entry === "string") {
        const url = entry.trim();
        if (!/^https?:\/\//i.test(url)) {
          continue;
        }
        const key = `url:${url}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        normalized.push({
          key,
          url,
          previewUrl: url,
          label: "",
        });
        continue;
      }

      if (!entry || typeof entry !== "object") {
        continue;
      }

      const url = typeof entry.url === "string" ? entry.url.trim() : "";
      const previewUrl =
        typeof entry.previewUrl === "string" ? entry.previewUrl.trim() : "";
      if (!url && !previewUrl) {
        continue;
      }

      const key =
        (typeof entry.key === "string" && entry.key.trim()) ||
        (url ? `url:${url}` : `preview:${previewUrl}`);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      normalized.push({
        key,
        url,
        previewUrl: previewUrl || url,
        label: typeof entry.label === "string" ? entry.label : "",
        kind: typeof entry.kind === "string" ? entry.kind : "image",
        maskUrl: typeof entry.maskUrl === "string" ? entry.maskUrl : "",
        fillColor: typeof entry.fillColor === "string" ? entry.fillColor : "",
      });
    }

    return normalized.slice(0, 40);
  }

  function renderAnalysisDetectedAssets(assets = []) {
    elements.analysisAssetList.replaceChildren();
    const normalizedAssets = normalizePreviewAssets(assets);

    if (normalizedAssets.length === 0) {
      elements.analysisAssetGallery.hidden = true;
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const asset of normalizedAssets) {
      const openUrl = asset.url || asset.previewUrl;
      const itemButton = document.createElement("button");
      itemButton.type = "button";
      itemButton.className = "analysis-asset-item";
      itemButton.title = asset.label || getDisplayName(asset.url || asset.previewUrl);
      itemButton.addEventListener("click", () => {
        openPreview({
          url: openUrl,
          alt: getDisplayName(asset.url || asset.previewUrl),
          displayUrl: asset.url || asset.previewUrl,
        });
      });

      if (asset.kind === "mask-color" && asset.maskUrl && asset.fillColor) {
        const thumb = document.createElement("div");
        thumb.className = "analysis-asset-thumb analysis-asset-thumb--mask";
        thumb.style.backgroundColor = asset.fillColor;
        thumb.style.maskImage = `url("${asset.maskUrl}")`;
        thumb.style.maskRepeat = "no-repeat";
        thumb.style.maskPosition = "center";
        thumb.style.maskSize = "contain";
        thumb.style.webkitMaskImage = `url("${asset.maskUrl}")`;
        thumb.style.webkitMaskRepeat = "no-repeat";
        thumb.style.webkitMaskPosition = "center";
        thumb.style.webkitMaskSize = "contain";
        itemButton.append(thumb);
      } else {
        const thumb = document.createElement("img");
        thumb.className = "analysis-asset-thumb";
        thumb.src = asset.previewUrl || asset.url;
        thumb.alt = getDisplayName(asset.url || asset.previewUrl);
        thumb.loading = "lazy";
        thumb.referrerPolicy = "no-referrer";
        thumb.addEventListener("error", () => {
          thumb.classList.add("analysis-asset-thumb--error");
          thumb.alt = "No s'ha pogut carregar";
        });
        itemButton.append(thumb);
      }
      fragment.append(itemButton);
    }

    elements.analysisAssetList.append(fragment);
    elements.analysisAssetGallery.hidden = false;
  }

  function renderAnalysisSvgPreview() {
    const svgUrl = String(state.elementSvgPreviewUrl || "").trim();
    const hasSvgPreview = svgUrl.startsWith("data:image/svg+xml");

    if (hasSvgPreview) {
      elements.analysisSvgPreview.hidden = false;
      elements.analysisSvgPreview.src = svgUrl;
      elements.analysisPreviewPanel.hidden = false;
      return;
    }

    elements.analysisSvgPreview.hidden = true;
    elements.analysisSvgPreview.removeAttribute("src");
    elements.analysisPreviewPanel.hidden = elements.analysisAssetGallery.hidden;
  }

  function setAnalysisReadyState(hasAnalysis) {
    const isReady = Boolean(hasAnalysis);

    elements.downloadBlockBundleButton.disabled = !isReady;
    elements.mockupQuickZipButton.disabled = !isReady;

    elements.analyzeElementButton.classList.toggle("secondary-button--done", isReady);
    elements.mockupQuickAnalyzeButton.classList.toggle("secondary-button--done", isReady);
  }

  function renderElementAnalysis(analysis, options = {}) {
    state.elementAnalysis = analysis;
    const selector = analysis?.element?.selector || analysis?.element?.tagName || "";
    const width = analysis?.element?.rect?.width;
    const height = analysis?.element?.rect?.height;
    const sizeLabel =
      Number.isFinite(width) && Number.isFinite(height)
        ? `${width} x ${height}`
        : "";

    elements.analysisSummary.textContent = [selector, sizeLabel]
      .filter(Boolean)
      .join(" · ");
    elements.analysisOutput.value = JSON.stringify(analysis, null, 2);
    renderAnalysisDetectedAssets(options.previewUrls || []);
    renderAnalysisSvgPreview();
    elements.analysisPanel.hidden = false;
    elements.copyAnalysisButton.disabled = false;
    elements.saveAnalysisButton.disabled = false;
    setAnalysisReadyState(true);
    elements.clearAnalysisButton.disabled = false;
  }

  function clearElementAnalysis() {
    state.elementAnalysis = null;
    elements.analysisSummary.textContent = "";
    elements.analysisOutput.value = "";
    elements.analysisAssetList.replaceChildren();
    elements.analysisAssetGallery.hidden = true;
    elements.analysisSvgPreview.hidden = true;
    elements.analysisSvgPreview.removeAttribute("src");
    elements.analysisPreviewPanel.hidden = true;
    elements.analysisPanel.hidden = true;
    elements.copyAnalysisButton.disabled = true;
    elements.saveAnalysisButton.disabled = true;
    setAnalysisReadyState(false);
    elements.clearAnalysisButton.disabled = true;
  }

  function closePreview() {
    elements.previewModal.hidden = true;
    elements.previewImage.removeAttribute("src");
  }

  function openPreview(image) {
    elements.previewImage.src = image.url;
    elements.previewImage.alt = image.alt || getDisplayName(image.url);
    elements.previewTitle.textContent = getDisplayName(image.url);
    elements.previewUrl.textContent = image.displayUrl || image.url;
    elements.previewModal.hidden = false;
  }

  function toggleUrl(url, checked) {
    if (checked) {
      state.selectedUrls.add(url);
    } else {
      state.selectedUrls.delete(url);
    }

    updateSelectionCount();
  }

  function createCard(image) {
    const article = document.createElement("article");
    article.className = "image-card";
    article.dataset.url = image.url;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedUrls.has(image.url);
    checkbox.addEventListener("change", () => {
      toggleUrl(image.url, checkbox.checked);
      article.classList.toggle("image-card--selected", checkbox.checked);
    });

    const preview = document.createElement("img");
    preview.className = "image-preview";
    preview.src = image.url;
    preview.alt = image.alt || getDisplayName(image.url);
    preview.loading = "lazy";
    preview.referrerPolicy = "no-referrer";
    preview.addEventListener("click", (event) => {
      event.stopPropagation();
      openPreview(image);
    });
    preview.addEventListener("error", () => {
      const fallback = document.createElement("div");
      fallback.className = "image-preview image-preview--error";
      fallback.textContent = "Sense preview";
      preview.replaceWith(fallback);
    });

    const meta = document.createElement("div");
    meta.className = "image-meta";

    const metaTop = document.createElement("div");
    metaTop.className = "image-meta-top";

    const extensionChip = document.createElement("span");
    extensionChip.className = "meta-chip meta-chip--muted";
    extensionChip.textContent = image.extension.toUpperCase();

    const name = document.createElement("p");
    name.className = "image-name";
    name.textContent = getDisplayName(image.url);

    const url = document.createElement("p");
    url.className = "image-url";
    url.textContent = getDisplayPath(image.url);

    const size = document.createElement("p");
    size.className = "image-size";
    size.textContent = `${image.width || "?"} x ${image.height || "?"}`;

    if (image.sourceType === "background") {
      const sourceChip = document.createElement("span");
      sourceChip.className = "meta-chip";
      sourceChip.textContent = getSourceLabel(image);
      metaTop.append(sourceChip);
    }

    metaTop.append(extensionChip);
    meta.append(metaTop, name, url, size);
    article.append(checkbox, preview, meta);
    article.classList.toggle("image-card--selected", checkbox.checked);

    article.addEventListener("click", (event) => {
      if (event.target === checkbox) {
        return;
      }

      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change"));
    });

    return article;
  }

  function renderTypeFilters(renderAll) {
    elements.typeFilterBar.replaceChildren();

    const extensions = getAvailableExtensions(state);

    if (extensions.length === 0) {
      return;
    }

    const filters = [
      {
        key: "all",
        label: `Totes (${getFilteredImages(state, { extension: "all", sizeKey: state.activeSizeKey }).length})`,
      },
      ...extensions.map((extension) => ({
        key: extension,
        label: `${extension.toUpperCase()} (${getFilteredImages(state, { extension, sizeKey: state.activeSizeKey }).length})`,
      })),
    ];

    for (const filter of filters) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "filter-pill";
      button.textContent = filter.label;
      button.classList.toggle(
        "filter-pill--active",
        state.activeExtension === filter.key,
      );
      button.addEventListener("click", () => {
        state.activeExtension = filter.key;
        state.currentPage = 1;
        renderAll();
      });
      elements.typeFilterBar.append(button);
    }
  }

  function renderSizeFilters(renderAll) {
    elements.sizeFilterBar.replaceChildren();

    for (const filter of SIZE_FILTERS) {
      const count = getFilteredImages(state, {
        extension: state.activeExtension,
        sizeKey: filter.key,
      }).length;

      if (
        filter.key !== "all" &&
        count === 0 &&
        state.activeSizeKey !== filter.key
      ) {
        continue;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "filter-pill";
      button.textContent = `${filter.label} (${count})`;
      button.classList.toggle(
        "filter-pill--active",
        state.activeSizeKey === filter.key,
      );
      button.addEventListener("click", () => {
        state.activeSizeKey = filter.key;
        state.currentPage = 1;
        renderAll();
      });
      elements.sizeFilterBar.append(button);
    }
  }

  function renderPagination(pagination) {
    if (pagination.totalItems <= pagination.pageSize) {
      elements.paginationPanel.hidden = true;
      elements.paginationInfo.textContent = "";
      elements.paginationPrevButton.disabled = true;
      elements.paginationNextButton.disabled = true;
      return;
    }

    elements.paginationPanel.hidden = false;
    elements.paginationInfo.textContent =
      `${pagination.startIndex + 1}-${pagination.endIndex} de ${pagination.totalItems} · Pagina ${pagination.currentPage}/${pagination.totalPages}`;
    elements.paginationPrevButton.disabled = pagination.currentPage <= 1;
    elements.paginationNextButton.disabled =
      pagination.currentPage >= pagination.totalPages;
  }

  function renderImages(renderAll) {
    elements.imageList.replaceChildren();
    const pagination = getPagination(state);
    state.currentPage = pagination.currentPage;
    const filteredImages = pagination.allItems;

    if (state.images.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "empty-state";
      emptyState.textContent =
        "No s'han trobat imatges compatibles a la pestanya actual.";
      elements.imageList.append(emptyState);
      renderPagination(pagination);
      updateSelectionCount();
      return;
    }

    if (filteredImages.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "empty-state";
      emptyState.textContent =
        "No hi ha imatges que compleixin els filtres actius.";
      elements.imageList.append(emptyState);
      renderPagination(pagination);
      updateSelectionCount();
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const image of pagination.pageItems) {
      fragment.append(createCard(image));
    }

    elements.imageList.append(fragment);
    renderPagination(pagination);
    updateSelectionCount();
  }

  function renderAll() {
    renderScopeFilters(renderAll);
    renderImages(renderAll);
    renderTypeFilters(renderAll);
    renderSizeFilters(renderAll);
  }

  return {
    updateSourceSite,
    updateSelectionCount,
    closePreview,
    renderAll,
    renderImages: () => renderImages(renderAll),
    renderTypeFilters: () => renderTypeFilters(renderAll),
    renderSizeFilters: () => renderSizeFilters(renderAll),
    renderScopeFilters: () => renderScopeFilters(renderAll),
    renderElementAnalysis,
    renderAnalysisDetectedAssets,
    renderAnalysisSvgPreview,
    setAnalysisReadyState,
    clearElementAnalysis,
    getVisibleImages: () => getPagination(state).pageItems,
  };
}

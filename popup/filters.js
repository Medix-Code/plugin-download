import { SIZE_FILTERS } from "./state.js";

export function matchesScopeFilter(image, state, scope) {
  if (scope !== "analysis") {
    return true;
  }

  return state.analyzedImageUrls.has(image.url);
}

export function getSourceLabel(image) {
  return image.sourceType === "background" ? "CSS background" : "IMG";
}

export function getAvailableExtensions(state) {
  const scope = state.activeScope || "all";
  const extensions = state.images
    .filter((image) => matchesScopeFilter(image, state, scope))
    .map((image) => image.extension);
  return Array.from(new Set(extensions)).sort();
}

export function getSizeFilterDefinition(sizeKey) {
  return SIZE_FILTERS.find((filter) => filter.key === sizeKey) || SIZE_FILTERS[0];
}

export function matchesExtensionFilter(image, extension) {
  return extension === "all" || image.extension === extension;
}

export function matchesSizeFilter(image, sizeKey) {
  return getSizeFilterDefinition(sizeKey).matches(image);
}

export function getFilteredImages(state, filters = {}) {
  const extension = filters.extension ?? state.activeExtension;
  const sizeKey = filters.sizeKey ?? state.activeSizeKey;
  const scope = filters.imageScope ?? state.activeScope ?? "all";

  return state.images.filter((image) => {
    return (
      matchesScopeFilter(image, state, scope) &&
      matchesExtensionFilter(image, extension) &&
      matchesSizeFilter(image, sizeKey)
    );
  });
}

export function getPagination(state, filters = {}) {
  const allItems = getFilteredImages(state, filters);
  const pageSize =
    Number.isInteger(state.pageSize) && state.pageSize > 0 ? state.pageSize : 20;
  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const rawPage = Number.isInteger(state.currentPage) ? state.currentPage : 1;
  const currentPage = Math.min(Math.max(1, rawPage), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(totalItems, startIndex + pageSize);
  const pageItems = allItems.slice(startIndex, endIndex);

  return {
    allItems,
    pageItems,
    pageSize,
    totalItems,
    totalPages,
    currentPage,
    startIndex,
    endIndex,
  };
}

export function getVisibleSelectionCount(state) {
  const filteredUrls = new Set(getFilteredImages(state).map((image) => image.url));
  let count = 0;

  for (const url of state.selectedUrls) {
    if (filteredUrls.has(url)) {
      count += 1;
    }
  }

  return count;
}

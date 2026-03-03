export const SIZE_FILTERS = [
  {
    key: "all",
    label: "Totes",
    matches: () => true,
  },
  {
    key: "icon",
    label: "Icones <128",
    matches: (image) => image.longestSide > 0 && image.longestSide < 128,
  },
  {
    key: "small",
    label: "Petites 128-399",
    matches: (image) => image.longestSide >= 128 && image.longestSide < 400,
  },
  {
    key: "medium",
    label: "Mitjanes 400-899",
    matches: (image) => image.longestSide >= 400 && image.longestSide < 900,
  },
  {
    key: "large",
    label: "Grans 900-1599",
    matches: (image) => image.longestSide >= 900 && image.longestSide < 1600,
  },
  {
    key: "xl",
    label: "XL 1600+",
    matches: (image) => image.longestSide >= 1600,
  },
  {
    key: "unknown",
    label: "Sense mida",
    matches: (image) => image.longestSide <= 0,
  },
];

export const state = {
  images: [],
  selectedUrls: new Set(),
  analyzedImageUrls: new Set(),
  activeExtension: "all",
  activeSizeKey: "all",
  activeScope: "all",
  currentPage: 1,
  pageSize: 20,
  logs: [],
  mode: "popup",
  sourceTabId: Number.NaN,
  sourceWindowId: Number.NaN,
  hideFixedSticky: true,
  sourceTabUrl: "",
  elementCaptureInProgress: false,
  elementAnalysis: null,
  rawElementAnalysis: null,
};

export function initializeStateFromUrl(urlParams) {
  state.mode = urlParams.get("mode") === "window" ? "window" : "popup";
  state.sourceTabId = Number.parseInt(urlParams.get("tabId") || "", 10);
  state.sourceWindowId = Number.parseInt(urlParams.get("windowId") || "", 10);
  state.hideFixedSticky = urlParams.get("hideFixedSticky") !== "0";
}

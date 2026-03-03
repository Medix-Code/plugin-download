export const ACTIONS = {
  DOWNLOAD_IMAGES: "downloadImages",
  CAPTURE_VISIBLE_TAB: "captureVisibleTab",
  CAPTURE_FULL_PAGE: "captureFullPage",
  START_ELEMENT_CAPTURE_FLOW: "startElementCaptureFlow",
  ELEMENT_SELECTED_FOR_CAPTURE: "elementSelectedForCapture",
  OPEN_EXPANDED_POPUP: "openExpandedPopup",
  PLUGIN_LOG_ENTRY: "pluginLogEntry",
  FULL_PAGE_CAPTURE_PROGRESS: "fullPageCaptureProgress",
  ELEMENT_CAPTURE_STATUS: "elementCaptureStatus",
};

export const OFFSCREEN_TARGET = "offscreen";

export function hasAction(message, action) {
  return Boolean(message && message.action === action);
}

export function isInteger(value) {
  return Number.isInteger(value);
}

export function isObject(value) {
  return value !== null && typeof value === "object";
}

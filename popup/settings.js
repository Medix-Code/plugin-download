import { debugError } from "../shared/logger.js";

export function applyInitialSettingsToDom(state, elements) {
  document.body.dataset.mode = state.mode;
  elements.hideFixedStickyCheckbox.checked = state.hideFixedSticky;

  if (state.mode === "window") {
    elements.openWindowButton.hidden = true;
  }
}

export function updateDownloadLocationUi(state, elements) {
  elements.downloadLocationNote.textContent =
    "Descarregues i captures a Downloads/Image Picker/.";
}

export async function loadSavedSettings(state, elements, queryParamFlags, logs) {
  try {
    const saved = await chrome.storage.local.get(["hideFixedSticky"]);

    if (
      !queryParamFlags.hasHideFixedSticky &&
      typeof saved.hideFixedSticky === "boolean"
    ) {
      state.hideFixedSticky = saved.hideFixedSticky;
      elements.hideFixedStickyCheckbox.checked = saved.hideFixedSticky;
    }
  } catch (error) {
    debugError("error carregant preferencies desades", error);
    logs.reportError("Error carregant preferencies desades.", error);
  }

  updateDownloadLocationUi(state, elements);
}

export function saveSettings(elements, logs) {
  chrome.storage.local
    .set({
      hideFixedSticky: elements.hideFixedStickyCheckbox.checked,
    })
    .catch((error) => {
      debugError("error desant preferencies", error);
      logs.reportError("Error desant preferencies.", error);
    });
}

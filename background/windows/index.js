const EXPANDED_WINDOW_DEFAULT_WIDTH = 1280;
const EXPANDED_WINDOW_DEFAULT_HEIGHT = 900;

export function buildExpandedPopupUrl(tabId, windowId, options = {}) {
  const url = new URL(chrome.runtime.getURL("popup.html"));
  url.searchParams.set("mode", "window");
  url.searchParams.set("tabId", String(tabId));
  url.searchParams.set("windowId", String(windowId));
  url.searchParams.set("hideFixedSticky", options.hideFixedSticky ? "1" : "0");
  url.searchParams.set("upscale", options.upscaleEnabled ? "1" : "0");
  url.searchParams.set("upscaleFactor", String(options.upscaleFactor === 4 ? 4 : 2));
  url.searchParams.set("saveAs", options.saveAs ? "1" : "0");
  return url.toString();
}

export function createMaximizedExpandedWindow(createData) {
  return new Promise((resolve, reject) => {
    chrome.windows.create(
      {
        ...createData,
        type: "popup",
        state: "normal",
        width: EXPANDED_WINDOW_DEFAULT_WIDTH,
        height: EXPANDED_WINDOW_DEFAULT_HEIGHT,
        focused: true,
      },
      (createdWindow) => {
        if (chrome.runtime.lastError || !createdWindow?.id) {
          reject(
            new Error(
              chrome.runtime.lastError?.message ||
                "No s'ha pogut obrir la finestra gran maximitzada.",
            ),
          );
          return;
        }

        chrome.windows.update(
          createdWindow.id,
          { state: "maximized", focused: true },
          (maximizedWindow) => {
            if (chrome.runtime.lastError) {
              resolve(createdWindow);
              return;
            }

            resolve(maximizedWindow || createdWindow);
          },
        );
      },
    );
  });
}

export function createFallbackExpandedWindow(createData) {
  return new Promise((resolve, reject) => {
    chrome.windows.create(
      {
        ...createData,
        type: "popup",
        width: 980,
        height: 820,
        focused: true,
      },
      (createdWindow) => {
        if (chrome.runtime.lastError || !createdWindow?.id) {
          reject(
            new Error(
              chrome.runtime.lastError?.message ||
                "No s'ha pogut obrir la finestra gran.",
            ),
          );
          return;
        }

        resolve(createdWindow);
      },
    );
  });
}

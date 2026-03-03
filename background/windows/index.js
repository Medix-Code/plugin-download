const EXPANDED_WINDOW_DEFAULT_WIDTH = 1280;
const EXPANDED_WINDOW_DEFAULT_HEIGHT = 900;
const EXTENSION_POPUP_URL = chrome.runtime.getURL("popup.html");
const POPUP_WINDOW_IDS_KEY = "pluginPopupWindowIds";

function getTrackedPopupWindowIds() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([POPUP_WINDOW_IDS_KEY], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const value = result?.[POPUP_WINDOW_IDS_KEY];
      const ids = Array.isArray(value)
        ? value.filter((id) => Number.isInteger(id))
        : [];
      resolve(Array.from(new Set(ids)));
    });
  });
}

function setTrackedPopupWindowIds(ids) {
  return new Promise((resolve, reject) => {
    const uniqueIds = Array.from(
      new Set((Array.isArray(ids) ? ids : []).filter((id) => Number.isInteger(id))),
    );

    chrome.storage.local.set({ [POPUP_WINDOW_IDS_KEY]: uniqueIds }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(uniqueIds);
    });
  });
}

export async function trackExtensionPopupWindow(windowId) {
  if (!Number.isInteger(windowId)) {
    return;
  }

  const currentIds = await getTrackedPopupWindowIds();
  if (currentIds.includes(windowId)) {
    return;
  }

  currentIds.push(windowId);
  await setTrackedPopupWindowIds(currentIds);
}

export async function untrackExtensionPopupWindow(windowId) {
  if (!Number.isInteger(windowId)) {
    return;
  }

  const currentIds = await getTrackedPopupWindowIds();
  const nextIds = currentIds.filter((id) => id !== windowId);
  if (nextIds.length === currentIds.length) {
    return;
  }

  await setTrackedPopupWindowIds(nextIds);
}

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
            const finalWindow = chrome.runtime.lastError
              ? createdWindow
              : maximizedWindow || createdWindow;

            trackExtensionPopupWindow(finalWindow.id).catch(() => {});
            resolve(finalWindow);
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

        trackExtensionPopupWindow(createdWindow.id).catch(() => {});
        resolve(createdWindow);
      },
    );
  });
}

function isExtensionPopupUrl(url) {
  const value = String(url || "");
  return value === EXTENSION_POPUP_URL || value.startsWith(`${EXTENSION_POPUP_URL}?`);
}

export function closeExtensionPopupWindows() {
  return new Promise((resolve, reject) => {
    chrome.windows.getAll({ populate: true }, (windows) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const popupWindowIdsFromUrl = [];

      for (const win of windows || []) {
        const tabs = Array.isArray(win?.tabs) ? win.tabs : [];
        const hasExtensionPopupTab = tabs.some((tab) => isExtensionPopupUrl(tab?.url));
        if (hasExtensionPopupTab && Number.isInteger(win?.id)) {
          popupWindowIdsFromUrl.push(win.id);
        }
      }

      getTrackedPopupWindowIds()
        .then((trackedIds) => {
          const popupWindowIds = Array.from(
            new Set([...popupWindowIdsFromUrl, ...trackedIds]).values(),
          );

          if (popupWindowIds.length === 0) {
            resolve({ closedCount: 0 });
            return;
          }

          let closedCount = 0;
          let pending = popupWindowIds.length;

          for (const windowId of popupWindowIds) {
            chrome.windows.remove(windowId, () => {
              if (!chrome.runtime.lastError) {
                closedCount += 1;
              }

              pending -= 1;
              if (pending === 0) {
                setTrackedPopupWindowIds([]).catch(() => {});
                resolve({ closedCount });
              }
            });
          }
        })
        .catch((error) => {
          reject(error);
        });
    });
  });
}

export function refreshExtensionPopupWindows() {
  return new Promise((resolve, reject) => {
    chrome.windows.getAll({ populate: true }, (windows) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const popupTabIds = [];

      for (const win of windows || []) {
        const tabs = Array.isArray(win?.tabs) ? win.tabs : [];
        for (const tab of tabs) {
          if (Number.isInteger(tab?.id) && isExtensionPopupUrl(tab?.url)) {
            popupTabIds.push(tab.id);
          }
        }
      }

      if (popupTabIds.length === 0) {
        resolve({ refreshedCount: 0 });
        return;
      }

      let refreshedCount = 0;
      let pending = popupTabIds.length;

      for (const tabId of popupTabIds) {
        chrome.tabs.reload(tabId, { bypassCache: true }, () => {
          if (!chrome.runtime.lastError) {
            refreshedCount += 1;
          }

          pending -= 1;
          if (pending === 0) {
            resolve({ refreshedCount });
          }
        });
      }
    });
  });
}

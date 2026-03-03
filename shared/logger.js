import { ACTIONS } from "./messages.js";
import { DEBUG_PREFIX, LOG_STORAGE_KEY, MAX_LOG_ENTRIES } from "./constants.js";

/** @returns {import('./types.js').PluginLogEntry} */
export function createLogEntry(level, message, details = null) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level,
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

export function debugLog(...args) {
  console.log(DEBUG_PREFIX, ...args);
}

export function debugError(...args) {
  console.error(DEBUG_PREFIX, ...args);
}

export function addLogEntry(logs, entry) {
  if (!entry?.id) {
    return logs;
  }

  if (logs.some((existingEntry) => existingEntry.id === entry.id)) {
    return logs;
  }

  return [entry, ...logs].slice(0, MAX_LOG_ENTRIES);
}

export async function loadPersistedLogs() {
  if (!chrome.storage?.local) {
    return [];
  }

  const saved = await chrome.storage.local.get(LOG_STORAGE_KEY);
  return Array.isArray(saved?.[LOG_STORAGE_KEY]) ? saved[LOG_STORAGE_KEY] : [];
}

export async function persistLogs(logs) {
  if (!chrome.storage?.local) {
    return;
  }

  await chrome.storage.local.set({
    [LOG_STORAGE_KEY]: logs.slice(0, MAX_LOG_ENTRIES),
  });
}

export async function appendPersistedLog(entry) {
  const existingLogs = await loadPersistedLogs();
  const nextLogs = addLogEntry(existingLogs, entry);
  await persistLogs(nextLogs);
}

export async function clearPersistedLogs() {
  if (!chrome.storage?.local) {
    return;
  }

  await chrome.storage.local.remove(LOG_STORAGE_KEY);
}

export function emitPluginLog(level, message, details = null) {
  const entry = createLogEntry(level, message, details);

  if (level === "error") {
    debugError(message, details);
  } else {
    debugLog(message, details);
  }

  chrome.runtime.sendMessage(
    {
      action: ACTIONS.PLUGIN_LOG_ENTRY,
      entry,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );

  void appendPersistedLog(entry).catch((error) => {
    debugError("error desant log intern", error);
  });

  return entry;
}

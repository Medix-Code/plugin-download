import {
  addLogEntry,
  clearPersistedLogs,
  createLogEntry,
  debugError,
  loadPersistedLogs,
  persistLogs,
} from "../shared/logger.js";
import { getErrorMessage } from "../shared/errors.js";

function formatLogTimestamp(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString("ca-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatLogDetails(details) {
  if (!details) {
    return "";
  }

  if (typeof details === "string") {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

export function createLogsController(state, elements) {
  function renderLogs() {
    elements.logList.replaceChildren();

    if (state.logs.length === 0) {
      const empty = document.createElement("p");
      empty.className = "log-empty";
      empty.textContent = "Sense logs encara.";
      elements.logList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const entry of state.logs) {
      const item = document.createElement("article");
      item.className = `log-entry log-entry--${entry.level || "info"}`;

      const meta = document.createElement("div");
      meta.className = "log-entry__meta";

      const level = document.createElement("span");
      level.className = "log-entry__level";
      level.textContent = entry.level || "info";

      const time = document.createElement("time");
      time.className = "log-entry__time";
      time.textContent = formatLogTimestamp(entry.timestamp);

      const message = document.createElement("p");
      message.className = "log-entry__message";
      message.textContent = entry.message || "";

      meta.append(level, time);
      item.append(meta, message);

      const detailsText = formatLogDetails(entry.details);

      if (detailsText) {
        const details = document.createElement("p");
        details.className = "log-entry__details";
        details.textContent = detailsText;
        item.append(details);
      }

      fragment.append(item);
    }

    elements.logList.append(fragment);
  }

  async function load() {
    try {
      state.logs = await loadPersistedLogs();
    } catch (error) {
      debugError("error carregant logs desats", error);
      state.logs = [];
    }

    renderLogs();
  }

  async function clear() {
    state.logs = [];
    renderLogs();

    try {
      await clearPersistedLogs();
    } catch (error) {
      debugError("error netejant logs", error);
    }
  }

  function register(entry, options = {}) {
    const nextLogs = addLogEntry(state.logs, entry);

    if (nextLogs === state.logs) {
      return;
    }

    state.logs = nextLogs;
    renderLogs();

    if (options.persist === true) {
      persistLogs(state.logs).catch((error) => {
        debugError("error desant logs", error);
      });
    }
  }

  function push(level, message, details = null) {
    register(createLogEntry(level, message, details), { persist: true });
  }

  function reportError(message, error, extraDetails = null) {
    push("error", message, {
      message: getErrorMessage(error),
      ...extraDetails,
    });
  }

  return {
    renderLogs,
    load,
    clear,
    register,
    push,
    reportError,
  };
}

import { getErrorMessage } from "../shared/errors.js";
import { emitPluginLog } from "../shared/logger.js";
import { OFFSCREEN_TARGET } from "../shared/messages.js";
import { OFFSCREEN_DOCUMENT_PATH } from "./downloads/constants.js";

let creatingOffscreenDocumentPromise = null;

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

async function hasOffscreenDocument(path = OFFSCREEN_DOCUMENT_PATH) {
  const offscreenDocumentUrl = chrome.runtime.getURL(path);

  if (typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenDocumentUrl],
    });

    return contexts.length > 0;
  }

  if (typeof self.clients?.matchAll === "function") {
    const matchedClients = await self.clients.matchAll();
    return matchedClients.some((client) => client.url === offscreenDocumentUrl);
  }

  return false;
}

async function ensureOffscreenDocument(path = OFFSCREEN_DOCUMENT_PATH) {
  if (await hasOffscreenDocument(path)) {
    return;
  }

  if (creatingOffscreenDocumentPromise) {
    await creatingOffscreenDocumentPromise;
    return;
  }

  creatingOffscreenDocumentPromise = chrome.offscreen.createDocument({
    url: path,
    reasons: ["BLOBS"],
    justification:
      "Crear object URLs per descarregar blobs des del service worker.",
  });

  try {
    await creatingOffscreenDocumentPromise;
  } finally {
    creatingOffscreenDocumentPromise = null;
  }
}

export async function createOffscreenObjectUrlFromBlob(blob) {
  await ensureOffscreenDocument();
  const dataUrl = await blobToDataUrl(blob);
  const response = await sendRuntimeMessage({
    target: OFFSCREEN_TARGET,
    type: "create-object-url",
    dataUrl,
  });

  if (
    !response?.ok ||
    typeof response.objectUrl !== "string" ||
    typeof response.token !== "string"
  ) {
    throw new Error(
      response?.error || "No s'ha pogut crear l'object URL a offscreen.",
    );
  }

  return {
    objectUrl: response.objectUrl,
    token: response.token,
  };
}

export async function revokeOffscreenObjectUrl(token) {
  if (!token) {
    return;
  }

  try {
    await sendRuntimeMessage({
      target: OFFSCREEN_TARGET,
      type: "revoke-object-url",
      token,
    });
  } catch (error) {
    emitPluginLog("warn", "No s'ha pogut revocar un object URL temporal.", {
      token,
      message: getErrorMessage(error),
    });
  }
}

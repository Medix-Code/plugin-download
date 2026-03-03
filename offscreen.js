const objectUrlByToken = new Map();

function createToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function createObjectUrlFromDataUrl(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const token = createToken();
  const objectUrl = URL.createObjectURL(blob);
  objectUrlByToken.set(token, objectUrl);
  return {
    token,
    objectUrl
  };
}

async function createObjectUrlFromBytes(bytes, mimeType = "application/octet-stream") {
  const blob = new Blob([bytes], { type: mimeType });
  const token = createToken();
  const objectUrl = URL.createObjectURL(blob);
  objectUrlByToken.set(token, objectUrl);
  return {
    token,
    objectUrl
  };
}

function revokeObjectUrlByToken(token) {
  const objectUrl = objectUrlByToken.get(token);

  if (!objectUrl) {
    return false;
  }

  URL.revokeObjectURL(objectUrl);
  objectUrlByToken.delete(token);
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.target !== "offscreen") {
    return false;
  }

  if (message.type === "create-object-url" && typeof message.dataUrl === "string") {
    createObjectUrlFromDataUrl(message.dataUrl)
      .then((result) => {
        sendResponse({
          ok: true,
          token: result.token,
          objectUrl: result.objectUrl
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  if (message.type === "create-object-url-from-bytes" && message.bytes) {
    createObjectUrlFromBytes(message.bytes, message.mimeType)
      .then((result) => {
        sendResponse({
          ok: true,
          token: result.token,
          objectUrl: result.objectUrl
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  if (message.type === "revoke-object-url" && typeof message.token === "string") {
    sendResponse({
      ok: true,
      revoked: revokeObjectUrlByToken(message.token)
    });
    return false;
  }

  if (message.type === "revoke-all-object-urls") {
    for (const token of Array.from(objectUrlByToken.keys())) {
      revokeObjectUrlByToken(token);
    }

    sendResponse({
      ok: true
    });
    return false;
  }

  return false;
});

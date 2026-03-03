export function collectImagesFromPage() {
  const supportedExtensions = new Set([
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "svg",
    "avif",
    "bin",
  ]);
  const urls = new Set();
  const images = [];

  function inferExtension(rawUrl) {
    if (!rawUrl) {
      return "";
    }

    const value = String(rawUrl).trim();
    if (!value) {
      return "";
    }

    const dataMimeMatch = value.match(/^data:image\/([a-z0-9.+-]+);/i);
    if (dataMimeMatch?.[1]) {
      const mimeToken = dataMimeMatch[1].toLowerCase();
      if (mimeToken === "jpeg") return "jpg";
      if (mimeToken === "svg+xml") return "svg";
      if (["png", "jpg", "webp", "gif", "svg", "avif"].includes(mimeToken)) {
        return mimeToken;
      }
      return "bin";
    }

    if (/^blob:/i.test(value)) {
      return "bin";
    }

    try {
      const parsed = new URL(value, window.location.href);
      const pathname = parsed.pathname.toLowerCase();
      if (!pathname.includes(".")) {
        return "";
      }
      return pathname.split(".").pop() || "";
    } catch {
      return "";
    }
  }

  function addImage(rawUrl, sourceType, alt, width, height) {
    if (!rawUrl) {
      return;
    }

    try {
      const parsed = new URL(rawUrl, window.location.href);
      const extension = inferExtension(parsed.href);

      if (!supportedExtensions.has(extension) || urls.has(parsed.href)) {
        return;
      }

      urls.add(parsed.href);
      images.push({
        url: parsed.href,
        extension,
        longestSide: Math.max(Math.round(width || 0), Math.round(height || 0)),
        sourceType,
        alt: alt || "",
        width: Math.round(width || 0),
        height: Math.round(height || 0),
      });
    } catch {
      // Ignore invalid or unsupported image sources.
    }
  }

  for (const image of document.images) {
    const rawUrl = image.currentSrc || image.src;

    addImage(
      rawUrl,
      "img",
      image.alt || "",
      image.naturalWidth || image.width || 0,
      image.naturalHeight || image.height || 0,
    );
  }

  for (const element of document.querySelectorAll("*")) {
    const style = window.getComputedStyle(element);
    const backgroundImage = style.backgroundImage;

    if (!backgroundImage || !backgroundImage.includes("url(")) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    const matches = backgroundImage.matchAll(/url\((['"]?)(.*?)\1\)/g);

    for (const match of matches) {
      addImage(match[2], "background", "", rect.width, rect.height);
    }
  }

  return images;
}

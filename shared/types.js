/**
 * @typedef {Object} ImageItem
 * @property {string} url
 * @property {string} extension
 * @property {number} longestSide
 * @property {"img"|"background"} sourceType
 * @property {string} alt
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} UpscaleOptions
 * @property {boolean} enabled
 * @property {2|4} factor
 */

/**
 * @typedef {Object} DownloadOptions
 * @property {boolean} [saveAs]
 * @property {UpscaleOptions} [upscale]
 * @property {boolean} [preferArchive]
 * @property {string} [operation]
 * @property {number|null} [tabId]
 * @property {number|null} [windowId]
 */

/**
 * @typedef {Object} CaptureProgress
 * @property {string} captureId
 * @property {number} tabId
 * @property {number} windowId
 * @property {"started"|"capturing"|"stitching"|"done"|"error"} phase
 * @property {number} current
 * @property {number} total
 * @property {number} [retries]
 * @property {number} [skippedDuplicatePositions]
 * @property {string} [message]
 */

/**
 * @typedef {Object} PluginLogEntry
 * @property {string} id
 * @property {"info"|"warn"|"error"} level
 * @property {string} message
 * @property {unknown} [details]
 * @property {string} timestamp
 */

export const TYPES_VERSION = 1;

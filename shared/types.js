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
 * @property {Array<{name: string, text: string}>} [archiveExtraEntries]
 * @property {MockupTemplate} [archiveTemplate]
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

/**
 * @typedef {Object} ElementAnalysisLayer
 * @property {string} id
 * @property {"root"|"image"|"background"|"text"|"shape"|"unknown"} role
 * @property {string} selector
 * @property {string} tagName
 * @property {Object} rect
 * @property {number} zIndex
 * @property {string} opacity
 * @property {string} transform
 * @property {string} transformOrigin
 * @property {string} blendMode
 * @property {string} borderRadius
 * @property {string} objectFit
 * @property {string} objectPosition
 * @property {string} textColor
 * @property {string} fontFamily
 * @property {string} fontSize
 * @property {string} fontWeight
 * @property {string} lineHeight
 * @property {string} textAlign
 * @property {string} backgroundColor
 * @property {string} backgroundImage
 * @property {string} text
 * @property {string} maskImage
 * @property {string} maskSize
 * @property {string} maskPosition
 * @property {string} maskRepeat
 * @property {string} maskSource
 * @property {string[]} sources
 * @property {boolean} replaceable
 */

/**
 * @typedef {Object} MockupTemplate
 * @property {number} templateVersion
 * @property {string} exportedAt
 * @property {{url: string, title: string}} source
 * @property {{selector: string, tagName: string, size: {width: number, height: number}}} element
 * @property {{width: number, height: number, contentBounds: {x: number, y: number, width: number, height: number}}} canvas
 * @property {Object} styles
 * @property {Object} typography
 * @property {ElementAnalysisLayer[]} layers
 * @property {Array<{id: string, selector: string, role: string, sources: string[]}>} replaceableLayers
 * @property {{detected: boolean, svgFilename: string, screenLayerId?: string, frameLayerId?: string, screenSelector?: string, frameSelector?: string, screenRect?: {x: number, y: number, width: number, height: number}, frameRect?: {x: number, y: number, width: number, height: number}, screenClipRadius?: {rx: number, ry: number}, screenAsset?: string, frameAsset?: string, reason?: string}} [editableMockup]
 * @property {string[]} notes
 */

export const TYPES_VERSION = 1;

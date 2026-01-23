/**
 * DMARC Report Reader - Service Worker
 * Handles file extraction and message passing between extension components
 */

importScripts(
  '../../lib/pako.min.js',
  '../../lib/jszip.min.js',
  '../parser/file-handler.js'
);

/**
 * Keep-alive alarm configuration
 * Prevents Chrome from terminating service worker during idle periods.
 * Chrome MV3 terminates service workers after ~5 minutes of inactivity.
 * We use a 4-minute alarm to stay under this threshold.
 */
const KEEP_ALIVE_ALARM = 'dmarc-keep-alive';
const KEEP_ALIVE_INTERVAL_MINUTES = 4;

/**
 * Set up keep-alive alarm
 * Creates a periodic alarm if one doesn't already exist.
 */
function setupKeepAlive() {
  chrome.alarms.get(KEEP_ALIVE_ALARM, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(KEEP_ALIVE_ALARM, {
        periodInMinutes: KEEP_ALIVE_INTERVAL_MINUTES
      });
    }
  });
}

/**
 * Handle alarm events
 * The alarm firing itself resets the idle timer, keeping the worker alive.
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    // Alarm firing is sufficient to keep worker alive - no action needed
  }
});

// Initialize keep-alive on extension lifecycle events
chrome.runtime.onInstalled.addListener(setupKeepAlive);
chrome.runtime.onStartup.addListener(setupKeepAlive);

// Also set up immediately in case worker is waking from idle
setupKeepAlive();

/**
 * Storage keys for report data
 * @constant {Object}
 */
const STORAGE_KEYS = Object.freeze({
  REPORT_DATA: 'dmarcReportData',
  // Legacy key for backwards compatibility
  LEGACY_XML: 'currentXml'
});

/**
 * Extract and process file data
 * @param {number[]} dataArray - File data as array of bytes
 * @param {string} fileName - Original filename
 * @returns {Promise<ExtractionResult>} Extraction result
 */
async function extractFile(dataArray, fileName) {
  const data = new Uint8Array(dataArray);
  return await extractXmlFromFile(data, fileName);
}

/**
 * Store extraction result in chrome.storage.local
 * @param {ExtractionResult} result - Extraction result to store
 * @returns {Promise<void>}
 */
function storeReportData(result) {
  return new Promise((resolve, reject) => {
    // Clear any legacy data first, then store new format
    chrome.storage.local.remove([STORAGE_KEYS.LEGACY_XML], () => {
      chrome.storage.local.set({ [STORAGE_KEYS.REPORT_DATA]: result }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * Open viewer tab
 * @param {number|undefined} tabIndex - Index to open tab at
 * @returns {Promise<chrome.tabs.Tab>}
 */
function openViewerTab(tabIndex) {
  return new Promise((resolve) => {
    const viewerUrl = chrome.runtime.getURL('src/viewer/viewer.html');
    chrome.tabs.create({ url: viewerUrl, index: tabIndex }, (tab) => {
      resolve(tab);
    });
  });
}

/**
 * Allowed origins for message senders
 * Only our extension pages and authorized content script hosts
 * @constant {string[]}
 */
const ALLOWED_ORIGINS = Object.freeze([
  'chrome-extension://', // Our extension pages (popup, viewer)
  'https://mail.google.com',
  'https://outlook.live.com',
  'https://outlook.office.com'
]);

/**
 * Validate message sender origin
 * @param {Object} sender - Chrome message sender object
 * @returns {boolean} True if sender is from an allowed origin
 */
function isValidSender(sender) {
  // Extension pages (popup, viewer) have sender.id matching our extension
  if (sender.id === chrome.runtime.id) {
    return true;
  }

  // Content scripts have sender.url from the host page
  if (sender.url) {
    return ALLOWED_ORIGINS.some(origin => sender.url.startsWith(origin));
  }

  // Reject if we can't verify
  return false;
}

/**
 * Validate file data payload
 * @param {*} data - Data to validate
 * @returns {boolean} True if data is a valid array of numbers
 */
function isValidFileData(data) {
  if (!Array.isArray(data)) {
    return false;
  }
  // Check it's reasonably sized (max 50MB) and contains numbers
  if (data.length === 0 || data.length > 50 * 1024 * 1024) {
    return false;
  }
  // Spot check a few elements are valid byte values
  const checkIndices = [0, Math.floor(data.length / 2), data.length - 1];
  return checkIndices.every(i => {
    const val = data[i];
    return typeof val === 'number' && val >= 0 && val <= 255 && Number.isInteger(val);
  });
}

/**
 * Validate filename string
 * @param {*} filename - Filename to validate
 * @returns {boolean} True if filename is a valid string
 */
function isValidFilename(filename) {
  return typeof filename === 'string' && filename.length > 0 && filename.length < 256;
}

// Message handlers with validation
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate sender origin for all messages
  if (!isValidSender(sender)) {
    console.warn('DMARC Reader: Rejected message from unauthorized sender:', sender.url || sender.id);
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return true;
  }

  const action = message.action;

  // Ping action - used to wake up the service worker
  // This is a lightweight check that confirms the worker is running
  if (action === 'ping') {
    sendResponse({ success: true, pong: true });
    return true;
  }

  if (action === 'processFile') {
    // Validate message payload
    if (!isValidFileData(message.data)) {
      sendResponse({ success: false, error: 'Invalid file data' });
      return true;
    }
    if (!isValidFilename(message.filename)) {
      sendResponse({ success: false, error: 'Invalid filename' });
      return true;
    }

    extractFile(message.data, message.filename)
      .then(result => storeReportData(result))
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error('DMARC Reader: Error processing file:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  }

  if (action === 'openViewer') {
    const tabIndex = sender.tab ? sender.tab.index + 1 : undefined;
    openViewerTab(tabIndex)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (action === 'processAttachment') {
    // Validate message payload
    if (!isValidFileData(message.data)) {
      sendResponse({ success: false, error: 'Invalid file data' });
      return true;
    }
    if (!isValidFilename(message.filename)) {
      sendResponse({ success: false, error: 'Invalid filename' });
      return true;
    }

    const tabIndex = sender.tab ? sender.tab.index + 1 : undefined;

    extractFile(message.data, message.filename)
      .then(result => storeReportData(result))
      .then(() => openViewerTab(tabIndex))
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('DMARC Reader: Error processing attachment:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  // Unknown action - don't send response (let other handlers try)
  return false;
});

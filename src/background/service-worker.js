/**
 * DMARC Report Reader - Service Worker
 * Handles background tasks, file processing, and message passing
 */

// Import libraries and parser modules
importScripts(
  '../../lib/pako.min.js',
  '../../lib/jszip.min.js',
  '../parser/file-handler.js',
  '../parser/dmarc-parser.js'
);

/**
 * Process a DMARC report file
 * @param {number[]} dataArray - File data as byte array
 * @param {string} fileName - Original filename
 * @returns {Promise<Object>} Parsed DMARC report
 */
async function processFile(dataArray, fileName) {
  const data = new Uint8Array(dataArray);

  // Extract XML from file (handles ZIP, GZIP, or plain XML)
  const xmlString = await extractXmlFromFile(data, fileName);

  // Parse DMARC report
  const report = parseDmarcReport(xmlString);

  return report;
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'processFile') {
    processFile(message.data, message.fileName)
      .then(report => {
        // Store the report for the viewer
        chrome.storage.local.set({ currentReport: report }, () => {
          sendResponse({ success: true, report });
        });
      })
      .catch(err => {
        console.error('File processing error:', err);
        sendResponse({ success: false, error: err.message });
      });

    // Return true to indicate async response
    return true;
  }

  if (message.action === 'getReport') {
    chrome.storage.local.get(['currentReport'], (result) => {
      sendResponse({ success: true, report: result.currentReport });
    });
    return true;
  }
});

// Log when service worker starts
console.log('DMARC Report Reader service worker initialized');

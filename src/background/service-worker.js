/**
 * DMARC Report Reader - Service Worker
 * Handles background tasks, file extraction, and message passing
 * Note: DOMParser is not available in service workers, so XML parsing
 * is done in the viewer context instead.
 */

// Import libraries for file extraction only
importScripts(
  '../../lib/pako.min.js',
  '../../lib/jszip.min.js',
  '../parser/file-handler.js'
);

/**
 * Extract XML from a DMARC report file
 * @param {number[]} dataArray - File data as byte array
 * @param {string} fileName - Original filename
 * @returns {Promise<string>} Extracted XML string
 */
async function extractFile(dataArray, fileName) {
  const data = new Uint8Array(dataArray);
  // Extract XML from file (handles ZIP, GZIP, or plain XML)
  return await extractXmlFromFile(data, fileName);
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'processFile') {
    extractFile(message.data, message.fileName)
      .then(xmlString => {
        // Store the raw XML for the viewer to parse
        chrome.storage.local.set({ currentXml: xmlString }, () => {
          sendResponse({ success: true });
        });
      })
      .catch(err => {
        console.error('File extraction error:', err);
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }

  if (message.action === 'getXml') {
    chrome.storage.local.get(['currentXml'], (result) => {
      sendResponse({ success: true, xml: result.currentXml });
    });
    return true;
  }

  if (message.action === 'openViewer') {
    const viewerUrl = chrome.runtime.getURL('src/viewer/viewer.html');
    chrome.tabs.create({ url: viewerUrl }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

console.log('DMARC Report Reader service worker initialized');

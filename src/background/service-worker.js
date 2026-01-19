/**
 * DMARC Report Reader - Service Worker
 * Handles file extraction and message passing
 */

importScripts(
  '../../lib/pako.min.js',
  '../../lib/jszip.min.js',
  '../parser/file-handler.js'
);

/**
 * Extract XML from file data
 */
async function extractFile(dataArray, fileName) {
  const data = new Uint8Array(dataArray);
  return await extractXmlFromFile(data, fileName);
}

// Message handlers
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('DMARC Reader:', message.action);

  if (message.action === 'processFile') {
    extractFile(message.data, message.fileName)
      .then(xmlString => {
        chrome.storage.local.set({ currentXml: xmlString }, () => {
          sendResponse({ success: true });
        });
      })
      .catch(err => {
        console.error('DMARC Reader: Error processing file:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.action === 'openViewer') {
    const viewerUrl = chrome.runtime.getURL('src/viewer/viewer.html');
    // Open tab next to current tab
    const tabIndex = sender.tab ? sender.tab.index + 1 : undefined;
    chrome.tabs.create({ url: viewerUrl, index: tabIndex }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'processAttachment') {
    // Get tab index before async operation
    const tabIndex = sender.tab ? sender.tab.index + 1 : undefined;

    extractFile(message.data, message.filename)
      .then(xmlString => {
        chrome.storage.local.set({ currentXml: xmlString }, () => {
          const viewerUrl = chrome.runtime.getURL('src/viewer/viewer.html');
          // Open tab next to current tab
          chrome.tabs.create({ url: viewerUrl, index: tabIndex }, () => {
            sendResponse({ success: true });
          });
        });
      })
      .catch(err => {
        console.error('DMARC Reader: Error processing attachment:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

});

console.log('DMARC Report Reader service worker ready');

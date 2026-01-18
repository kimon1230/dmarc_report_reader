/**
 * DMARC Report Reader - Service Worker
 * Handles background tasks, file processing, and message passing
 */

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'processFile') {
    // Placeholder for file processing - implemented in Phase 2
    console.log('Received file:', message.fileName);
    sendResponse({ success: false, error: 'File processing not yet implemented' });
  }

  // Return true to indicate async response
  return true;
});

// Log when service worker starts
console.log('DMARC Report Reader service worker initialized');

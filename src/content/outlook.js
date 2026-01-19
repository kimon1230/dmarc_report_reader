/**
 * DMARC Report Reader - Outlook Web Content Script
 * Detects DMARC report attachments and injects viewer button
 */

(function() {
  'use strict';

  console.log('DMARC Report Reader: Outlook content script loading...');

  /**
   * Send message to service worker with retry logic.
   * Handles MV3 service worker lifecycle where the worker may be inactive.
   * @param {Object} message - Message to send
   * @param {Object} options - Retry options
   * @param {number} options.maxRetries - Maximum retry attempts (default 3)
   * @param {Function} options.onRetry - Callback when retrying (receives attempt number)
   * @returns {Promise<Object>} Response from service worker
   */
  function sendMessageWithRetry(message, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const onRetry = options.onRetry || (() => {});

    return new Promise((resolve, reject) => {
      let attempts = 0;
      let settled = false;

      function attempt() {
        if (settled) return;
        attempts++;
        let attemptHandled = false;
        let timeoutId = null;

        // First attempt: short timeout (just wake the worker)
        // Subsequent attempts: longer timeout (let it process)
        const timeoutMs = attempts === 1 ? 1000 : 3000;

        timeoutId = setTimeout(() => {
          if (attemptHandled || settled) return;
          attemptHandled = true;

          if (attempts < maxRetries) {
            console.log(`DMARC Reader: Attempt ${attempts} timeout, retrying...`);
            onRetry(attempts);
            setTimeout(attempt, 100 * attempts); // Fast backoff
          } else {
            settled = true;
            reject(new Error('Service worker did not respond after retries'));
          }
        }, timeoutMs);

        try {
          chrome.runtime.sendMessage(message, (response) => {
            if (attemptHandled || settled) return;
            attemptHandled = true;
            clearTimeout(timeoutId);

            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message || 'Unknown error';
              console.log(`DMARC Reader: sendMessage error: ${errMsg}`);

              if (attempts < maxRetries) {
                onRetry(attempts);
                setTimeout(attempt, 100 * attempts);
              } else {
                settled = true;
                reject(new Error(errMsg));
              }
              return;
            }

            settled = true;
            resolve(response);
          });
        } catch (err) {
          if (attemptHandled || settled) return;
          attemptHandled = true;
          clearTimeout(timeoutId);

          if (attempts < maxRetries) {
            console.log(`DMARC Reader: Exception, retrying:`, err.message);
            onRetry(attempts);
            setTimeout(attempt, 100 * attempts);
          } else {
            settled = true;
            reject(err);
          }
        }
      }

      attempt();
    });
  }

  // File patterns that indicate DMARC reports
  const DMARC_PATTERNS = [
    /dmarc/i,
    /^[a-z0-9.-]+![a-z0-9.-]+!\d+!\d+/i,  // Standard DMARC filename format
    /aggregate.*report/i,
    /rua.*report/i
  ];

  // Valid file extensions
  const VALID_EXTENSIONS = ['.xml', '.xml.gz', '.gz', '.zip'];

  // Global flag to prevent duplicate buttons
  let buttonsInjected = new Set();

  /**
   * Check if filename looks like a DMARC report
   */
  function isDmarcReport(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    const hasValidExtension = VALID_EXTENSIONS.some(ext => lower.endsWith(ext));
    if (!hasValidExtension) return false;
    return DMARC_PATTERNS.some(pattern => pattern.test(filename));
  }

  /**
   * Extract filename from text
   */
  function extractFilename(text) {
    if (!text) return null;
    const match = text.match(/[\w\-!.]+\.(xml\.gz|xml|gz|zip)/i);
    return match ? match[0] : null;
  }

  // Add CSS for button states
  if (!document.getElementById('dmarc-outlook-style')) {
    const style = document.createElement('style');
    style.id = 'dmarc-outlook-style';
    style.textContent = `
      @keyframes dmarc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
      .dmarc-viewer-btn.connecting { animation: dmarc-pulse 0.8s ease-in-out infinite; }
      .dmarc-viewer-btn.error { background: #d13438 !important; }
      .dmarc-viewer-btn.success { background: #107c10 !important; }
    `;
    document.head.appendChild(style);
  }

  /**
   * Create the viewer button
   */
  function createViewerButton(filename) {
    const button = document.createElement('button');
    button.className = 'dmarc-viewer-btn';
    button.textContent = 'Open in DMARC Viewer';
    button.title = `Open ${filename} in DMARC Report Viewer`;
    button.dataset.dmarcFilename = filename;

    const defaultText = 'Open in DMARC Viewer';

    button.style.cssText = `
      margin: 8px;
      padding: 8px 16px;
      background: #0078d4;
      color: white;
      border: none;
      border-radius: 2px;
      font-size: 13px;
      font-weight: 600;
      font-family: 'Segoe UI', sans-serif;
      cursor: pointer;
      display: block;
      transition: background 0.15s;
    `;

    button.onmouseover = () => {
      if (!button.classList.contains('error') && !button.classList.contains('success')) {
        button.style.background = '#106ebe';
      }
    };
    button.onmouseout = () => {
      if (!button.classList.contains('error') && !button.classList.contains('success')) {
        button.style.background = '#0078d4';
      }
    };

    function setButtonState(state) {
      button.classList.remove('connecting', 'error', 'success');
      switch (state) {
        case 'connecting':
          button.textContent = 'Connecting...';
          button.classList.add('connecting');
          break;
        case 'success':
          button.textContent = 'Opened!';
          button.classList.add('success');
          button.style.background = '#107c10';
          break;
        case 'error':
          button.textContent = 'Failed - Click to retry';
          button.classList.add('error');
          button.style.background = '#d13438';
          break;
        default:
          button.textContent = defaultText;
          button.style.background = '#0078d4';
      }
    }

    button.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      setButtonState('connecting');

      try {
        await sendMessageWithRetry({ action: 'openViewer' }, {
          onRetry: () => setButtonState('connecting')
        });

        setButtonState('success');
        setTimeout(() => setButtonState('default'), 2000);

        alert(`To view this DMARC report:\n\n1. Download "${filename}" from Outlook\n2. Drop the file into the viewer that just opened\n\n(Outlook doesn't allow extensions to directly access attachments)`);
      } catch (err) {
        console.error('DMARC Reader: Failed to open viewer:', err);
        setButtonState('error');
        setTimeout(() => setButtonState('default'), 3000);
        alert('Failed to open DMARC Viewer. Please try again or use the extension popup.');
      }
    };

    return button;
  }

  /**
   * Find attachment containers and inject buttons
   */
  function scanForAttachments() {
    // Find all elements that might contain DMARC filenames
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const dmarcNodes = [];
    let node;

    while (node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (text.length > 5 && text.length < 200) {
        const filename = extractFilename(text);
        if (filename && isDmarcReport(filename)) {
          dmarcNodes.push({ node, filename });
        }
      }
    }

    // Process found nodes
    for (const { node, filename } of dmarcNodes) {
      // Skip if we already added a button for this filename in this area
      const buttonId = `${filename}-${node.parentElement?.className || 'unknown'}`;
      if (buttonsInjected.has(buttonId)) continue;

      // Find a good container to append the button to
      let container = node.parentElement;

      // Walk up to find a reasonable container (but not too far)
      let depth = 0;
      while (container && depth < 5) {
        // Check if this container already has our button
        if (container.querySelector('.dmarc-viewer-btn')) {
          container = null;
          break;
        }

        // Check if container seems like an attachment area
        const rect = container.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 30 && rect.width < 600) {
          break;
        }
        container = container.parentElement;
        depth++;
      }

      if (container && !container.querySelector('.dmarc-viewer-btn')) {
        console.log('DMARC Viewer: Adding button for', filename);
        buttonsInjected.add(buttonId);

        const button = createViewerButton(filename);
        container.appendChild(button);
      }
    }
  }

  /**
   * Initialize
   */
  function init() {
    // Initial scan after a delay (let Outlook load)
    const initialScanTimeout = setTimeout(scanForAttachments, 1000);

    // Watch for changes
    let debounceTimeout;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(scanForAttachments, 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Cleanup on page unload to prevent memory leaks
    window.addEventListener('pagehide', () => {
      observer.disconnect();
      clearTimeout(initialScanTimeout);
      clearTimeout(debounceTimeout);
    });

    console.log('DMARC Report Reader: Outlook observer initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

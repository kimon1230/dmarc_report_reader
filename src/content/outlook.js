/**
 * DMARC Report Reader - Outlook Web Content Script
 * Detects DMARC report attachments and injects viewer button
 */

(function() {
  'use strict';

  console.log('DMARC Report Reader: Outlook content script loading...');

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

  /**
   * Create the viewer button
   */
  function createViewerButton(filename) {
    const button = document.createElement('button');
    button.className = 'dmarc-viewer-btn';
    button.textContent = 'Open in DMARC Viewer';
    button.title = `Open ${filename} in DMARC Report Viewer`;
    button.dataset.dmarcFilename = filename;

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
    `;

    button.onmouseover = () => button.style.background = '#106ebe';
    button.onmouseout = () => button.style.background = '#0078d4';

    button.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Open extension viewer with instructions
      chrome.runtime.sendMessage({ action: 'openViewer' }, () => {
        alert(`To view this DMARC report:\n\n1. Download "${filename}" from Outlook\n2. Drop the file into the viewer that just opened\n\n(Outlook doesn't allow extensions to directly access attachments)`);
      });
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
    setTimeout(scanForAttachments, 1000);

    // Watch for changes
    const observer = new MutationObserver(() => {
      clearTimeout(init.timeout);
      init.timeout = setTimeout(scanForAttachments, 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('DMARC Report Reader: Outlook observer initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

/**
 * DMARC Report Reader - Gmail Content Script
 */

(function() {
  'use strict';

  /**
   * Send message to service worker with retry logic.
   * In MV3, chrome.runtime.sendMessage automatically wakes the service worker.
   * This function adds retry logic with exponential backoff for reliability.
   *
   * Pattern based on Chrome MV3 best practices:
   * - sendMessage wakes the worker automatically
   * - Check chrome.runtime.lastError for errors
   * - Retry with exponential backoff on failure
   *
   * @param {Object} message - Message to send
   * @param {Object} options - Retry options
   * @param {number} options.maxRetries - Maximum retry attempts (default 3)
   * @param {Function} options.onRetry - Callback when retrying (receives attempt number)
   * @returns {Promise<Object>} Response from service worker
   */
  async function sendMessageWithRetry(message, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const onRetry = options.onRetry || (() => {});

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await new Promise((resolve, reject) => {
          // Use longer timeout for cold-start scenarios where service worker
          // needs to load external libraries (pako, jszip, file-handler)
          // First attempt: 15s (cold start), subsequent: 20s (processing large files)
          const timeoutMs = attempt === 1 ? 15000 : 20000;
          const timeoutId = setTimeout(() => {
            reject(new Error(`Timeout after ${timeoutMs}ms - service worker may be initializing`));
          }, timeoutMs);

          chrome.runtime.sendMessage(message, (response) => {
            clearTimeout(timeoutId);

            // Check for Chrome runtime errors (connection issues, worker terminated, etc.)
            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message || 'Unknown Chrome runtime error';
              reject(new Error(errMsg));
              return;
            }

            resolve(response);
          });
        });

        return response;
      } catch (err) {
        const isTimeout = err.message.includes('Timeout');
        const isConnectionError = err.message.includes('Could not establish connection') ||
                                   err.message.includes('Receiving end does not exist');

        console.log(`DMARC Reader: Attempt ${attempt}/${maxRetries} failed:`, err.message);

        if (attempt < maxRetries) {
          onRetry(attempt);

          // Exponential backoff: 1s, 2s, 4s
          // Longer delays give service worker time to fully initialize
          const backoffMs = 1000 * Math.pow(2, attempt - 1);
          console.log(`DMARC Reader: Waiting ${backoffMs}ms before retry...`);
          await new Promise(r => setTimeout(r, backoffMs));
        } else {
          // Provide helpful error message based on error type
          if (isConnectionError) {
            throw new Error('Could not connect to extension. Try refreshing the page.');
          } else if (isTimeout) {
            throw new Error('Extension took too long to respond. Try again.');
          } else {
            throw new Error(`Extension error: ${err.message}`);
          }
        }
      }
    }
  }

  const DMARC_PATTERNS = [
    /dmarc/i,
    /[a-z0-9.-]+![a-z0-9.-]+!\d+!\d+/i,
    /aggregate.*report/i,
    /rua.*report/i
  ];

  const VALID_EXTENSIONS = ['.xml', '.xml.gz', '.gz', '.zip'];

  function isDmarcFile(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    const hasValidExt = VALID_EXTENSIONS.some(ext => lower.endsWith(ext));
    if (!hasValidExt) return false;
    return DMARC_PATTERNS.some(p => p.test(filename));
  }

  function extractFilename(text) {
    if (!text) return null;
    const match = text.match(/[\w\-!.]+\.(xml\.gz|xml|gz|zip)/i);
    return match ? match[0] : null;
  }

  function findDownloadUrl(el) {
    // Traverse up from the element to find attachment download link
    let current = el;
    for (let i = 0; i < 10 && current; i++) {
      const links = current.querySelectorAll('a[href*="mail.google.com"]');
      for (const link of links) {
        const href = link.href;
        if (href.includes('attid=') || href.includes('disp=safe') || href.includes('disp=attd')) {
          return href;
        }
      }
      current = current.parentElement;
    }

    // Try to construct URL from inbox row data
    // Find thread ID from the row
    current = el;
    for (let i = 0; i < 20 && current; i++) {
      // Log what we're checking
      const attrs = Array.from(current.attributes || []).map(a => `${a.name}="${a.value.substring(0, 50)}"`).join(', ');
      if (attrs.length > 0 && i < 5) {
        console.log('DMARC Reader: Checking element:', current.tagName, attrs.substring(0, 200));
      }

      // Look for thread ID in data attributes
      const threadId = current.getAttribute('data-thread-id') ||
                       current.getAttribute('data-message-id') ||
                       current.getAttribute('data-legacy-thread-id') ||
                       current.getAttribute('data-item-id');

      if (threadId) {
        const userMatch = window.location.pathname.match(/\/mail\/u\/(\d+)/);
        const userNum = userMatch ? userMatch[1] : '0';
        const url = `https://mail.google.com/mail/u/${userNum}/?ui=2&attid=0.1&disp=safe&th=${threadId}&zw`;
        console.log('DMARC Reader: Constructed URL from thread ID:', threadId);
        return url;
      }

      // Check all links in this element for thread references
      const allLinks = current.querySelectorAll('a[href]');
      for (const link of allLinks) {
        const href = link.href || '';
        // Match patterns like #inbox/FMfcgzQZTCsq or #inbox/19b7ab44902c2dbe
        const hrefMatch = href.match(/#(?:inbox|sent|label\/[^/]+|search\/[^/]+)\/([A-Za-z0-9_-]+)/);
        if (hrefMatch && hrefMatch[1].length > 10) {
          const userMatch = window.location.pathname.match(/\/mail\/u\/(\d+)/);
          const userNum = userMatch ? userMatch[1] : '0';
          const url = `https://mail.google.com/mail/u/${userNum}/?ui=2&attid=0.1&disp=safe&th=${hrefMatch[1]}&zw`;
          console.log('DMARC Reader: Constructed URL from link href:', hrefMatch[1]);
          return url;
        }
      }

      current = current.parentElement;
    }

    console.log('DMARC Reader: Could not find thread ID');
    return null;
  }

  async function fetchAttachment(url) {
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.arrayBuffer();
    } catch (e) {
      console.log('DMARC Reader: Fetch failed:', e.message);
      return null;
    }
  }

  function triggerDownload(el) {
    // Traverse up from the element to find download button
    let current = el;
    for (let i = 0; i < 10 && current; i++) {
      const btns = current.querySelectorAll('[aria-label*="ownload"], [data-tooltip*="ownload"]');
      for (const btn of btns) {
        const label = (btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || '').toLowerCase();
        if (label.includes('download') && !label.includes('all')) {
          btn.click();
          return true;
        }
      }
      current = current.parentElement;
    }
    return false;
  }

  function createButton(filename, containerEl, isInbox = false) {
    const btn = document.createElement('div');
    btn.className = 'dmarc-viewer-btn';
    btn.setAttribute('data-dmarc-file', filename);
    btn.title = isInbox ? 'Open email to view DMARC Report' : 'View DMARC Report';

    btn.innerHTML = ICONS.chart;

    Object.assign(btn.style, {
      width: '26px',
      height: '26px',
      minWidth: '26px',
      background: '#1a73e8',
      borderRadius: '50%',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      marginLeft: '4px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
      flexShrink: '0'
    });

    btn.onmouseenter = () => {
      if (!btn.classList.contains('dmarc-error')) {
        btn.style.background = '#1557b0';
      }
    };
    btn.onmouseleave = () => {
      if (!btn.classList.contains('dmarc-error')) {
        btn.style.background = '#1a73e8';
      }
    };

    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Show connecting state immediately
      setButtonState(btn, 'connecting');

      const url = findDownloadUrl(containerEl);
      if (url) {
        const data = await fetchAttachment(url);
        if (data) {
          setButtonState(btn, 'processing');
          try {
            const response = await sendMessageWithRetry({
              action: 'processAttachment',
              data: Array.from(new Uint8Array(data)),
              filename: filename
            }, {
              onRetry: () => setButtonState(btn, 'connecting')
            });

            setButtonState(btn, 'success');
            setTimeout(() => setButtonState(btn, 'default'), 1500);

            if (!response?.success) {
              await sendMessageWithRetry({ action: 'openViewer' });
            }
          } catch (err) {
            console.error('DMARC Reader: Failed to process attachment:', err);
            setButtonState(btn, 'error');
            setTimeout(() => setButtonState(btn, 'default'), 3000);

            // Try to open viewer anyway - user can drop file manually
            try {
              await sendMessageWithRetry({ action: 'openViewer' });
            } catch (e) {
              console.error('DMARC Reader: Failed to open viewer:', e);
            }
          }
          return;
        }
      }

      // No download URL found - we're in inbox listing
      // Navigate to email where the button will work
      setButtonState(btn, 'default');

      sessionStorage.setItem('dmarc_pending_file', filename);

      let row = containerEl;
      for (let i = 0; i < 15 && row; i++) {
        if (row.getAttribute('role') === 'row' || row.classList.contains('zA')) {
          const clickable = row.querySelector('.xT, .y6, [data-thread-id], .bog, .bqe');
          if (clickable) {
            clickable.click();
            return;
          }
          row.click();
          return;
        }
        row = row.parentElement;
      }

      // Last resort: trigger download and open viewer
      triggerDownload(containerEl);
      sendMessageWithRetry({ action: 'openViewer' }).catch(err => {
        console.error('DMARC Reader: Failed to open viewer:', err);
        setButtonState(btn, 'error');
        setTimeout(() => setButtonState(btn, 'default'), 3000);
      });
    };

    return btn;
  }

  // CSS with connection/processing states
  if (!document.getElementById('dmarc-style')) {
    const style = document.createElement('style');
    style.id = 'dmarc-style';
    style.textContent = `
      @keyframes dmarc-spin { to { transform: rotate(360deg); } }
      @keyframes dmarc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      .dmarc-viewer-btn { transition: background 0.15s; }
      .dmarc-connecting { animation: dmarc-pulse 0.8s ease-in-out infinite; }
      .dmarc-error { background: #dc2626 !important; }
    `;
    document.head.appendChild(style);
  }

  // UI state constants
  const ICONS = {
    chart: `<svg viewBox="0 0 24 24" width="18" height="18" fill="white">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z"/>
    </svg>`,
    spinner: '<div style="width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:dmarc-spin 0.8s linear infinite"></div>',
    check: `<svg viewBox="0 0 24 24" width="18" height="18" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
    error: `<svg viewBox="0 0 24 24" width="18" height="18" fill="white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`
  };

  function setButtonState(btn, state) {
    btn.classList.remove('dmarc-connecting', 'dmarc-error');
    switch (state) {
      case 'connecting':
        btn.innerHTML = ICONS.spinner;
        btn.classList.add('dmarc-connecting');
        btn.title = 'Connecting...';
        break;
      case 'processing':
        btn.innerHTML = ICONS.spinner;
        btn.title = 'Processing...';
        break;
      case 'success':
        btn.innerHTML = ICONS.check;
        btn.title = 'Done!';
        break;
      case 'error':
        btn.innerHTML = ICONS.error;
        btn.classList.add('dmarc-error');
        btn.title = 'Failed - click to retry';
        break;
      default:
        btn.innerHTML = ICONS.chart;
        btn.title = 'View DMARC Report';
    }
  }

  function scan() {
    // Remove any existing buttons first to prevent duplicates
    document.querySelectorAll('.dmarc-viewer-btn').forEach(btn => btn.remove());

    // Track which filenames we've added buttons for
    const addedFiles = new Set();

    // Skip projector mode - Gmail doesn't expose download URLs there
    // User needs to open the email to use the DMARC viewer button
    if (window.location.hash.includes('projector=')) {
      return;
    }

    // Find attachment elements - Gmail uses aria-label and data-tooltip
    const candidates = document.querySelectorAll('[aria-label], [data-tooltip]');

    for (const el of candidates) {
      const label = el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || '';
      const filename = extractFilename(label);

      if (!filename || !isDmarcFile(filename)) continue;
      if (addedFiles.has(filename)) continue;

      // Check element is visible
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 10) continue;

      addedFiles.add(filename);
      console.log('DMARC Reader: Adding button for', filename);

      const btn = createButton(filename, el, false);
      el.parentElement?.appendChild(btn);
    }

    // Also check inbox listing - attachment chips may use different structure
    // Look for attachment preview elements that contain DMARC filenames as text
    const attachmentChips = document.querySelectorAll('[data-tooltip], .aZo, .brg');
    for (const el of attachmentChips) {
      // Check text content for filename patterns
      const text = el.textContent || '';
      if (text.length > 200) continue; // Skip large elements

      const filename = extractFilename(text);
      if (!filename || !isDmarcFile(filename)) continue;
      if (addedFiles.has(filename)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 30 || rect.height < 15) continue;

      addedFiles.add(filename);
      console.log('DMARC Reader: Adding button for (inbox)', filename);

      const btn = createButton(filename, el, true);
      // For inbox chips, append to parent or after element
      if (el.parentElement) {
        el.parentElement.appendChild(btn);
      }
    }
  }

  // Check for pending file to auto-process after navigation from inbox
  function checkPendingFile() {
    const pendingFile = sessionStorage.getItem('dmarc_pending_file');
    if (!pendingFile) return;

    // Only process if we're now in email view (not inbox)
    const hash = window.location.hash;
    if (hash === '#inbox' || hash === '#sent' || !hash.includes('/')) return;

    // Find button for this file using safe iteration (avoid selector injection)
    const buttons = document.querySelectorAll('.dmarc-viewer-btn');
    for (const btn of buttons) {
      if (btn.dataset.dmarcFile === pendingFile) {
        console.log('DMARC Reader: Auto-clicking button for', pendingFile);
        sessionStorage.removeItem('dmarc_pending_file');
        btn.click();
        return;
      }
    }
  }

  // Debounced observer
  let timeout;
  let scanTimeout1;
  let scanTimeout2;
  let pendingFileTimeout;

  const observer = new MutationObserver(() => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      scan();
      checkPendingFile();
    }, 600);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  scanTimeout1 = setTimeout(scan, 1500);
  scanTimeout2 = setTimeout(scan, 3500);
  pendingFileTimeout = setTimeout(checkPendingFile, 2000);

  // Cleanup on page unload to prevent memory leaks
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    clearTimeout(timeout);
    clearTimeout(scanTimeout1);
    clearTimeout(scanTimeout2);
    clearTimeout(pendingFileTimeout);
  });

  /**
   * Health check on tab visibility change
   * Proactively wakes the service worker when user returns to tab after being idle.
   * This ensures the worker is ready before user clicks any buttons.
   */
  let healthCheckInProgress = false;

  async function checkServiceWorkerHealth() {
    if (healthCheckInProgress) return;
    healthCheckInProgress = true;

    try {
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('Health check timeout')), 5000);

        chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      });

      if (!response?.pong) {
        console.warn('DMARC Reader: Service worker health check failed - unexpected response');
      }
    } catch (err) {
      console.warn('DMARC Reader: Service worker may need initialization. Buttons will retry automatically.');
    } finally {
      healthCheckInProgress = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkServiceWorkerHealth();
    }
  });

  console.log('DMARC Reader: Loaded');
})();

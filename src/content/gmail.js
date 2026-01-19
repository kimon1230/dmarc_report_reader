/**
 * DMARC Report Reader - Gmail Content Script
 */

(function() {
  'use strict';

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

  function createButton(filename, containerEl) {
    const btn = document.createElement('div');
    btn.className = 'dmarc-viewer-btn';
    btn.setAttribute('data-dmarc-file', filename);
    btn.title = 'View DMARC Report';

    const svg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="white">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z"/>
    </svg>`;

    btn.innerHTML = svg;

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

    btn.onmouseenter = () => btn.style.background = '#1557b0';
    btn.onmouseleave = () => btn.style.background = '#1a73e8';

    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      btn.innerHTML = '<div style="width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:dmarc-spin 1s linear infinite"></div>';

      const url = findDownloadUrl(containerEl);
      if (url) {
        const data = await fetchAttachment(url);
        if (data) {
          chrome.runtime.sendMessage({
            action: 'processAttachment',
            data: Array.from(new Uint8Array(data)),
            filename: filename
          }, (response) => {
            btn.innerHTML = svg;
            if (!response?.success) {
              chrome.runtime.sendMessage({ action: 'openViewer' });
            }
          });
          return;
        }
      }

      // Fallback: trigger native download and open viewer
      triggerDownload(containerEl);
      chrome.runtime.sendMessage({ action: 'openViewer' });
      btn.innerHTML = svg;
    };

    return btn;
  }

  // CSS
  if (!document.getElementById('dmarc-style')) {
    const style = document.createElement('style');
    style.id = 'dmarc-style';
    style.textContent = `
      @keyframes dmarc-spin { to { transform: rotate(360deg); } }
      .dmarc-viewer-btn { transition: background 0.15s; }
    `;
    document.head.appendChild(style);
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

      const btn = createButton(filename, el);
      el.parentElement?.appendChild(btn);
    }
  }

  // Debounced observer
  let timeout;
  const observer = new MutationObserver(() => {
    clearTimeout(timeout);
    timeout = setTimeout(scan, 600);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(scan, 1500);
  setTimeout(scan, 3500);

  console.log('DMARC Reader: Loaded');
})();

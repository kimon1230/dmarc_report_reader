/**
 * DMARC Report Reader - Popup Script
 * Handles file selection and drag-drop for DMARC report files
 */

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const filePicker = document.getElementById('file-picker');
const status = document.getElementById('status');

/**
 * Send message to service worker with retry logic
 * Handles cases where service worker may be waking from idle state.
 * @param {Object} message - Message to send
 * @param {number} maxRetries - Maximum retry attempts (default 3)
 * @returns {Promise<Object>} Response from service worker
 */
async function sendMessageWithRetry(message, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await new Promise((resolve, reject) => {
        const timeoutMs = attempt === 1 ? 10000 : 15000;
        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout - service worker may be initializing'));
        }, timeoutMs);

        chrome.runtime.sendMessage(message, (response) => {
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      });
      return response;
    } catch (err) {
      console.log(`DMARC Reader Popup: Attempt ${attempt}/${maxRetries} failed:`, err.message);

      if (attempt < maxRetries) {
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, backoffMs));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Show status message to user
 * @param {string} message - Message to display
 * @param {string} type - Status type: 'error', 'success', or 'loading'
 */
function showStatus(message, type) {
  status.textContent = message;
  status.className = `status ${type}`;
}

/**
 * Hide status message
 */
function hideStatus() {
  status.className = 'status hidden';
}

/**
 * Validate file type
 * @param {File} file - File to validate
 * @returns {boolean} True if valid DMARC report file
 */
function isValidFile(file) {
  const name = file.name.toLowerCase();
  return name.endsWith('.xml') ||
         name.endsWith('.xml.gz') ||
         name.endsWith('.gz') ||
         name.endsWith('.zip');
}

/**
 * Handle file selection
 * @param {File} file - Selected file
 */
async function handleFile(file) {
  if (!isValidFile(file)) {
    showStatus('Invalid file type. Use .xml, .xml.gz, or .zip', 'error');
    return;
  }

  showStatus('Processing file...', 'loading');

  try {
    const data = await file.arrayBuffer();

    const response = await sendMessageWithRetry({
      action: 'processFile',
      filename: file.name,
      data: Array.from(new Uint8Array(data))
    });

    if (response?.success) {
      showStatus('Opening viewer...', 'success');
      await sendMessageWithRetry({ action: 'openViewer' });
      window.close();
    } else {
      showStatus(response?.error || 'Failed to process file', 'error');
    }
  } catch (err) {
    const isConnectionError = err.message.includes('Could not establish connection') ||
                              err.message.includes('Receiving end does not exist');
    if (isConnectionError) {
      showStatus('Extension not ready. Please reload the extension.', 'error');
    } else {
      showStatus(`Error: ${err.message}`, 'error');
    }
  }
}

// Drag and drop handlers
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFile(files[0]);
  }
});

// Click on drop zone to open file picker
dropZone.addEventListener('click', () => {
  fileInput.click();
});

// File picker button
filePicker.addEventListener('click', () => {
  fileInput.click();
});

// File input change
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
});

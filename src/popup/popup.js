/**
 * DMARC Report Reader - Popup Script
 * Handles file selection and drag-drop for DMARC report files
 */

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const filePicker = document.getElementById('file-picker');
const status = document.getElementById('status');

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
    const reader = new FileReader();
    reader.onload = async (e) => {
      const data = e.target.result;

      // Send to background script for processing
      chrome.runtime.sendMessage({
        action: 'processFile',
        filename: file.name,
        data: Array.from(new Uint8Array(data))
      }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Extension not ready. Please reload.', 'error');
          return;
        }

        if (response && response.success) {
          showStatus('Opening viewer...', 'success');

          // Request background to open viewer tab
          chrome.runtime.sendMessage({ action: 'openViewer' }, () => {
            // Close popup after opening viewer
            window.close();
          });
        } else {
          showStatus(response?.error || 'Failed to process file', 'error');
        }
      });
    };

    reader.onerror = () => {
      showStatus('Failed to read file', 'error');
    };

    reader.readAsArrayBuffer(file);
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
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

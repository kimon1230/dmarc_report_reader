/**
 * DMARC Report Reader - UI Utilities Module
 * Common UI helper functions
 */

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format date for display
 * @param {Date} date - Date object
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  if (!date) return '-';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Convert country code to flag emoji
 * @param {string} countryCode - Two-letter country code
 * @returns {string} Flag emoji
 */
function countryCodeToFlag(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 0x1f1e6 + char.charCodeAt(0) - 65);
  return String.fromCodePoint(...codePoints);
}

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {number} duration - Duration in milliseconds
 */
function showToast(message, duration = 2500) {
  // Remove existing toast if any
  const existing = document.querySelector('.toast');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);

  // Auto-remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Create a status badge element
 * @param {string} status - Status value (pass, fail, none, quarantine, reject, etc.)
 * @returns {string} HTML string for badge
 */
function createBadge(status) {
  if (!status) return '<span class="badge badge-neutral">-</span>';

  const lower = status.toLowerCase();

  let className;
  if (lower === 'pass' || lower === 'none') {
    className = 'badge-pass';
  } else if (lower === 'quarantine') {
    className = 'badge-warn';
  } else {
    className = 'badge-fail';
  }

  return `<span class="badge ${className}">${escapeHtml(status)}</span>`;
}

/**
 * Get CSS class for table row based on record status
 * @param {Object} record - Record object
 * @returns {string} CSS class name
 */
function getRowClass(record) {
  const pe = record.policyEvaluated || {};
  const dkimPass = pe.dkim === 'pass';
  const spfPass = pe.spf === 'pass';
  const disposition = (pe.disposition || '').toLowerCase();

  // Quarantine and reject get special treatment
  if (disposition === 'reject') return 'row-fail';
  if (disposition === 'quarantine') return 'row-partial';

  // Otherwise base on auth results
  if (dkimPass && spfPass) return 'row-pass';
  if (!dkimPass && !spfPass) return 'row-fail';
  return 'row-partial';
}

// Export for use in other modules (if in Node.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHtml,
    formatDate,
    countryCodeToFlag,
    showToast,
    createBadge,
    getRowClass
  };
}

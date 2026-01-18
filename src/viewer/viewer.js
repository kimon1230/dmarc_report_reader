/**
 * DMARC Report Reader - Viewer Script
 * Displays parsed DMARC reports with IP geolocation
 */

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const filePickerBtn = document.getElementById('file-picker-btn');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const reportEl = document.getElementById('report');
const recordsBody = document.getElementById('records-body');

// Current report data
let currentReport = null;
let ipGeoData = new Map();

/**
 * Show loading state
 */
function showLoading() {
  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  reportEl.classList.add('hidden');
}

/**
 * Show error message
 * @param {string} message - Error message
 */
function showError(message) {
  loadingEl.classList.add('hidden');
  errorEl.classList.remove('hidden');
  errorEl.textContent = message;
  reportEl.classList.add('hidden');
}

/**
 * Show report
 */
function showReport() {
  loadingEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  reportEl.classList.remove('hidden');
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
 * Create a status badge element
 * @param {string} status - Status value (pass, fail, etc.)
 * @returns {string} HTML string for badge
 */
function createBadge(status) {
  if (!status) return '<span class="badge badge-neutral">-</span>';

  const isPass = status.toLowerCase() === 'pass';
  const className = isPass ? 'badge-pass' : 'badge-fail';
  return `<span class="badge ${className}">${status}</span>`;
}

/**
 * Render summary cards
 * @param {Object} summary - Report summary data
 */
function renderSummary(summary) {
  document.getElementById('total-messages').textContent = summary.totalMessages.toLocaleString();
  document.getElementById('passed-both').textContent = summary.passedBoth.toLocaleString();
  document.getElementById('passed-dkim').textContent = summary.passedDkim.toLocaleString();
  document.getElementById('passed-spf').textContent = summary.passedSpf.toLocaleString();
}

/**
 * Render report metadata
 * @param {Object} metadata - Report metadata
 */
function renderMetadata(metadata) {
  document.getElementById('org-name').textContent = metadata.orgName || '-';
  document.getElementById('report-id').textContent = metadata.reportId || '-';
  document.getElementById('contact-email').textContent = metadata.email || '-';

  if (metadata.dateRange) {
    const begin = formatDate(metadata.dateRange.begin);
    const end = formatDate(metadata.dateRange.end);
    document.getElementById('date-range').textContent = `${begin} - ${end}`;
  } else {
    document.getElementById('date-range').textContent = '-';
  }
}

/**
 * Render policy information
 * @param {Object} policy - Published policy data
 */
function renderPolicy(policy) {
  document.getElementById('policy-domain').textContent = policy.domain || '-';
  document.getElementById('policy-p').textContent = policy.policy || '-';
  document.getElementById('policy-sp').textContent = policy.subdomainPolicy || '-';
  document.getElementById('policy-adkim').textContent = policy.adkim || '-';
  document.getElementById('policy-aspf').textContent = policy.aspf || '-';
  document.getElementById('policy-pct').textContent = policy.percentage !== null ? `${policy.percentage}%` : '-';
}

/**
 * Render location cell for a record
 * @param {string} ip - IP address
 * @returns {string} HTML string for location cell
 */
function renderLocationCell(ip) {
  const geo = ipGeoData.get(ip);

  if (!geo) {
    return `<td class="location-cell"><span class="location-loading">Loading...</span></td>`;
  }

  if (geo.error) {
    return `<td class="location-cell">Unknown</td>`;
  }

  const location = formatLocation(geo);
  const isp = formatIsp(geo);
  return `<td class="location-cell" title="${isp}">${location}</td>`;
}

/**
 * Render details section for a record
 * @param {Object} record - Record data
 * @returns {string} HTML string for details
 */
function renderDetails(record) {
  const identifiers = record.identifiers || {};
  const authResults = record.authResults || { dkim: [], spf: [] };

  let dkimHtml = authResults.dkim.length > 0
    ? authResults.dkim.map(d => `
        <li>
          <span class="label">Domain:</span> ${d.domain || '-'}
        </li>
        <li>
          <span class="label">Selector:</span> ${d.selector || '-'}
        </li>
        <li>
          <span class="label">Result:</span> ${createBadge(d.result)}
        </li>
      `).join('')
    : '<li>No DKIM results</li>';

  let spfHtml = authResults.spf.length > 0
    ? authResults.spf.map(s => `
        <li>
          <span class="label">Domain:</span> ${s.domain || '-'}
        </li>
        <li>
          <span class="label">Scope:</span> ${s.scope || '-'}
        </li>
        <li>
          <span class="label">Result:</span> ${createBadge(s.result)}
        </li>
      `).join('')
    : '<li>No SPF results</li>';

  return `
    <div class="details-content">
      <div class="details-section">
        <h4>Identifiers</h4>
        <ul>
          <li><span class="label">Header From:</span> ${identifiers.headerFrom || '-'}</li>
          <li><span class="label">Envelope From:</span> ${identifiers.envelopeFrom || '-'}</li>
          <li><span class="label">Envelope To:</span> ${identifiers.envelopeTo || '-'}</li>
        </ul>
      </div>
      <div class="details-section">
        <h4>DKIM Authentication</h4>
        <ul>${dkimHtml}</ul>
      </div>
      <div class="details-section">
        <h4>SPF Authentication</h4>
        <ul>${spfHtml}</ul>
      </div>
    </div>
  `;
}

/**
 * Render records table
 * @param {Array} records - Array of record objects
 */
function renderRecords(records) {
  recordsBody.innerHTML = '';

  records.forEach((record, index) => {
    const pe = record.policyEvaluated || {};

    // Main row
    const mainRow = document.createElement('tr');
    mainRow.innerHTML = `
      <td class="ip-cell">${record.sourceIp || '-'}</td>
      ${renderLocationCell(record.sourceIp)}
      <td>${record.count.toLocaleString()}</td>
      <td>${createBadge(pe.disposition)}</td>
      <td>${createBadge(pe.dkim)}</td>
      <td>${createBadge(pe.spf)}</td>
      <td><button class="details-toggle" data-index="${index}">Show</button></td>
    `;
    recordsBody.appendChild(mainRow);

    // Details row (hidden by default)
    const detailsRow = document.createElement('tr');
    detailsRow.className = 'details-row hidden';
    detailsRow.id = `details-${index}`;
    detailsRow.innerHTML = `<td colspan="7">${renderDetails(record)}</td>`;
    recordsBody.appendChild(detailsRow);
  });

  // Add click handlers for details toggle
  recordsBody.querySelectorAll('.details-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = btn.dataset.index;
      const detailsRow = document.getElementById(`details-${index}`);
      const isHidden = detailsRow.classList.contains('hidden');

      detailsRow.classList.toggle('hidden');
      btn.textContent = isHidden ? 'Hide' : 'Show';
    });
  });
}

/**
 * Update location cells after IP lookup completes
 */
function updateLocationCells() {
  if (!currentReport) return;

  currentReport.records.forEach((record, index) => {
    const row = recordsBody.children[index * 2]; // Skip details rows
    if (row) {
      const locationCell = row.children[1];
      locationCell.outerHTML = renderLocationCell(record.sourceIp);
    }
  });
}

/**
 * Load IP geolocation data for all records
 * @param {Array} records - Array of record objects
 */
async function loadIpGeoData(records) {
  const ips = records.map(r => r.sourceIp).filter(Boolean);

  if (ips.length === 0) return;

  try {
    ipGeoData = await lookupIps(ips);
    updateLocationCells();
  } catch (err) {
    console.error('IP lookup error:', err);
  }
}

/**
 * Display a parsed DMARC report
 * @param {Object} report - Parsed DMARC report
 */
function displayReport(report) {
  currentReport = report;

  renderSummary(report.summary);
  renderMetadata(report.metadata);
  renderPolicy(report.policy);
  renderRecords(report.records);

  showReport();

  // Load IP geolocation data asynchronously
  loadIpGeoData(report.records);
}

/**
 * Process a file and display the report
 * @param {File} file - File object
 */
async function processFile(file) {
  showLoading();

  try {
    const buffer = await file.arrayBuffer();
    const xml = await extractXmlFromFile(buffer, file.name);
    const report = parseDmarcReport(xml);
    displayReport(report);
  } catch (err) {
    showError(`Failed to process file: ${err.message}`);
  }
}

// Event Listeners

// Drag and drop
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
    processFile(files[0]);
  }
});

// File picker
filePickerBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    processFile(e.target.files[0]);
  }
});

// Also support dropping anywhere on the page
document.body.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.body.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    processFile(files[0]);
  }
});

// Check for XML passed via chrome.storage (from popup)
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.local.get(['currentXml'], (result) => {
    if (result.currentXml) {
      try {
        const report = parseDmarcReport(result.currentXml);
        displayReport(report);
        // Clear storage after loading
        chrome.storage.local.remove(['currentXml']);
      } catch (err) {
        showError(`Failed to parse report: ${err.message}`);
      }
    }
  });
}

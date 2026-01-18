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
const exportButtons = document.getElementById('export-buttons');
const exportJsonBtn = document.getElementById('export-json');
const exportCsvBtn = document.getElementById('export-csv');
const filterSelect = document.getElementById('filter-status');
const sortSelect = document.getElementById('sort-by');

// Current report data
let currentReport = null;
let ipGeoData = new Map();
let currentFilter = 'all';
let currentSort = 'count-desc';

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

  return `<span class="badge ${className}">${status}</span>`;
}

/**
 * Render summary cards with progress bars
 * @param {Object} summary - Report summary data
 */
function renderSummary(summary) {
  // Main counts
  document.getElementById('total-messages').textContent = summary.totalMessages.toLocaleString();
  document.getElementById('passed-both').textContent = summary.passedBoth.toLocaleString();
  document.getElementById('passed-dkim').textContent = summary.passedDkim.toLocaleString();
  document.getElementById('passed-spf').textContent = summary.passedSpf.toLocaleString();

  // Failure counts
  document.getElementById('failed-both').textContent = summary.failedBoth.toLocaleString();
  document.getElementById('quarantined').textContent = summary.quarantined.toLocaleString();
  document.getElementById('rejected').textContent = summary.rejected.toLocaleString();

  // Progress bars and percentages
  const overallRate = summary.overallPassRate.toFixed(1);
  const dkimRate = summary.dkimPassRate.toFixed(1);
  const spfRate = summary.spfPassRate.toFixed(1);

  document.getElementById('progress-both').style.width = `${overallRate}%`;
  document.getElementById('percent-both').textContent = `${overallRate}%`;

  document.getElementById('progress-dkim').style.width = `${dkimRate}%`;
  document.getElementById('percent-dkim').textContent = `${dkimRate}%`;

  document.getElementById('progress-spf').style.width = `${spfRate}%`;
  document.getElementById('percent-spf').textContent = `${spfRate}%`;
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
 * Render hostname cell for a record
 * @param {string} ip - IP address
 * @returns {string} HTML string for hostname cell
 */
function renderHostnameCell(ip) {
  const geo = ipGeoData.get(ip);

  if (!geo) {
    return `<td class="hostname-cell"><span class="location-loading">...</span></td>`;
  }

  const hostname = formatHostname(geo);
  return `<td class="hostname-cell" title="${hostname}">${hostname || '-'}</td>`;
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
 * Get row CSS class based on record status
 * @param {Object} record - Record data
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

/**
 * Render alignment warning if there's a mismatch
 * @param {Object} record - Record data
 * @returns {string} HTML string for alignment warning
 */
function renderAlignmentWarning(record) {
  if (record.alignment?.headerEnvelopeMismatch) {
    return '<span class="alignment-warning">Alignment Mismatch</span>';
  }
  return '';
}

/**
 * Render policy override reasons
 * @param {Array} reasons - Array of reason objects
 * @returns {string} HTML string for reasons
 */
function renderReasons(reasons) {
  if (!reasons || reasons.length === 0) return '';

  const reasonHtml = reasons.map(r =>
    `<div class="reason-item">${r.type}${r.comment ? ': ' + r.comment : ''}</div>`
  ).join('');

  return `<div class="reason-list">${reasonHtml}</div>`;
}

/**
 * Get explanation and recommendation for a record's status
 * @param {Object} record - Record data
 * @returns {Object} Object with issues array containing explanations and recommendations
 */
function getRecordDiagnosis(record) {
  const issues = [];
  const pe = record.policyEvaluated || {};
  const authResults = record.authResults || { dkim: [], spf: [] };
  const identifiers = record.identifiers || {};

  // Check DKIM status
  if (pe.dkim !== 'pass') {
    const dkimResults = authResults.dkim || [];
    const dkimResult = dkimResults[0]?.result || 'none';

    const dkimExplanations = {
      'fail': {
        title: 'DKIM Signature Invalid',
        explanation: 'The DKIM signature on the message could not be verified. This can happen if the message was modified in transit, the signing key has been rotated, or the signature was malformed.',
        recommendations: [
          'Verify your DKIM signing configuration is correct',
          'Check that your DKIM public key DNS record matches your private key',
          'Ensure no mail gateways are modifying message content after signing',
          'If using a third-party sender, verify they are signing with your domain\'s key'
        ]
      },
      'none': {
        title: 'No DKIM Signature',
        explanation: 'The message was not signed with DKIM. Without a DKIM signature, receivers cannot verify the message originated from your domain.',
        recommendations: [
          'Enable DKIM signing on your mail server',
          'If using a third-party email service, configure them to sign with your domain',
          'Publish a DKIM public key record in your DNS'
        ]
      },
      'neutral': {
        title: 'DKIM Result Neutral',
        explanation: 'The DKIM signature exists but could not be evaluated, often due to a missing or inaccessible public key.',
        recommendations: [
          'Verify your DKIM DNS record is published correctly',
          'Check DNS propagation for your DKIM selector',
          'Ensure the selector in the signature matches your DNS record'
        ]
      },
      'temperror': {
        title: 'DKIM Temporary Error',
        explanation: 'A temporary error occurred during DKIM verification, typically due to DNS timeout or server issues.',
        recommendations: [
          'This is usually transient and may resolve on its own',
          'Verify your DNS servers are responsive',
          'Check for any DNS infrastructure issues'
        ]
      },
      'permerror': {
        title: 'DKIM Permanent Error',
        explanation: 'A permanent error in the DKIM configuration prevents verification. The signature or DNS record is malformed.',
        recommendations: [
          'Review your DKIM DNS record syntax',
          'Regenerate your DKIM key pair if corrupted',
          'Verify the DKIM signature header format'
        ]
      }
    };

    const diagnosis = dkimExplanations[dkimResult] || dkimExplanations['fail'];
    issues.push({ type: 'dkim', ...diagnosis });
  }

  // Check SPF status
  if (pe.spf !== 'pass') {
    const spfResults = authResults.spf || [];
    const spfResult = spfResults[0]?.result || 'none';

    const spfExplanations = {
      'fail': {
        title: 'SPF Check Failed',
        explanation: 'The sending IP address is not authorized to send email for this domain. The IP was explicitly denied by your SPF record.',
        recommendations: [
          'Add the sending IP or mail server to your SPF record',
          'If using a third-party service, include their SPF mechanism',
          'Review your SPF record: v=spf1 include:_spf.example.com ~all',
          'Check if the sender should be authorized to send for your domain'
        ]
      },
      'softfail': {
        title: 'SPF Soft Fail',
        explanation: 'The sending IP is not explicitly authorized but not strictly denied (~all). The message is suspicious but not rejected.',
        recommendations: [
          'Add legitimate senders to your SPF record',
          'Consider using -all (hard fail) once all senders are properly listed',
          'This may indicate a forwarded message or unauthorized sender'
        ]
      },
      'neutral': {
        title: 'SPF Neutral',
        explanation: 'Your SPF record makes no assertion about this IP address (?all). No authorization decision can be made.',
        recommendations: [
          'Review your SPF record to properly authorize or deny senders',
          'Replace ?all with ~all or -all for better protection'
        ]
      },
      'none': {
        title: 'No SPF Record',
        explanation: 'No SPF record was found for the sending domain. Receivers cannot verify which servers are authorized to send email.',
        recommendations: [
          'Publish an SPF record in your DNS',
          'Example: v=spf1 include:_spf.google.com ~all',
          'List all authorized sending IPs and services'
        ]
      },
      'temperror': {
        title: 'SPF Temporary Error',
        explanation: 'A temporary DNS error prevented SPF verification. This is typically transient.',
        recommendations: [
          'Usually resolves automatically',
          'Check your DNS server availability',
          'Verify SPF record is not too complex (max 10 DNS lookups)'
        ]
      },
      'permerror': {
        title: 'SPF Permanent Error',
        explanation: 'Your SPF record has a syntax error or exceeds the 10 DNS lookup limit, preventing verification.',
        recommendations: [
          'Check SPF record syntax using an SPF validator',
          'Reduce DNS lookups by flattening includes',
          'Remove redundant or unused mechanisms',
          'Consider using an SPF flattening service'
        ]
      }
    };

    const diagnosis = spfExplanations[spfResult] || spfExplanations['fail'];
    issues.push({ type: 'spf', ...diagnosis });
  }

  // Check alignment
  if (record.alignment?.headerEnvelopeMismatch) {
    issues.push({
      type: 'alignment',
      title: 'Domain Alignment Mismatch',
      explanation: `The From header domain (${identifiers.headerFrom || 'unknown'}) does not match the envelope sender domain (${identifiers.envelopeFrom || 'unknown'}). DMARC requires alignment between these domains.`,
      recommendations: [
        'Ensure the envelope From (Return-Path) matches or is a subdomain of the header From',
        'Configure your mail server to use the same domain for both',
        'If using a third-party sender, set up proper domain alignment',
        'Check your DMARC policy alignment mode (strict vs relaxed)'
      ]
    });
  }

  // Check disposition
  if (pe.disposition === 'quarantine') {
    issues.push({
      type: 'disposition',
      title: 'Message Quarantined',
      explanation: 'The receiving server placed this message in quarantine (spam/junk folder) due to DMARC policy. Your DMARC policy requested quarantine for failing messages.',
      recommendations: [
        'Fix the underlying DKIM/SPF issues to prevent quarantine',
        'Review which senders are failing authentication',
        'Ensure all legitimate email sources are properly configured'
      ]
    });
  } else if (pe.disposition === 'reject') {
    issues.push({
      type: 'disposition',
      title: 'Message Rejected',
      explanation: 'The receiving server rejected this message outright due to DMARC policy failure. Your DMARC policy specifies reject for failing messages.',
      recommendations: [
        'Urgently fix DKIM/SPF configuration for legitimate senders',
        'These messages were not delivered to recipients',
        'Consider temporarily relaxing DMARC policy while fixing issues',
        'Review all authorized senders and their authentication setup'
      ]
    });
  }

  return issues;
}

/**
 * Render diagnosis section for a record
 * @param {Object} record - Record data
 * @returns {string} HTML string for diagnosis
 */
function renderDiagnosis(record) {
  const issues = getRecordDiagnosis(record);

  if (issues.length === 0) {
    return `
      <div class="diagnosis-section diagnosis-pass">
        <h4>Status: All Checks Passed</h4>
        <p>This message passed both DKIM and SPF authentication with proper domain alignment. No action required.</p>
      </div>
    `;
  }

  const issuesHtml = issues.map(issue => `
    <div class="diagnosis-item diagnosis-${issue.type}">
      <h5>${issue.title}</h5>
      <p class="diagnosis-explanation">${issue.explanation}</p>
      <div class="diagnosis-recommendations">
        <strong>Recommendations:</strong>
        <ul>
          ${issue.recommendations.map(r => `<li>${r}</li>`).join('')}
        </ul>
      </div>
    </div>
  `).join('');

  return `
    <div class="diagnosis-section">
      <h4>Issues & Recommendations</h4>
      ${issuesHtml}
    </div>
  `;
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
          <span class="label">Signing Domain:</span> <strong>${d.domain || '-'}</strong>
        </li>
        <li>
          <span class="label">Selector:</span> ${d.selector || '-'}
        </li>
        <li>
          <span class="label">Result:</span> ${createBadge(d.result)}
        </li>
      `).join('')
    : '<li>No DKIM signature found</li>';

  let spfHtml = authResults.spf.length > 0
    ? authResults.spf.map(s => `
        <li>
          <span class="label">Checked Domain:</span> <strong>${s.domain || '-'}</strong>
        </li>
        <li>
          <span class="label">Scope:</span> ${s.scope || 'mfrom'}
        </li>
        <li>
          <span class="label">Result:</span> ${createBadge(s.result)}
        </li>
      `).join('')
    : '<li>No SPF check performed</li>';

  // Check for domain mismatches that affect alignment
  const headerFrom = identifiers.headerFrom || '';
  const dkimDomain = authResults.dkim[0]?.domain || '';
  const spfDomain = authResults.spf[0]?.domain || '';

  let alignmentNote = '';
  if (headerFrom && dkimDomain && !dkimDomain.endsWith(headerFrom) && !headerFrom.endsWith(dkimDomain)) {
    alignmentNote += `<div class="alignment-note">DKIM signed by <strong>${dkimDomain}</strong> but From header is <strong>${headerFrom}</strong> - may fail DKIM alignment</div>`;
  }
  if (headerFrom && spfDomain && !spfDomain.endsWith(headerFrom) && !headerFrom.endsWith(spfDomain)) {
    alignmentNote += `<div class="alignment-note">SPF checked for <strong>${spfDomain}</strong> but From header is <strong>${headerFrom}</strong> - may fail SPF alignment</div>`;
  }

  return `
    <div class="details-content">
      <div class="details-section">
        <h4>Message Identifiers</h4>
        <ul>
          <li><span class="label">Header From:</span> <strong>${identifiers.headerFrom || '-'}</strong> <span class="identifier-hint">(visible to recipient)</span></li>
          <li><span class="label">Envelope From:</span> ${identifiers.envelopeFrom || '-'} <span class="identifier-hint">(Return-Path/bounce address)</span></li>
          <li><span class="label">Envelope To:</span> ${identifiers.envelopeTo || '-'} <span class="identifier-hint">(recipient domain)</span></li>
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
    ${alignmentNote ? `<div class="alignment-notes">${alignmentNote}</div>` : ''}
    ${renderDiagnosis(record)}
  `;
}

/**
 * Filter records based on current filter
 * @param {Array} records - Array of record objects
 * @returns {Array} Filtered records
 */
function filterRecords(records) {
  if (currentFilter === 'all') return records;

  return records.filter(record => {
    const pe = record.policyEvaluated || {};
    const dkimPass = pe.dkim === 'pass';
    const spfPass = pe.spf === 'pass';

    switch (currentFilter) {
      case 'pass':
        return dkimPass && spfPass;
      case 'fail':
        return !dkimPass || !spfPass;
      case 'quarantine':
        return pe.disposition === 'quarantine';
      case 'reject':
        return pe.disposition === 'reject';
      default:
        return true;
    }
  });
}

/**
 * Sort records based on current sort setting
 * @param {Array} records - Array of record objects
 * @returns {Array} Sorted records
 */
function sortRecords(records) {
  const sorted = [...records];

  switch (currentSort) {
    case 'count-desc':
      sorted.sort((a, b) => b.count - a.count);
      break;
    case 'count-asc':
      sorted.sort((a, b) => a.count - b.count);
      break;
    case 'ip':
      sorted.sort((a, b) => {
        const ipA = a.sourceIp || '';
        const ipB = b.sourceIp || '';
        return ipA.localeCompare(ipB, undefined, { numeric: true });
      });
      break;
  }

  return sorted;
}

/**
 * Render From Domain cell with auth domains tooltip
 * @param {Object} record - Record data
 * @returns {string} HTML string for from domain cell
 */
function renderFromDomainCell(record) {
  const identifiers = record.identifiers || {};
  const authResults = record.authResults || { dkim: [], spf: [] };

  const headerFrom = identifiers.headerFrom || '-';
  const envelopeFrom = identifiers.envelopeFrom || '-';

  // Get auth domains for tooltip
  const dkimDomains = authResults.dkim.map(d => d.domain).filter(Boolean).join(', ') || '-';
  const spfDomains = authResults.spf.map(s => s.domain).filter(Boolean).join(', ') || '-';

  const tooltip = `Header From: ${headerFrom}\nEnvelope From: ${envelopeFrom}\nDKIM Domain: ${dkimDomains}\nSPF Domain: ${spfDomains}`;

  return `<td class="domain-cell" title="${tooltip}">${headerFrom}</td>`;
}

/**
 * Render records table
 * @param {Array} records - Array of record objects
 */
function renderRecords(records) {
  recordsBody.innerHTML = '';

  const filtered = filterRecords(records);
  const sorted = sortRecords(filtered);

  sorted.forEach((record, index) => {
    const pe = record.policyEvaluated || {};
    const rowClass = getRowClass(record);

    // Main row
    const mainRow = document.createElement('tr');
    mainRow.className = rowClass;
    mainRow.innerHTML = `
      <td class="ip-cell">${record.sourceIp || '-'}</td>
      ${renderHostnameCell(record.sourceIp)}
      ${renderLocationCell(record.sourceIp)}
      ${renderFromDomainCell(record)}
      <td>${record.count.toLocaleString()}</td>
      <td>${createBadge(pe.disposition)}${renderAlignmentWarning(record)}</td>
      <td>${createBadge(pe.dkim)}</td>
      <td>${createBadge(pe.spf)}</td>
      <td><button class="details-toggle" data-index="${index}">Show</button></td>
    `;
    recordsBody.appendChild(mainRow);

    // Details row (hidden by default)
    const detailsRow = document.createElement('tr');
    detailsRow.className = 'details-row hidden';
    detailsRow.id = `details-${index}`;
    const reasonsHtml = renderReasons(pe.reasons);
    detailsRow.innerHTML = `<td colspan="9">${renderDetails(record)}${reasonsHtml}</td>`;
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

  // Update records summary
  const summaryEl = document.getElementById('records-summary');
  summaryEl.textContent = `Showing ${sorted.length} of ${records.length} records`;
}

/**
 * Update location and hostname cells after IP lookup completes
 */
function updateLocationCells() {
  if (!currentReport) return;

  // Re-render the entire table to update hostname and location cells
  renderRecords(currentReport.records);
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

  // Show export buttons
  exportButtons.classList.remove('hidden');

  showReport();

  // Load IP geolocation data asynchronously
  loadIpGeoData(report.records);
}

/**
 * Export report as JSON
 */
function exportAsJson() {
  if (!currentReport) return;

  const dataStr = JSON.stringify(currentReport, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `dmarc-report-${currentReport.metadata?.reportId || 'export'}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * Export report as CSV
 */
function exportAsCsv() {
  if (!currentReport) return;

  const headers = [
    'Source IP',
    'Hostname',
    'Country',
    'City',
    'Count',
    'Disposition',
    'DKIM Result',
    'SPF Result',
    'Header From',
    'Envelope From',
    'DKIM Signing Domain',
    'SPF Checked Domain'
  ];

  const rows = currentReport.records.map(record => {
    const pe = record.policyEvaluated || {};
    const id = record.identifiers || {};
    const auth = record.authResults || { dkim: [], spf: [] };
    const geo = ipGeoData.get(record.sourceIp) || {};

    return [
      record.sourceIp || '',
      geo.hostname || '',
      geo.country || '',
      geo.city || '',
      record.count,
      pe.disposition || '',
      pe.dkim || '',
      pe.spf || '',
      id.headerFrom || '',
      id.envelopeFrom || '',
      auth.dkim.map(d => d.domain).filter(Boolean).join('; ') || '',
      auth.spf.map(s => s.domain).filter(Boolean).join('; ') || ''
    ];
  });

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `dmarc-report-${currentReport.metadata?.reportId || 'export'}.csv`;
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * Initialize collapsible sections
 */
function initCollapsibleSections() {
  document.querySelectorAll('.section.collapsible .section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.closest('.collapsible');
      section.classList.toggle('collapsed');
    });
  });
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

// Export button handlers
exportJsonBtn.addEventListener('click', exportAsJson);
exportCsvBtn.addEventListener('click', exportAsCsv);

// Filter and sort handlers
filterSelect.addEventListener('change', (e) => {
  currentFilter = e.target.value;
  if (currentReport) {
    renderRecords(currentReport.records);
  }
});

sortSelect.addEventListener('change', (e) => {
  currentSort = e.target.value;
  if (currentReport) {
    renderRecords(currentReport.records);
  }
});

// Initialize collapsible sections
initCollapsibleSections();

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

/**
 * DMARC Report Reader - Viewer Script
 * Displays parsed DMARC reports with IP geolocation
 */

// Storage key constant (must match service-worker.js)
const STORAGE_KEY_REPORT_DATA = 'dmarcReportData';

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

// Modal elements
const reportSelectorModal = document.getElementById('report-selector-modal');
const reportListEl = document.getElementById('report-list');
const closeSelectorModalBtn = document.getElementById('close-selector-modal');
const combineAllBtn = document.getElementById('combine-all-btn');

// Advanced filter elements
const toggleFiltersBtn = document.getElementById('toggle-filters-btn');
const advancedFiltersPanel = document.getElementById('advanced-filters');
const filterDomainInput = document.getElementById('filter-domain');
const filterIpInput = document.getElementById('filter-ip');
const filterCountrySelect = document.getElementById('filter-country');
const filterMinCountInput = document.getElementById('filter-min-count');
const filterHostnameInput = document.getElementById('filter-hostname');
const filterClassificationSelect = document.getElementById('filter-classification');
const filterProviderSelect = document.getElementById('filter-provider');
const applyFiltersBtn = document.getElementById('apply-filters-btn');
const clearFiltersBtn = document.getElementById('clear-filters-btn');
const activeFilterCountBadge = document.getElementById('active-filter-count');

// Enrichment elements
const enrichmentBanner = document.getElementById('enrichment-banner');
const enrichmentMessage = document.getElementById('enrichment-message');
const enrichNowBtn = document.getElementById('enrich-now-btn');
const skipEnrichmentBtn = document.getElementById('skip-enrichment-btn');

// XML modal elements
const xmlModal = document.getElementById('xml-modal');
const xmlContent = document.getElementById('xml-content');
const viewXmlBtn = document.getElementById('view-xml-btn');
const copyXmlBtn = document.getElementById('copy-xml-btn');
const closeXmlModalBtn = document.getElementById('close-xml-modal');

// Enrichment threshold - reports with more unique IPs than this will prompt
const LARGE_REPORT_IP_THRESHOLD = 50;

// Track enrichment state
let enrichmentSkipped = false;

// Current report data
let currentReport = null;
let currentRawXml = null; // Store for raw XML drilldown (Checkpoint 5)
let ipGeoData = new Map();
let pendingDownloadId = null; // Track if file came from download for cleanup
let pendingExtraction = null; // Store multi-file extraction for modal handling

// Filter state - centralized for all filter criteria
const filterState = {
  status: 'all',
  domain: '',
  ip: '',
  country: '',
  minCount: 0,
  hostname: '',
  classification: '',
  provider: ''
};

// Sort state
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

  return `<span class="badge ${className}">${escapeHtml(status)}</span>`;
}

/**
 * Create classification badge for a record
 * @param {Object} record - Record with _classification data
 * @returns {string} HTML badge string
 */
function createClassificationBadge(record) {
  // Only show classification for failing records
  if (record.alignment?.dmarcPass) {
    return '<span class="badge badge-neutral">-</span>';
  }

  const classification = record._classification;
  if (!classification) {
    return '<span class="badge badge-neutral">-</span>';
  }

  // Use the getClassificationDisplay function from classification.js if available
  let display;
  if (typeof getClassificationDisplay === 'function') {
    display = getClassificationDisplay(classification.classification);
  } else {
    // Fallback if function not loaded
    switch (classification.classification) {
      case 'likely_spoof':
        display = { label: 'Likely Spoof', badgeClass: 'classification-spoof' };
        break;
      case 'likely_legit_misconfig':
        display = { label: 'Likely Misconfig', badgeClass: 'classification-misconfig' };
        break;
      default:
        display = { label: 'Unknown', badgeClass: 'classification-unknown' };
    }
  }

  // Build tooltip with signals
  const signals = classification.signals || [];
  const confidence = classification.confidence || 0;
  const tooltip = signals.length > 0
    ? `${signals.join('\\n')}\\nConfidence: ${confidence}%`
    : `Confidence: ${confidence}%`;

  return `<span class="badge ${display.badgeClass}" title="${escapeHtml(tooltip)}">${escapeHtml(display.label)}</span>`;
}

/**
 * Render provider cell for a record
 * @param {string} sourceIp - Source IP to lookup provider for
 * @returns {string} HTML string for provider cell
 */
function renderProviderCell(sourceIp) {
  // Get provider info from record (attached after fingerprinting)
  // We need to look up the record from currentReport
  let provider = null;

  if (currentReport && sourceIp) {
    // Find the record with this IP to get its provider
    const record = currentReport.records.find(r => r.sourceIp === sourceIp);
    provider = record?._provider;
  }

  if (!provider || provider.id === 'unknown') {
    return '<td class="provider-cell">-</td>';
  }

  const categoryInfo = typeof getCategoryInfo === 'function'
    ? getCategoryInfo(provider.category)
    : { label: provider.category || 'Unknown' };

  const tooltip = `${provider.name}\\n${categoryInfo.label}`;

  return `<td class="provider-cell">
    <span class="provider-badge" title="${escapeHtml(tooltip)}">
      ${escapeHtml(provider.name)}
    </span>
  </td>`;
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
 * Calculate enforcement readiness metrics from report data
 * Evaluates whether it's safe to move to a more restrictive DMARC policy
 * @param {Array} records - Array of parsed records
 * @param {Object} policy - Published DMARC policy
 * @returns {Object} Enforcement readiness assessment
 */
function calculateEnforcementReadiness(records, policy) {
  const currentPolicy = policy?.policy || 'none';

  // Calculate totals
  let totalMessages = 0;
  let alignedMessages = 0;
  let failingSources = 0;
  let failingMessages = 0;

  for (const record of records) {
    const count = record.count || 0;
    totalMessages += count;

    if (record.alignment?.dmarcPass) {
      alignedMessages += count;
    } else {
      failingMessages += count;
      failingSources++;
    }
  }

  // Calculate alignment percentage
  const alignedPercent = totalMessages > 0
    ? Math.round((alignedMessages / totalMessages) * 100)
    : 0;

  // Determine readiness status based on thresholds
  // Safe: 98%+ aligned, Caution: 90-98%, Not Ready: <90%
  let status, statusText, statusIcon, recommendation;

  if (currentPolicy === 'reject') {
    // Already at maximum enforcement
    status = 'none';
    statusText = 'Maximum Enforcement';
    statusIcon = '✓';
    recommendation = `Your domain is already at the strictest DMARC policy (reject). ${alignedPercent}% of messages are properly aligned. Monitor failing sources to ensure they are not legitimate senders.`;
  } else if (alignedPercent >= 98) {
    status = 'safe';
    statusText = currentPolicy === 'quarantine' ? 'Ready for Reject' : 'Ready for Quarantine';
    statusIcon = '✓';

    if (currentPolicy === 'none') {
      recommendation = `With ${alignedPercent}% alignment, you can safely move to p=quarantine. This will send unauthenticated messages to spam folders. Consider monitoring for a few more reporting periods before moving to p=reject.`;
    } else {
      recommendation = `With ${alignedPercent}% alignment, you can safely move to p=reject. This will block unauthenticated messages entirely. Ensure all legitimate sending sources are properly configured before making this change.`;
    }
  } else if (alignedPercent >= 90) {
    status = 'caution';
    statusText = 'Proceed with Caution';
    statusIcon = '⚠';

    if (failingSources <= 3) {
      recommendation = `${alignedPercent}% alignment with only ${failingSources} failing source(s). Review the failing sources - if they are misconfigured legitimate senders, fix them before increasing enforcement. If they appear to be unauthorized, you may consider increasing enforcement.`;
    } else {
      recommendation = `${alignedPercent}% alignment but ${failingSources} different sources are failing. Review each failing source before increasing enforcement. Moving to a stricter policy now may cause delivery issues for legitimate mail.`;
    }
  } else {
    status = 'not-ready';
    statusText = 'Not Ready';
    statusIcon = '✗';
    recommendation = `Only ${alignedPercent}% of messages are properly aligned. Do not increase enforcement at this time. Review and fix the ${failingSources} failing source(s) which account for ${failingMessages.toLocaleString()} message(s). Common issues: missing SPF includes for third-party senders, unsigned DKIM for some mail flows.`;
  }

  return {
    currentPolicy,
    totalMessages,
    alignedMessages,
    failingSources,
    failingMessages,
    alignedPercent,
    status,
    statusText,
    statusIcon,
    recommendation
  };
}

/**
 * Render the enforcement readiness panel
 * @param {Object} readiness - Enforcement readiness data from calculateEnforcementReadiness
 */
function renderEnforcementReadiness(readiness) {
  // Update gauge
  const gaugeRing = document.getElementById('enforcement-gauge-ring');
  const gaugeValue = document.getElementById('enforcement-gauge-value');
  if (gaugeRing && gaugeValue) {
    gaugeRing.style.setProperty('--gauge-percent', readiness.alignedPercent);
    gaugeValue.textContent = `${readiness.alignedPercent}%`;
  }

  // Update status badge
  const statusBadge = document.getElementById('enforcement-status-badge');
  const statusIcon = document.getElementById('enforcement-status-icon');
  const statusText = document.getElementById('enforcement-status-text');
  if (statusBadge) {
    statusBadge.className = `status-badge status-${readiness.status}`;
    statusIcon.textContent = readiness.statusIcon;
    statusText.textContent = readiness.statusText;
  }

  // Update current policy display
  const currentPolicyEl = document.getElementById('enforcement-current-policy');
  if (currentPolicyEl) {
    currentPolicyEl.innerHTML = `Current Policy: <strong>${readiness.currentPolicy}</strong>`;
  }

  // Update metrics
  document.getElementById('enforcement-total-messages').textContent =
    readiness.totalMessages.toLocaleString();
  document.getElementById('enforcement-aligned-messages').textContent =
    readiness.alignedMessages.toLocaleString();
  document.getElementById('enforcement-failing-sources').textContent =
    readiness.failingSources.toLocaleString();
  document.getElementById('enforcement-failing-volume').textContent =
    readiness.failingMessages.toLocaleString();

  // Update recommendation
  const recommendationEl = document.getElementById('enforcement-recommendation');
  const recommendationText = document.getElementById('enforcement-recommendation-text');
  if (recommendationEl && recommendationText) {
    recommendationEl.className = `enforcement-recommendation rec-${readiness.status}`;
    recommendationText.textContent = readiness.recommendation;
  }
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

  // Escape hostname for XSS protection (data comes from external API)
  const hostname = escapeHtml(formatHostname(geo));
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

  // Escape geo data for XSS protection (data comes from external API)
  const location = escapeHtml(formatLocation(geo));
  const isp = escapeHtml(formatIsp(geo));
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
 * Explain when the applied disposition differs from the published DMARC policy
 * This helps users understand why a message wasn't treated according to their policy
 * @param {Object} record - Record data with policyEvaluated
 * @param {Object} policy - Published DMARC policy from the report
 * @returns {Object|null} Issue object if there's an override, null otherwise
 */
function explainDispositionOverride(record, policy) {
  if (!record || !policy) return null;

  const pe = record.policyEvaluated || {};
  const appliedDisposition = pe.disposition;
  const reason = pe.reason || [];

  // Determine the expected disposition based on the published policy
  // For subdomains, use sp if specified, otherwise fall back to p
  const identifiers = record.identifiers || {};
  const headerFrom = identifiers.headerFrom || '';
  const policyDomain = policy.domain || '';

  // Check if this is a subdomain (header_from is subdomain of policy domain)
  const isSubdomain = headerFrom &&
    policyDomain &&
    headerFrom !== policyDomain &&
    headerFrom.endsWith('.' + policyDomain);

  const expectedPolicy = isSubdomain && policy.subdomainPolicy
    ? policy.subdomainPolicy
    : policy.policy;

  // If policy is 'none', no enforcement expected
  if (expectedPolicy === 'none') return null;

  // If disposition matches expected policy, no override
  if (appliedDisposition === expectedPolicy) return null;

  // If the message passed DMARC, no disposition applies
  if (record.alignment?.dmarcPass) return null;

  // There's a discrepancy - explain why
  const explanations = {
    forwarded: {
      title: 'Disposition Override: Message Forwarded',
      explanation: `Your policy requests "${expectedPolicy}" but the receiver applied "${appliedDisposition || 'none'}". The receiver detected this message was forwarded, which commonly breaks SPF alignment. Many receivers reduce enforcement for forwarded mail to avoid blocking legitimate messages.`,
      recommendations: [
        'This is usually expected behavior for forwarded mail',
        'Consider using ARC (Authenticated Received Chain) if available',
        'DKIM signatures survive forwarding if the message body is unchanged'
      ]
    },
    mailing_list: {
      title: 'Disposition Override: Mailing List',
      explanation: `Your policy requests "${expectedPolicy}" but the receiver applied "${appliedDisposition || 'none'}". This message passed through a mailing list, which typically modifies headers and breaks authentication. Most receivers relax enforcement for mailing list traffic.`,
      recommendations: [
        'Mailing lists often modify Subject lines or add footers, breaking DKIM',
        'This is expected behavior and not a configuration problem',
        'Users receiving via mailing lists may see reduced protection'
      ]
    },
    local_policy: {
      title: 'Disposition Override: Receiver Local Policy',
      explanation: `Your policy requests "${expectedPolicy}" but the receiver applied "${appliedDisposition || 'none'}". The receiving server has its own local policy that overrode your DMARC policy. This is at the receiver's discretion.`,
      recommendations: [
        'Receivers can choose to override DMARC policies',
        'This may be due to whitelisting, user preferences, or reputation',
        'Your DMARC policy is still being honored by most receivers'
      ]
    },
    sampled_out: {
      title: 'Disposition Override: Sampling (pct)',
      explanation: `Your policy requests "${expectedPolicy}" but the receiver applied "${appliedDisposition || 'none'}". Your DMARC policy has pct=${policy.percentage || 100}, meaning only ${policy.percentage || 100}% of failing messages should be subject to the policy. This message was in the non-enforced percentage.`,
      recommendations: [
        'This is expected behavior when using pct<100',
        'Increase pct gradually as you gain confidence in your configuration',
        'Once at pct=100, all failing messages will be subject to your policy'
      ]
    },
    trusted_forwarder: {
      title: 'Disposition Override: Trusted Forwarder',
      explanation: `Your policy requests "${expectedPolicy}" but the receiver applied "${appliedDisposition || 'none'}". The receiver recognized this as coming from a trusted forwarder and relaxed enforcement.`,
      recommendations: [
        'Trusted forwarders are whitelisted by some receivers',
        'This is similar to ARC-based authentication',
        'Your policy is still honored for direct mail flows'
      ]
    },
    other: {
      title: 'Disposition Override',
      explanation: `Your policy requests "${expectedPolicy}" but the receiver applied "${appliedDisposition || 'none'}". The receiver chose to override your policy for reasons not specified in the report.`,
      recommendations: [
        'Check if the sending IP has good reputation',
        'Receivers may override based on historical sending patterns',
        'This does not necessarily indicate a problem'
      ]
    }
  };

  // Find the reason type from the record
  const reasonTypes = reason.map(r => r.type?.toLowerCase());

  // Match to known override reasons
  let matchedExplanation = null;
  for (const reasonType of reasonTypes) {
    if (explanations[reasonType]) {
      matchedExplanation = explanations[reasonType];
      break;
    }
  }

  // If no specific reason matched but there is a disposition difference
  if (!matchedExplanation && appliedDisposition !== expectedPolicy) {
    // Check if it's likely sampling (pct < 100)
    if (policy.percentage !== null && policy.percentage < 100 && appliedDisposition === 'none') {
      matchedExplanation = explanations.sampled_out;
    } else {
      matchedExplanation = explanations.other;
    }
  }

  if (matchedExplanation) {
    return {
      type: 'override',
      ...matchedExplanation
    };
  }

  return null;
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
        explanation: 'The SPF record has a configuration error that prevents evaluation. This typically means the record is malformed or exceeds DNS lookup limits.',
        recommendations: [
          'SPF allows maximum 10 DNS lookups (include, a, mx, ptr, exists mechanisms)',
          'Each "include:" counts as at least 1 lookup, plus any nested includes',
          'Common fix: flatten includes by replacing with ip4/ip6 mechanisms',
          'Check record syntax: must start with v=spf1 and end with ~all or -all',
          'Use an SPF validator tool to diagnose the specific error'
        ],
        commonCauses: [
          'Too many include: mechanisms (e.g., Google + Microsoft + SendGrid = >10 lookups)',
          'Syntax error in SPF record (missing space, invalid mechanism)',
          'Circular include references between domains',
          'Void lookups (mechanisms that return no DNS results)'
        ]
      }
    };

    const diagnosis = spfExplanations[spfResult] || spfExplanations['fail'];
    issues.push({ type: 'spf', ...diagnosis });
  }

  // Check alignment
  if (record.alignment?.headerEnvelopeMismatch) {
    // Escape domain values to prevent XSS when rendered as HTML
    const safeHeaderFrom = escapeHtml(identifiers.headerFrom) || 'unknown';
    const safeEnvelopeFrom = escapeHtml(identifiers.envelopeFrom) || 'unknown';
    issues.push({
      type: 'alignment',
      title: 'Domain Alignment Mismatch',
      explanation: `The From header domain (${safeHeaderFrom}) does not match the envelope sender domain (${safeEnvelopeFrom}). DMARC requires alignment between these domains.`,
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

  // Check for disposition override (when applied disposition differs from published policy)
  const overrideExplanation = explainDispositionOverride(record, currentReport?.policy);
  if (overrideExplanation) {
    issues.push(overrideExplanation);
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

  const issuesHtml = issues.map(issue => {
    // Optional commonCauses section (e.g., for permerror)
    const commonCausesHtml = issue.commonCauses ? `
      <div class="diagnosis-common-causes">
        <strong>Common Causes:</strong>
        <ul>
          ${issue.commonCauses.map(c => `<li>${c}</li>`).join('')}
        </ul>
      </div>
    ` : '';

    return `
      <div class="diagnosis-item diagnosis-${issue.type}">
        <h5>${issue.title}</h5>
        <p class="diagnosis-explanation">${issue.explanation}</p>
        ${commonCausesHtml}
        <div class="diagnosis-recommendations">
          <strong>Recommendations:</strong>
          <ul>
            ${issue.recommendations.map(r => `<li>${r}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="diagnosis-section">
      <h4>Issues & Recommendations</h4>
      ${issuesHtml}
    </div>
  `;
}

/**
 * Render details section for a record
 * All user-controlled values (domains, selectors, etc.) are escaped to prevent XSS
 * @param {Object} record - Record data
 * @returns {string} HTML string for details
 */
function renderDetails(record) {
  const identifiers = record.identifiers || {};
  const authResults = record.authResults || { dkim: [], spf: [] };

  // Escape all user-controlled values from DKIM results
  let dkimHtml = authResults.dkim.length > 0
    ? authResults.dkim.map(d => `
        <li>
          <span class="label">Signing Domain:</span> <strong>${escapeHtml(d.domain) || '-'}</strong>
        </li>
        <li>
          <span class="label">Selector:</span> ${escapeHtml(d.selector) || '-'}
        </li>
        <li>
          <span class="label">Result:</span> ${createBadge(d.result)}
        </li>
      `).join('')
    : '<li>No DKIM signature found</li>';

  // Escape all user-controlled values from SPF results
  let spfHtml = authResults.spf.length > 0
    ? authResults.spf.map(s => `
        <li>
          <span class="label">Checked Domain:</span> <strong>${escapeHtml(s.domain) || '-'}</strong>
        </li>
        <li>
          <span class="label">Scope:</span> ${escapeHtml(s.scope) || 'mfrom'}
        </li>
        <li>
          <span class="label">Result:</span> ${createBadge(s.result)}
        </li>
      `).join('')
    : '<li>No SPF check performed</li>';

  // Check for domain mismatches that affect alignment
  // Use raw values for comparison, escaped values for display
  const headerFrom = identifiers.headerFrom || '';
  const dkimDomain = authResults.dkim[0]?.domain || '';
  const spfDomain = authResults.spf[0]?.domain || '';

  let alignmentNote = '';
  if (headerFrom && dkimDomain && !dkimDomain.endsWith(headerFrom) && !headerFrom.endsWith(dkimDomain)) {
    alignmentNote += `<div class="alignment-note">DKIM signed by <strong>${escapeHtml(dkimDomain)}</strong> but From header is <strong>${escapeHtml(headerFrom)}</strong> - may fail DKIM alignment</div>`;
  }
  if (headerFrom && spfDomain && !spfDomain.endsWith(headerFrom) && !headerFrom.endsWith(spfDomain)) {
    alignmentNote += `<div class="alignment-note">SPF checked for <strong>${escapeHtml(spfDomain)}</strong> but From header is <strong>${escapeHtml(headerFrom)}</strong> - may fail SPF alignment</div>`;
  }

  // Escape identifier values for display
  const safeHeaderFrom = escapeHtml(identifiers.headerFrom) || '-';
  const safeEnvelopeFrom = escapeHtml(identifiers.envelopeFrom) || '-';
  const safeEnvelopeTo = escapeHtml(identifiers.envelopeTo) || '-';

  return `
    <div class="details-content">
      <div class="details-section">
        <h4>Message Identifiers</h4>
        <ul>
          <li><span class="label">Header From:</span> <strong>${safeHeaderFrom}</strong> <span class="identifier-hint">(visible to recipient)</span></li>
          <li><span class="label">Envelope From:</span> ${safeEnvelopeFrom} <span class="identifier-hint">(Return-Path/bounce address)</span></li>
          <li><span class="label">Envelope To:</span> ${safeEnvelopeTo} <span class="identifier-hint">(recipient domain)</span></li>
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
 * Check if an IP address matches a filter (supports prefix and CIDR notation)
 * @param {string} ip - IP address to check
 * @param {string} filter - Filter value (prefix or CIDR like 192.168.1.0/24)
 * @returns {boolean} True if IP matches filter
 */
function matchesIpFilter(ip, filter) {
  if (!ip || !filter) return true;

  const filterLower = filter.trim().toLowerCase();
  const ipLower = ip.toLowerCase();

  // CIDR notation check
  if (filterLower.includes('/')) {
    return isIpInCidr(ip, filterLower);
  }

  // Simple prefix match
  return ipLower.startsWith(filterLower);
}

/**
 * Check if an IPv4 address is within a CIDR range
 * @param {string} ip - IP address to check
 * @param {string} cidr - CIDR notation (e.g., 192.168.1.0/24)
 * @returns {boolean} True if IP is in range
 */
function isIpInCidr(ip, cidr) {
  try {
    const [subnet, bitsStr] = cidr.split('/');
    const bits = parseInt(bitsStr, 10);

    if (isNaN(bits) || bits < 0 || bits > 32) return false;

    const ipNum = ipToInt(ip);
    const subnetNum = ipToInt(subnet);

    if (ipNum === null || subnetNum === null) return false;

    // Create mask: e.g., /24 = 0xFFFFFF00
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;

    return (ipNum & mask) === (subnetNum & mask);
  } catch (err) {
    return false;
  }
}

/**
 * Convert IPv4 address string to 32-bit integer
 * @param {string} ip - IPv4 address
 * @returns {number|null} Integer representation or null if invalid
 */
function ipToInt(ip) {
  if (!ip) return null;

  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }

  return result >>> 0; // Ensure unsigned
}

/**
 * Filter records based on current filter state
 * Applies all active filters with AND logic
 * @param {Array} records - Array of record objects
 * @returns {Array} Filtered records
 */
function filterRecords(records) {
  return records.filter(record => {
    const pe = record.policyEvaluated || {};
    const dkimPass = pe.dkim === 'pass';
    const spfPass = pe.spf === 'pass';

    // Status filter
    if (filterState.status !== 'all') {
      switch (filterState.status) {
        case 'pass':
          if (!(dkimPass && spfPass)) return false;
          break;
        case 'fail':
          if (dkimPass && spfPass) return false;
          break;
        case 'quarantine':
          if (pe.disposition !== 'quarantine') return false;
          break;
        case 'reject':
          if (pe.disposition !== 'reject') return false;
          break;
      }
    }

    // Domain filter (searches header_from)
    if (filterState.domain) {
      const domain = (record.identifiers?.headerFrom || '').toLowerCase();
      if (!domain.includes(filterState.domain.toLowerCase())) {
        return false;
      }
    }

    // IP filter (prefix or CIDR)
    if (filterState.ip) {
      if (!matchesIpFilter(record.sourceIp, filterState.ip)) {
        return false;
      }
    }

    // Country filter (requires geo data)
    if (filterState.country) {
      const geo = ipGeoData.get(record.sourceIp);
      if (!geo || geo.countryCode !== filterState.country) {
        return false;
      }
    }

    // Minimum message count filter
    if (filterState.minCount > 0) {
      if (record.count < filterState.minCount) {
        return false;
      }
    }

    // Hostname filter (searches reverse DNS)
    if (filterState.hostname) {
      const geo = ipGeoData.get(record.sourceIp);
      const hostname = (geo?.hostname || '').toLowerCase();
      if (!hostname.includes(filterState.hostname.toLowerCase())) {
        return false;
      }
    }

    // Classification filter
    if (filterState.classification) {
      const recordClassification = record._classification?.classification || 'unknown';
      if (recordClassification !== filterState.classification) {
        return false;
      }
    }

    // Provider filter
    if (filterState.provider) {
      const recordProvider = record._provider?.id || 'unknown';
      if (recordProvider !== filterState.provider) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Count the number of active filters
 * @returns {number} Number of non-default filter values
 */
function countActiveFilters() {
  let count = 0;
  if (filterState.status !== 'all') count++;
  if (filterState.domain) count++;
  if (filterState.ip) count++;
  if (filterState.country) count++;
  if (filterState.minCount > 0) count++;
  if (filterState.hostname) count++;
  if (filterState.classification) count++;
  if (filterState.provider) count++;
  return count;
}

/**
 * Update the active filter count badge
 */
function updateFilterBadge() {
  const count = countActiveFilters();
  if (count > 0) {
    activeFilterCountBadge.textContent = count;
    activeFilterCountBadge.classList.remove('hidden');
  } else {
    activeFilterCountBadge.classList.add('hidden');
  }
}

/**
 * Populate country dropdown from current geo data
 */
function populateCountryFilter() {
  if (!filterCountrySelect) return;

  const countries = new Map();
  for (const [ip, geo] of ipGeoData.entries()) {
    if (geo && geo.countryCode && geo.country) {
      countries.set(geo.countryCode, geo.country);
    }
  }

  // Sort by country name
  const sorted = [...countries.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  // Clear existing options except first
  while (filterCountrySelect.options.length > 1) {
    filterCountrySelect.remove(1);
  }

  // Add country options
  for (const [code, name] of sorted) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    filterCountrySelect.appendChild(option);
  }
}

/**
 * Populate provider dropdown from current records
 */
function populateProviderFilter() {
  if (!filterProviderSelect || !currentReport) return;

  const providers = new Map();

  for (const record of currentReport.records) {
    const provider = record._provider;
    if (provider && provider.id !== 'unknown') {
      providers.set(provider.id, provider.name);
    }
  }

  // Sort by provider name
  const sorted = [...providers.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  // Clear existing options except first
  while (filterProviderSelect.options.length > 1) {
    filterProviderSelect.remove(1);
  }

  // Add provider options
  for (const [id, name] of sorted) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = name;
    filterProviderSelect.appendChild(option);
  }
}

/**
 * Apply current filter input values to filter state
 */
function applyFilters() {
  filterState.status = filterSelect?.value || 'all';
  filterState.domain = filterDomainInput?.value?.trim() || '';
  filterState.ip = filterIpInput?.value?.trim() || '';
  filterState.country = filterCountrySelect?.value || '';
  filterState.minCount = parseInt(filterMinCountInput?.value, 10) || 0;
  filterState.hostname = filterHostnameInput?.value?.trim() || '';
  filterState.classification = filterClassificationSelect?.value || '';
  filterState.provider = filterProviderSelect?.value || '';

  updateFilterBadge();

  if (currentReport) {
    renderRecords(currentReport.records);
  }
}

/**
 * Clear all filters to default values
 */
function clearFilters() {
  filterState.status = 'all';
  filterState.domain = '';
  filterState.ip = '';
  filterState.country = '';
  filterState.minCount = 0;
  filterState.hostname = '';
  filterState.classification = '';
  filterState.provider = '';

  // Reset input elements
  if (filterSelect) filterSelect.value = 'all';
  if (filterDomainInput) filterDomainInput.value = '';
  if (filterIpInput) filterIpInput.value = '';
  if (filterCountrySelect) filterCountrySelect.value = '';
  if (filterMinCountInput) filterMinCountInput.value = '';
  if (filterHostnameInput) filterHostnameInput.value = '';
  if (filterClassificationSelect) filterClassificationSelect.value = '';
  if (filterProviderSelect) filterProviderSelect.value = '';

  updateFilterBadge();

  if (currentReport) {
    renderRecords(currentReport.records);
  }
}

/**
 * Toggle the advanced filters panel visibility
 */
function toggleFiltersPanel() {
  const isHidden = advancedFiltersPanel.classList.contains('hidden');
  advancedFiltersPanel.classList.toggle('hidden');
  toggleFiltersBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
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
 * All user-controlled values are escaped to prevent XSS
 * @param {Object} record - Record data
 * @returns {string} HTML string for from domain cell
 */
function renderFromDomainCell(record) {
  const identifiers = record.identifiers || {};
  const authResults = record.authResults || { dkim: [], spf: [] };

  // Escape all domain values for safe HTML output
  const headerFrom = escapeHtml(identifiers.headerFrom) || '-';
  const envelopeFrom = escapeHtml(identifiers.envelopeFrom) || '-';

  // Get and escape auth domains for tooltip
  const dkimDomains = authResults.dkim.map(d => escapeHtml(d.domain)).filter(Boolean).join(', ') || '-';
  const spfDomains = authResults.spf.map(s => escapeHtml(s.domain)).filter(Boolean).join(', ') || '-';

  // Build tooltip - already escaped values, but also escape for attribute context
  const tooltip = escapeHtml(`Header From: ${identifiers.headerFrom || '-'}\nEnvelope From: ${identifiers.envelopeFrom || '-'}\nDKIM Domain: ${authResults.dkim.map(d => d.domain).filter(Boolean).join(', ') || '-'}\nSPF Domain: ${authResults.spf.map(s => s.domain).filter(Boolean).join(', ') || '-'}`);

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

    // Main row - escape sourceIp for XSS protection
    const mainRow = document.createElement('tr');
    mainRow.className = rowClass;
    const safeIp = escapeHtml(record.sourceIp) || '-';
    mainRow.innerHTML = `
      <td class="ip-cell">${safeIp}</td>
      ${renderHostnameCell(record.sourceIp)}
      ${renderLocationCell(record.sourceIp)}
      ${renderProviderCell(record.sourceIp)}
      ${renderFromDomainCell(record)}
      <td>${record.count.toLocaleString()}</td>
      <td>${createBadge(pe.disposition)}${renderAlignmentWarning(record)}</td>
      <td>${createClassificationBadge(record)}</td>
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
    detailsRow.innerHTML = `<td colspan="11">${renderDetails(record)}${reasonsHtml}</td>`;
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

  // Populate country dropdown with discovered countries
  populateCountryFilter();

  // Apply provider fingerprinting to all records
  if (typeof fingerprintProvider === 'function') {
    for (const record of currentReport.records) {
      const geoData = ipGeoData.get(record.sourceIp);
      record._provider = fingerprintProvider(geoData);
    }
  }

  // Re-run classification with provider info now available
  if (typeof classifyRecord === 'function') {
    for (const record of currentReport.records) {
      record._classification = classifyRecord(record, record._provider);
    }
  }

  // Populate provider dropdown
  populateProviderFilter();

  // Re-render the entire table to update hostname, location, and provider cells
  renderRecords(currentReport.records);

  // Re-calculate and render analysis with geo data now available
  const analysis = calculateAnalysis(currentReport.records);
  renderAnalysis(analysis, currentReport.summary.totalMessages);
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
 * Calculate top-N analysis from records
 * @param {Array} records - Array of record objects
 * @returns {Object} Analysis data with top lists
 */
function calculateAnalysis(records) {
  const analysis = {
    topSenders: [],      // Top IPs by message count
    topFailures: [],     // Top failing domains
    topCountries: [],    // Top countries by message count
    topAsns: []          // Top ASNs by message count
  };

  // Aggregate data
  const ipCounts = new Map();
  const domainFailures = new Map();
  const countryCounts = new Map();
  const asnCounts = new Map();

  for (const record of records) {
    const count = record.count || 0;
    const ip = record.sourceIp;

    // IP counts
    if (ip) {
      ipCounts.set(ip, (ipCounts.get(ip) || 0) + count);
    }

    // Domain failures (only count failing records)
    const pe = record.policyEvaluated || {};
    const dkimPass = pe.dkim === 'pass';
    const spfPass = pe.spf === 'pass';

    if (!dkimPass || !spfPass) {
      const domain = record.identifiers?.headerFrom || 'unknown';
      domainFailures.set(domain, (domainFailures.get(domain) || 0) + count);
    }

    // Country and ASN counts (require geo data)
    const geo = ipGeoData.get(ip);
    if (geo && !geo.error) {
      if (geo.country) {
        const key = `${geo.countryCode}|${geo.country}`;
        countryCounts.set(key, (countryCounts.get(key) || 0) + count);
      }
      if (geo.asn) {
        asnCounts.set(geo.asn, (asnCounts.get(geo.asn) || 0) + count);
      }
    }
  }

  // Sort and take top 10 for each
  analysis.topSenders = [...ipCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ip, count]) => ({
      ip,
      count,
      geo: ipGeoData.get(ip)
    }));

  analysis.topFailures = [...domainFailures.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));

  analysis.topCountries = [...countryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [code, name] = key.split('|');
      return { code, name, count };
    });

  analysis.topAsns = [...asnCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([asn, count]) => ({ asn, count }));

  return analysis;
}

/**
 * Render the analysis section
 * @param {Object} analysis - Analysis data from calculateAnalysis
 * @param {number} totalMessages - Total message count for percentage calculation
 */
function renderAnalysis(analysis, totalMessages) {
  const topSendersList = document.getElementById('top-senders-list');
  const topFailuresList = document.getElementById('top-failures-list');
  const topCountriesList = document.getElementById('top-countries-list');
  const topAsnsList = document.getElementById('top-asns-list');

  const maxCount = Math.max(
    analysis.topSenders[0]?.count || 0,
    analysis.topCountries[0]?.count || 0,
    analysis.topAsns[0]?.count || 0,
    1
  );
  const maxFailCount = analysis.topFailures[0]?.count || 1;

  // Render top senders
  if (topSendersList) {
    if (analysis.topSenders.length === 0) {
      topSendersList.innerHTML = '<div class="analysis-empty">No data</div>';
    } else {
      topSendersList.innerHTML = analysis.topSenders.map((item, i) => {
        const geo = item.geo;
        const location = geo && !geo.error
          ? `${geo.flag || ''} ${geo.city || ''} ${geo.country || ''}`.trim()
          : '';
        const pct = ((item.count / maxCount) * 100).toFixed(0);

        return `
          <div class="analysis-item" title="${escapeHtml(item.ip)}">
            <span class="analysis-item-rank">${i + 1}</span>
            <div class="analysis-item-info">
              <div class="analysis-item-label">${escapeHtml(item.ip)}</div>
              <div class="analysis-item-sublabel">${escapeHtml(location) || 'Unknown location'}</div>
            </div>
            <div class="analysis-item-value">${item.count.toLocaleString()}</div>
            <div class="analysis-item-bar">
              <div class="analysis-item-bar-fill fill-primary" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Render top failures
  if (topFailuresList) {
    if (analysis.topFailures.length === 0) {
      topFailuresList.innerHTML = '<div class="analysis-empty">No failures</div>';
    } else {
      topFailuresList.innerHTML = analysis.topFailures.map((item, i) => {
        const pct = ((item.count / maxFailCount) * 100).toFixed(0);
        return `
          <div class="analysis-item">
            <span class="analysis-item-rank">${i + 1}</span>
            <div class="analysis-item-info">
              <div class="analysis-item-label">${escapeHtml(item.domain)}</div>
            </div>
            <div class="analysis-item-value">${item.count.toLocaleString()}</div>
            <div class="analysis-item-bar">
              <div class="analysis-item-bar-fill fill-fail" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Render top countries
  if (topCountriesList) {
    if (analysis.topCountries.length === 0) {
      topCountriesList.innerHTML = '<div class="analysis-loading">Waiting for geo data...</div>';
    } else {
      topCountriesList.innerHTML = analysis.topCountries.map((item, i) => {
        const flag = countryCodeToFlag(item.code);
        const pct = ((item.count / maxCount) * 100).toFixed(0);
        return `
          <div class="analysis-item">
            <span class="analysis-item-rank">${i + 1}</span>
            <div class="analysis-item-info">
              <div class="analysis-item-label">${flag} ${escapeHtml(item.name)}</div>
            </div>
            <div class="analysis-item-value">${item.count.toLocaleString()}</div>
            <div class="analysis-item-bar">
              <div class="analysis-item-bar-fill fill-primary" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Render top ASNs
  if (topAsnsList) {
    if (analysis.topAsns.length === 0) {
      topAsnsList.innerHTML = '<div class="analysis-loading">Waiting for geo data...</div>';
    } else {
      topAsnsList.innerHTML = analysis.topAsns.map((item, i) => {
        const pct = ((item.count / maxCount) * 100).toFixed(0);
        return `
          <div class="analysis-item">
            <span class="analysis-item-rank">${i + 1}</span>
            <div class="analysis-item-info">
              <div class="analysis-item-label" title="${escapeHtml(item.asn)}">${escapeHtml(item.asn)}</div>
            </div>
            <div class="analysis-item-value">${item.count.toLocaleString()}</div>
            <div class="analysis-item-bar">
              <div class="analysis-item-bar-fill fill-primary" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

/**
 * Country code to flag emoji (duplicated from ip-lookup.js for viewer context)
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
 * Get the number of unique IPs in records
 * @param {Array} records - Array of record objects
 * @returns {number} Unique IP count
 */
function getUniqueIpCount(records) {
  const uniqueIps = new Set();
  for (const record of records) {
    if (record.sourceIp) {
      uniqueIps.add(record.sourceIp);
    }
  }
  return uniqueIps.size;
}

/**
 * Show enrichment banner for large reports
 * @param {number} uniqueIpCount - Number of unique IPs
 */
function showEnrichmentBanner(uniqueIpCount) {
  if (!enrichmentBanner) return;

  enrichmentMessage.textContent =
    `This report has ${uniqueIpCount} unique IPs. Enrichment adds location and hostname data but may be slow.`;
  enrichmentBanner.classList.remove('hidden');
}

/**
 * Hide enrichment banner
 */
function hideEnrichmentBanner() {
  if (!enrichmentBanner) return;
  enrichmentBanner.classList.add('hidden');
}

/**
 * Trigger IP enrichment for current report
 */
function triggerEnrichment() {
  hideEnrichmentBanner();
  if (currentReport) {
    loadIpGeoData(currentReport.records);
  }
}

/**
 * Display a parsed DMARC report
 * @param {Object} report - Parsed DMARC report
 */
function displayReport(report) {
  currentReport = report;
  enrichmentSkipped = false;

  // Apply classification to all records
  // Note: Provider fingerprinting will be added in Checkpoint 3
  if (typeof classifyRecord === 'function') {
    for (const record of report.records) {
      // Classification is applied without provider info initially
      // It will be re-applied after geo data loads with provider fingerprinting
      record._classification = classifyRecord(record, null);
    }
  }

  renderSummary(report.summary);
  renderMetadata(report.metadata);
  renderPolicy(report.policy);

  // Calculate and render enforcement readiness
  const readiness = calculateEnforcementReadiness(report.records, report.policy);
  renderEnforcementReadiness(readiness);

  renderRecords(report.records);

  // Initial analysis render (will be updated after geo data loads)
  const analysis = calculateAnalysis(report.records);
  renderAnalysis(analysis, report.summary.totalMessages);

  // Show export buttons
  exportButtons.classList.remove('hidden');

  showReport();

  // Check if this is a large report
  const uniqueIpCount = getUniqueIpCount(report.records);

  if (uniqueIpCount > LARGE_REPORT_IP_THRESHOLD) {
    // Large report - offer opt-in enrichment
    showEnrichmentBanner(uniqueIpCount);
  } else {
    // Small report - auto-enrich
    hideEnrichmentBanner();
    loadIpGeoData(report.records);
  }
}

/**
 * Export report as JSON
 * Exports filtered records if filters are active
 */
function exportAsJson() {
  if (!currentReport) return;

  // Apply current filters to get exported records
  const filteredRecords = filterRecords(currentReport.records);
  const activeFilterCount = countActiveFilters();

  // Build export object with filtered records
  const exportData = {
    ...currentReport,
    records: filteredRecords,
    _exportMetadata: {
      exportedAt: new Date().toISOString(),
      totalRecords: currentReport.records.length,
      filteredRecords: filteredRecords.length,
      filtersApplied: activeFilterCount > 0,
      filterState: activeFilterCount > 0 ? { ...filterState } : null
    }
  };

  // Include analysis in export
  const analysis = calculateAnalysis(filteredRecords);
  exportData._analysis = {
    topSendingIps: analysis.topSenders.map(item => ({
      ip: item.ip,
      count: item.count,
      location: item.geo ? `${item.geo.city || ''} ${item.geo.country || ''}`.trim() : null
    })),
    topFailingDomains: analysis.topFailures,
    topCountries: analysis.topCountries,
    topAsns: analysis.topAsns.map(item => ({ asn: item.asn, count: item.count }))
  };

  const dataStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  const suffix = activeFilterCount > 0 ? '-filtered' : '';
  a.download = `dmarc-report-${currentReport.metadata?.reportId || 'export'}${suffix}.json`;
  a.click();

  URL.revokeObjectURL(url);

  // Show feedback
  if (activeFilterCount > 0) {
    showToast(`Exported ${filteredRecords.length} of ${currentReport.records.length} records (filtered)`);
  }
}

/**
 * Export report as CSV
 * Exports filtered records if filters are active
 */
function exportAsCsv() {
  if (!currentReport) return;

  // Apply current filters and sort
  const filteredRecords = filterRecords(currentReport.records);
  const sortedRecords = sortRecords(filteredRecords);
  const activeFilterCount = countActiveFilters();

  const headers = [
    'Source IP',
    'Hostname',
    'Country',
    'City',
    'ISP/ASN',
    'Count',
    'Disposition',
    'DKIM Result',
    'SPF Result',
    'Header From',
    'Envelope From',
    'DKIM Signing Domain',
    'SPF Checked Domain',
    'Pass/Fail'
  ];

  const rows = sortedRecords.map(record => {
    const pe = record.policyEvaluated || {};
    const id = record.identifiers || {};
    const auth = record.authResults || { dkim: [], spf: [] };
    const geo = ipGeoData.get(record.sourceIp) || {};

    const dkimPass = pe.dkim === 'pass';
    const spfPass = pe.spf === 'pass';
    const passStatus = dkimPass && spfPass ? 'PASS' : (!dkimPass && !spfPass ? 'FAIL' : 'PARTIAL');

    return [
      record.sourceIp || '',
      geo.hostname || '',
      geo.country || '',
      geo.city || '',
      geo.asn || geo.isp || '',
      record.count,
      pe.disposition || '',
      pe.dkim || '',
      pe.spf || '',
      id.headerFrom || '',
      id.envelopeFrom || '',
      auth.dkim.map(d => d.domain).filter(Boolean).join('; ') || '',
      auth.spf.map(s => s.domain).filter(Boolean).join('; ') || '',
      passStatus
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
  const suffix = activeFilterCount > 0 ? '-filtered' : '';
  a.download = `dmarc-report-${currentReport.metadata?.reportId || 'export'}${suffix}.csv`;
  a.click();

  URL.revokeObjectURL(url);

  // Show feedback
  if (activeFilterCount > 0) {
    showToast(`Exported ${sortedRecords.length} of ${currentReport.records.length} records (filtered)`);
  }
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
 * Parse a report XML to extract preview metadata for the selector
 * This is a lightweight parse that only extracts what we need for display
 * @param {string} xml - Raw XML string
 * @returns {Object|null} Preview metadata or null if parsing fails
 */
function parseReportPreview(xml) {
  try {
    const report = parseDmarcReport(xml);
    return {
      orgName: report.metadata?.orgName || 'Unknown',
      reportId: report.metadata?.reportId || 'Unknown',
      dateRange: report.metadata?.dateRange,
      totalMessages: report.summary?.totalMessages || 0,
      recordCount: report.records?.length || 0,
      passRate: report.summary?.overallPassRate || 0
    };
  } catch (err) {
    return null;
  }
}

/**
 * Show the report selector modal for multi-file ZIPs
 * @param {Array<{filename: string, xml: string}>} files - Array of extracted files
 */
function showReportSelectorModal(files) {
  pendingExtraction = files;
  reportListEl.innerHTML = '';

  files.forEach((file, index) => {
    const preview = parseReportPreview(file.xml);
    const item = document.createElement('div');
    item.className = 'report-item';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');

    const dateStr = preview?.dateRange
      ? `${formatDate(preview.dateRange.begin)} - ${formatDate(preview.dateRange.end)}`
      : 'Unknown date range';

    const passRateStr = preview ? `${preview.passRate.toFixed(0)}% pass` : '';
    const msgCountStr = preview ? `${preview.totalMessages.toLocaleString()} messages` : '';

    item.innerHTML = `
      <div class="report-item-info">
        <div class="report-item-filename" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</div>
        <div class="report-item-meta">
          <span>${escapeHtml(preview?.orgName || 'Unknown')}</span>
          <span>${msgCountStr}</span>
          <span>${passRateStr}</span>
        </div>
      </div>
      <button class="report-item-action" data-index="${index}">View</button>
    `;

    // Click anywhere on item to view
    item.addEventListener('click', (e) => {
      if (!e.target.classList.contains('report-item-action')) {
        selectReport(index);
      }
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectReport(index);
      }
    });

    // View button click
    const viewBtn = item.querySelector('.report-item-action');
    viewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectReport(index);
    });

    reportListEl.appendChild(item);
  });

  reportSelectorModal.classList.remove('hidden');
  // Focus first item for accessibility
  const firstItem = reportListEl.querySelector('.report-item');
  if (firstItem) firstItem.focus();
}

/**
 * Hide the report selector modal
 */
function hideReportSelectorModal() {
  reportSelectorModal.classList.add('hidden');
  pendingExtraction = null;
}

/**
 * Apply basic XML syntax highlighting
 * Security: All user content is HTML-escaped BEFORE regex processing.
 * The regex patterns only wrap already-escaped content in span tags.
 * @param {string} xml - Raw XML string
 * @returns {string} HTML with syntax highlighting spans
 */
function highlightXml(xml) {
  if (!xml) return '';

  // Escape ALL HTML-significant characters first to prevent XSS
  // This MUST happen before any regex processing
  let escaped = xml
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // From this point, no user content can contain executable HTML.
  // All < > " ' & are now entity-encoded.

  // Highlight XML declaration
  escaped = escaped.replace(
    /(&lt;\?xml[^?]*\?&gt;)/g,
    '<span class="xml-declaration">$1</span>'
  );

  // Highlight comments
  escaped = escaped.replace(
    /(&lt;!--[\s\S]*?--&gt;)/g,
    '<span class="xml-comment">$1</span>'
  );

  // Highlight tags (opening and closing)
  escaped = escaped.replace(
    /(&lt;\/?)([\w:-]+)/g,
    '$1<span class="xml-tag">$2</span>'
  );

  // Highlight attributes (name before =)
  escaped = escaped.replace(
    /(\s)([\w:-]+)(=)/g,
    '$1<span class="xml-attr">$2</span>$3'
  );

  // Highlight attribute values (now using &quot; since we escaped quotes)
  escaped = escaped.replace(
    /=&quot;([^&]*(?:&(?!quot;)[^&]*)*)&quot;/g,
    '=&quot;<span class="xml-value">$1</span>&quot;'
  );

  return escaped;
}

/**
 * Show the raw XML modal
 */
function showXmlModal() {
  if (!xmlModal || !xmlContent) return;

  if (!currentRawXml) {
    showToast('Raw XML not available for combined reports');
    return;
  }

  // Apply syntax highlighting
  xmlContent.innerHTML = highlightXml(currentRawXml);
  xmlModal.classList.remove('hidden');

  // Focus the modal for accessibility
  xmlContent.focus();
}

/**
 * Hide the raw XML modal
 */
function hideXmlModal() {
  if (!xmlModal) return;
  xmlModal.classList.add('hidden');
}

/**
 * Copy raw XML to clipboard
 */
async function copyXmlToClipboard() {
  if (!currentRawXml) {
    showToast('No XML to copy');
    return;
  }

  try {
    await navigator.clipboard.writeText(currentRawXml);
    showToast('XML copied to clipboard');
  } catch (err) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = currentRawXml;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('XML copied to clipboard');
  }
}

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {number} duration - Duration in ms (default 2500)
 */
function showToast(message, duration = 2500) {
  // Remove existing toast if any
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, duration);
}

/**
 * Select and display a single report from the pending extraction
 * @param {number} index - Index of the report to display
 */
function selectReport(index) {
  if (!pendingExtraction || !pendingExtraction[index]) return;

  const file = pendingExtraction[index];
  hideReportSelectorModal();

  try {
    currentRawXml = file.xml;
    const report = parseDmarcReport(file.xml);
    displayReport(report);
  } catch (err) {
    showError(`Failed to parse report: ${err.message}`);
  }
}

/**
 * Combine multiple DMARC reports into a single aggregated report
 * Records are merged, and summary statistics are recalculated
 * @param {Array<{filename: string, xml: string}>} files - Array of extracted files
 * @returns {Object} Combined report object
 */
function combineReports(files) {
  const parsedReports = [];
  const parseErrors = [];

  // Parse all reports
  for (const file of files) {
    try {
      const report = parseDmarcReport(file.xml);
      report._sourceFilename = file.filename;
      parsedReports.push(report);
    } catch (err) {
      parseErrors.push({ filename: file.filename, error: err.message });
    }
  }

  if (parsedReports.length === 0) {
    throw new Error('No valid reports could be parsed');
  }

  // Use first report as base for metadata (or aggregate)
  const baseReport = parsedReports[0];
  const allRecords = [];

  // Collect all records from all reports
  for (const report of parsedReports) {
    for (const record of report.records) {
      // Add source attribution for debugging
      record._sourceReport = report.metadata?.reportId || report._sourceFilename;
      allRecords.push(record);
    }
  }

  // Recalculate summary statistics
  let totalMessages = 0;
  let passedDkim = 0;
  let failedDkim = 0;
  let passedSpf = 0;
  let failedSpf = 0;
  let passedBoth = 0;
  let failedBoth = 0;
  let quarantined = 0;
  let rejected = 0;

  for (const record of allRecords) {
    const count = record.count;
    totalMessages += count;

    const dkimPass = record.policyEvaluated?.dkim === 'pass';
    const spfPass = record.policyEvaluated?.spf === 'pass';
    const disposition = record.policyEvaluated?.disposition;

    if (dkimPass) passedDkim += count;
    else failedDkim += count;

    if (spfPass) passedSpf += count;
    else failedSpf += count;

    if (dkimPass && spfPass) passedBoth += count;
    if (!dkimPass && !spfPass) failedBoth += count;

    if (disposition === 'quarantine') quarantined += count;
    if (disposition === 'reject') rejected += count;
  }

  // Find overall date range across all reports
  let earliestDate = null;
  let latestDate = null;
  for (const report of parsedReports) {
    const dr = report.metadata?.dateRange;
    if (dr?.begin && (!earliestDate || dr.begin < earliestDate)) {
      earliestDate = dr.begin;
    }
    if (dr?.end && (!latestDate || dr.end > latestDate)) {
      latestDate = dr.end;
    }
  }

  // Build combined report
  return {
    version: baseReport.version,
    metadata: {
      orgName: `Combined (${parsedReports.length} reports)`,
      email: baseReport.metadata?.email,
      reportId: `combined-${Date.now()}`,
      dateRange: earliestDate && latestDate ? { begin: earliestDate, end: latestDate } : null,
      _sourceReports: parsedReports.map(r => ({
        filename: r._sourceFilename,
        reportId: r.metadata?.reportId,
        orgName: r.metadata?.orgName
      }))
    },
    policy: baseReport.policy, // Use policy from first report
    records: allRecords,
    summary: {
      totalMessages,
      passedDkim,
      failedDkim,
      passedSpf,
      failedSpf,
      passedBoth,
      failedBoth,
      quarantined,
      rejected,
      dkimPassRate: totalMessages > 0 ? (passedDkim / totalMessages * 100) : 0,
      spfPassRate: totalMessages > 0 ? (passedSpf / totalMessages * 100) : 0,
      overallPassRate: totalMessages > 0 ? (passedBoth / totalMessages * 100) : 0
    },
    _isCombined: true,
    _reportCount: parsedReports.length,
    _parseErrors: parseErrors
  };
}

/**
 * Handle extraction result - display single report or show selector for multiple
 * @param {ExtractionResult} extraction - Result from extractXmlFromFile
 */
function handleExtraction(extraction) {
  if (!extraction || !extraction.files || extraction.files.length === 0) {
    showError('No DMARC reports found in file');
    return;
  }

  if (extraction.files.length === 1) {
    // Single report - display directly
    try {
      currentRawXml = extraction.files[0].xml;
      const report = parseDmarcReport(extraction.files[0].xml);
      displayReport(report);
    } catch (err) {
      showError(`Failed to parse report: ${err.message}`);
    }
  } else {
    // Multiple reports - show selector modal
    showReportSelectorModal(extraction.files);
  }
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Process a file and display the report
 * @param {File} file - File object
 */
async function processFile(file) {
  // Remove any waiting banners
  const waitingBanner = document.getElementById('waiting-banner');
  if (waitingBanner) {
    const intervalId = waitingBanner.dataset.pollInterval;
    if (intervalId) clearInterval(parseInt(intervalId));
    waitingBanner.remove();
    document.body.style.paddingTop = '';
  }

  showLoading();

  try {
    const buffer = await file.arrayBuffer();
    const extraction = await extractXmlFromFile(buffer, file.name);
    handleExtraction(extraction);

    // Clean up downloaded file if this came from webmail
    cleanupDownloadedFile();
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

// Filter panel toggle
if (toggleFiltersBtn) {
  toggleFiltersBtn.addEventListener('click', toggleFiltersPanel);
}

// Apply filters button
if (applyFiltersBtn) {
  applyFiltersBtn.addEventListener('click', applyFilters);
}

// Clear filters button
if (clearFiltersBtn) {
  clearFiltersBtn.addEventListener('click', clearFilters);
}

// Filter inputs - apply on Enter key
const filterInputs = [filterDomainInput, filterIpInput, filterMinCountInput, filterHostnameInput];
filterInputs.forEach(input => {
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyFilters();
      }
    });
  }
});

// Status filter (also triggers immediate apply for backwards compat)
if (filterSelect) {
  filterSelect.addEventListener('change', () => {
    filterState.status = filterSelect.value;
    updateFilterBadge();
    if (currentReport) {
      renderRecords(currentReport.records);
    }
  });
}

// Country filter (immediate apply)
if (filterCountrySelect) {
  filterCountrySelect.addEventListener('change', () => {
    filterState.country = filterCountrySelect.value;
    updateFilterBadge();
    if (currentReport) {
      renderRecords(currentReport.records);
    }
  });
}

// Sort handler
if (sortSelect) {
  sortSelect.addEventListener('change', (e) => {
    currentSort = e.target.value;
    if (currentReport) {
      renderRecords(currentReport.records);
    }
  });
}

// Enrichment handlers
if (enrichNowBtn) {
  enrichNowBtn.addEventListener('click', () => {
    triggerEnrichment();
  });
}

if (skipEnrichmentBtn) {
  skipEnrichmentBtn.addEventListener('click', () => {
    enrichmentSkipped = true;
    hideEnrichmentBanner();
  });
}

// Modal event listeners
if (closeSelectorModalBtn) {
  closeSelectorModalBtn.addEventListener('click', hideReportSelectorModal);
}

if (combineAllBtn) {
  combineAllBtn.addEventListener('click', () => {
    if (!pendingExtraction || pendingExtraction.length < 2) return;

    hideReportSelectorModal();
    showLoading();

    try {
      const combinedReport = combineReports(pendingExtraction);
      // For combined reports, we don't have a single raw XML
      currentRawXml = null;
      displayReport(combinedReport);
    } catch (err) {
      showError(`Failed to combine reports: ${err.message}`);
    }
  });
}

// Close modal on backdrop click
if (reportSelectorModal) {
  reportSelectorModal.querySelector('.modal-backdrop')?.addEventListener('click', hideReportSelectorModal);
}

// XML modal event listeners
if (viewXmlBtn) {
  viewXmlBtn.addEventListener('click', showXmlModal);
}

if (closeXmlModalBtn) {
  closeXmlModalBtn.addEventListener('click', hideXmlModal);
}

if (copyXmlBtn) {
  copyXmlBtn.addEventListener('click', copyXmlToClipboard);
}

if (xmlModal) {
  xmlModal.querySelector('.modal-backdrop')?.addEventListener('click', hideXmlModal);
}

// Close modals on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (reportSelectorModal && !reportSelectorModal.classList.contains('hidden')) {
      hideReportSelectorModal();
    }
    if (xmlModal && !xmlModal.classList.contains('hidden')) {
      hideXmlModal();
    }
  }
});

// Initialize collapsible sections
initCollapsibleSections();

/**
 * Show download notification banner with clear instructions
 * @param {Object} downloadInfo - Info about the pending download
 */
function showDownloadNotification(downloadInfo) {
  // Store download ID for cleanup after processing
  pendingDownloadId = downloadInfo.id;

  const banner = document.createElement('div');
  banner.id = 'download-notification';
  banner.className = 'download-notification';

  // Create the banner content
  banner.innerHTML = `
    <div class="download-notification-content">
      <div class="download-notification-main">
        <div class="download-notification-title">
          DMARC Report Downloaded
        </div>
        <div class="download-notification-filename">
          ${downloadInfo.filename}
        </div>
        <div class="download-notification-instructions">
          Click the button below to select the downloaded file from your Downloads folder
        </div>
      </div>
      <button class="download-notification-btn" id="select-download-btn">
        Select Downloaded File
      </button>
      <button class="download-notification-close" title="Dismiss">&times;</button>
    </div>
  `;

  // Apply styles
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #1a73e8 0%, #1557b0 100%);
    color: white;
    padding: 16px 24px;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;

  const content = banner.querySelector('.download-notification-content');
  content.style.cssText = `
    display: flex;
    align-items: center;
    gap: 20px;
    max-width: 1200px;
    margin: 0 auto;
  `;

  const main = banner.querySelector('.download-notification-main');
  main.style.cssText = 'flex: 1;';

  const title = banner.querySelector('.download-notification-title');
  title.style.cssText = 'font-size: 16px; font-weight: 600; margin-bottom: 4px;';

  const filename = banner.querySelector('.download-notification-filename');
  filename.style.cssText = `
    font-family: monospace;
    background: rgba(255,255,255,0.2);
    padding: 4px 8px;
    border-radius: 4px;
    display: inline-block;
    margin-bottom: 4px;
    font-size: 13px;
  `;

  const instructions = banner.querySelector('.download-notification-instructions');
  instructions.style.cssText = 'font-size: 13px; opacity: 0.9;';

  const selectBtn = banner.querySelector('#select-download-btn');
  selectBtn.style.cssText = `
    background: white;
    color: #1a73e8;
    border: none;
    padding: 12px 24px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: transform 0.1s, box-shadow 0.1s;
  `;
  selectBtn.onmouseenter = () => {
    selectBtn.style.transform = 'scale(1.02)';
    selectBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
  };
  selectBtn.onmouseleave = () => {
    selectBtn.style.transform = 'scale(1)';
    selectBtn.style.boxShadow = 'none';
  };
  selectBtn.onclick = () => fileInput.click();

  const closeBtn = banner.querySelector('.download-notification-close');
  closeBtn.style.cssText = `
    background: none;
    border: none;
    color: white;
    font-size: 28px;
    cursor: pointer;
    padding: 0 8px;
    opacity: 0.8;
    line-height: 1;
  `;
  closeBtn.onmouseenter = () => closeBtn.style.opacity = '1';
  closeBtn.onmouseleave = () => closeBtn.style.opacity = '0.8';
  closeBtn.onclick = () => {
    banner.remove();
    document.body.style.paddingTop = '';
  };

  document.body.prepend(banner);

  // Add padding to body to prevent overlap
  document.body.style.paddingTop = '100px';

  // Try to auto-open file picker (may be blocked by browser)
  setTimeout(() => {
    try {
      fileInput.click();
    } catch (e) {
      console.log('DMARC Viewer: Auto file picker blocked, user can click button');
    }
  }, 300);
}

/**
 * Clean up UI after successful processing of a downloaded file
 */
function cleanupDownloadedFile() {
  if (!pendingDownloadId) return;

  pendingDownloadId = null;

  // Remove notification banner
  const banner = document.getElementById('download-notification');
  if (banner) {
    banner.remove();
    document.body.style.paddingTop = '';
  }
}

/**
 * Show waiting banner and poll for XML data
 */
function showWaitingForDownload(filename) {
  const banner = document.createElement('div');
  banner.id = 'waiting-banner';
  banner.innerHTML = `
    <div class="waiting-content">
      <div class="waiting-spinner"></div>
      <div class="waiting-main">
        <div class="waiting-title">Waiting for download...</div>
        <div class="waiting-filename">${filename}</div>
        <div class="waiting-hint">If the download doesn't start, click the download icon in Gmail</div>
      </div>
      <button class="waiting-manual" id="manual-select-btn">Select File Manually</button>
    </div>
  `;

  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0;
    background: linear-gradient(135deg, #1a73e8, #1557b0);
    color: white; padding: 20px 24px; z-index: 1000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;

  const content = banner.querySelector('.waiting-content');
  content.style.cssText = 'display:flex;align-items:center;gap:20px;max-width:1200px;margin:0 auto;';

  const spinner = banner.querySelector('.waiting-spinner');
  spinner.style.cssText = `
    width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.3);
    border-top-color: white; border-radius: 50%;
    animation: spin 1s linear infinite;
  `;

  // Add spinner animation
  if (!document.getElementById('spinner-style')) {
    const style = document.createElement('style');
    style.id = 'spinner-style';
    style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  const main = banner.querySelector('.waiting-main');
  main.style.cssText = 'flex:1;';

  const title = banner.querySelector('.waiting-title');
  title.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:4px;';

  const fn = banner.querySelector('.waiting-filename');
  fn.style.cssText = 'font-family:monospace;background:rgba(255,255,255,0.2);padding:4px 8px;border-radius:4px;display:inline-block;margin-bottom:4px;font-size:13px;';

  const hint = banner.querySelector('.waiting-hint');
  hint.style.cssText = 'font-size:12px;opacity:0.8;';

  const btn = banner.querySelector('#manual-select-btn');
  btn.style.cssText = 'background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.5);padding:10px 20px;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap;';
  btn.onclick = () => fileInput.click();

  document.body.prepend(banner);
  document.body.style.paddingTop = '90px';

  // Poll for download complete or XML data
  let pollCount = 0;
  const maxPolls = 120; // Poll for up to 60 seconds

  const pollInterval = setInterval(() => {
    pollCount++;

    chrome.storage.local.get([STORAGE_KEY_REPORT_DATA, 'currentXml', 'downloadComplete'], (result) => {
      // Check new format first
      if (result[STORAGE_KEY_REPORT_DATA]) {
        clearInterval(pollInterval);
        banner.remove();
        document.body.style.paddingTop = '';
        chrome.storage.local.remove([STORAGE_KEY_REPORT_DATA, 'downloadComplete']);
        handleExtraction(result[STORAGE_KEY_REPORT_DATA]);
        return;
      }

      // Legacy format support
      if (result.currentXml) {
        // XML is ready - display it
        clearInterval(pollInterval);
        banner.remove();
        document.body.style.paddingTop = '';

        try {
          currentRawXml = result.currentXml;
          const report = parseDmarcReport(result.currentXml);
          displayReport(report);
          chrome.storage.local.remove(['currentXml', 'downloadComplete']);
        } catch (err) {
          showError(`Failed to parse report: ${err.message}`);
        }
        return;
      }

      if (result.downloadComplete) {
        // Download finished - prompt user to select file
        clearInterval(pollInterval);
        chrome.storage.local.remove(['downloadComplete']);

        spinner.style.display = 'none';
        title.textContent = 'Download complete!';
        title.style.color = '#90EE90';
        hint.textContent = 'Click the button to select the downloaded file';

        btn.textContent = 'Select Downloaded File';
        btn.style.background = 'white';
        btn.style.color = '#1a73e8';
        btn.style.fontWeight = '600';
        btn.style.border = 'none';

        // Auto-click file picker
        setTimeout(() => fileInput.click(), 300);
      } else if (pollCount >= maxPolls) {
        clearInterval(pollInterval);
        spinner.style.display = 'none';
        title.textContent = 'Download the attachment from Gmail';
        hint.textContent = 'Then click "Select File Manually" to open the report';
      }
    });
  }, 500);

  // Store interval ID for cleanup
  banner.dataset.pollInterval = pollInterval;
}

// =============================================================================
// Debug Mode
// =============================================================================

/**
 * Check if debug mode is enabled via localStorage
 * @returns {boolean} True if debug mode is active
 */
function isDebugMode() {
  try {
    return localStorage.getItem('dmarcDebugMode') === 'true';
  } catch {
    return false;
  }
}

/**
 * Initialize debug mode from URL parameter
 * Allows enabling via ?debug=1
 */
function initDebugMode() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('debug') === '1') {
    localStorage.setItem('dmarcDebugMode', 'true');
    console.log('DMARC Debug Mode enabled via URL parameter');
    console.log('To disable: localStorage.removeItem("dmarcDebugMode")');
  }

  if (isDebugMode()) {
    console.log('DMARC Debug Mode is active');
  }
}

/**
 * Render robustness note for a record (debug mode only)
 * @param {Object} record - Record with _robustness data
 * @returns {string} HTML string or empty if not in debug mode
 */
function renderRobustnessNote(record) {
  if (!isDebugMode()) return '';

  const r = record._robustness;
  if (!r || r.confidence === 'high') return '';

  const issues = [];
  if (r.missingAuthResults) issues.push('Missing auth_results');
  if (r.incompleteDkim) issues.push('Incomplete DKIM');
  if (r.incompleteSpf) issues.push('Incomplete SPF');

  return `<div class="debug-note" title="${issues.join(', ')}">
    <span class="debug-confidence debug-confidence-${r.confidence}">${r.confidence}</span>
    ${r.receiverName ? `<span class="debug-receiver">${escapeHtml(r.receiverName)}</span>` : ''}
  </div>`;
}

/**
 * Initialize viewer - check for stored report data
 * Handles both new format (ExtractionResult) and legacy format (raw XML string)
 */
function initViewer() {
  // Initialize debug mode from URL param
  initDebugMode();

  if (typeof chrome !== 'undefined' && chrome.storage) {
    // Check for new format first, then legacy
    chrome.storage.local.get([STORAGE_KEY_REPORT_DATA, 'currentXml'], (result) => {
      // New format: ExtractionResult with files array
      if (result[STORAGE_KEY_REPORT_DATA]) {
        const extraction = result[STORAGE_KEY_REPORT_DATA];
        chrome.storage.local.remove([STORAGE_KEY_REPORT_DATA]);
        handleExtraction(extraction);
        return;
      }

      // Legacy format: raw XML string (backwards compatibility)
      if (result.currentXml) {
        chrome.storage.local.remove(['currentXml']);
        try {
          currentRawXml = result.currentXml;
          const report = parseDmarcReport(result.currentXml);
          displayReport(report);
        } catch (err) {
          showError(`Failed to parse report: ${err.message}`);
        }
        return;
      }

      // No stored data - show default drop zone (no action needed)
    });
  }
}

// Initialize on load
initViewer();

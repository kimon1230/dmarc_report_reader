/**
 * DMARC Report Reader - DMARC XML Parser
 * Parses DMARC aggregate report XML into structured JSON
 */

// =============================================================================
// Debug Mode
// =============================================================================

/**
 * Check if debug mode is enabled via localStorage
 * @returns {boolean} True if debug mode is active
 */
function isDebugMode() {
  try {
    return typeof localStorage !== 'undefined' &&
           localStorage.getItem('dmarcDebugMode') === 'true';
  } catch {
    return false; // localStorage not available (service worker context)
  }
}

/**
 * Log debug message when debug mode is enabled
 * @param {string} category - Log category (alignment, quirk, parse, etc.)
 * @param {string} message - Log message
 * @param {*} data - Optional data to log
 */
function debugLog(category, message, data) {
  if (!isDebugMode()) return;
  console.log(`[DMARC:${category}]`, message, data || '');
}

// =============================================================================
// DMARC Alignment Engine
// =============================================================================

/**
 * Known two-part TLDs for organizational domain extraction
 * @constant {string[]}
 */
const TWO_PART_TLDS = [
  'co.uk', 'com.au', 'co.nz', 'co.jp', 'com.br', 'co.za', 'com.mx',
  'co.in', 'com.sg', 'com.hk', 'co.kr', 'com.tw', 'com.ar', 'com.co',
  'org.uk', 'net.au', 'org.au', 'ac.uk', 'gov.uk', 'edu.au'
];

/**
 * Extract organizational domain from a full domain
 * Used for DMARC relaxed alignment checks
 * @param {string} domain - Full domain (e.g., mail.example.com)
 * @returns {string|null} Organizational domain (e.g., example.com)
 */
function getOrganizationalDomain(domain) {
  if (!domain) return null;

  const parts = domain.toLowerCase().split('.');
  if (parts.length <= 2) return domain.toLowerCase();

  // Check for two-part TLDs
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_PART_TLDS.includes(lastTwo)) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

/**
 * Check if two domains align under DMARC rules
 * @param {string} authDomain - Domain from SPF/DKIM authentication
 * @param {string} headerFrom - From header domain
 * @param {string} mode - 'relaxed' or 'strict'
 * @returns {boolean} True if domains align
 */
function domainsAlign(authDomain, headerFrom, mode) {
  if (!authDomain || !headerFrom) return false;

  const authLower = authDomain.toLowerCase();
  const headerLower = headerFrom.toLowerCase();

  // DMARC uses 's' for strict, 'r' for relaxed (default)
  if (mode === 's' || mode === 'strict') {
    return authLower === headerLower;
  }

  // Relaxed: organizational domains must match
  const authOrg = getOrganizationalDomain(authLower);
  const headerOrg = getOrganizationalDomain(headerLower);

  debugLog('alignment', 'Comparing org domains', { authOrg, headerOrg, mode });

  return authOrg === headerOrg;
}

/**
 * Primary failure reason enum values
 * @constant {Object}
 */
const FAILURE_REASONS = Object.freeze({
  NONE: 'none',
  BOTH_AUTH_FAIL: 'both_auth_fail',
  BOTH_MISALIGNED: 'both_misaligned',
  SPF_FAIL_DKIM_MISALIGNED: 'spf_fail_dkim_misaligned',
  SPF_MISALIGNED_DKIM_FAIL: 'spf_misaligned_dkim_fail',
  SPF_FAIL: 'spf_fail',
  SPF_MISALIGNED: 'spf_misaligned',
  DKIM_FAIL: 'dkim_fail',
  DKIM_MISALIGNED: 'dkim_misaligned',
  UNKNOWN: 'unknown'
});

/**
 * Compute full DMARC alignment for a record
 * DMARC passes if (SPF passes AND aligns) OR (DKIM passes AND aligns)
 * @param {Object} record - Partially parsed record with authResults and identifiers
 * @param {Object} policy - Parsed policy for alignment mode
 * @returns {Object} Alignment result with detailed breakdown
 */
function computeAlignment(record, policy) {
  const headerFrom = record.identifiers?.headerFrom;
  const authResults = record.authResults || { dkim: [], spf: [] };

  const aspfMode = policy?.aspf || 'relaxed';
  const adkimMode = policy?.adkim || 'relaxed';

  debugLog('alignment', 'Computing alignment', {
    headerFrom,
    aspfMode,
    adkimMode,
    spfCount: authResults.spf.length,
    dkimCount: authResults.dkim.length
  });

  // SPF alignment check
  const spfResult = authResults.spf[0];
  const spfPassed = spfResult?.result === 'pass';
  const spfDomain = spfResult?.domain;
  const spfAligned = spfPassed && domainsAlign(spfDomain, headerFrom, aspfMode);

  // DKIM alignment check (any DKIM signature that passes AND aligns)
  let dkimAligned = false;
  let dkimPassed = false;
  let alignedDkimDomain = null;

  for (const dkim of authResults.dkim) {
    if (dkim.result === 'pass') {
      dkimPassed = true;
      if (domainsAlign(dkim.domain, headerFrom, adkimMode)) {
        dkimAligned = true;
        alignedDkimDomain = dkim.domain;
        break;
      }
    }
  }

  // DMARC passes if either SPF or DKIM is both passing AND aligned
  const dmarcPass = spfAligned || dkimAligned;

  // Determine primary failure reason
  let primaryFailureReason = FAILURE_REASONS.NONE;

  if (!dmarcPass) {
    if (!spfPassed && !dkimPassed) {
      primaryFailureReason = FAILURE_REASONS.BOTH_AUTH_FAIL;
    } else if (spfPassed && !spfAligned && dkimPassed && !dkimAligned) {
      primaryFailureReason = FAILURE_REASONS.BOTH_MISALIGNED;
    } else if (!spfPassed && dkimPassed && !dkimAligned) {
      primaryFailureReason = FAILURE_REASONS.SPF_FAIL_DKIM_MISALIGNED;
    } else if (spfPassed && !spfAligned && !dkimPassed) {
      primaryFailureReason = FAILURE_REASONS.SPF_MISALIGNED_DKIM_FAIL;
    } else if (!spfPassed && !dkimPassed) {
      primaryFailureReason = FAILURE_REASONS.BOTH_AUTH_FAIL;
    } else if (spfPassed && !spfAligned) {
      primaryFailureReason = FAILURE_REASONS.SPF_MISALIGNED;
    } else if (dkimPassed && !dkimAligned) {
      primaryFailureReason = FAILURE_REASONS.DKIM_MISALIGNED;
    } else {
      primaryFailureReason = FAILURE_REASONS.UNKNOWN;
    }
  }

  debugLog('alignment', 'Alignment result', {
    dmarcPass,
    spfPassed,
    spfAligned,
    dkimPassed,
    dkimAligned,
    primaryFailureReason
  });

  return {
    spfPassed,
    spfAligned,
    spfDomain,
    dkimPassed,
    dkimAligned,
    alignedDkimDomain,
    dkimDomains: authResults.dkim.map(d => d.domain).filter(Boolean),
    dmarcPass,
    primaryFailureReason,
    headerFrom,
    // Legacy field for backwards compatibility
    headerEnvelopeMismatch: headerFrom &&
      record.identifiers?.envelopeFrom &&
      headerFrom.toLowerCase() !== record.identifiers.envelopeFrom.toLowerCase()
  };
}

// =============================================================================
// Parser Robustness Signals
// =============================================================================

/**
 * Known DMARC report receivers and their quirks
 * @constant {Object}
 */
const KNOWN_RECEIVERS = Object.freeze({
  'google.com': { name: 'Google', quirks: ['may_omit_spf_scope'] },
  'yahoo.com': { name: 'Yahoo', quirks: ['nonstandard_reasons'] },
  'yahoo.co.jp': { name: 'Yahoo Japan', quirks: ['nonstandard_reasons'] },
  'microsoft.com': { name: 'Microsoft', quirks: ['may_omit_auth_results'] },
  'outlook.com': { name: 'Microsoft', quirks: ['may_omit_auth_results'] },
  'hotmail.com': { name: 'Microsoft', quirks: ['may_omit_auth_results'] },
  'mail.ru': { name: 'Mail.ru', quirks: ['minimal_auth_results'] },
  'yandex.ru': { name: 'Yandex', quirks: ['minimal_auth_results'] }
});

/**
 * Compute robustness signals for a parsed record
 * Indicates parsing confidence and potential data quality issues
 * @param {Object} record - Parsed record
 * @param {Object} metadata - Report metadata
 * @returns {Object} Robustness signals
 */
function computeRobustnessSignals(record, metadata) {
  const signals = {
    missingAuthResults: false,
    incompleteDkim: false,
    incompleteSpf: false,
    receiverQuirks: [],
    receiverName: null,
    confidence: 'high'
  };

  const auth = record.authResults;

  // Check for missing auth_results
  if (!auth || (auth.dkim.length === 0 && auth.spf.length === 0)) {
    signals.missingAuthResults = true;
    signals.confidence = 'low';
    debugLog('quirk', 'Missing auth_results', { sourceIp: record.sourceIp });
  }

  // Check for incomplete DKIM (has result but no domain)
  for (const dkim of (auth?.dkim || [])) {
    if (dkim.result && !dkim.domain) {
      signals.incompleteDkim = true;
      if (signals.confidence === 'high') signals.confidence = 'medium';
      debugLog('quirk', 'Incomplete DKIM entry', { dkim });
    }
  }

  // Check for incomplete SPF (has result but no domain)
  for (const spf of (auth?.spf || [])) {
    if (spf.result && !spf.domain) {
      signals.incompleteSpf = true;
      if (signals.confidence === 'high') signals.confidence = 'medium';
      debugLog('quirk', 'Incomplete SPF entry', { spf });
    }
  }

  // Detect receiver-specific quirks from metadata email
  const orgEmail = (metadata?.email || '').toLowerCase();
  for (const [domain, info] of Object.entries(KNOWN_RECEIVERS)) {
    if (orgEmail.includes(domain)) {
      signals.receiverQuirks = info.quirks;
      signals.receiverName = info.name;
      debugLog('quirk', 'Detected known receiver', { receiver: info.name, quirks: info.quirks });
      break;
    }
  }

  return signals;
}

// =============================================================================
// XML Parsing Utilities
// =============================================================================

/**
 * Safely get text content from an XML element
 * @param {Element} parent - Parent element
 * @param {string} tagName - Child tag name
 * @returns {string|null} Text content or null
 */
function getText(parent, tagName) {
  const el = parent.getElementsByTagName(tagName)[0];
  return el ? el.textContent.trim() : null;
}

/**
 * Safely get integer from an XML element
 * @param {Element} parent - Parent element
 * @param {string} tagName - Child tag name
 * @returns {number|null} Integer value or null
 */
function getInt(parent, tagName) {
  const text = getText(parent, tagName);
  return text ? parseInt(text, 10) : null;
}

/**
 * Convert Unix timestamp to Date object
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {Date} Date object
 */
function timestampToDate(timestamp) {
  return new Date(timestamp * 1000);
}

/**
 * Expand DMARC alignment mode
 * @param {string} mode - 'r' or 's'
 * @returns {string} 'relaxed' or 'strict'
 */
function expandAlignmentMode(mode) {
  if (!mode) return null;
  return mode.toLowerCase() === 's' ? 'strict' : 'relaxed';
}

/**
 * Parse report metadata section
 * @param {Element} metadataEl - report_metadata element
 * @returns {Object} Parsed metadata
 */
function parseMetadata(metadataEl) {
  if (!metadataEl) return null;

  const dateRangeEl = metadataEl.getElementsByTagName('date_range')[0];

  return {
    orgName: getText(metadataEl, 'org_name'),
    email: getText(metadataEl, 'email'),
    extraContactInfo: getText(metadataEl, 'extra_contact_info'),
    reportId: getText(metadataEl, 'report_id'),
    dateRange: dateRangeEl ? {
      begin: timestampToDate(getInt(dateRangeEl, 'begin')),
      end: timestampToDate(getInt(dateRangeEl, 'end'))
    } : null
  };
}

/**
 * Parse policy_published section
 * @param {Element} policyEl - policy_published element
 * @returns {Object} Parsed policy
 */
function parsePolicy(policyEl) {
  if (!policyEl) return null;

  return {
    domain: getText(policyEl, 'domain'),
    adkim: expandAlignmentMode(getText(policyEl, 'adkim')),
    aspf: expandAlignmentMode(getText(policyEl, 'aspf')),
    policy: getText(policyEl, 'p'),
    subdomainPolicy: getText(policyEl, 'sp'),
    percentage: getInt(policyEl, 'pct'),
    failureOptions: getText(policyEl, 'fo'),
    npPolicy: getText(policyEl, 'np')
  };
}

/**
 * Parse policy override reasons
 * @param {Element} policyEvalEl - policy_evaluated element
 * @returns {Array} Array of reason objects
 */
function parseReasons(policyEvalEl) {
  if (!policyEvalEl) return [];

  const reasons = [];
  const reasonEls = policyEvalEl.getElementsByTagName('reason');

  for (const reasonEl of reasonEls) {
    reasons.push({
      type: getText(reasonEl, 'type'),
      comment: getText(reasonEl, 'comment')
    });
  }

  return reasons;
}

/**
 * Parse auth_results section
 * @param {Element} authEl - auth_results element
 * @returns {Object} Parsed auth results
 */
function parseAuthResults(authEl) {
  if (!authEl) return { dkim: [], spf: [] };

  const dkimResults = [];
  const spfResults = [];

  // Parse DKIM results
  const dkimEls = authEl.getElementsByTagName('dkim');
  for (const dkim of dkimEls) {
    dkimResults.push({
      domain: getText(dkim, 'domain'),
      selector: getText(dkim, 'selector'),
      result: getText(dkim, 'result'),
      humanResult: getText(dkim, 'human_result')
    });
  }

  // Parse SPF results
  const spfEls = authEl.getElementsByTagName('spf');
  for (const spf of spfEls) {
    spfResults.push({
      domain: getText(spf, 'domain'),
      scope: getText(spf, 'scope'),
      result: getText(spf, 'result')
    });
  }

  return { dkim: dkimResults, spf: spfResults };
}

/**
 * Parse identifiers section
 * @param {Element} idEl - identifiers element
 * @returns {Object} Parsed identifiers
 */
function parseIdentifiers(idEl) {
  if (!idEl) return null;

  return {
    envelopeTo: getText(idEl, 'envelope_to'),
    envelopeFrom: getText(idEl, 'envelope_from'),
    headerFrom: getText(idEl, 'header_from')
  };
}

/**
 * Parse a single record element
 * @param {Element} recordEl - record element
 * @param {Object} policy - Parsed policy for alignment checks
 * @param {Object} metadata - Report metadata for robustness checks
 * @returns {Object} Parsed record
 */
function parseRecord(recordEl, policy, metadata) {
  const rowEl = recordEl.getElementsByTagName('row')[0];
  const policyEvalEl = rowEl ? rowEl.getElementsByTagName('policy_evaluated')[0] : null;
  const identifiers = parseIdentifiers(recordEl.getElementsByTagName('identifiers')[0]);
  const authResults = parseAuthResults(recordEl.getElementsByTagName('auth_results')[0]);

  const policyEvaluated = policyEvalEl ? {
    disposition: getText(policyEvalEl, 'disposition'),
    dkim: getText(policyEvalEl, 'dkim'),
    spf: getText(policyEvalEl, 'spf'),
    reasons: parseReasons(policyEvalEl)
  } : null;

  // Build partial record for alignment computation
  const partialRecord = {
    sourceIp: rowEl ? getText(rowEl, 'source_ip') : null,
    count: rowEl ? getInt(rowEl, 'count') : 0,
    policyEvaluated,
    identifiers,
    authResults
  };

  // Compute full DMARC alignment
  const alignment = computeAlignment(partialRecord, policy);

  // Compute robustness signals
  const _robustness = computeRobustnessSignals(partialRecord, metadata);

  debugLog('parse', 'Parsed record', {
    sourceIp: partialRecord.sourceIp,
    count: partialRecord.count,
    dmarcPass: alignment.dmarcPass
  });

  return {
    ...partialRecord,
    alignment,
    _robustness
  };
}

/**
 * Parse DMARC aggregate report XML string
 * @param {string} xmlString - Raw XML string
 * @returns {Object} Parsed DMARC report
 */
function parseDmarcReport(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  // Check for parsing errors
  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new Error(`XML parsing failed: ${parseError.textContent}`);
  }

  const feedback = doc.getElementsByTagName('feedback')[0];
  if (!feedback) {
    throw new Error('Invalid DMARC report: missing feedback element');
  }

  // Parse all sections
  const metadata = parseMetadata(feedback.getElementsByTagName('report_metadata')[0]);
  const policy = parsePolicy(feedback.getElementsByTagName('policy_published')[0]);

  // Parse all record elements
  const recordEls = feedback.getElementsByTagName('record');
  const records = [];
  for (const recordEl of recordEls) {
    records.push(parseRecord(recordEl, policy, metadata));
  }

  // Calculate summary statistics
  let totalMessages = 0;
  let passedDkim = 0;
  let failedDkim = 0;
  let passedSpf = 0;
  let failedSpf = 0;
  let passedBoth = 0;
  let failedBoth = 0;
  let quarantined = 0;
  let rejected = 0;
  // New: DMARC alignment statistics
  let dmarcAligned = 0;
  let dmarcFailed = 0;

  for (const record of records) {
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

    // Track DMARC alignment (computed alignment, not just auth pass)
    if (record.alignment?.dmarcPass) {
      dmarcAligned += count;
    } else {
      dmarcFailed += count;
    }
  }

  debugLog('summary', 'Calculated summary', {
    totalMessages,
    dmarcAligned,
    dmarcFailed,
    passedBoth,
    failedBoth
  });

  return {
    version: getText(feedback, 'version'),
    metadata,
    policy,
    records,
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
      // New: DMARC alignment stats
      dmarcAligned,
      dmarcFailed,
      // Percentages
      dkimPassRate: totalMessages > 0 ? (passedDkim / totalMessages * 100) : 0,
      spfPassRate: totalMessages > 0 ? (passedSpf / totalMessages * 100) : 0,
      overallPassRate: totalMessages > 0 ? (passedBoth / totalMessages * 100) : 0,
      dmarcAlignedRate: totalMessages > 0 ? (dmarcAligned / totalMessages * 100) : 0
    }
  };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseDmarcReport,
    getOrganizationalDomain,
    domainsAlign,
    computeAlignment,
    computeRobustnessSignals,
    isDebugMode,
    FAILURE_REASONS,
    KNOWN_RECEIVERS,
    TWO_PART_TLDS
  };
}

/**
 * DMARC Report Reader - DMARC XML Parser
 * Parses DMARC aggregate report XML into structured JSON
 */

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
 * Check if there's an alignment mismatch
 * @param {Object} identifiers - Parsed identifiers
 * @param {Object} policy - Parsed policy
 * @returns {Object} Alignment status
 */
function checkAlignment(identifiers, policy) {
  if (!identifiers) return { headerEnvelopeMismatch: false };

  const headerFrom = identifiers.headerFrom?.toLowerCase();
  const envelopeFrom = identifiers.envelopeFrom?.toLowerCase();

  return {
    headerEnvelopeMismatch: headerFrom && envelopeFrom && headerFrom !== envelopeFrom
  };
}

/**
 * Parse a single record element
 * @param {Element} recordEl - record element
 * @param {Object} policy - Parsed policy for alignment checks
 * @returns {Object} Parsed record
 */
function parseRecord(recordEl, policy) {
  const rowEl = recordEl.getElementsByTagName('row')[0];
  const policyEvalEl = rowEl ? rowEl.getElementsByTagName('policy_evaluated')[0] : null;
  const identifiers = parseIdentifiers(recordEl.getElementsByTagName('identifiers')[0]);

  const policyEvaluated = policyEvalEl ? {
    disposition: getText(policyEvalEl, 'disposition'),
    dkim: getText(policyEvalEl, 'dkim'),
    spf: getText(policyEvalEl, 'spf'),
    reasons: parseReasons(policyEvalEl)
  } : null;

  return {
    sourceIp: rowEl ? getText(rowEl, 'source_ip') : null,
    count: rowEl ? getInt(rowEl, 'count') : 0,
    policyEvaluated,
    identifiers,
    authResults: parseAuthResults(recordEl.getElementsByTagName('auth_results')[0]),
    alignment: checkAlignment(identifiers, policy)
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
    records.push(parseRecord(recordEl, policy));
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
  }

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
      // Percentages
      dkimPassRate: totalMessages > 0 ? (passedDkim / totalMessages * 100) : 0,
      spfPassRate: totalMessages > 0 ? (passedSpf / totalMessages * 100) : 0,
      overallPassRate: totalMessages > 0 ? (passedBoth / totalMessages * 100) : 0
    }
  };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseDmarcReport };
}

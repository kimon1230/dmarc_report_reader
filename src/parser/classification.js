/**
 * DMARC Report Reader - Record Classification
 * Heuristic classification of DMARC records as likely spoof or misconfiguration
 */

// =============================================================================
// Classification Constants
// =============================================================================

/**
 * Classification result enum values
 * @constant {Object}
 */
const CLASSIFICATION = Object.freeze({
  LIKELY_SPOOF: 'likely_spoof',
  LIKELY_MISCONFIG: 'likely_legit_misconfig',
  UNKNOWN: 'unknown'
});

/**
 * Signal weights for classification scoring
 * Positive values lean toward spoof, negative toward misconfig
 * @constant {Object}
 */
const SIGNAL_WEIGHTS = Object.freeze({
  BOTH_AUTH_FAIL: { spoof: 3, misconfig: 0 },
  DKIM_PASS_SPF_FAIL: { spoof: 0, misconfig: 2 },
  SPF_PASS_DKIM_FAIL: { spoof: 0, misconfig: 2 },
  SPF_SOFTFAIL: { spoof: 0, misconfig: 1 },
  KNOWN_ESP: { spoof: 0, misconfig: 3 },
  ALIGNMENT_ONLY_FAIL: { spoof: 0, misconfig: 2 },
  HIGH_VOLUME_FAIL: { spoof: 1, misconfig: 0 },
  SINGLE_MESSAGE: { spoof: 0, misconfig: 1 }
});

/**
 * Volume threshold for high-volume failure detection
 * @constant {number}
 */
const HIGH_VOLUME_THRESHOLD = 100;

// =============================================================================
// Classification Logic
// =============================================================================

/**
 * Classify a DMARC record as likely spoof or misconfiguration
 * Uses weighted scoring based on multiple signals
 *
 * @param {Object} record - Parsed record with alignment data
 * @param {Object|null} providerInfo - ESP fingerprint from provider-fingerprint.js
 * @returns {Object} Classification result with classification, confidence, and signals
 */
function classifyRecord(record, providerInfo = null) {
  let spoofScore = 0;
  let misconfigScore = 0;
  const signals = [];

  const auth = record.authResults || { dkim: [], spf: [] };
  const alignment = record.alignment || {};
  const spfResult = auth.spf[0]?.result;

  // Signal 1: Both DKIM and SPF authentication fail
  if (!alignment.spfPassed && !alignment.dkimPassed) {
    spoofScore += SIGNAL_WEIGHTS.BOTH_AUTH_FAIL.spoof;
    misconfigScore += SIGNAL_WEIGHTS.BOTH_AUTH_FAIL.misconfig;
    signals.push('No authentication passed');
  }

  // Signal 2: DKIM passes but SPF fails
  // Common with third-party senders (SendGrid, Mailchimp, etc.) not in SPF
  if (alignment.dkimPassed && !alignment.spfPassed) {
    spoofScore += SIGNAL_WEIGHTS.DKIM_PASS_SPF_FAIL.spoof;
    misconfigScore += SIGNAL_WEIGHTS.DKIM_PASS_SPF_FAIL.misconfig;
    signals.push('DKIM passed but SPF failed (common with third-party senders)');
  }

  // Signal 2b: SPF passes but DKIM fails
  // Less common but indicates possible DKIM config issue
  if (alignment.spfPassed && !alignment.dkimPassed) {
    spoofScore += SIGNAL_WEIGHTS.SPF_PASS_DKIM_FAIL.spoof;
    misconfigScore += SIGNAL_WEIGHTS.SPF_PASS_DKIM_FAIL.misconfig;
    signals.push('SPF passed but DKIM failed (possible DKIM signing issue)');
  }

  // Signal 3: SPF softfail vs hard fail
  // Softfail (~all) indicates transitional SPF record
  if (spfResult === 'softfail') {
    spoofScore += SIGNAL_WEIGHTS.SPF_SOFTFAIL.spoof;
    misconfigScore += SIGNAL_WEIGHTS.SPF_SOFTFAIL.misconfig;
    signals.push('SPF softfail indicates transitional configuration');
  }

  // Signal 4: Known ESP provider detected
  // If IP is from a recognized ESP, likely legitimate sender with config issues
  if (providerInfo && providerInfo.id !== 'unknown') {
    spoofScore += SIGNAL_WEIGHTS.KNOWN_ESP.spoof;
    misconfigScore += SIGNAL_WEIGHTS.KNOWN_ESP.misconfig;
    signals.push(`Sent via known provider: ${providerInfo.name}`);
  }

  // Signal 5: Auth passes but alignment fails
  // This specifically indicates a domain alignment configuration issue
  if ((alignment.spfPassed || alignment.dkimPassed) && !alignment.dmarcPass) {
    spoofScore += SIGNAL_WEIGHTS.ALIGNMENT_ONLY_FAIL.spoof;
    misconfigScore += SIGNAL_WEIGHTS.ALIGNMENT_ONLY_FAIL.misconfig;
    signals.push('Authentication passed but alignment failed');
  }

  // Signal 6: High volume failures
  // Large volumes of unauthenticated mail from single IP more likely malicious
  if (record.count > HIGH_VOLUME_THRESHOLD && !alignment.dmarcPass) {
    spoofScore += SIGNAL_WEIGHTS.HIGH_VOLUME_FAIL.spoof;
    misconfigScore += SIGNAL_WEIGHTS.HIGH_VOLUME_FAIL.misconfig;
    signals.push(`High volume (${record.count}) of unauthenticated messages`);
  }

  // Signal 7: Single message failures
  // Single messages failing are often one-off misconfigs rather than sustained attack
  if (record.count === 1 && !alignment.dmarcPass) {
    spoofScore += SIGNAL_WEIGHTS.SINGLE_MESSAGE.spoof;
    misconfigScore += SIGNAL_WEIGHTS.SINGLE_MESSAGE.misconfig;
    signals.push('Single message failure (likely one-off issue)');
  }

  // Determine classification based on scores
  return determineClassification(spoofScore, misconfigScore, signals, alignment.dmarcPass);
}

/**
 * Determine final classification from scores
 * @param {number} spoofScore - Accumulated spoof score
 * @param {number} misconfigScore - Accumulated misconfig score
 * @param {string[]} signals - Explanatory signals
 * @param {boolean} dmarcPass - Whether DMARC passed
 * @returns {Object} Classification result
 */
function determineClassification(spoofScore, misconfigScore, signals, dmarcPass) {
  // If DMARC passed, no classification needed
  if (dmarcPass) {
    return {
      classification: CLASSIFICATION.UNKNOWN,
      confidence: 0,
      signals: ['DMARC passed - no classification needed']
    };
  }

  const totalScore = spoofScore + misconfigScore;

  // Need minimum score to make a determination
  if (totalScore < 2) {
    return {
      classification: CLASSIFICATION.UNKNOWN,
      confidence: 0,
      signals: signals.length > 0 ? signals : ['Insufficient signals for classification']
    };
  }

  let classification = CLASSIFICATION.UNKNOWN;
  let confidence = 0;

  if (spoofScore > misconfigScore) {
    classification = CLASSIFICATION.LIKELY_SPOOF;
    // Confidence based on score difference and total
    confidence = Math.min(90, 40 + (spoofScore - misconfigScore) * 15 + totalScore * 5);
  } else if (misconfigScore > spoofScore) {
    classification = CLASSIFICATION.LIKELY_MISCONFIG;
    confidence = Math.min(90, 40 + (misconfigScore - spoofScore) * 15 + totalScore * 5);
  } else if (totalScore >= 3) {
    // Tie with significant evidence - lean toward misconfig (safer assumption)
    classification = CLASSIFICATION.LIKELY_MISCONFIG;
    confidence = 40;
    signals.push('Tie-breaker: assuming misconfiguration (safer assumption)');
  }

  return { classification, confidence, signals };
}

/**
 * Get display properties for a classification
 * @param {string} classification - Classification value
 * @returns {Object} Display properties (label, badgeClass, icon)
 */
function getClassificationDisplay(classification) {
  switch (classification) {
    case CLASSIFICATION.LIKELY_SPOOF:
      return {
        label: 'Likely Spoof',
        badgeClass: 'classification-spoof',
        icon: '⚠️',
        description: 'This record has characteristics of a spoofing attempt'
      };
    case CLASSIFICATION.LIKELY_MISCONFIG:
      return {
        label: 'Likely Misconfig',
        badgeClass: 'classification-misconfig',
        icon: '🔧',
        description: 'This record appears to be from a legitimate sender with configuration issues'
      };
    case CLASSIFICATION.UNKNOWN:
    default:
      return {
        label: 'Unknown',
        badgeClass: 'classification-unknown',
        icon: '❓',
        description: 'Insufficient information to classify this record'
      };
  }
}

/**
 * Batch classify all records in a report
 * @param {Array} records - Array of parsed records
 * @param {Map} providerMap - Map of IP to provider info
 * @returns {Array} Records with _classification field added
 */
function classifyRecords(records, providerMap = new Map()) {
  return records.map(record => {
    const providerInfo = providerMap.get(record.sourceIp) || null;
    const classification = classifyRecord(record, providerInfo);

    return {
      ...record,
      _classification: classification
    };
  });
}

/**
 * Get classification statistics for a set of records
 * @param {Array} records - Array of records with _classification
 * @returns {Object} Classification statistics
 */
function getClassificationStats(records) {
  const stats = {
    totalFailing: 0,
    likelySpoof: { count: 0, messages: 0 },
    likelyMisconfig: { count: 0, messages: 0 },
    unknown: { count: 0, messages: 0 }
  };

  for (const record of records) {
    if (record.alignment?.dmarcPass) continue;

    stats.totalFailing++;
    const classification = record._classification?.classification || CLASSIFICATION.UNKNOWN;
    const msgCount = record.count || 0;

    switch (classification) {
      case CLASSIFICATION.LIKELY_SPOOF:
        stats.likelySpoof.count++;
        stats.likelySpoof.messages += msgCount;
        break;
      case CLASSIFICATION.LIKELY_MISCONFIG:
        stats.likelyMisconfig.count++;
        stats.likelyMisconfig.messages += msgCount;
        break;
      default:
        stats.unknown.count++;
        stats.unknown.messages += msgCount;
    }
  }

  return stats;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CLASSIFICATION,
    classifyRecord,
    classifyRecords,
    getClassificationDisplay,
    getClassificationStats
  };
}

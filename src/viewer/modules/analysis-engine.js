/**
 * DMARC Report Reader - Analysis Engine Module
 * Calculates enforcement readiness and top-N analysis metrics
 */

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
 * Calculate top-N analysis data from records
 * @param {Array} records - Array of record objects
 * @param {Map} ipGeoData - Map of IP to geo data
 * @returns {Object} Analysis with top senders, failures, countries, ASNs
 */
function calculateAnalysis(records, ipGeoData) {
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
    const geo = ipGeoData?.get(ip);
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
      geo: ipGeoData?.get(ip)
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
 * Calculate summary statistics from records
 * @param {Array} records - Array of record objects
 * @returns {Object} Summary statistics
 */
function calculateSummary(records) {
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
    const count = record.count || 0;
    totalMessages += count;

    const pe = record.policyEvaluated || {};
    const dkimPass = pe.dkim === 'pass';
    const spfPass = pe.spf === 'pass';

    if (dkimPass) {
      passedDkim += count;
    } else {
      failedDkim += count;
    }

    if (spfPass) {
      passedSpf += count;
    } else {
      failedSpf += count;
    }

    if (dkimPass && spfPass) {
      passedBoth += count;
    } else if (!dkimPass && !spfPass) {
      failedBoth += count;
    }

    if (pe.disposition === 'quarantine') {
      quarantined += count;
    } else if (pe.disposition === 'reject') {
      rejected += count;
    }
  }

  return {
    totalMessages,
    passedDkim,
    failedDkim,
    passedSpf,
    failedSpf,
    passedBoth,
    failedBoth,
    quarantined,
    rejected,
    dkimPassRate: totalMessages > 0 ? (passedDkim / totalMessages) * 100 : 0,
    spfPassRate: totalMessages > 0 ? (passedSpf / totalMessages) * 100 : 0,
    overallPassRate: totalMessages > 0 ? (passedBoth / totalMessages) * 100 : 0
  };
}

// Export for use in other modules (if in Node.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateEnforcementReadiness,
    calculateAnalysis,
    getUniqueIpCount,
    calculateSummary
  };
}

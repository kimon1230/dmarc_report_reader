/**
 * DMARC Report Reader - Diagnosis Engine Module
 * Provides error diagnosis and recommendations for DMARC records
 */

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
 * DKIM explanation messages by result type
 */
const DKIM_EXPLANATIONS = {
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

/**
 * SPF explanation messages by result type
 */
const SPF_EXPLANATIONS = {
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

/**
 * Get explanation and recommendation for a record's status
 * @param {Object} record - Record data
 * @param {Object} policy - Current report policy (for disposition override explanation)
 * @returns {Array} Array of issue objects containing explanations and recommendations
 */
function getRecordDiagnosis(record, policy) {
  const issues = [];
  const pe = record.policyEvaluated || {};
  const authResults = record.authResults || { dkim: [], spf: [] };
  const identifiers = record.identifiers || {};

  // Check DKIM status
  if (pe.dkim !== 'pass') {
    const dkimResults = authResults.dkim || [];
    const dkimResult = dkimResults[0]?.result || 'none';
    const diagnosis = DKIM_EXPLANATIONS[dkimResult] || DKIM_EXPLANATIONS['fail'];
    issues.push({ type: 'dkim', ...diagnosis });
  }

  // Check SPF status
  if (pe.spf !== 'pass') {
    const spfResults = authResults.spf || [];
    const spfResult = spfResults[0]?.result || 'none';
    const diagnosis = SPF_EXPLANATIONS[spfResult] || SPF_EXPLANATIONS['fail'];
    issues.push({ type: 'spf', ...diagnosis });
  }

  // Check alignment
  if (record.alignment?.headerEnvelopeMismatch) {
    // Escape domain values to prevent XSS when rendered as HTML
    const safeHeaderFrom = typeof escapeHtml === 'function'
      ? escapeHtml(identifiers.headerFrom)
      : identifiers.headerFrom || 'unknown';
    const safeEnvelopeFrom = typeof escapeHtml === 'function'
      ? escapeHtml(identifiers.envelopeFrom)
      : identifiers.envelopeFrom || 'unknown';
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
  const overrideExplanation = explainDispositionOverride(record, policy);
  if (overrideExplanation) {
    issues.push(overrideExplanation);
  }

  return issues;
}

/**
 * Render diagnosis section for a record
 * @param {Object} record - Record data
 * @param {Object} policy - Current report policy
 * @returns {string} HTML string for diagnosis
 */
function renderDiagnosis(record, policy) {
  const issues = getRecordDiagnosis(record, policy);

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
 * @param {Object} policy - Current report policy (for diagnosis)
 * @returns {string} HTML string for details
 */
function renderRecordDetails(record, policy) {
  const identifiers = record.identifiers || {};
  const authResults = record.authResults || { dkim: [], spf: [] };

  // Escape function (use global if available, otherwise basic escape)
  const escape = typeof escapeHtml === 'function' ? escapeHtml : (s) => {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
  const badge = typeof createBadge === 'function' ? createBadge : (s) => {
    const safe = escape(s);
    return `<span class="badge">${safe || '-'}</span>`;
  };

  // Escape all user-controlled values from DKIM results
  let dkimHtml = authResults.dkim.length > 0
    ? authResults.dkim.map(d => `
        <li>
          <span class="label">Signing Domain:</span> <strong>${escape(d.domain) || '-'}</strong>
        </li>
        <li>
          <span class="label">Selector:</span> ${escape(d.selector) || '-'}
        </li>
        <li>
          <span class="label">Result:</span> ${badge(d.result)}
        </li>
      `).join('')
    : '<li>No DKIM signature found</li>';

  // Escape all user-controlled values from SPF results
  let spfHtml = authResults.spf.length > 0
    ? authResults.spf.map(s => `
        <li>
          <span class="label">Checked Domain:</span> <strong>${escape(s.domain) || '-'}</strong>
        </li>
        <li>
          <span class="label">Scope:</span> ${escape(s.scope) || 'mfrom'}
        </li>
        <li>
          <span class="label">Result:</span> ${badge(s.result)}
        </li>
      `).join('')
    : '<li>No SPF check performed</li>';

  // Check for domain mismatches that affect alignment
  const headerFrom = identifiers.headerFrom || '';
  const dkimDomain = authResults.dkim[0]?.domain || '';
  const spfDomain = authResults.spf[0]?.domain || '';

  let alignmentNote = '';
  if (headerFrom && dkimDomain && !dkimDomain.endsWith(headerFrom) && !headerFrom.endsWith(dkimDomain)) {
    alignmentNote += `<div class="alignment-note">DKIM signed by <strong>${escape(dkimDomain)}</strong> but From header is <strong>${escape(headerFrom)}</strong> - may fail DKIM alignment</div>`;
  }
  if (headerFrom && spfDomain && !spfDomain.endsWith(headerFrom) && !headerFrom.endsWith(spfDomain)) {
    alignmentNote += `<div class="alignment-note">SPF checked for <strong>${escape(spfDomain)}</strong> but From header is <strong>${escape(headerFrom)}</strong> - may fail SPF alignment</div>`;
  }

  // Escape identifier values for display
  const safeHeaderFrom = escape(identifiers.headerFrom) || '-';
  const safeEnvelopeFrom = escape(identifiers.envelopeFrom) || '-';
  const safeEnvelopeTo = escape(identifiers.envelopeTo) || '-';

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
    ${renderDiagnosis(record, policy)}
  `;
}

// Export for use in other modules (if in Node.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    explainDispositionOverride,
    getRecordDiagnosis,
    renderDiagnosis,
    renderRecordDetails,
    DKIM_EXPLANATIONS,
    SPF_EXPLANATIONS
  };
}

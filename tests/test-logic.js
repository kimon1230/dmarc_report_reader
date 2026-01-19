/**
 * DMARC Report Reader - Node.js CLI Tests
 * Tests pure logic functions without DOM dependencies
 *
 * Run: node tests/test-logic.js
 */

// =============================================================================
// Test Framework (minimal, no dependencies)
// =============================================================================

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    \x1b[31m${err.message}\x1b[0m`);
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value, message = '') {
  if (!value) {
    throw new Error(`${message} Expected truthy value, got ${JSON.stringify(value)}`);
  }
}

function assertFalse(value, message = '') {
  if (value) {
    throw new Error(`${message} Expected falsy value, got ${JSON.stringify(value)}`);
  }
}

function assertDeepEqual(actual, expected, message = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// =============================================================================
// Load Modules
// =============================================================================

// Mock localStorage for Node.js (needed for debug mode tests)
global.localStorage = {
  _data: {},
  getItem(key) { return this._data[key] || null; },
  setItem(key, value) { this._data[key] = value; },
  removeItem(key) { delete this._data[key]; },
  clear() { this._data = {}; }
};

const {
  getOrganizationalDomain,
  domainsAlign,
  computeAlignment,
  computeRobustnessSignals,
  isDebugMode,
  FAILURE_REASONS,
  TWO_PART_TLDS,
  KNOWN_RECEIVERS
} = require('../src/parser/dmarc-parser.js');

const {
  CLASSIFICATION,
  classifyRecord,
  getClassificationDisplay
} = require('../src/parser/classification.js');

const {
  fingerprintProvider,
  PROVIDERS
} = require('../src/services/provider-fingerprint.js');

// =============================================================================
// Enforcement Readiness (extracted logic for testing)
// =============================================================================

function calculateEnforcementReadiness(records, policy) {
  const currentPolicy = policy?.policy || 'none';

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

  const alignedPercent = totalMessages > 0
    ? Math.round((alignedMessages / totalMessages) * 100)
    : 0;

  let status;
  if (currentPolicy === 'reject') {
    status = 'none';
  } else if (alignedPercent >= 98) {
    status = 'safe';
  } else if (alignedPercent >= 90) {
    status = 'caution';
  } else {
    status = 'not-ready';
  }

  return {
    currentPolicy,
    totalMessages,
    alignedMessages,
    failingSources,
    failingMessages,
    alignedPercent,
    status
  };
}

// =============================================================================
// Disposition Override Explanation (extracted logic for testing)
// =============================================================================

function explainDispositionOverride(record, policy) {
  if (!record || !policy) return null;

  const pe = record.policyEvaluated || {};
  const appliedDisposition = pe.disposition;
  const reason = pe.reason || [];

  const identifiers = record.identifiers || {};
  const headerFrom = identifiers.headerFrom || '';
  const policyDomain = policy.domain || '';

  const isSubdomain = headerFrom &&
    policyDomain &&
    headerFrom !== policyDomain &&
    headerFrom.endsWith('.' + policyDomain);

  const expectedPolicy = isSubdomain && policy.subdomainPolicy
    ? policy.subdomainPolicy
    : policy.policy;

  if (expectedPolicy === 'none') return null;
  if (appliedDisposition === expectedPolicy) return null;
  if (record.alignment?.dmarcPass) return null;

  const explanations = {
    forwarded: { title: 'Disposition Override: Message Forwarded' },
    mailing_list: { title: 'Disposition Override: Mailing List' },
    local_policy: { title: 'Disposition Override: Receiver Local Policy' },
    sampled_out: { title: 'Disposition Override: Sampling (pct)' },
    trusted_forwarder: { title: 'Disposition Override: Trusted Forwarder' },
    other: { title: 'Disposition Override' }
  };

  const reasonTypes = reason.map(r => r.type?.toLowerCase());

  let matchedExplanation = null;
  for (const reasonType of reasonTypes) {
    if (explanations[reasonType]) {
      matchedExplanation = explanations[reasonType];
      break;
    }
  }

  if (!matchedExplanation && appliedDisposition !== expectedPolicy) {
    if (policy.percentage !== null && policy.percentage < 100 && appliedDisposition === 'none') {
      matchedExplanation = explanations.sampled_out;
    } else {
      matchedExplanation = explanations.other;
    }
  }

  if (matchedExplanation) {
    return { type: 'override', ...matchedExplanation };
  }

  return null;
}

// =============================================================================
// Tests: Organizational Domain Extraction
// =============================================================================

console.log('\n\x1b[1mOrganizational Domain Extraction\x1b[0m');

test('simple domain returns as-is', () => {
  assertEqual(getOrganizationalDomain('example.com'), 'example.com');
});

test('subdomain extracts org domain', () => {
  assertEqual(getOrganizationalDomain('mail.example.com'), 'example.com');
});

test('deep subdomain extracts org domain', () => {
  assertEqual(getOrganizationalDomain('a.b.c.example.com'), 'example.com');
});

test('two-part TLD (co.uk) handled correctly', () => {
  assertEqual(getOrganizationalDomain('mail.example.co.uk'), 'example.co.uk');
});

test('two-part TLD (com.au) handled correctly', () => {
  assertEqual(getOrganizationalDomain('www.example.com.au'), 'example.com.au');
});

test('null input returns null', () => {
  assertEqual(getOrganizationalDomain(null), null);
});

test('empty string returns null', () => {
  assertEqual(getOrganizationalDomain(''), null);
});

test('case insensitive', () => {
  assertEqual(getOrganizationalDomain('MAIL.EXAMPLE.COM'), 'example.com');
});

// =============================================================================
// Tests: Domain Alignment
// =============================================================================

console.log('\n\x1b[1mDomain Alignment\x1b[0m');

test('exact match aligns in strict mode', () => {
  assertTrue(domainsAlign('example.com', 'example.com', 's'));
});

test('exact match aligns in relaxed mode', () => {
  assertTrue(domainsAlign('example.com', 'example.com', 'r'));
});

test('subdomain does not align in strict mode', () => {
  assertFalse(domainsAlign('mail.example.com', 'example.com', 's'));
});

test('subdomain aligns in relaxed mode', () => {
  assertTrue(domainsAlign('mail.example.com', 'example.com', 'r'));
});

test('parent domain aligns with subdomain in relaxed mode', () => {
  assertTrue(domainsAlign('example.com', 'mail.example.com', 'r'));
});

test('different domains do not align', () => {
  assertFalse(domainsAlign('example.com', 'other.com', 'r'));
});

test('null auth domain does not align', () => {
  assertFalse(domainsAlign(null, 'example.com', 'r'));
});

test('null header from does not align', () => {
  assertFalse(domainsAlign('example.com', null, 'r'));
});

test('defaults to relaxed mode', () => {
  assertTrue(domainsAlign('mail.example.com', 'example.com', null));
});

// =============================================================================
// Tests: DMARC Alignment Computation
// =============================================================================

console.log('\n\x1b[1mDMARC Alignment Computation\x1b[0m');

test('both DKIM and SPF pass with alignment', () => {
  const record = {
    policyEvaluated: { dkim: 'pass', spf: 'pass' },
    identifiers: { headerFrom: 'example.com' },
    authResults: {
      dkim: [{ domain: 'example.com', result: 'pass' }],
      spf: [{ domain: 'example.com', result: 'pass' }]
    }
  };
  const policy = { adkim: 'r', aspf: 'r' };
  const alignment = computeAlignment(record, policy);

  assertTrue(alignment.dmarcPass, 'DMARC should pass');
  assertTrue(alignment.dkimPassed, 'DKIM should pass');
  assertTrue(alignment.spfPassed, 'SPF should pass');
  assertEqual(alignment.primaryFailureReason, FAILURE_REASONS.NONE);
});

test('DKIM pass alone is sufficient for DMARC pass', () => {
  const record = {
    policyEvaluated: { dkim: 'pass', spf: 'fail' },
    identifiers: { headerFrom: 'example.com' },
    authResults: {
      dkim: [{ domain: 'example.com', result: 'pass' }],
      spf: [{ domain: 'other.com', result: 'fail' }]
    }
  };
  const policy = { adkim: 'r', aspf: 'r' };
  const alignment = computeAlignment(record, policy);

  assertTrue(alignment.dmarcPass, 'DMARC should pass with DKIM alone');
  assertTrue(alignment.dkimPassed);
  assertFalse(alignment.spfPassed);
});

test('SPF pass alone is sufficient for DMARC pass', () => {
  const record = {
    policyEvaluated: { dkim: 'fail', spf: 'pass' },
    identifiers: { headerFrom: 'example.com' },
    authResults: {
      dkim: [{ domain: 'other.com', result: 'fail' }],
      spf: [{ domain: 'example.com', result: 'pass' }]
    }
  };
  const policy = { adkim: 'r', aspf: 'r' };
  const alignment = computeAlignment(record, policy);

  assertTrue(alignment.dmarcPass, 'DMARC should pass with SPF alone');
  assertFalse(alignment.dkimPassed);
  assertTrue(alignment.spfPassed);
});

test('both fail results in DMARC fail', () => {
  const record = {
    policyEvaluated: { dkim: 'fail', spf: 'fail' },
    identifiers: { headerFrom: 'example.com' },
    authResults: {
      dkim: [{ domain: 'other.com', result: 'fail' }],
      spf: [{ domain: 'other.com', result: 'fail' }]
    }
  };
  const policy = { adkim: 'r', aspf: 'r' };
  const alignment = computeAlignment(record, policy);

  assertFalse(alignment.dmarcPass, 'DMARC should fail');
  assertEqual(alignment.primaryFailureReason, FAILURE_REASONS.BOTH_AUTH_FAIL);
});

test('strict DKIM mode rejects subdomain alignment', () => {
  const record = {
    policyEvaluated: { dkim: 'pass', spf: 'fail' },
    identifiers: { headerFrom: 'example.com' },
    authResults: {
      dkim: [{ domain: 'mail.example.com', result: 'pass' }],
      spf: []
    }
  };
  const policy = { adkim: 's', aspf: 'r' };
  const alignment = computeAlignment(record, policy);

  assertTrue(alignment.dkimPassed, 'DKIM auth should pass');
  assertFalse(alignment.dkimAligned, 'DKIM should not align in strict mode');
  assertFalse(alignment.dmarcPass, 'DMARC should fail without alignment');
});

// =============================================================================
// Tests: Classification Heuristics
// =============================================================================

console.log('\n\x1b[1mClassification Heuristics\x1b[0m');

test('passing record returns unknown classification', () => {
  const record = {
    count: 10,
    alignment: { dmarcPass: true, dkimPassed: true, spfPassed: true },
    authResults: { dkim: [], spf: [] }
  };
  const result = classifyRecord(record, null);
  assertEqual(result.classification, CLASSIFICATION.UNKNOWN);
});

test('both auth fail with no ESP leans toward spoof', () => {
  const record = {
    count: 50,
    alignment: { dmarcPass: false, dkimPassed: false, spfPassed: false },
    authResults: { dkim: [{ result: 'fail' }], spf: [{ result: 'fail' }] }
  };
  const result = classifyRecord(record, null);
  assertEqual(result.classification, CLASSIFICATION.LIKELY_SPOOF);
});

test('known ESP provider leans toward misconfiguration', () => {
  const record = {
    count: 10,
    alignment: { dmarcPass: false, dkimPassed: true, spfPassed: false },
    authResults: { dkim: [{ result: 'pass' }], spf: [{ result: 'fail' }] }
  };
  const providerInfo = { id: 'sendgrid', name: 'SendGrid', category: 'transactional' };
  const result = classifyRecord(record, providerInfo);
  assertEqual(result.classification, CLASSIFICATION.LIKELY_MISCONFIG);
  assertTrue(result.signals.some(s => s.includes('SendGrid')));
});

test('DKIM pass with SPF fail suggests misconfiguration', () => {
  const record = {
    count: 10,
    alignment: { dmarcPass: false, dkimPassed: true, spfPassed: false },
    authResults: { dkim: [{ result: 'pass' }], spf: [{ result: 'fail' }] }
  };
  const result = classifyRecord(record, null);
  assertEqual(result.classification, CLASSIFICATION.LIKELY_MISCONFIG);
});

test('SPF softfail adds misconfiguration signal', () => {
  const record = {
    count: 10,
    alignment: { dmarcPass: false, dkimPassed: false, spfPassed: false },
    authResults: { dkim: [], spf: [{ result: 'softfail' }] }
  };
  const result = classifyRecord(record, null);
  assertTrue(result.signals.some(s => s.includes('softfail')));
});

test('high volume failure adds spoof signal', () => {
  const record = {
    count: 500,
    alignment: { dmarcPass: false, dkimPassed: false, spfPassed: false },
    authResults: { dkim: [], spf: [{ result: 'fail' }] }
  };
  const result = classifyRecord(record, null);
  assertTrue(result.signals.some(s => s.includes('High volume')));
});

test('single message failure adds misconfiguration signal', () => {
  const record = {
    count: 1,
    alignment: { dmarcPass: false, dkimPassed: false, spfPassed: false },
    authResults: { dkim: [], spf: [{ result: 'fail' }] }
  };
  const result = classifyRecord(record, null);
  assertTrue(result.signals.some(s => s.includes('Single message')));
});

test('getClassificationDisplay returns correct labels', () => {
  const spoof = getClassificationDisplay(CLASSIFICATION.LIKELY_SPOOF);
  assertEqual(spoof.label, 'Likely Spoof');

  const misconfig = getClassificationDisplay(CLASSIFICATION.LIKELY_MISCONFIG);
  assertEqual(misconfig.label, 'Likely Misconfig');
});

// =============================================================================
// Tests: Provider Fingerprinting
// =============================================================================

console.log('\n\x1b[1mProvider Fingerprinting\x1b[0m');

test('identifies Google by ASN', () => {
  const geoData = { asn: 'AS15169', org: 'Google LLC', hostname: 'mail.google.com' };
  const result = fingerprintProvider(geoData);
  assertEqual(result.id, 'google');
  assertEqual(result.name, 'Google Workspace');
});

test('identifies Microsoft by hostname', () => {
  const geoData = { hostname: 'mail-abc.protection.outlook.com', org: 'Microsoft' };
  const result = fingerprintProvider(geoData);
  assertEqual(result.id, 'microsoft');
});

test('identifies Amazon SES by org pattern', () => {
  const geoData = { org: 'Amazon.com, Inc.', hostname: 'a1-2.smtp-out.amazonses.com' };
  const result = fingerprintProvider(geoData);
  assertEqual(result.id, 'amazon_ses');
});

test('identifies SendGrid by hostname', () => {
  const geoData = { hostname: 'o1.ptr1234.sendgrid.net' };
  const result = fingerprintProvider(geoData);
  assertEqual(result.id, 'sendgrid');
});

test('identifies Mailchimp by hostname', () => {
  const geoData = { hostname: 'mail123.mcsv.net' };
  const result = fingerprintProvider(geoData);
  assertEqual(result.id, 'mailchimp');
});

test('returns unknown for unrecognized provider', () => {
  const geoData = { hostname: 'mail.randomhost.xyz', org: 'Unknown ISP' };
  const result = fingerprintProvider(geoData);
  assertEqual(result.id, 'unknown');
});

test('handles null geoData', () => {
  const result = fingerprintProvider(null);
  assertEqual(result.id, 'unknown');
});

test('handles geoData with error', () => {
  const result = fingerprintProvider({ error: 'Rate limited' });
  assertEqual(result.id, 'unknown');
});

test('provider database has expected providers', () => {
  const providerIds = PROVIDERS.map(p => p.id);
  assertTrue(providerIds.includes('google'));
  assertTrue(providerIds.includes('microsoft'));
  assertTrue(providerIds.includes('amazon_ses'));
  assertTrue(providerIds.includes('sendgrid'));
  assertTrue(providerIds.includes('mailchimp'));
});

// =============================================================================
// Tests: Enforcement Readiness
// =============================================================================

console.log('\n\x1b[1mEnforcement Readiness\x1b[0m');

test('100% alignment returns safe status', () => {
  const records = [
    { count: 100, alignment: { dmarcPass: true } },
    { count: 50, alignment: { dmarcPass: true } }
  ];
  const policy = { policy: 'none' };
  const result = calculateEnforcementReadiness(records, policy);

  assertEqual(result.alignedPercent, 100);
  assertEqual(result.status, 'safe');
  assertEqual(result.totalMessages, 150);
  assertEqual(result.alignedMessages, 150);
});

test('98% alignment returns safe status', () => {
  const records = [
    { count: 98, alignment: { dmarcPass: true } },
    { count: 2, alignment: { dmarcPass: false } }
  ];
  const policy = { policy: 'none' };
  const result = calculateEnforcementReadiness(records, policy);

  assertEqual(result.alignedPercent, 98);
  assertEqual(result.status, 'safe');
});

test('95% alignment returns caution status', () => {
  const records = [
    { count: 95, alignment: { dmarcPass: true } },
    { count: 5, alignment: { dmarcPass: false } }
  ];
  const policy = { policy: 'none' };
  const result = calculateEnforcementReadiness(records, policy);

  assertEqual(result.alignedPercent, 95);
  assertEqual(result.status, 'caution');
});

test('80% alignment returns not-ready status', () => {
  const records = [
    { count: 80, alignment: { dmarcPass: true } },
    { count: 20, alignment: { dmarcPass: false } }
  ];
  const policy = { policy: 'none' };
  const result = calculateEnforcementReadiness(records, policy);

  assertEqual(result.alignedPercent, 80);
  assertEqual(result.status, 'not-ready');
});

test('reject policy returns none status', () => {
  const records = [
    { count: 100, alignment: { dmarcPass: true } }
  ];
  const policy = { policy: 'reject' };
  const result = calculateEnforcementReadiness(records, policy);

  assertEqual(result.status, 'none');
  assertEqual(result.currentPolicy, 'reject');
});

test('counts failing sources correctly', () => {
  const records = [
    { count: 100, alignment: { dmarcPass: true } },
    { count: 5, alignment: { dmarcPass: false } },
    { count: 3, alignment: { dmarcPass: false } },
    { count: 2, alignment: { dmarcPass: false } }
  ];
  const policy = { policy: 'none' };
  const result = calculateEnforcementReadiness(records, policy);

  assertEqual(result.failingSources, 3);
  assertEqual(result.failingMessages, 10);
});

test('empty records returns 0% alignment', () => {
  const result = calculateEnforcementReadiness([], { policy: 'none' });
  assertEqual(result.alignedPercent, 0);
  assertEqual(result.totalMessages, 0);
});

test('handles missing policy', () => {
  const records = [{ count: 100, alignment: { dmarcPass: true } }];
  const result = calculateEnforcementReadiness(records, null);
  assertEqual(result.currentPolicy, 'none');
});

// =============================================================================
// Tests: Robustness Signals
// =============================================================================

console.log('\n\x1b[1mRobustness Signals\x1b[0m');

test('high confidence with complete auth results', () => {
  const record = {
    sourceIp: '192.0.2.1',
    authResults: {
      dkim: [{ domain: 'example.com', result: 'pass' }],
      spf: [{ domain: 'example.com', result: 'pass' }]
    }
  };
  const metadata = { email: 'postmaster@unknown.com' };
  const signals = computeRobustnessSignals(record, metadata);

  assertEqual(signals.confidence, 'high');
  assertFalse(signals.missingAuthResults);
  assertFalse(signals.incompleteDkim);
  assertFalse(signals.incompleteSpf);
});

test('low confidence when auth_results missing', () => {
  const record = {
    sourceIp: '192.0.2.1',
    authResults: { dkim: [], spf: [] }
  };
  const signals = computeRobustnessSignals(record, {});

  assertEqual(signals.confidence, 'low');
  assertTrue(signals.missingAuthResults);
});

test('medium confidence with incomplete DKIM', () => {
  const record = {
    sourceIp: '192.0.2.1',
    authResults: {
      dkim: [{ result: 'pass' }],  // missing domain
      spf: [{ domain: 'example.com', result: 'pass' }]
    }
  };
  const signals = computeRobustnessSignals(record, {});

  assertEqual(signals.confidence, 'medium');
  assertTrue(signals.incompleteDkim);
});

test('medium confidence with incomplete SPF', () => {
  const record = {
    sourceIp: '192.0.2.1',
    authResults: {
      dkim: [{ domain: 'example.com', result: 'pass' }],
      spf: [{ result: 'pass' }]  // missing domain
    }
  };
  const signals = computeRobustnessSignals(record, {});

  assertEqual(signals.confidence, 'medium');
  assertTrue(signals.incompleteSpf);
});

test('detects Google as known receiver', () => {
  const record = {
    sourceIp: '192.0.2.1',
    authResults: { dkim: [], spf: [] }
  };
  const metadata = { email: 'noreply-dmarc-support@google.com' };
  const signals = computeRobustnessSignals(record, metadata);

  assertEqual(signals.receiverName, 'Google');
  assertTrue(signals.receiverQuirks.length > 0);
});

test('detects Microsoft as known receiver', () => {
  const record = {
    sourceIp: '192.0.2.1',
    authResults: { dkim: [{ domain: 'test.com', result: 'pass' }], spf: [] }
  };
  const metadata = { email: 'dmarcreport@microsoft.com' };
  const signals = computeRobustnessSignals(record, metadata);

  assertEqual(signals.receiverName, 'Microsoft');
});

test('KNOWN_RECEIVERS includes major providers', () => {
  assertTrue('google.com' in KNOWN_RECEIVERS);
  assertTrue('microsoft.com' in KNOWN_RECEIVERS);
  assertTrue('yahoo.com' in KNOWN_RECEIVERS);
});

// =============================================================================
// Tests: Disposition Override Explanation
// =============================================================================

console.log('\n\x1b[1mDisposition Override Explanation\x1b[0m');

test('returns null when policy is none', () => {
  const record = {
    policyEvaluated: { disposition: 'none' },
    identifiers: { headerFrom: 'example.com' }
  };
  const policy = { policy: 'none', domain: 'example.com' };
  const result = explainDispositionOverride(record, policy);
  assertEqual(result, null);
});

test('returns null when disposition matches policy', () => {
  const record = {
    policyEvaluated: { disposition: 'reject' },
    identifiers: { headerFrom: 'example.com' },
    alignment: { dmarcPass: false }
  };
  const policy = { policy: 'reject', domain: 'example.com' };
  const result = explainDispositionOverride(record, policy);
  assertEqual(result, null);
});

test('returns null when DMARC passes', () => {
  const record = {
    policyEvaluated: { disposition: 'none' },
    identifiers: { headerFrom: 'example.com' },
    alignment: { dmarcPass: true }
  };
  const policy = { policy: 'reject', domain: 'example.com' };
  const result = explainDispositionOverride(record, policy);
  assertEqual(result, null);
});

test('detects forwarded override', () => {
  const record = {
    policyEvaluated: { disposition: 'none', reason: [{ type: 'forwarded' }] },
    identifiers: { headerFrom: 'example.com' },
    alignment: { dmarcPass: false }
  };
  const policy = { policy: 'reject', domain: 'example.com' };
  const result = explainDispositionOverride(record, policy);

  assertEqual(result.type, 'override');
  assertTrue(result.title.includes('Forwarded'));
});

test('detects mailing list override', () => {
  const record = {
    policyEvaluated: { disposition: 'none', reason: [{ type: 'mailing_list' }] },
    identifiers: { headerFrom: 'example.com' },
    alignment: { dmarcPass: false }
  };
  const policy = { policy: 'quarantine', domain: 'example.com' };
  const result = explainDispositionOverride(record, policy);

  assertEqual(result.type, 'override');
  assertTrue(result.title.includes('Mailing List'));
});

test('detects local policy override', () => {
  const record = {
    policyEvaluated: { disposition: 'none', reason: [{ type: 'local_policy' }] },
    identifiers: { headerFrom: 'example.com' },
    alignment: { dmarcPass: false }
  };
  const policy = { policy: 'reject', domain: 'example.com' };
  const result = explainDispositionOverride(record, policy);

  assertEqual(result.type, 'override');
  assertTrue(result.title.includes('Local Policy'));
});

test('detects sampling override when pct < 100', () => {
  const record = {
    policyEvaluated: { disposition: 'none', reason: [] },
    identifiers: { headerFrom: 'example.com' },
    alignment: { dmarcPass: false }
  };
  const policy = { policy: 'reject', domain: 'example.com', percentage: 50 };
  const result = explainDispositionOverride(record, policy);

  assertEqual(result.type, 'override');
  assertTrue(result.title.includes('Sampling'));
});

test('uses subdomain policy when applicable', () => {
  const record = {
    policyEvaluated: { disposition: 'none', reason: [] },
    identifiers: { headerFrom: 'sub.example.com' },
    alignment: { dmarcPass: false }
  };
  const policy = { policy: 'none', subdomainPolicy: 'reject', domain: 'example.com' };
  const result = explainDispositionOverride(record, policy);

  // subdomainPolicy is 'reject' but disposition is 'none', so override detected
  assertEqual(result.type, 'override');
});

test('returns other for unknown override reason', () => {
  const record = {
    policyEvaluated: { disposition: 'none', reason: [] },
    identifiers: { headerFrom: 'example.com' },
    alignment: { dmarcPass: false }
  };
  const policy = { policy: 'reject', domain: 'example.com', percentage: 100 };
  const result = explainDispositionOverride(record, policy);

  assertEqual(result.type, 'override');
  assertEqual(result.title, 'Disposition Override');
});

// =============================================================================
// Tests: Debug Mode
// =============================================================================

console.log('\n\x1b[1mDebug Mode\x1b[0m');

test('debug mode disabled by default', () => {
  localStorage.clear();
  assertFalse(isDebugMode());
});

test('debug mode enabled via localStorage', () => {
  localStorage.setItem('dmarcDebugMode', 'true');
  assertTrue(isDebugMode());
  localStorage.clear();
});

test('debug mode disabled when set to false', () => {
  localStorage.setItem('dmarcDebugMode', 'false');
  assertFalse(isDebugMode());
  localStorage.clear();
});

test('debug mode disabled for non-true values', () => {
  localStorage.setItem('dmarcDebugMode', 'yes');
  assertFalse(isDebugMode());
  localStorage.clear();
});

// =============================================================================
// Summary
// =============================================================================

console.log('\n' + '='.repeat(60));
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mAll ${passed} tests passed!\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m${failed} of ${passed + failed} tests failed\x1b[0m`);
  console.log('\nFailures:');
  failures.forEach(f => {
    console.log(`  - ${f.name}: ${f.error}`);
  });
}
console.log('='.repeat(60) + '\n');

process.exit(failed > 0 ? 1 : 0);

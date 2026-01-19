/**
 * DMARC Report Reader - Provider/ESP Fingerprinting
 * Identifies known email service providers from IP geolocation data
 */

// =============================================================================
// Provider Database
// =============================================================================

/**
 * Known email service providers and their identifying patterns
 * Each provider has patterns for ASN, hostname, and organization name
 * @constant {Array}
 */
const PROVIDERS = Object.freeze([
  {
    id: 'google',
    name: 'Google Workspace',
    category: 'enterprise',
    patterns: {
      asn: ['AS15169', 'AS396982'],
      hostname: [/\.google\.com$/, /\.googlemail\.com$/, /\.goog$/],
      org: [/^Google/i]
    }
  },
  {
    id: 'microsoft',
    name: 'Microsoft 365',
    category: 'enterprise',
    patterns: {
      asn: ['AS8075', 'AS8068'],
      hostname: [/\.outlook\.com$/, /\.hotmail\.com$/, /protection\.outlook\.com$/],
      org: [/^Microsoft/i]
    }
  },
  {
    id: 'amazon_ses',
    name: 'Amazon SES',
    category: 'transactional',
    patterns: {
      asn: ['AS16509', 'AS14618'],
      hostname: [/\.amazonaws\.com$/, /\.amazonses\.com$/],
      org: [/^Amazon/i, /^AWS/i, /^AMAZON/]
    }
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    category: 'transactional',
    patterns: {
      asn: ['AS11377'],
      hostname: [/\.sendgrid\.net$/, /\.sendgrid\.com$/],
      org: [/SendGrid/i, /Twilio/i]
    }
  },
  {
    id: 'mailgun',
    name: 'Mailgun',
    category: 'transactional',
    patterns: {
      hostname: [/\.mailgun\.org$/, /\.mailgun\.net$/],
      org: [/Mailgun/i, /Rackspace/i, /Sinch/i]
    }
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    category: 'marketing',
    patterns: {
      hostname: [/\.mcsv\.net$/, /\.mcdlv\.net$/, /\.mailchimp\.com$/, /\.rsgsv\.net$/],
      org: [/Mailchimp/i, /The Rocket Science Group/i, /Intuit/i]
    }
  },
  {
    id: 'postmark',
    name: 'Postmark',
    category: 'transactional',
    patterns: {
      hostname: [/\.postmarkapp\.com$/, /\.mtasv\.net$/],
      org: [/Postmark/i, /Wildbit/i, /ActiveCampaign/i]
    }
  },
  {
    id: 'sparkpost',
    name: 'SparkPost',
    category: 'transactional',
    patterns: {
      hostname: [/\.sparkpostmail\.com$/, /\.e\.sparkpost\.com$/],
      org: [/SparkPost/i, /Message Systems/i, /MessageBird/i]
    }
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    category: 'enterprise',
    patterns: {
      hostname: [/\.zoho\.com$/, /\.zohomail\.com$/, /\.zohocorp\.com$/],
      org: [/Zoho/i]
    }
  },
  {
    id: 'fastmail',
    name: 'Fastmail',
    category: 'enterprise',
    patterns: {
      hostname: [/\.fastmail\.com$/, /\.messagingengine\.com$/, /\.fastmail\.fm$/],
      org: [/Fastmail/i, /Messagingengine/i]
    }
  },
  {
    id: 'mailjet',
    name: 'Mailjet',
    category: 'transactional',
    patterns: {
      hostname: [/\.mailjet\.com$/],
      org: [/Mailjet/i, /Mailgun/i, /Sinch/i]
    }
  },
  {
    id: 'sendinblue',
    name: 'Brevo (Sendinblue)',
    category: 'marketing',
    patterns: {
      hostname: [/\.sendinblue\.com$/, /\.brevo\.com$/],
      org: [/Sendinblue/i, /Brevo/i]
    }
  },
  {
    id: 'constantcontact',
    name: 'Constant Contact',
    category: 'marketing',
    patterns: {
      hostname: [/\.constantcontact\.com$/, /\.ccsend\.com$/],
      org: [/Constant Contact/i]
    }
  },
  {
    id: 'campaignmonitor',
    name: 'Campaign Monitor',
    category: 'marketing',
    patterns: {
      hostname: [/\.createsend\.com$/, /\.cmail[0-9]+\.com$/],
      org: [/Campaign Monitor/i]
    }
  },
  {
    id: 'yahoo',
    name: 'Yahoo Mail',
    category: 'consumer',
    patterns: {
      asn: ['AS36647', 'AS36646'],
      hostname: [/\.yahoo\.com$/, /\.yahoodns\.net$/],
      org: [/Yahoo/i, /Oath/i, /Verizon Media/i]
    }
  },
  {
    id: 'protonmail',
    name: 'Proton Mail',
    category: 'enterprise',
    patterns: {
      hostname: [/\.protonmail\.ch$/, /\.proton\.me$/],
      org: [/Proton/i]
    }
  },
  {
    id: 'ovh',
    name: 'OVH',
    category: 'hosting',
    patterns: {
      asn: ['AS16276'],
      hostname: [/\.ovh\.net$/, /\.ovh\.com$/],
      org: [/^OVH/i]
    }
  },
  {
    id: 'godaddy',
    name: 'GoDaddy',
    category: 'hosting',
    patterns: {
      asn: ['AS26496', 'AS44273'],
      hostname: [/\.secureserver\.net$/, /\.godaddy\.com$/],
      org: [/GoDaddy/i]
    }
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'infrastructure',
    patterns: {
      asn: ['AS13335'],
      hostname: [/\.cloudflare\.com$/],
      org: [/Cloudflare/i]
    }
  }
]);

/**
 * Category descriptions for provider types
 * @constant {Object}
 */
const CATEGORY_INFO = Object.freeze({
  enterprise: { label: 'Enterprise', description: 'Business email service' },
  transactional: { label: 'Transactional', description: 'Transactional email service' },
  marketing: { label: 'Marketing', description: 'Email marketing platform' },
  consumer: { label: 'Consumer', description: 'Consumer email service' },
  hosting: { label: 'Hosting', description: 'Web hosting provider' },
  infrastructure: { label: 'Infrastructure', description: 'Cloud/CDN infrastructure' }
});

// =============================================================================
// Fingerprinting Functions
// =============================================================================

/**
 * Fingerprint a provider from IP geolocation data
 * Matches against ASN, hostname, and organization patterns
 *
 * @param {Object} geoData - Geolocation data from ip-lookup.js
 * @returns {Object} Provider info { id, name, category } or { id: 'unknown', name: 'Unknown' }
 */
function fingerprintProvider(geoData) {
  if (!geoData || geoData.error) {
    return { id: 'unknown', name: 'Unknown', category: null };
  }

  for (const provider of PROVIDERS) {
    const { asn, hostname, org } = provider.patterns;

    // Check ASN match
    if (asn && geoData.asn) {
      for (const pattern of asn) {
        if (geoData.asn.includes(pattern)) {
          return {
            id: provider.id,
            name: provider.name,
            category: provider.category
          };
        }
      }
    }

    // Check hostname match (reverse DNS)
    if (hostname && geoData.hostname) {
      for (const pattern of hostname) {
        if (pattern.test(geoData.hostname)) {
          return {
            id: provider.id,
            name: provider.name,
            category: provider.category
          };
        }
      }
    }

    // Check org match
    if (org && geoData.org) {
      for (const pattern of org) {
        if (pattern.test(geoData.org)) {
          return {
            id: provider.id,
            name: provider.name,
            category: provider.category
          };
        }
      }
    }
  }

  return { id: 'unknown', name: 'Unknown', category: null };
}

/**
 * Batch fingerprint providers for multiple IPs
 * @param {Map} geoDataMap - Map of IP to geolocation data
 * @returns {Map} Map of IP to provider info
 */
function fingerprintProviders(geoDataMap) {
  const providerMap = new Map();

  for (const [ip, geoData] of geoDataMap.entries()) {
    providerMap.set(ip, fingerprintProvider(geoData));
  }

  return providerMap;
}

/**
 * Get category info for a provider category
 * @param {string} category - Category ID
 * @returns {Object} Category info { label, description }
 */
function getCategoryInfo(category) {
  return CATEGORY_INFO[category] || { label: 'Unknown', description: '' };
}

/**
 * Get all unique providers from a set of records
 * @param {Array} records - Array of records with _provider data
 * @returns {Array} Array of unique provider objects sorted by count
 */
function getUniqueProviders(records) {
  const providerCounts = new Map();

  for (const record of records) {
    const provider = record._provider;
    if (provider && provider.id !== 'unknown') {
      const existing = providerCounts.get(provider.id) || { ...provider, count: 0, messages: 0 };
      existing.count++;
      existing.messages += record.count || 0;
      providerCounts.set(provider.id, existing);
    }
  }

  return [...providerCounts.values()]
    .sort((a, b) => b.messages - a.messages);
}

/**
 * Get provider statistics for failing records
 * @param {Array} records - Array of records with _provider and alignment data
 * @returns {Object} Stats { totalFailing, providerBreakdown }
 */
function getProviderFailureStats(records) {
  const stats = {
    totalFailing: 0,
    knownProviderFailing: 0,
    unknownFailing: 0,
    providerBreakdown: new Map()
  };

  for (const record of records) {
    if (!record.alignment?.dmarcPass) {
      stats.totalFailing++;
      const provider = record._provider;

      if (provider && provider.id !== 'unknown') {
        stats.knownProviderFailing++;
        const existing = stats.providerBreakdown.get(provider.id) || {
          name: provider.name,
          count: 0,
          messages: 0
        };
        existing.count++;
        existing.messages += record.count || 0;
        stats.providerBreakdown.set(provider.id, existing);
      } else {
        stats.unknownFailing++;
      }
    }
  }

  return stats;
}

// =============================================================================
// Exports
// =============================================================================

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PROVIDERS,
    CATEGORY_INFO,
    fingerprintProvider,
    fingerprintProviders,
    getCategoryInfo,
    getUniqueProviders,
    getProviderFailureStats
  };
}

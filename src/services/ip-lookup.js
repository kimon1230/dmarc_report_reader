/**
 * DMARC Report Reader - IP Lookup Service
 * Fetches geolocation and reverse DNS data for IP addresses using ip-api.com
 *
 * Features:
 * - Session-persistent cache using chrome.storage.session
 * - Batch API calls for efficiency
 * - Rate limiting (45 req/min for ip-api.com free tier)
 */

/**
 * In-memory cache for current session (fallback and fast access)
 * @type {Map<string, Object>}
 */
const ipCache = new Map();

/**
 * Storage key for session cache
 * @constant {string}
 */
const IP_CACHE_STORAGE_KEY = 'ipLookupCache';

/**
 * Cache TTL in milliseconds (24 hours)
 * @constant {number}
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Maximum cache entries to prevent storage quota issues
 * @constant {number}
 */
const MAX_CACHE_ENTRIES = 5000;

/**
 * Load cache from chrome.storage.session into memory
 * @returns {Promise<void>}
 */
async function loadCacheFromStorage() {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {
    return; // Not in extension context
  }

  try {
    const result = await chrome.storage.session.get(IP_CACHE_STORAGE_KEY);
    const stored = result[IP_CACHE_STORAGE_KEY];

    if (stored && Array.isArray(stored)) {
      const now = Date.now();
      for (const [ip, entry] of stored) {
        // Only load non-expired entries
        if (entry.timestamp && (now - entry.timestamp) < CACHE_TTL_MS) {
          ipCache.set(ip, entry.data);
        }
      }
    }
  } catch (err) {
    // Silently fail - cache is just an optimization
    console.warn('IP Lookup: Failed to load cache from storage:', err.message);
  }
}

/**
 * Save current cache to chrome.storage.session
 * @returns {Promise<void>}
 */
async function saveCacheToStorage() {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {
    return;
  }

  try {
    const entries = [];
    const now = Date.now();

    // Convert to array format with timestamps
    for (const [ip, data] of ipCache.entries()) {
      entries.push([ip, { data, timestamp: now }]);
    }

    // Limit size to prevent quota issues
    const trimmed = entries.slice(-MAX_CACHE_ENTRIES);

    await chrome.storage.session.set({ [IP_CACHE_STORAGE_KEY]: trimmed });
  } catch (err) {
    console.warn('IP Lookup: Failed to save cache to storage:', err.message);
  }
}

// Initialize cache from storage on module load
loadCacheFromStorage();

/**
 * Country code to flag emoji mapping
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
 * Lookup a single IP address
 * @param {string} ip - IP address to lookup
 * @returns {Promise<Object>} Geolocation data
 */
async function lookupIp(ip) {
  if (ipCache.has(ip)) {
    return ipCache.get(ip);
  }

  try {
    const response = await fetch(
      `https://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp,org,as,reverse`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'fail') {
      const result = { error: true, ip };
      ipCache.set(ip, result);
      return result;
    }

    const result = {
      ip,
      country: data.country,
      countryCode: data.countryCode,
      flag: countryCodeToFlag(data.countryCode),
      city: data.city,
      isp: data.isp,
      org: data.org,
      asn: data.as,
      hostname: data.reverse || null
    };

    ipCache.set(ip, result);
    return result;
  } catch (err) {
    console.error(`IP lookup failed for ${ip}:`, err);
    const result = { error: true, ip, message: err.message };
    ipCache.set(ip, result);
    return result;
  }
}

/**
 * Lookup multiple IP addresses with rate limiting
 * ip-api.com allows 45 requests per minute for free tier
 * @param {string[]} ips - Array of IP addresses
 * @param {Function} onProgress - Callback for progress updates
 * @returns {Promise<Map<string, Object>>} Map of IP to geolocation data
 */
async function lookupIps(ips, onProgress) {
  const uniqueIps = [...new Set(ips)];
  const results = new Map();
  const uncachedIps = uniqueIps.filter(ip => !ipCache.has(ip));

  for (const ip of uniqueIps) {
    if (ipCache.has(ip)) {
      results.set(ip, ipCache.get(ip));
    }
  }

  if (uncachedIps.length === 0) {
    return results;
  }

  const batchSize = 100;
  for (let i = 0; i < uncachedIps.length; i += batchSize) {
    const batch = uncachedIps.slice(i, i + batchSize);

    try {
      const response = await fetch(
        'https://ip-api.com/batch?fields=status,query,country,countryCode,city,isp,org,as,reverse',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch)
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      for (const item of data) {
        const ip = item.query;
        let result;

        if (item.status === 'fail') {
          result = { error: true, ip };
        } else {
          result = {
            ip,
            country: item.country,
            countryCode: item.countryCode,
            flag: countryCodeToFlag(item.countryCode),
            city: item.city,
            isp: item.isp,
            org: item.org,
            asn: item.as,
            hostname: item.reverse || null
          };
        }

        ipCache.set(ip, result);
        results.set(ip, result);
      }

      if (onProgress) {
        onProgress(Math.min(i + batchSize, uncachedIps.length), uncachedIps.length);
      }
    } catch (err) {
      console.error('Batch IP lookup failed:', err);
      for (const ip of batch) {
        const result = { error: true, ip, message: err.message };
        ipCache.set(ip, result);
        results.set(ip, result);
      }
    }

    if (i + batchSize < uncachedIps.length) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // Persist cache to session storage after lookups complete
  saveCacheToStorage();

  return results;
}

/**
 * Format location string from IP lookup result
 * @param {Object} geo - Geolocation data
 * @returns {string} Formatted location string
 */
function formatLocation(geo) {
  if (!geo || geo.error) {
    return 'Unknown';
  }

  const parts = [];
  if (geo.flag) parts.push(geo.flag);
  if (geo.city) parts.push(geo.city);
  if (geo.country) parts.push(geo.country);

  return parts.join(' ') || 'Unknown';
}

/**
 * Format ISP/ASN string from IP lookup result
 * @param {Object} geo - Geolocation data
 * @returns {string} Formatted ISP/ASN string
 */
function formatIsp(geo) {
  if (!geo || geo.error) {
    return 'Unknown';
  }

  if (geo.asn) {
    return geo.asn;
  }

  return geo.isp || geo.org || 'Unknown';
}

/**
 * Format hostname from IP lookup result
 * @param {Object} geo - Geolocation data
 * @returns {string} Hostname or empty string
 */
function formatHostname(geo) {
  if (!geo || geo.error || !geo.hostname) {
    return '';
  }
  return geo.hostname;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lookupIp, lookupIps, formatLocation, formatIsp, formatHostname };
}

/**
 * DMARC Report Reader - IP Lookup Service
 * Fetches geolocation data for IP addresses using ip-api.com
 */

/**
 * Cache for IP lookup results to avoid redundant API calls
 */
const ipCache = new Map();

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
  // Check cache first
  if (ipCache.has(ip)) {
    return ipCache.get(ip);
  }

  try {
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp,org,as`);

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
      asn: data.as
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

  // Return cached results for already-looked-up IPs
  for (const ip of uniqueIps) {
    if (ipCache.has(ip)) {
      results.set(ip, ipCache.get(ip));
    }
  }

  if (uncachedIps.length === 0) {
    return results;
  }

  // Use batch endpoint for efficiency (up to 100 IPs per request)
  const batchSize = 100;
  for (let i = 0; i < uncachedIps.length; i += batchSize) {
    const batch = uncachedIps.slice(i, i + batchSize);

    try {
      const response = await fetch('http://ip-api.com/batch?fields=status,query,country,countryCode,city,isp,org,as', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch)
      });

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
            asn: item.as
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
      // Fall back to marking all as errors
      for (const ip of batch) {
        const result = { error: true, ip, message: err.message };
        ipCache.set(ip, result);
        results.set(ip, result);
      }
    }

    // Rate limiting: wait 1.5 seconds between batches to stay under 45 req/min
    if (i + batchSize < uncachedIps.length) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

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

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lookupIp, lookupIps, formatLocation, formatIsp };
}

/**
 * DMARC Report Reader - Filter Engine Module
 * Handles record filtering and sorting logic
 */

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
 * Check if an IP matches the filter (prefix match or CIDR)
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
 * Filter records based on filter state
 * Applies all active filters with AND logic
 * @param {Array} records - Array of record objects
 * @param {Object} filterState - Current filter state
 * @param {Map} ipGeoData - Map of IP to geo data
 * @returns {Array} Filtered records
 */
function filterRecords(records, filterState, ipGeoData) {
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
 * @param {Object} filterState - Current filter state
 * @returns {number} Number of non-default filter values
 */
function countActiveFilters(filterState) {
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
 * Sort records based on sort setting
 * @param {Array} records - Array of record objects
 * @param {string} sortType - Sort type (count-desc, count-asc, ip)
 * @returns {Array} Sorted records (new array)
 */
function sortRecords(records, sortType) {
  const sorted = [...records];

  switch (sortType) {
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
 * Create default filter state object
 * @returns {Object} Default filter state
 */
function createDefaultFilterState() {
  return {
    status: 'all',
    domain: '',
    ip: '',
    country: '',
    minCount: 0,
    hostname: '',
    classification: '',
    provider: ''
  };
}

// Export for use in other modules (if in Node.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ipToInt,
    isIpInCidr,
    matchesIpFilter,
    filterRecords,
    countActiveFilters,
    sortRecords,
    createDefaultFilterState
  };
}

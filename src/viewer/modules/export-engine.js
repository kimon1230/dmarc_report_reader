/**
 * DMARC Report Reader - Export Engine Module
 * Handles JSON and CSV export functionality
 */

/**
 * Export report data as JSON
 * @param {Object} report - Full report object
 * @param {Array} filteredRecords - Records after filtering
 * @param {Object} filterState - Current filter state
 * @param {Object} analysis - Analysis data
 * @returns {string} JSON string
 */
function exportReportAsJson(report, filteredRecords, filterState, analysis) {
  const activeFilterCount = countActiveFiltersForExport(filterState);

  // Build export object with filtered records
  const exportData = {
    ...report,
    records: filteredRecords,
    _exportMetadata: {
      exportedAt: new Date().toISOString(),
      totalRecords: report.records.length,
      filteredRecords: filteredRecords.length,
      filtersApplied: activeFilterCount > 0,
      filterState: activeFilterCount > 0 ? { ...filterState } : null
    }
  };

  // Include analysis in export
  if (analysis) {
    exportData._analysis = {
      topSendingIps: analysis.topSenders.map(item => ({
        ip: item.ip,
        count: item.count,
        location: item.geo ? `${item.geo.city || ''} ${item.geo.country || ''}`.trim() : null
      })),
      topFailingDomains: analysis.topFailures,
      topCountries: analysis.topCountries,
      topAsns: analysis.topAsns.map(item => ({ asn: item.asn, count: item.count }))
    };
  }

  return JSON.stringify(exportData, null, 2);
}

/**
 * Export report data as CSV
 * @param {Array} records - Records to export (already filtered and sorted)
 * @param {Map} ipGeoData - IP geolocation data
 * @returns {string} CSV string
 */
function exportReportAsCsv(records, ipGeoData) {
  const headers = [
    'Source IP',
    'Hostname',
    'Country',
    'City',
    'ISP/ASN',
    'Count',
    'Disposition',
    'DKIM Result',
    'SPF Result',
    'Header From',
    'Envelope From',
    'DKIM Signing Domain',
    'SPF Checked Domain',
    'Pass/Fail'
  ];

  const rows = records.map(record => {
    const pe = record.policyEvaluated || {};
    const id = record.identifiers || {};
    const auth = record.authResults || { dkim: [], spf: [] };
    const geo = ipGeoData?.get(record.sourceIp) || {};

    const dkimPass = pe.dkim === 'pass';
    const spfPass = pe.spf === 'pass';
    const passStatus = dkimPass && spfPass ? 'PASS' : (!dkimPass && !spfPass ? 'FAIL' : 'PARTIAL');

    return [
      record.sourceIp || '',
      geo.hostname || '',
      geo.country || '',
      geo.city || '',
      geo.asn || geo.isp || '',
      record.count,
      pe.disposition || '',
      pe.dkim || '',
      pe.spf || '',
      id.headerFrom || '',
      id.envelopeFrom || '',
      auth.dkim.map(d => d.domain).filter(Boolean).join('; ') || '',
      auth.spf.map(s => s.domain).filter(Boolean).join('; ') || '',
      passStatus
    ];
  });

  // Escape CSV cells
  const escapeCsvCell = (cell) => `"${String(cell).replace(/"/g, '""')}"`;

  return [
    headers.join(','),
    ...rows.map(row => row.map(escapeCsvCell).join(','))
  ].join('\n');
}

/**
 * Count active filters for export metadata
 * @param {Object} filterState - Filter state object
 * @returns {number} Count of active filters
 */
function countActiveFiltersForExport(filterState) {
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
 * Trigger file download for export data
 * @param {string} data - Data string to export
 * @param {string} filename - Filename for download
 * @param {string} mimeType - MIME type of the data
 */
function downloadExport(data, filename, mimeType) {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * Apply basic XML syntax highlighting
 * Security: All user content is HTML-escaped BEFORE regex processing.
 * The regex patterns only wrap already-escaped content in span tags.
 * @param {string} xml - Raw XML string
 * @returns {string} HTML with syntax highlighting spans
 */
function highlightXml(xml) {
  if (!xml) return '';

  // Escape ALL HTML-significant characters first to prevent XSS
  // This MUST happen before any regex processing
  const escape = typeof escapeHtml === 'function' ? escapeHtml : (s) => {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  let escaped = escape(xml);

  // Now apply highlighting to the escaped content
  // These regexes only match escaped HTML entities, not actual HTML

  // Highlight tags: &lt;tagname...&gt; and &lt;/tagname&gt;
  escaped = escaped.replace(/(&lt;\/?)([\w:]+)([^&]*?)(&gt;)/g,
    '<span class="xml-bracket">$1</span><span class="xml-tag">$2</span>$3<span class="xml-bracket">$4</span>');

  // Highlight attributes: name=&quot;value&quot;
  escaped = escaped.replace(/([\w:]+)(=)(&quot;[^&]*?&quot;)/g,
    '<span class="xml-attr-name">$1</span><span class="xml-equals">$2</span><span class="xml-attr-value">$3</span>');

  // Highlight XML declaration
  escaped = escaped.replace(/(&lt;\?xml[^&]*?\?&gt;)/g,
    '<span class="xml-declaration">$1</span>');

  // Highlight comments
  escaped = escaped.replace(/(&lt;!--[\s\S]*?--&gt;)/g,
    '<span class="xml-comment">$1</span>');

  return escaped;
}

// Export for use in other modules (if in Node.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    exportReportAsJson,
    exportReportAsCsv,
    countActiveFiltersForExport,
    downloadExport,
    highlightXml
  };
}

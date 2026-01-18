/**
 * DMARC Report Reader - File Handler
 * Detects file format and extracts XML content from various containers
 */

/**
 * Magic bytes for file format detection
 */
const MAGIC_BYTES = {
  GZIP: [0x1f, 0x8b],
  ZIP: [0x50, 0x4b, 0x03, 0x04],
  XML_BOM: [0xef, 0xbb, 0xbf],
  XML_DECLARATION: [0x3c, 0x3f, 0x78, 0x6d, 0x6c] // <?xml
};

/**
 * Detect file format from magic bytes
 * @param {Uint8Array} data - Raw file bytes
 * @returns {string} Format: 'gzip', 'zip', or 'xml'
 */
function detectFormat(data) {
  if (data.length < 4) {
    throw new Error('File too small to determine format');
  }

  // Check GZIP magic bytes (1f 8b)
  if (data[0] === MAGIC_BYTES.GZIP[0] && data[1] === MAGIC_BYTES.GZIP[1]) {
    return 'gzip';
  }

  // Check ZIP magic bytes (PK..)
  if (data[0] === MAGIC_BYTES.ZIP[0] && data[1] === MAGIC_BYTES.ZIP[1] &&
      data[2] === MAGIC_BYTES.ZIP[2] && data[3] === MAGIC_BYTES.ZIP[3]) {
    return 'zip';
  }

  // Check for XML (with or without BOM)
  if (data[0] === MAGIC_BYTES.XML_BOM[0] && data[1] === MAGIC_BYTES.XML_BOM[1] &&
      data[2] === MAGIC_BYTES.XML_BOM[2]) {
    return 'xml';
  }

  // Check for XML declaration <?xml
  if (data[0] === MAGIC_BYTES.XML_DECLARATION[0] &&
      data[1] === MAGIC_BYTES.XML_DECLARATION[1] &&
      data[2] === MAGIC_BYTES.XML_DECLARATION[2] &&
      data[3] === MAGIC_BYTES.XML_DECLARATION[3]) {
    return 'xml';
  }

  // Check for XML starting with < (whitespace trimmed)
  const text = new TextDecoder().decode(data.slice(0, 100));
  if (text.trim().startsWith('<')) {
    return 'xml';
  }

  throw new Error('Unknown file format');
}

/**
 * Decompress GZIP data using pako
 * @param {Uint8Array} data - GZIP compressed data
 * @returns {string} Decompressed XML string
 */
function decompressGzip(data) {
  try {
    const decompressed = pako.inflate(data);
    return new TextDecoder('utf-8').decode(decompressed);
  } catch (err) {
    throw new Error(`GZIP decompression failed: ${err.message}`);
  }
}

/**
 * Extract XML from ZIP archive using JSZip
 * @param {Uint8Array} data - ZIP archive data
 * @returns {Promise<string>} Extracted XML string
 */
async function extractFromZip(data) {
  try {
    const zip = await JSZip.loadAsync(data);
    const fileNames = Object.keys(zip.files);

    // Find XML file in archive
    const xmlFile = fileNames.find(name =>
      name.toLowerCase().endsWith('.xml') && !zip.files[name].dir
    );

    if (!xmlFile) {
      throw new Error('No XML file found in ZIP archive');
    }

    return await zip.files[xmlFile].async('string');
  } catch (err) {
    if (err.message.includes('No XML file')) {
      throw err;
    }
    throw new Error(`ZIP extraction failed: ${err.message}`);
  }
}

/**
 * Process a DMARC report file and extract XML content
 * @param {ArrayBuffer|Uint8Array} fileData - Raw file data
 * @param {string} [fileName] - Optional filename for format hints
 * @returns {Promise<string>} XML content string
 */
async function extractXmlFromFile(fileData, fileName = '') {
  const data = fileData instanceof ArrayBuffer
    ? new Uint8Array(fileData)
    : fileData;

  const format = detectFormat(data);

  switch (format) {
    case 'gzip':
      return decompressGzip(data);

    case 'zip':
      return await extractFromZip(data);

    case 'xml':
      return new TextDecoder('utf-8').decode(data);

    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectFormat, extractXmlFromFile };
}

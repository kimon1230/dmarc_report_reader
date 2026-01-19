/**
 * DMARC Report Reader - File Handler
 * Detects file format and extracts XML content from various containers
 *
 * Supports: Plain XML, GZIP compressed (.xml.gz), ZIP archives (single or multi-file)
 */

/**
 * Magic bytes for file format detection
 * @constant {Object}
 */
const MAGIC_BYTES = Object.freeze({
  GZIP: [0x1f, 0x8b],
  ZIP: [0x50, 0x4b, 0x03, 0x04],
  XML_BOM: [0xef, 0xbb, 0xbf],
  XML_DECLARATION: [0x3c, 0x3f, 0x78, 0x6d, 0x6c] // <?xml
});

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
 * Extract all XML files from ZIP archive using JSZip
 * @param {Uint8Array} data - ZIP archive data
 * @returns {Promise<Array<{filename: string, xml: string}>>} Array of extracted XML files
 * @throws {Error} If ZIP is invalid or contains no XML files
 */
async function extractFromZip(data) {
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (err) {
    throw new Error(`Invalid ZIP file: ${err.message}`);
  }

  const fileNames = Object.keys(zip.files);

  // Find all XML files in archive (excluding directories and macOS metadata)
  const xmlFileNames = fileNames.filter(name => {
    const lower = name.toLowerCase();
    return lower.endsWith('.xml') &&
           !zip.files[name].dir &&
           !name.startsWith('__MACOSX/') &&
           !name.startsWith('.');
  });

  if (xmlFileNames.length === 0) {
    throw new Error('No XML files found in ZIP archive');
  }

  // Extract all XML files in parallel
  const extractionPromises = xmlFileNames.map(async (filename) => {
    try {
      const xml = await zip.files[filename].async('string');
      // Basic validation: must contain feedback element (DMARC report marker)
      if (!xml.includes('<feedback') && !xml.includes('<feedback>')) {
        return null; // Not a DMARC report, skip it
      }
      return {
        filename: filename.split('/').pop(), // Remove path, keep filename only
        xml
      };
    } catch (err) {
      // Log but don't fail entire extraction for one bad file
      console.warn(`Failed to extract ${filename}: ${err.message}`);
      return null;
    }
  });

  const results = await Promise.all(extractionPromises);
  const validFiles = results.filter(f => f !== null);

  if (validFiles.length === 0) {
    throw new Error('ZIP contains no valid DMARC report XML files');
  }

  // Sort by filename for consistent ordering
  validFiles.sort((a, b) => a.filename.localeCompare(b.filename));

  return validFiles;
}

/**
 * @typedef {Object} ExtractedFile
 * @property {string} filename - Name of the file
 * @property {string} xml - Raw XML content
 */

/**
 * @typedef {Object} ExtractionResult
 * @property {ExtractedFile[]} files - Array of extracted XML files
 * @property {string} sourceFormat - Original format: 'xml', 'gzip', or 'zip'
 * @property {boolean} isMultiFile - True if ZIP contained multiple reports
 */

/**
 * Process a DMARC report file and extract XML content
 * Handles XML, GZIP, and ZIP formats. ZIP archives may contain multiple reports.
 *
 * @param {ArrayBuffer|Uint8Array} fileData - Raw file data
 * @param {string} [fileName=''] - Original filename for metadata
 * @returns {Promise<ExtractionResult>} Extraction result with all XML files
 * @throws {Error} If file format is unknown or extraction fails
 */
async function extractXmlFromFile(fileData, fileName = '') {
  if (!fileData || (fileData.byteLength === 0 && fileData.length === 0)) {
    throw new Error('Empty file provided');
  }

  const data = fileData instanceof ArrayBuffer
    ? new Uint8Array(fileData)
    : fileData;

  const format = detectFormat(data);

  switch (format) {
    case 'gzip': {
      const xml = decompressGzip(data);
      return {
        files: [{ filename: fileName || 'report.xml', xml }],
        sourceFormat: 'gzip',
        isMultiFile: false
      };
    }

    case 'zip': {
      const files = await extractFromZip(data);
      return {
        files,
        sourceFormat: 'zip',
        isMultiFile: files.length > 1
      };
    }

    case 'xml': {
      const xml = new TextDecoder('utf-8').decode(data);
      return {
        files: [{ filename: fileName || 'report.xml', xml }],
        sourceFormat: 'xml',
        isMultiFile: false
      };
    }

    default:
      throw new Error(`Unsupported file format: ${format}`);
  }
}

/**
 * Legacy wrapper for backwards compatibility
 * Returns single XML string for single-file results
 *
 * @param {ArrayBuffer|Uint8Array} fileData - Raw file data
 * @param {string} [fileName=''] - Original filename
 * @returns {Promise<string|ExtractionResult>} XML string if single file, ExtractionResult if multiple
 * @deprecated Use extractXmlFromFile and handle ExtractionResult directly
 */
async function extractXmlFromFileLegacy(fileData, fileName = '') {
  const result = await extractXmlFromFile(fileData, fileName);
  if (result.files.length === 1) {
    return result.files[0].xml;
  }
  return result;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectFormat, extractXmlFromFile, extractXmlFromFileLegacy };
}

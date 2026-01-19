/**
 * DMARC Report Reader - Structured Error Types
 * Provides consistent error handling with user-friendly messages
 */

/**
 * Error codes for categorizing errors
 * @constant {Object}
 */
const ErrorCodes = Object.freeze({
  // File handling errors
  FILE_EMPTY: 'FILE_EMPTY',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TOO_SMALL: 'FILE_TOO_SMALL',
  FORMAT_UNKNOWN: 'FORMAT_UNKNOWN',

  // GZIP errors
  GZIP_CORRUPT: 'GZIP_CORRUPT',
  GZIP_DECOMPRESS_FAILED: 'GZIP_DECOMPRESS_FAILED',

  // ZIP errors
  ZIP_INVALID: 'ZIP_INVALID',
  ZIP_NO_XML: 'ZIP_NO_XML',
  ZIP_NO_DMARC: 'ZIP_NO_DMARC',
  ZIP_EXTRACT_FAILED: 'ZIP_EXTRACT_FAILED',

  // XML parsing errors
  XML_PARSE_ERROR: 'XML_PARSE_ERROR',
  XML_NOT_DMARC: 'XML_NOT_DMARC',
  XML_MISSING_REQUIRED: 'XML_MISSING_REQUIRED',

  // Network/service errors
  IP_LOOKUP_FAILED: 'IP_LOOKUP_FAILED',
  IP_LOOKUP_RATE_LIMITED: 'IP_LOOKUP_RATE_LIMITED',

  // Extension communication errors
  SERVICE_WORKER_TIMEOUT: 'SERVICE_WORKER_TIMEOUT',
  SERVICE_WORKER_ERROR: 'SERVICE_WORKER_ERROR',
  MESSAGE_SEND_FAILED: 'MESSAGE_SEND_FAILED',
  STORAGE_ERROR: 'STORAGE_ERROR',

  // Validation errors
  INVALID_SENDER: 'INVALID_SENDER',
  INVALID_FILE_DATA: 'INVALID_FILE_DATA',
  INVALID_FILENAME: 'INVALID_FILENAME',

  // Generic
  UNKNOWN: 'UNKNOWN'
});

/**
 * User-friendly messages for each error code
 * @constant {Object}
 */
const UserMessages = Object.freeze({
  [ErrorCodes.FILE_EMPTY]: 'The file is empty. Please select a valid DMARC report file.',
  [ErrorCodes.FILE_TOO_LARGE]: 'The file is too large to process. Maximum size is 50MB.',
  [ErrorCodes.FILE_TOO_SMALL]: 'The file is too small to be a valid DMARC report.',
  [ErrorCodes.FORMAT_UNKNOWN]: 'Unrecognized file format. Please use .xml, .xml.gz, or .zip files.',

  [ErrorCodes.GZIP_CORRUPT]: 'The GZIP file appears to be corrupted and cannot be decompressed.',
  [ErrorCodes.GZIP_DECOMPRESS_FAILED]: 'Failed to decompress the GZIP file. The file may be corrupted.',

  [ErrorCodes.ZIP_INVALID]: 'The ZIP file is invalid or corrupted.',
  [ErrorCodes.ZIP_NO_XML]: 'No XML files found in the ZIP archive.',
  [ErrorCodes.ZIP_NO_DMARC]: 'The ZIP archive does not contain any valid DMARC report files.',
  [ErrorCodes.ZIP_EXTRACT_FAILED]: 'Failed to extract files from the ZIP archive.',

  [ErrorCodes.XML_PARSE_ERROR]: 'The XML file could not be parsed. It may be malformed or corrupted.',
  [ErrorCodes.XML_NOT_DMARC]: 'The file is not a valid DMARC aggregate report. Missing required elements.',
  [ErrorCodes.XML_MISSING_REQUIRED]: 'The DMARC report is missing required information.',

  [ErrorCodes.IP_LOOKUP_FAILED]: 'Failed to lookup IP address information. Some location data may be unavailable.',
  [ErrorCodes.IP_LOOKUP_RATE_LIMITED]: 'IP lookup service is rate limited. Please wait and try again.',

  [ErrorCodes.SERVICE_WORKER_TIMEOUT]: 'The extension is not responding. Please try again or reload the page.',
  [ErrorCodes.SERVICE_WORKER_ERROR]: 'An error occurred in the extension. Please try again.',
  [ErrorCodes.MESSAGE_SEND_FAILED]: 'Failed to communicate with the extension. Please reload the page.',
  [ErrorCodes.STORAGE_ERROR]: 'Failed to access extension storage. Please check your browser settings.',

  [ErrorCodes.INVALID_SENDER]: 'Unauthorized request. The message was not from a trusted source.',
  [ErrorCodes.INVALID_FILE_DATA]: 'The file data is invalid or corrupted.',
  [ErrorCodes.INVALID_FILENAME]: 'The filename is invalid.',

  [ErrorCodes.UNKNOWN]: 'An unexpected error occurred. Please try again.'
});

/**
 * Custom error class for DMARC Report Reader
 * Provides structured error information with user-friendly messages
 */
class DmarcError extends Error {
  /**
   * Create a new DmarcError
   * @param {string} code - Error code from ErrorCodes
   * @param {string} [technicalMessage] - Technical details for debugging
   * @param {Object} [details] - Additional error details
   */
  constructor(code, technicalMessage = null, details = null) {
    const userMessage = UserMessages[code] || UserMessages[ErrorCodes.UNKNOWN];
    super(technicalMessage || userMessage);

    this.name = 'DmarcError';
    this.code = code;
    this.userMessage = userMessage;
    this.technicalMessage = technicalMessage;
    this.details = details;
    this.timestamp = new Date().toISOString();

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DmarcError);
    }
  }

  /**
   * Get the user-friendly message for display
   * @returns {string}
   */
  getUserMessage() {
    return this.userMessage;
  }

  /**
   * Get a detailed message including technical info
   * @returns {string}
   */
  getDetailedMessage() {
    if (this.technicalMessage) {
      return `${this.userMessage} (${this.technicalMessage})`;
    }
    return this.userMessage;
  }

  /**
   * Serialize error for logging or transmission
   * @returns {Object}
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      technicalMessage: this.technicalMessage,
      details: this.details,
      timestamp: this.timestamp
    };
  }

  /**
   * Create a DmarcError from a caught exception
   * @param {Error} error - Original error
   * @param {string} [defaultCode] - Default error code if cannot be determined
   * @returns {DmarcError}
   */
  static fromError(error, defaultCode = ErrorCodes.UNKNOWN) {
    if (error instanceof DmarcError) {
      return error;
    }

    // Try to map common error messages to codes
    const message = error.message || '';
    let code = defaultCode;

    if (message.includes('Empty file')) {
      code = ErrorCodes.FILE_EMPTY;
    } else if (message.includes('too small')) {
      code = ErrorCodes.FILE_TOO_SMALL;
    } else if (message.includes('Unknown file format')) {
      code = ErrorCodes.FORMAT_UNKNOWN;
    } else if (message.includes('GZIP') || message.includes('inflate')) {
      code = ErrorCodes.GZIP_DECOMPRESS_FAILED;
    } else if (message.includes('Invalid ZIP') || message.includes('bad zip')) {
      code = ErrorCodes.ZIP_INVALID;
    } else if (message.includes('No XML files')) {
      code = ErrorCodes.ZIP_NO_XML;
    } else if (message.includes('no valid DMARC')) {
      code = ErrorCodes.ZIP_NO_DMARC;
    } else if (message.includes('XML parsing failed') || message.includes('parsererror')) {
      code = ErrorCodes.XML_PARSE_ERROR;
    } else if (message.includes('missing feedback')) {
      code = ErrorCodes.XML_NOT_DMARC;
    }

    return new DmarcError(code, error.message, { originalError: error.name });
  }
}

/**
 * Create an error with the specified code
 * @param {string} code - Error code from ErrorCodes
 * @param {string} [technicalMessage] - Technical details
 * @param {Object} [details] - Additional details
 * @returns {DmarcError}
 */
function createError(code, technicalMessage = null, details = null) {
  return new DmarcError(code, technicalMessage, details);
}

/**
 * Check if an error is a DmarcError with a specific code
 * @param {Error} error - Error to check
 * @param {string} code - Expected error code
 * @returns {boolean}
 */
function isErrorCode(error, code) {
  return error instanceof DmarcError && error.code === code;
}

/**
 * Get user-friendly message for any error
 * @param {Error} error - Error to get message for
 * @returns {string}
 */
function getUserMessage(error) {
  if (error instanceof DmarcError) {
    return error.getUserMessage();
  }
  return error.message || UserMessages[ErrorCodes.UNKNOWN];
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ErrorCodes,
    UserMessages,
    DmarcError,
    createError,
    isErrorCode,
    getUserMessage
  };
}

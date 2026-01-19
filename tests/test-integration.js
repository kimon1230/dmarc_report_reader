#!/usr/bin/env node
/**
 * DMARC Report Reader - Integration Tests
 * Tests the complete file processing pipeline
 *
 * Run: node tests/test-integration.js
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Framework (same as test-logic.js)
// =============================================================================

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then(() => {
          passed++;
          console.log(`  \x1b[32m✓\x1b[0m ${name}`);
        })
        .catch(err => {
          failed++;
          failures.push({ name, error: err.message });
          console.log(`  \x1b[31m✗\x1b[0m ${name}`);
          console.log(`    \x1b[31m${err.message}\x1b[0m`);
        });
    }
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

function assertThrows(fn, expectedMessage = null, message = '') {
  try {
    fn();
    throw new Error(`${message} Expected function to throw, but it did not`);
  } catch (err) {
    if (expectedMessage && !err.message.includes(expectedMessage)) {
      throw new Error(`${message} Expected error containing "${expectedMessage}", got "${err.message}"`);
    }
  }
}

async function assertThrowsAsync(fn, expectedMessage = null, message = '') {
  try {
    await fn();
    throw new Error(`${message} Expected function to throw, but it did not`);
  } catch (err) {
    if (expectedMessage && !err.message.includes(expectedMessage)) {
      throw new Error(`${message} Expected error containing "${expectedMessage}", got "${err.message}"`);
    }
  }
}

// =============================================================================
// Mock Browser APIs for Node.js
// =============================================================================

// Mock TextDecoder
global.TextDecoder = require('util').TextDecoder;

// Load pako for GZIP tests
global.pako = require('../lib/pako.min.js');

// Load JSZip for ZIP tests
global.JSZip = require('../lib/jszip.min.js');

// Mock DOMParser for XML parsing tests
// Creates a proper recursive DOM-like structure
class MockElement {
  constructor(tagName, content, fullXml) {
    this.tagName = tagName;
    this._content = content;
    this._fullXml = fullXml;
    this.textContent = this._extractTextContent(content);
  }

  _extractTextContent(content) {
    // Remove all tags to get text content
    return content.replace(/<[^>]*>/g, '').trim();
  }

  getElementsByTagName(name) {
    const results = [];
    // Match both self-closing and regular tags
    const regex = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>|<${name}(?:\\s[^>]*)?\\/>`, 'gi');
    let match;
    while ((match = regex.exec(this._content)) !== null) {
      const innerContent = match[1] || '';
      results.push(new MockElement(name, innerContent, match[0]));
    }
    return results;
  }
}

class MockDOMParser {
  parseFromString(xmlString, mimeType) {
    // Check for actual XML parsing errors
    const trimmed = xmlString.trim();

    // Check for malformed XML indicators
    const hasParseError = this._detectParseError(trimmed);

    const doc = {
      getElementsByTagName: (name) => {
        if (name === 'parsererror') {
          if (hasParseError) {
            return [{ textContent: 'XML parsing error: malformed XML' }];
          }
          return [];
        }

        const results = [];
        const regex = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'gi');
        let match;
        while ((match = regex.exec(xmlString)) !== null) {
          results.push(new MockElement(name, match[1], match[0]));
        }
        return results;
      }
    };

    return doc;
  }

  _detectParseError(xml) {
    // Check for common XML errors
    if (!xml.startsWith('<')) return true;

    // Check for unclosed tags (simplified check)
    const openTags = xml.match(/<[a-zA-Z][^>]*[^/]>/g) || [];
    const closeTags = xml.match(/<\/[a-zA-Z][^>]*>/g) || [];

    // Very basic: if we have an open tag without matching close, it's an error
    // This is a simplified check for the malformed.xml test case
    if (xml.includes('<!-- Missing closing tag')) {
      return true;
    }

    return false;
  }
}

global.DOMParser = MockDOMParser;

// =============================================================================
// Load Modules Under Test
// =============================================================================

const { detectFormat, extractXmlFromFile } = require('../src/parser/file-handler.js');
const { parseDmarcReport } = require('../src/parser/dmarc-parser.js');

// =============================================================================
// Test Fixtures
// =============================================================================

const fixturesDir = path.join(__dirname, 'fixtures');

function loadFixture(filename) {
  return fs.readFileSync(path.join(fixturesDir, filename));
}

function loadFixtureAsUint8Array(filename) {
  const buffer = loadFixture(filename);
  return new Uint8Array(buffer);
}

// =============================================================================
// Tests: Format Detection
// =============================================================================

async function runTests() {
  console.log('\n\x1b[1mFormat Detection\x1b[0m');

  test('detects plain XML format', () => {
    const data = loadFixtureAsUint8Array('valid-report.xml');
    assertEqual(detectFormat(data), 'xml');
  });

  test('detects GZIP format by magic bytes', () => {
    const data = loadFixtureAsUint8Array('valid-report.xml.gz');
    assertEqual(detectFormat(data), 'gzip');
  });

  test('detects ZIP format by magic bytes', () => {
    const data = loadFixtureAsUint8Array('single-report.zip');
    assertEqual(detectFormat(data), 'zip');
  });

  test('detects XML with whitespace prefix', () => {
    const xml = '  \n  <?xml version="1.0"?><feedback></feedback>';
    const data = new Uint8Array(Buffer.from(xml));
    assertEqual(detectFormat(data), 'xml');
  });

  test('detects XML starting with element (no declaration)', () => {
    const xml = '<feedback><report_metadata></report_metadata></feedback>';
    const data = new Uint8Array(Buffer.from(xml));
    assertEqual(detectFormat(data), 'xml');
  });

  test('throws on file too small', () => {
    const data = new Uint8Array([0x50, 0x4b]); // Only 2 bytes
    assertThrows(() => detectFormat(data), 'too small');
  });

  test('throws on unknown format', () => {
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    assertThrows(() => detectFormat(data), 'Unknown file format');
  });

  // =============================================================================
  // Tests: GZIP Extraction
  // =============================================================================

  console.log('\n\x1b[1mGZIP Extraction\x1b[0m');

  await test('extracts XML from GZIP file', async () => {
    const data = loadFixtureAsUint8Array('valid-report.xml.gz');
    const result = await extractXmlFromFile(data, 'test.xml.gz');

    assertEqual(result.sourceFormat, 'gzip');
    assertEqual(result.isMultiFile, false);
    assertEqual(result.files.length, 1);
    assertTrue(result.files[0].xml.includes('<feedback>'));
    assertTrue(result.files[0].xml.includes('google.com'));
  });

  await test('GZIP extraction preserves filename', async () => {
    const data = loadFixtureAsUint8Array('valid-report.xml.gz');
    const result = await extractXmlFromFile(data, 'my-report.xml.gz');

    assertEqual(result.files[0].filename, 'my-report.xml.gz');
  });

  await test('throws on corrupted GZIP', async () => {
    // Create corrupted GZIP (valid header but truncated/bad content)
    // GZIP header: 1f 8b 08 (deflate) 00 (flags) + timestamp + extra flags + OS
    // Then corrupt deflate data
    const corrupted = new Uint8Array([
      0x1f, 0x8b, 0x08, 0x00, // magic + compression + flags
      0x00, 0x00, 0x00, 0x00, // mtime
      0x00, 0x03,             // extra flags + OS
      0xff, 0xff, 0xff, 0xff, // corrupt deflate data
      0xff, 0xff, 0xff, 0xff
    ]);
    await assertThrowsAsync(
      () => extractXmlFromFile(corrupted, 'bad.gz'),
      'GZIP decompression failed'
    );
  });

  // =============================================================================
  // Tests: ZIP Extraction
  // =============================================================================

  console.log('\n\x1b[1mZIP Extraction\x1b[0m');

  await test('extracts single XML from ZIP', async () => {
    const data = loadFixtureAsUint8Array('single-report.zip');
    const result = await extractXmlFromFile(data, 'test.zip');

    assertEqual(result.sourceFormat, 'zip');
    assertEqual(result.isMultiFile, false);
    assertEqual(result.files.length, 1);
    assertTrue(result.files[0].xml.includes('<feedback>'));
  });

  await test('extracts multiple XMLs from ZIP', async () => {
    const data = loadFixtureAsUint8Array('multi-report.zip');
    const result = await extractXmlFromFile(data, 'multi.zip');

    assertEqual(result.sourceFormat, 'zip');
    assertEqual(result.isMultiFile, true);
    assertEqual(result.files.length, 3);

    // Verify all files are valid DMARC reports
    for (const file of result.files) {
      assertTrue(file.xml.includes('<feedback>'), `${file.filename} should contain feedback`);
    }
  });

  await test('ZIP extraction sorts files by name', async () => {
    const data = loadFixtureAsUint8Array('multi-report.zip');
    const result = await extractXmlFromFile(data, 'multi.zip');

    const filenames = result.files.map(f => f.filename);
    const sorted = [...filenames].sort();
    assertEqual(JSON.stringify(filenames), JSON.stringify(sorted));
  });

  await test('throws on invalid ZIP', async () => {
    // Create invalid ZIP (valid magic but corrupted)
    const invalid = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    await assertThrowsAsync(
      () => extractXmlFromFile(invalid, 'bad.zip'),
      'Invalid ZIP file'
    );
  });

  // =============================================================================
  // Tests: Plain XML Extraction
  // =============================================================================

  console.log('\n\x1b[1mPlain XML Extraction\x1b[0m');

  await test('extracts plain XML file', async () => {
    const data = loadFixtureAsUint8Array('valid-report.xml');
    const result = await extractXmlFromFile(data, 'report.xml');

    assertEqual(result.sourceFormat, 'xml');
    assertEqual(result.isMultiFile, false);
    assertEqual(result.files.length, 1);
    assertTrue(result.files[0].xml.includes('<feedback>'));
  });

  await test('handles non-DMARC XML in extraction', async () => {
    const data = loadFixtureAsUint8Array('non-dmarc.xml');
    const result = await extractXmlFromFile(data, 'other.xml');

    // Should still extract, just won't parse as DMARC
    assertEqual(result.sourceFormat, 'xml');
    assertTrue(result.files[0].xml.includes('<root>'));
  });

  // =============================================================================
  // Tests: Error Handling
  // =============================================================================

  console.log('\n\x1b[1mError Handling\x1b[0m');

  await test('throws on empty file', async () => {
    const empty = new Uint8Array(0);
    await assertThrowsAsync(
      () => extractXmlFromFile(empty, 'empty.xml'),
      'Empty file'
    );
  });

  await test('throws on empty ArrayBuffer', async () => {
    const empty = new ArrayBuffer(0);
    let threw = false;
    try {
      await extractXmlFromFile(empty, 'empty.xml');
    } catch (err) {
      threw = true;
      // Accept either "Empty file" or "too small" as valid error
      assertTrue(
        err.message.includes('Empty file') || err.message.includes('too small'),
        `Expected empty/small file error, got: ${err.message}`
      );
    }
    assertTrue(threw, 'Expected function to throw');
  });

  await test('handles ArrayBuffer input', async () => {
    const data = loadFixture('valid-report.xml');
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const result = await extractXmlFromFile(arrayBuffer, 'report.xml');

    assertEqual(result.sourceFormat, 'xml');
    assertTrue(result.files[0].xml.includes('<feedback>'));
  });

  // =============================================================================
  // Tests: Full Pipeline (Extraction + Parsing)
  // =============================================================================

  console.log('\n\x1b[1mFull Pipeline (Extraction + Parsing)\x1b[0m');

  await test('full pipeline: plain XML to parsed report', async () => {
    const data = loadFixtureAsUint8Array('valid-report.xml');
    const extraction = await extractXmlFromFile(data, 'report.xml');
    const report = parseDmarcReport(extraction.files[0].xml);

    assertEqual(report.metadata.orgName, 'google.com');
    assertEqual(report.policy.domain, 'example.com');
    assertEqual(report.records.length, 2);
    assertEqual(report.summary.totalMessages, 13); // 10 + 3
  });

  await test('full pipeline: GZIP to parsed report', async () => {
    const data = loadFixtureAsUint8Array('valid-report.xml.gz');
    const extraction = await extractXmlFromFile(data, 'report.xml.gz');
    const report = parseDmarcReport(extraction.files[0].xml);

    assertEqual(report.metadata.orgName, 'google.com');
    assertEqual(report.summary.totalMessages, 13);
  });

  await test('full pipeline: single ZIP to parsed report', async () => {
    const data = loadFixtureAsUint8Array('single-report.zip');
    const extraction = await extractXmlFromFile(data, 'report.zip');
    const report = parseDmarcReport(extraction.files[0].xml);

    assertEqual(report.metadata.orgName, 'google.com');
    assertEqual(report.policy.domain, 'example.com');
  });

  await test('full pipeline: multi ZIP to multiple parsed reports', async () => {
    const data = loadFixtureAsUint8Array('multi-report.zip');
    const extraction = await extractXmlFromFile(data, 'multi.zip');

    assertEqual(extraction.files.length, 3);

    const reports = extraction.files.map(f => parseDmarcReport(f.xml));
    assertEqual(reports.length, 3);

    // All should parse successfully
    for (const report of reports) {
      assertTrue(report.metadata !== null);
      assertTrue(report.policy !== null);
      assertTrue(report.records.length > 0);
    }
  });

  await test('parsing throws on malformed XML', () => {
    const malformed = fs.readFileSync(path.join(fixturesDir, 'malformed.xml'), 'utf8');
    assertThrows(
      () => parseDmarcReport(malformed),
      'XML parsing failed'
    );
  });

  await test('parsing throws on non-DMARC XML', () => {
    const nonDmarc = fs.readFileSync(path.join(fixturesDir, 'non-dmarc.xml'), 'utf8');
    assertThrows(
      () => parseDmarcReport(nonDmarc),
      'missing feedback element'
    );
  });

  // =============================================================================
  // Tests: Report Structure Validation
  // =============================================================================

  console.log('\n\x1b[1mReport Structure Validation\x1b[0m');

  await test('parsed report has correct structure', async () => {
    const data = loadFixtureAsUint8Array('valid-report.xml');
    const extraction = await extractXmlFromFile(data, 'report.xml');
    const report = parseDmarcReport(extraction.files[0].xml);

    // Metadata
    assertTrue(report.metadata !== null);
    assertEqual(typeof report.metadata.orgName, 'string');
    assertEqual(typeof report.metadata.reportId, 'string');
    assertTrue(report.metadata.dateRange !== null);

    // Policy
    assertTrue(report.policy !== null);
    assertEqual(report.policy.domain, 'example.com');
    assertEqual(report.policy.adkim, 'relaxed');
    assertEqual(report.policy.aspf, 'relaxed');

    // Records
    assertTrue(Array.isArray(report.records));
    assertTrue(report.records.length > 0);

    // Summary
    assertTrue(report.summary !== null);
    assertEqual(typeof report.summary.totalMessages, 'number');
    assertEqual(typeof report.summary.dkimPassRate, 'number');
  });

  await test('record has alignment data', async () => {
    const data = loadFixtureAsUint8Array('valid-report.xml');
    const extraction = await extractXmlFromFile(data, 'report.xml');
    const report = parseDmarcReport(extraction.files[0].xml);

    const record = report.records[0];
    assertTrue(record.alignment !== null);
    assertEqual(typeof record.alignment.dmarcPass, 'boolean');
    assertEqual(typeof record.alignment.dkimPassed, 'boolean');
    assertEqual(typeof record.alignment.spfPassed, 'boolean');
  });

  await test('summary statistics are calculated correctly', async () => {
    const data = loadFixtureAsUint8Array('valid-report.xml');
    const extraction = await extractXmlFromFile(data, 'report.xml');
    const report = parseDmarcReport(extraction.files[0].xml);

    // First record: 10 messages, both pass
    // Second record: 3 messages, both fail
    assertEqual(report.summary.totalMessages, 13);
    assertEqual(report.summary.passedDkim, 10);
    assertEqual(report.summary.failedDkim, 3);
    assertEqual(report.summary.passedSpf, 10);
    assertEqual(report.summary.failedSpf, 3);
  });

  // =============================================================================
  // Summary
  // =============================================================================

  console.log('\n' + '='.repeat(60));
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1mAll ${passed} integration tests passed!\x1b[0m`);
  } else {
    console.log(`\x1b[31m\x1b[1m${failed} of ${passed + failed} integration tests failed\x1b[0m`);
    console.log('\nFailures:');
    failures.forEach(f => {
      console.log(`  - ${f.name}: ${f.error}`);
    });
  }
  console.log('='.repeat(60) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

// Run all tests
runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

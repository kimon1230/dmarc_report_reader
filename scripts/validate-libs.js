#!/usr/bin/env node
/**
 * DMARC Report Reader - Vendor Library Validation
 * Validates bundled third-party libraries against known hashes
 *
 * Run: node scripts/validate-libs.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load package.json for vendor dependency info
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const vendorDeps = packageJson.vendorDependencies || {};

/**
 * Compute SHA-384 hash of a file
 * @param {string} filePath - Path to file
 * @returns {string} Hex-encoded SHA-384 hash
 */
function computeHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha384').update(content).digest('hex');
}

/**
 * Validate a single vendor library
 * @param {string} name - Library name
 * @param {Object} config - Library configuration from package.json
 * @returns {Object} Validation result
 */
function validateLibrary(name, config) {
  const filePath = path.join(__dirname, '..', config.file);
  const result = {
    name,
    version: config.version,
    file: config.file,
    license: config.license,
    exists: false,
    hashMatch: false,
    actualHash: null,
    expectedHash: config.sha384
  };

  if (!fs.existsSync(filePath)) {
    return result;
  }
  result.exists = true;

  const actualHash = computeHash(filePath);
  result.actualHash = actualHash;
  result.hashMatch = actualHash === config.sha384;

  return result;
}

/**
 * Format validation results for console output
 * @param {Object[]} results - Array of validation results
 */
function printResults(results) {
  console.log('\n=== Vendor Library Validation ===\n');

  let allValid = true;

  for (const result of results) {
    const statusIcon = result.exists && result.hashMatch ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${statusIcon} ${result.name} v${result.version}`);
    console.log(`  File: ${result.file}`);
    console.log(`  License: ${result.license}`);

    if (!result.exists) {
      console.log(`  \x1b[31mERROR: File not found\x1b[0m`);
      allValid = false;
    } else if (!result.hashMatch) {
      console.log(`  \x1b[31mERROR: Hash mismatch\x1b[0m`);
      console.log(`  Expected: ${result.expectedHash}`);
      console.log(`  Actual:   ${result.actualHash}`);
      allValid = false;
    } else {
      console.log(`  \x1b[32mHash verified\x1b[0m`);
    }
    console.log('');
  }

  // Security advisory information
  console.log('=== Security Advisory Status ===\n');
  console.log('Check for known vulnerabilities:');
  for (const result of results) {
    console.log(`  - ${result.name}@${result.version}: https://www.npmjs.com/package/${result.name}/v/${result.version}`);
  }
  console.log('\nAs of 2026-01-19:');
  console.log('  - jszip@3.10.1: No known CVEs');
  console.log('  - pako@2.1.0: No known CVEs');
  console.log('');

  return allValid;
}

// Main execution
const results = Object.entries(vendorDeps).map(([name, config]) =>
  validateLibrary(name, config)
);

const allValid = printResults(results);

if (!allValid) {
  console.log('\x1b[31mValidation FAILED\x1b[0m');
  console.log('Vendor libraries have been modified or are missing.');
  console.log('Please restore original files or update hashes in package.json.\n');
  process.exit(1);
} else {
  console.log('\x1b[32mValidation PASSED\x1b[0m');
  console.log('All vendor libraries match expected hashes.\n');
  process.exit(0);
}

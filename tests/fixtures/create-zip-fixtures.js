#!/usr/bin/env node
/**
 * Generate ZIP test fixtures using JSZip
 * Run: node tests/fixtures/create-zip-fixtures.js
 */

const fs = require('fs');
const path = require('path');

// Load JSZip from lib folder
const JSZip = require('../../lib/jszip.min.js');

const fixturesDir = __dirname;

// Read the valid report XML
const validReport = fs.readFileSync(path.join(fixturesDir, 'valid-report.xml'), 'utf8');

// Create a second report for multi-file ZIP
const secondReport = validReport
  .replace('12345678901234567890', '98765432109876543210')
  .replace('192.0.2.1', '203.0.113.1')
  .replace('<count>10</count>', '<count>25</count>');

// Create a third report for multi-file ZIP
const thirdReport = validReport
  .replace('12345678901234567890', '11111111111111111111')
  .replace('192.0.2.1', '10.0.0.1')
  .replace('<count>10</count>', '<count>5</count>');

async function createSingleReportZip() {
  const zip = new JSZip();
  zip.file('google.com!example.com!1704067200!1704153599.xml', validReport);

  const content = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(path.join(fixturesDir, 'single-report.zip'), content);
  console.log('Created: single-report.zip');
}

async function createMultiReportZip() {
  const zip = new JSZip();
  zip.file('google.com!example.com!1704067200!1704153599.xml', validReport);
  zip.file('microsoft.com!example.com!1704067200!1704153599.xml', secondReport);
  zip.file('yahoo.com!example.com!1704067200!1704153599.xml', thirdReport);

  const content = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(path.join(fixturesDir, 'multi-report.zip'), content);
  console.log('Created: multi-report.zip');
}

async function main() {
  try {
    await createSingleReportZip();
    await createMultiReportZip();
    console.log('All ZIP fixtures created successfully');
  } catch (err) {
    console.error('Error creating fixtures:', err);
    process.exit(1);
  }
}

main();

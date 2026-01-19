# DMARC Report Reader

A Chrome/Edge browser extension that reads and visualizes DMARC (Domain-based Message Authentication, Reporting, and Conformance) aggregate reports.

## Features

- **Multiple Input Formats**: Supports plain XML, GZIP (.xml.gz), and ZIP archives
- **Drag and Drop**: Simply drop a DMARC report file onto the viewer
- **IP Geolocation**: Shows country, city, hostname (reverse DNS), ISP, and ASN for source IPs
- **Webmail Integration**: Detects DMARC attachments in Gmail and Outlook Web
- **Clear Visualization**: Color-coded pass/fail indicators with row highlighting
- **Filtering & Sorting**: Filter by status (pass/fail/quarantine/reject) and sort by count or IP
- **Export**: Export reports as JSON or CSV for further analysis
- **Error Diagnosis**: Contextual explanations and recommendations for authentication failures
- **Collapsible Sections**: Clean UI with collapsible metadata sections

## Supported File Types

| Format | Extensions |
|--------|------------|
| Plain XML | `.xml` |
| GZIP compressed | `.xml.gz`, `.gz` |
| ZIP archive | `.zip` |

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome/Edge and navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `dmarc_report_reader` directory

### From Chrome Web Store

Coming soon.

## Usage

### Direct File Opening

1. Click the extension icon in your browser toolbar
2. Either:
   - Drag and drop a DMARC report file onto the popup
   - Click "Select File" to open a file picker
3. View the parsed report with authentication results

### Webmail Integration

When viewing emails in Gmail or Outlook Web:
1. Open an email containing a DMARC report attachment
2. Look for the "View DMARC Report" button next to matching attachments
3. Click the button - the extension will:
   - Trigger the download automatically
   - Open the DMARC viewer when the download completes
   - Prompt you to select the just-downloaded file
   - Clean up the downloaded file after processing

**Detected filenames**: Attachments containing "dmarc" or matching the standard format (e.g., `google.com!example.com!1234567890!1234567891.xml.gz`).

## Report Viewer Features

### Summary Dashboard

- **Total Messages**: Overall count of messages in the report
- **Compliance Rates**: Visual progress bars for DKIM, SPF, and overall pass rates
- **Failure Statistics**: Count of failed messages, quarantined, and rejected

### Authentication Records Table

Each record shows:
- **Source IP**: Sending server IP address
- **Hostname**: Reverse DNS lookup result
- **Location**: Country flag, city, and country name
- **From Domain**: The visible From header domain (hover for full domain details)
- **Count**: Number of messages from this source
- **Disposition**: What happened to the messages (none/quarantine/reject)
- **DKIM/SPF**: Pass/fail status with color coding

### Row Color Coding

- **Green**: Both DKIM and SPF passed
- **Red**: Both DKIM and SPF failed, or messages were rejected
- **Amber**: Partial pass or messages were quarantined

### Detail Expansion

Click "Show" on any record to see:
- **Message Identifiers**: Header From, Envelope From, Envelope To with explanations
- **DKIM Authentication**: Signing domain, selector, and result
- **SPF Authentication**: Checked domain, scope, and result
- **Alignment Warnings**: If domains don't match for DMARC alignment
- **Issues & Recommendations**: Contextual diagnosis with actionable fixes

### Export Options

- **Export JSON**: Full structured data including all parsed fields
- **Export CSV**: Spreadsheet-compatible format with key fields

## DMARC Error Diagnosis

The extension provides detailed explanations for common issues:

### DKIM Failures
- Invalid signature (modified in transit, wrong key)
- No signature present
- DNS lookup errors (temperror, permerror)

### SPF Failures
- Unauthorized sender IP
- Soft fail (~all) vs hard fail (-all)
- Missing SPF record
- Too many DNS lookups (permerror)

### Alignment Issues
- Header From vs Envelope From mismatch
- DKIM signing domain not aligned
- SPF checked domain not aligned

## Development

See [DEVELOPER.md](docs/DEVELOPER.md) for setup instructions and contribution guidelines.

## Architecture

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for technical documentation.

## Privacy

- All file processing happens locally in your browser
- IP geolocation uses ip-api.com (free tier, no API key required)
- No DMARC report data is stored or transmitted to external servers
- IP lookup results are cached in memory for the session only

## License

MIT License

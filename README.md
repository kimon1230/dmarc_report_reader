# DMARC Report Reader

A Chrome/Edge browser extension that reads and visualizes DMARC (Domain-based Message Authentication, Reporting, and Conformance) aggregate reports.

## Features

- **Multiple Input Formats**: Supports plain XML, GZIP (.xml.gz), and ZIP archives
- **Drag and Drop**: Simply drop a DMARC report file onto the extension popup
- **IP Geolocation**: Shows country, ISP, and ASN for source IPs
- **Webmail Integration**: Detects DMARC attachments in Gmail and Outlook Web
- **Clear Visualization**: Color-coded pass/fail indicators for SPF and DKIM results

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

1. Click the extension icon in your browser toolbar
2. Either:
   - Drag and drop a DMARC report file onto the popup
   - Click "Select File" to open a file picker
3. View the parsed report with authentication results

### Webmail

When viewing emails in Gmail or Outlook Web, DMARC report attachments will show a "View Report" button for direct viewing.

## DMARC Report Contents

The extension parses and displays:

- **Report Metadata**: Reporting organization, date range, report ID
- **Policy Published**: Your domain's DMARC policy settings
- **Authentication Results**: Per-record breakdown showing:
  - Source IP (with geolocation)
  - Message count
  - SPF result and alignment
  - DKIM result and alignment
  - Policy disposition

## Development

See [DEVELOPER.md](docs/DEVELOPER.md) for setup instructions and contribution guidelines.

## Architecture

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for technical documentation.

## Privacy

- All file processing happens locally in your browser
- IP geolocation uses ip-api.com (free tier, no API key)
- No data is stored or transmitted to external servers (except IP lookups)

## License

MIT License

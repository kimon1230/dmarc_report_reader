# DMARC Report Reader

A Chrome/Edge browser extension that reads and visualizes DMARC (Domain-based Message Authentication, Reporting, and Conformance) aggregate reports.

## Features

- **Multiple Input Formats**: Supports plain XML, GZIP (.xml.gz), and ZIP archives (including multi-report ZIPs)
- **Multi-Report ZIP Support**: Automatically detects ZIPs with multiple DMARC reports and offers report selection or combination
- **Drag and Drop**: Simply drop a DMARC report file onto the viewer
- **IP Geolocation**: Shows country, city, hostname (reverse DNS), ISP, and ASN for source IPs
- **Provider Fingerprinting**: Identifies email service providers (Google, Microsoft, SendGrid, etc.) from IP data
- **Webmail Integration**: Detects DMARC attachments in Gmail and Outlook Web
- **Clear Visualization**: Color-coded pass/fail indicators with row highlighting
- **Advanced Filtering**: Filter by status, domain, IP/CIDR, country, hostname, provider, classification, and message count
- **Top-N Analysis**: See top sending IPs, failing domains, countries, and networks at a glance
- **Raw XML Viewer**: View and copy the original XML source with syntax highlighting
- **Export**: Export reports as JSON or CSV (respects active filters)
- **Error Diagnosis**: Contextual explanations and recommendations for authentication failures
- **Spoof vs Misconfiguration Classification**: Heuristic analysis to identify likely spoofing attempts vs legitimate senders with configuration issues
- **Enforcement Readiness Panel**: Safety assessment for DMARC policy transitions (none → quarantine → reject)
- **Disposition Override Explanation**: Explains when receivers override your DMARC policy (forwarding, mailing lists, etc.)
- **On-Demand Enrichment**: For large reports, IP enrichment is optional to save time
- **Session Caching**: IP lookup results persist within browser session

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

[Install from Chrome Web Store](https://chrome.google.com/webstore/detail/dmarc-report-reader) (pending review)

## Usage

### Direct File Opening

1. Click the extension icon in your browser toolbar
2. Either:
   - Drag and drop a DMARC report file onto the popup
   - Click "Select File" to open a file picker
3. View the parsed report with authentication results

### Webmail Integration

#### Gmail

The extension detects DMARC attachments in Gmail and shows a blue chart button:

**From Inbox View:**
1. DMARC attachment chips show the viewer button
2. Click the button - the extension navigates to the email
3. The attachment is automatically processed and the viewer opens
4. You stay on the email for reference

**From Email View:**
1. Open an email containing a DMARC report attachment
2. Look for the blue chart button next to matching attachments
3. Click the button - the viewer opens with the parsed report

#### Outlook Web (Experimental)

> **Warning:** Outlook Web integration is **experimental** and not fully tested. It may not work reliably in all scenarios. Please report any issues on GitHub.

The extension attempts to detect DMARC attachments in Outlook Web (outlook.live.com and outlook.office.com) with similar functionality to Gmail.

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

### Advanced Filtering

Click "Filters" to expand the filter panel:
- **Status**: Pass/Fail/Quarantine/Reject
- **Domain**: Search by From domain (substring match)
- **Source IP**: Filter by IP prefix or CIDR notation (e.g., `192.168.1.0/24`)
- **Country**: Dropdown of countries found in the report
- **Hostname**: Search by reverse DNS hostname
- **Min Messages**: Show only records with at least N messages

### Top-N Analysis Section

The Analysis section shows:
- **Top Sending IPs**: Highest volume senders with location info
- **Top Failing Domains**: Domains with the most authentication failures
- **Top Countries**: Geographic distribution of senders
- **Top Networks (ASN)**: ISPs and cloud providers sending the most mail

### Export Options

- **View XML**: View original XML source with syntax highlighting (Copy button available)
- **Export JSON**: Full structured data including analysis summaries (respects filters)
- **Export CSV**: Spreadsheet-compatible format with all key fields (respects filters)

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

### Disposition Overrides
- Forwarded mail (SPF breaks on forwarding)
- Mailing list modifications
- Receiver local policy overrides
- Sampling (pct < 100)

## Enforcement Readiness

The Enforcement Readiness panel helps you safely transition your DMARC policy:

| Status | Alignment | Recommendation |
|--------|-----------|----------------|
| **Safe** | 98%+ | Ready to move to stricter policy |
| **Caution** | 90-98% | Review failing sources before proceeding |
| **Not Ready** | <90% | Fix configuration issues before enforcement |

## Classification

Records are classified to help distinguish between:

- **Likely Spoof**: Suspicious patterns (both auth fail, high volume, unknown sender)
- **Likely Misconfiguration**: Legitimate sender patterns (known ESP, partial auth, single message)
- **Unknown**: Insufficient signals for classification

## Development

See [DEVELOPER.md](docs/DEVELOPER.md) for setup instructions and contribution guidelines.

## Architecture

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for technical documentation.

## Privacy & Security

- All file processing happens locally in your browser
- IP geolocation uses ip-api.com over HTTPS (free tier, no API key required)
- No DMARC report data is stored or transmitted to external servers
- IP lookup results are cached in browser session storage (cleared when browser closes)
- No tracking, no analytics, no data collection
- All user-controlled data is sanitized before display (XSS protection)
- Service worker validates message origins and payloads
- Manifest V3 enforces strict Content Security Policy
- `alarms` permission used only to keep service worker responsive (no data collection)

## License

MIT License

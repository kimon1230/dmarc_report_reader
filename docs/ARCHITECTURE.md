# DMARC Report Reader - Architecture

## Overview

DMARC Report Reader is a Manifest V3 Chrome/Edge browser extension that processes DMARC aggregate reports in XML format (plain, GZIP-compressed, or ZIP-archived) and presents them in a human-readable format with error diagnosis and recommendations.

## Architecture Diagram

![Architecture](architecture.png)

## Components

### Input Layer

| Component | File | Description |
|-----------|------|-------------|
| Popup | `src/popup/popup.js` | Handles drag-drop and file picker input |
| Gmail Content Script | `src/content/gmail.js` | Detects DMARC attachments in Gmail, injects viewer button |
| Outlook Content Script | `src/content/outlook.js` | Detects DMARC attachments in Outlook Web, injects viewer button |
| Viewer Drop Zone | `src/viewer/viewer.js` | Accepts drag-drop directly in viewer |

### Processing Layer

| Component | File | Description |
|-----------|------|-------------|
| Service Worker | `src/background/service-worker.js` | Central message hub, orchestrates processing |
| File Handler | `src/parser/file-handler.js` | Detects file format, extracts XML content |
| DMARC Parser | `src/parser/dmarc-parser.js` | Parses DMARC XML into structured JSON with statistics |

### External Libraries

| Library | Purpose | Location |
|---------|---------|----------|
| JSZip | ZIP file extraction | `lib/jszip.min.js` |
| pako | GZIP decompression | `lib/pako.min.js` |

### Services

| Service | File | Description |
|---------|------|-------------|
| IP Lookup | `src/services/ip-lookup.js` | Fetches geolocation and reverse DNS for source IPs |

**External API**: ip-api.com (HTTPS, free tier, 45 requests/minute, batch endpoint for efficiency)

**Session Caching**: IP lookup results are cached in `chrome.storage.session` with 24-hour TTL and 5000 entry limit. Cache persists across viewer sessions within the same browser session.

**On-Demand Enrichment**: Reports with more than 50 unique IPs prompt the user to choose between enriching immediately or skipping (can enrich later).

### Output Layer

| Component | Files | Description |
|-----------|-------|-------------|
| Report Viewer | `src/viewer/viewer.html`, `viewer.js`, `viewer.css` | Full-page report display with filtering, sorting, export |

## Data Flow

### File Processing Pipeline

```
Input File (XML/ZIP/GZ)
         │
         ▼
   ┌─────────────┐
   │ File Handler│ ─── Detect format via magic bytes
   └─────────────┘
         │
    ┌────┴────┬────────┐
    ▼         ▼        ▼
  [XML]    [GZIP]    [ZIP]
    │         │        │
    │    ┌────┘   ┌────┘
    │    ▼        ▼
    │  pako    JSZip
    │    │        │
    │    └───┬────┘
    │        │
    ▼        ▼
   ┌──────────────┐
   │ DMARC Parser │ ─── XML → Structured JSON + Statistics
   └──────────────┘
         │
         ▼
   ┌─────────────┐
   │ IP Lookup   │ ─── Enrich with geolocation & hostname
   └─────────────┘
         │
         ▼
   ┌─────────────┐
   │ Viewer      │ ─── Render, filter, diagnose, export
   └─────────────┘
```

### Message Passing

The extension uses Chrome's messaging API for communication:

```
Content Script ──processAttachment──▶ Service Worker
       │                                    │
       │                                    ▼
       │                             File Extraction
       │                                    │
       │                                    ▼
       │                             chrome.storage.local
       │                                    │
       └──────────────────────────────────▶ Viewer Tab
```

### Webmail Integration Flow

The extension injects buttons next to DMARC attachments and fetches them directly using the user's authenticated session.

#### Gmail - Email View Flow

```
Gmail Email View Load
         │
         ▼
   MutationObserver watches DOM
         │
         ▼
   Scan for elements with DMARC filenames (aria-label, data-tooltip)
         │
         ▼
   Inject blue chart button next to attachment
         │
         ▼
   On click: Find attachment download URL
         │
         ▼
   Fetch attachment data (with credentials)
         │
         ▼
   Send to Service Worker for extraction
         │
         ▼
   Open Viewer tab with parsed report
```

#### Gmail - Inbox View Flow

```
Gmail Inbox View
         │
         ▼
   Scan attachment chips for DMARC filenames
         │
         ▼
   Inject button next to attachment chip
         │
         ▼
   On click: Store pending filename in sessionStorage
         │
         ▼
   Navigate to email (click row)
         │
         ▼
   Email loads → checkPendingFile() finds matching button
         │
         ▼
   Auto-click button → Process attachment → Open Viewer
```

#### Outlook Web Flow

> **Note:** Outlook Web integration requires testing.

Similar flow to Gmail, with selectors adapted for Outlook's DOM structure.

**Key Design Decisions:**

1. **Direct fetch approach**: Gmail allows fetching attachments via authenticated URLs constructed from thread IDs. The extension finds these URLs by traversing the DOM.

2. **Inbox navigation**: When clicking from inbox, the extension navigates to the email first (Gmail doesn't expose download URLs in inbox view), then auto-processes.

3. **Tab positioning**: Viewer tabs open immediately to the right of the current tab for easy reference.

4. **Duplicate prevention**: Buttons are cleared and re-scanned on DOM changes to prevent duplicates.

## Viewer Features

### Summary Statistics

The parser calculates:
- Total message count
- DKIM/SPF pass/fail counts
- Quarantine/reject counts
- Pass rate percentages

### Advanced Filtering

| Filter | Description |
|--------|-------------|
| Status | All / Pass / Fail / Quarantine / Reject |
| Domain | Substring match on From header domain |
| Source IP | Prefix match or CIDR notation (e.g., `192.168.1.0/24`) |
| Country | Dropdown populated from report data |
| Hostname | Substring match on reverse DNS |
| Min Messages | Only show records with at least N messages |

| Sort | Description |
|------|-------------|
| Count (High-Low) | Most messages first |
| Count (Low-High) | Fewest messages first |
| IP Address | Alphabetical by IP |

### Top-N Analysis

The viewer calculates and displays:
- **Top Sending IPs**: Highest volume senders with location info
- **Top Failing Domains**: Domains with the most authentication failures
- **Top Countries**: Geographic distribution of senders
- **Top Networks (ASN)**: ISPs and cloud providers by volume

### Multi-Report ZIP Handling

When a ZIP file contains multiple DMARC reports:
1. File handler extracts all XML files
2. Viewer shows a modal for report selection
3. User can view individual reports or combine all
4. Combined view aggregates records with deduplicated analysis

### Error Diagnosis

The viewer provides contextual diagnosis for:

| Issue Type | Examples |
|------------|----------|
| DKIM Failures | Invalid signature, no signature, DNS errors |
| SPF Failures | Unauthorized IP, soft fail, no record, lookup limit |
| Alignment | Header/envelope From mismatch, domain not aligned |
| Disposition | Explains impact of quarantine/reject |

### Export Formats

| Format | Contents |
|--------|----------|
| JSON | Full structured report with all fields (respects active filters) |
| CSV | Flat table with key fields for spreadsheet analysis (respects active filters) |
| Raw XML | View and copy original XML source with syntax highlighting |

## DMARC Report Structure

### Input XML Schema

```xml
<feedback>
  <report_metadata>
    <org_name>google.com</org_name>
    <email>noreply-dmarc-support@google.com</email>
    <report_id>...</report_id>
    <date_range>
      <begin>1234567890</begin>
      <end>1234567890</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>example.com</domain>
    <adkim>r</adkim>
    <aspf>r</aspf>
    <p>quarantine</p>
    <sp>quarantine</sp>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>192.0.2.1</source_ip>
      <count>10</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
        <reason>...</reason>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>example.com</header_from>
      <envelope_from>bounce.example.com</envelope_from>
    </identifiers>
    <auth_results>
      <dkim>
        <domain>example.com</domain>
        <selector>selector1</selector>
        <result>pass</result>
      </dkim>
      <spf>
        <domain>example.com</domain>
        <result>pass</result>
      </spf>
    </auth_results>
  </record>
</feedback>
```

### Parsed JSON Structure

```javascript
{
  metadata: {
    orgName: "google.com",
    email: "...",
    reportId: "...",
    dateRange: { begin: Date, end: Date }
  },
  policy: {
    domain: "example.com",
    adkim: "relaxed",
    aspf: "relaxed",
    policy: "quarantine",
    subdomainPolicy: "quarantine",
    percentage: 100
  },
  records: [
    {
      sourceIp: "192.0.2.1",
      count: 10,
      policyEvaluated: {
        disposition: "none",
        dkim: "pass",
        spf: "pass",
        reasons: []
      },
      identifiers: {
        headerFrom: "example.com",
        envelopeFrom: "bounce.example.com",
        envelopeTo: "gmail.com"
      },
      authResults: {
        dkim: [{ domain, selector, result }],
        spf: [{ domain, scope, result }]
      },
      alignment: {
        headerEnvelopeMismatch: false
      }
    }
  ],
  summary: {
    totalMessages: 10,
    passedDkim: 10,
    failedDkim: 0,
    passedSpf: 10,
    failedSpf: 0,
    passedBoth: 10,
    failedBoth: 0,
    quarantined: 0,
    rejected: 0,
    dkimPassRate: 100,
    spfPassRate: 100,
    overallPassRate: 100
  }
}
```

## Security Considerations

1. **Content Security Policy**: Manifest V3 enforces strict CSP
2. **Local Processing**: All file parsing happens client-side
3. **Minimal Permissions**: Only requests necessary host permissions
4. **External API**: Only IP addresses are sent to ip-api.com over HTTPS (no email content)
5. **No Data Storage**: Reports are processed in memory only, not persisted
6. **Sandboxed Context**: Content scripts run in isolated worlds
7. **XSS Prevention**: All user-controlled data (domains, IPs, hostnames) is escaped before HTML rendering
8. **Message Validation**: Service worker validates sender origin and message payload structure
9. **Input Validation**: File data is validated (size limits, byte value checks) before processing
10. **Service Worker Retry**: Content scripts handle MV3 service worker lifecycle with retry logic

## Browser Compatibility

- Chrome 88+ (Manifest V3 support)
- Edge 88+ (Chromium-based)
- Firefox: Not supported (different extension API)

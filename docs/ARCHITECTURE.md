# DMARC Report Reader - Architecture

## Overview

DMARC Report Reader is a Manifest V3 Chrome/Edge browser extension that processes DMARC aggregate reports in XML format (plain, GZIP-compressed, or ZIP-archived) and presents them in a human-readable format.

## Architecture Diagram

![Architecture](architecture.png)

## Components

### Input Layer

| Component | File | Description |
|-----------|------|-------------|
| Popup | `src/popup/popup.js` | Handles drag-drop and file picker input |
| Gmail Content Script | `src/content/gmail.js` | Detects DMARC attachments in Gmail |
| Outlook Content Script | `src/content/outlook.js` | Detects DMARC attachments in Outlook Web |

### Processing Layer

| Component | File | Description |
|-----------|------|-------------|
| Service Worker | `src/background/service-worker.js` | Central message hub, orchestrates processing |
| File Handler | `src/parser/file-handler.js` | Detects file format, extracts XML content |
| DMARC Parser | `src/parser/dmarc-parser.js` | Parses DMARC XML into structured JSON |

### External Libraries

| Library | Purpose | Location |
|---------|---------|----------|
| JSZip | ZIP file extraction | `lib/jszip.min.js` |
| pako | GZIP decompression | `lib/pako.min.js` |

### Services

| Service | File | Description |
|---------|------|-------------|
| IP Lookup | `src/services/ip-lookup.js` | Fetches geolocation data for source IPs |

**External API**: ip-api.com (free tier, 45 requests/minute)

### Output Layer

| Component | Files | Description |
|-----------|-------|-------------|
| Report Viewer | `src/viewer/viewer.html`, `viewer.js`, `viewer.css` | Full-page report display |

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
   │ DMARC Parser │ ─── XML → Structured JSON
   └──────────────┘
         │
         ▼
   ┌─────────────┐
   │ IP Lookup   │ ─── Enrich with geolocation
   └─────────────┘
         │
         ▼
   ┌─────────────┐
   │ Viewer      │ ─── Render report
   └─────────────┘
```

### Message Passing

The extension uses Chrome's messaging API for communication:

```
Content Script ──sendMessage──▶ Service Worker ──sendMessage──▶ Popup/Viewer
                                      │
                                      ▼
                               File Processing
```

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
      </policy_evaluated>
    </row>
    <identifiers>...</identifiers>
    <auth_results>...</auth_results>
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
      disposition: "none",
      dkim: "pass",
      spf: "pass",
      identifiers: {...},
      authResults: {...},
      // Enriched by IP lookup:
      geo: {
        country: "US",
        city: "Mountain View",
        isp: "Google LLC",
        asn: "AS15169"
      }
    }
  ]
}
```

## Security Considerations

1. **Content Security Policy**: Manifest V3 enforces strict CSP
2. **Local Processing**: All file parsing happens client-side
3. **Minimal Permissions**: Only requests necessary host permissions
4. **External API**: Only IP addresses are sent to ip-api.com (no email content)

## Browser Compatibility

- Chrome 88+ (Manifest V3 support)
- Edge 88+ (Chromium-based)
- Firefox: Not supported (different extension API)

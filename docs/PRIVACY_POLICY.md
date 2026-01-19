# Privacy Policy for DMARC Report Reader

**Effective Date:** January 2026
**Last Updated:** January 2026

## Overview

DMARC Report Reader is a browser extension that reads and visualizes DMARC aggregate reports. This policy explains how we handle your data.

## Data We Process

The extension processes DMARC report files you provide via:
- Drag and drop
- File picker
- Gmail/Outlook attachment detection

## Data We Do NOT Collect

- We do not collect your DMARC reports
- We do not track browsing activity
- We do not use analytics
- We do not collect personal information
- We do not store email content

## Local Processing

**All report parsing happens locally in your browser.** Your data never leaves your device except for optional IP geolocation.

## External Services

### IP Geolocation (ip-api.com)

When you enable IP enrichment:
- **Sent:** Only IP addresses from reports
- **Not sent:** Domains, emails, message counts, auth results
- **Protocol:** HTTPS only
- **Optional:** You can skip enrichment for any report

## Browser Storage

- IP lookup results cached in session storage
- Cleared when browser closes
- Never transmitted externally
- No persistent storage of reports

## Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | Session cache for IP lookups |
| Gmail/Outlook access | Detect DMARC attachments |
| ip-api.com | Optional IP geolocation |

## Security

- HTTPS for all external communication
- Content Security Policy via Manifest V3
- XSS protection through input sanitization
- Message origin validation

## Open Source

Source code available at: https://github.com/kimon1230/dmarc_report_reader

## Contact

Questions: https://github.com/kimon1230/dmarc_report_reader/issues

---

**Summary:** All processing is local. We collect nothing. Optional IP lookups send only IP addresses.

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

**All report parsing happens locally in your browser.** Your data never leaves your device except for IP geolocation lookups.

## External Services

### IP Geolocation (ip-api.com)

The extension looks up geographic location and ISP information for IP addresses found in DMARC reports:

- **Small reports (50 or fewer unique IPs):** Lookup runs automatically
- **Large reports (more than 50 unique IPs):** You are prompted and can choose to skip
- **Sent:** Only IP addresses from reports
- **Not sent:** Domains, emails, message counts, auth results
- **Protocol:** HTTPS only

## Browser Storage

- IP lookup results cached in session storage
- Cleared when browser closes
- Never transmitted externally
- No persistent storage of reports

## Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | Session cache for IP lookups |
| `alarms` | Keep extension responsive during idle periods (no data collection) |
| Gmail/Outlook access | Detect DMARC attachments |
| ip-api.com | IP geolocation (automatic for small reports, opt-in for large reports) |

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

**Summary:** All processing is local. We collect nothing. IP lookups send only IP addresses to ip-api.com (automatic for small reports, skippable for large reports).

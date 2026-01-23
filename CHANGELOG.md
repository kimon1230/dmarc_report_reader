# Changelog

All notable changes to the DMARC Report Reader extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-01-22

### Fixed
- Service worker idle termination bug - extension now remains responsive after browser idle periods
- Added `alarms` permission to keep service worker alive (4-minute keep-alive interval)
- Content scripts now proactively ping service worker when tab regains focus
- Popup now includes retry logic for service worker communication (was missing)

### Technical
- Added `chrome.alarms` keep-alive mechanism to prevent MV3 service worker termination
- Added `visibilitychange` health checks in Gmail and Outlook content scripts
- Added `sendMessageWithRetry` to popup.js for resilient messaging

## [1.0.0] - 2026-01-19

### Added
- Initial release of DMARC Report Reader extension
- Support for plain XML, GZIP (.xml.gz), and ZIP archive formats
- Multi-report ZIP handling with selection modal
- IP geolocation via ip-api.com with session caching
- Provider fingerprinting for major ESPs (Google, Microsoft, SendGrid, etc.)
- Gmail webmail integration with inline viewer buttons
- Outlook Web integration (experimental)
- Advanced filtering by status, domain, IP/CIDR, country, hostname, provider, classification
- Top-N analysis panels (senders, failures, countries, ASNs)
- Enforcement readiness assessment panel
- Spoof vs misconfiguration classification heuristics
- Disposition override explanations
- Export to JSON and CSV (respects active filters)
- Raw XML viewer with syntax highlighting
- Drag-and-drop file loading
- XSS protection via input escaping
- Service worker retry logic for MV3 lifecycle

### Security
- All user-controlled data escaped before HTML rendering
- Message validation in service worker
- Input validation with size limits
- Strict Content Security Policy via Manifest V3
- Vendor library integrity verification via SHA-384 hashes

### Technical
- Manifest V3 Chrome/Edge extension
- Modular architecture with separate concerns
- Structured error types with user-friendly messages
- 95 automated tests (67 unit + 28 integration)
- GitHub Actions CI/CD pipeline

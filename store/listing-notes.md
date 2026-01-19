# Chrome Web Store Submission Notes

## Category
Primary: Productivity
Alternative: Developer Tools

## Single Purpose Statement
Reads and displays DMARC aggregate reports to help users understand email authentication status.

## Permission Justifications

### storage
Caches IP geolocation results in browser session storage to avoid redundant API calls when viewing reports with many unique IPs.

### host_permissions: mail.google.com
Required for Gmail webmail integration. Content script detects DMARC report attachments and enables one-click viewing.

### host_permissions: outlook.live.com, outlook.office.com
Required for Outlook Web integration (experimental). Same purpose as Gmail integration.

### host_permissions: ip-api.com
Required for optional IP geolocation feature. Only IP addresses from DMARC reports are sent to this free service.

## Remote Code Declaration
None. All JavaScript is bundled locally. Third-party libraries (JSZip 3.10.1, pako 2.1.0) are vendored with SHA-384 integrity verification.

## Data Usage Declaration
- No user data collection
- No analytics or tracking
- Local processing only
- Optional IP geolocation sends only IP addresses

# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Security Model

### Local Processing
All DMARC report parsing and analysis happens locally in your browser. No report data is sent to external servers.

### External API Usage
The extension uses ip-api.com for IP geolocation. Only IP addresses are transmitted (no email content, domains, or other report data). This API is called over HTTPS.

### Permissions Model
The extension requests minimal permissions:
- `storage` - For session caching of IP lookups
- `host_permissions` for Gmail and Outlook - For webmail integration only
- `host_permissions` for ip-api.com - For geolocation lookups

### Input Validation
- File size limits prevent memory exhaustion
- Magic byte validation prevents format confusion
- All user-controlled data is escaped before HTML rendering (XSS prevention)
- Service worker validates message origins and payload structure

### Vendor Dependencies
Third-party libraries (JSZip, pako) are:
- Bundled locally (not loaded from CDN)
- Verified via SHA-384 integrity hashes
- Version-pinned for reproducibility

Run `npm run validate-libs` to verify library integrity.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by:

1. **DO NOT** create a public GitHub issue
2. Email the maintainer directly with details
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes

We aim to respond within 48 hours and will work with you to understand and address the issue.

## Security Best Practices for Users

1. **Keep the extension updated** - Install updates promptly
2. **Review permissions** - The extension only needs the permissions listed above
3. **Verify the source** - Only install from official sources
4. **Report suspicious behavior** - If the extension behaves unexpectedly, report it

## Known Limitations

### Outlook Web Integration
The Outlook Web integration is marked as **experimental**. The DOM structure of Outlook Web changes frequently, which may cause the integration to break or behave unexpectedly. Use with caution in production environments.

### IP Geolocation Accuracy
IP geolocation data is provided by a third-party service and may not be 100% accurate. It should be used for general analysis, not for definitive geographic attribution.

# DMARC Report Reader - Developer Guide

## Prerequisites

- Chrome or Edge browser (version 88+)
- Git
- Text editor or IDE

## Project Structure

```
dmarc_report_reader/
├── manifest.json              # Extension manifest (V3)
├── src/
│   ├── background/
│   │   └── service-worker.js  # Background service worker
│   ├── content/
│   │   ├── gmail.js           # Gmail content script
│   │   └── outlook.js         # Outlook Web content script
│   ├── parser/
│   │   ├── file-handler.js    # Format detection and extraction
│   │   └── dmarc-parser.js    # XML to JSON parsing
│   ├── services/
│   │   └── ip-lookup.js       # IP geolocation service
│   ├── viewer/
│   │   ├── viewer.html        # Report viewer page
│   │   ├── viewer.js          # Viewer logic
│   │   └── viewer.css         # Viewer styles
│   └── popup/
│       ├── popup.html         # Extension popup
│       ├── popup.js           # Popup logic
│       └── popup.css          # Popup styles
├── lib/
│   ├── jszip.min.js           # ZIP library
│   └── pako.min.js            # GZIP library
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── docs/
│   ├── ARCHITECTURE.md
│   ├── architecture.dot       # Graphviz source
│   ├── architecture.png       # Generated diagram
│   └── DEVELOPER.md           # This file
└── README.md
```

## Development Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd dmarc_report_reader
```

### 2. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `dmarc_report_reader` directory
5. The extension icon should appear in your toolbar

### 3. Load Extension in Edge

1. Open Edge and navigate to `edge://extensions`
2. Enable **Developer mode** (toggle in left sidebar)
3. Click **Load unpacked**
4. Select the `dmarc_report_reader` directory

## Development Workflow

### Making Changes

1. Edit the source files
2. Go to `chrome://extensions`
3. Click the refresh icon on the extension card
4. Test your changes

### Debugging

**Popup:**
- Right-click the extension icon → "Inspect popup"

**Service Worker:**
- Go to `chrome://extensions`
- Click "Service Worker" link under your extension

**Content Scripts:**
- Open DevTools on Gmail/Outlook
- Check Console for content script logs

### Common Tasks

**Update manifest.json:**
After changing permissions or scripts, reload the extension.

**Regenerate architecture diagram:**
```bash
dot -Tpng docs/architecture.dot -o docs/architecture.png
```

## Testing

### Manual Testing Checklist

#### Popup UI
- [ ] Extension icon visible in toolbar
- [ ] Popup opens on click
- [ ] Drop zone highlights on drag-over
- [ ] File picker opens on button click
- [ ] Status messages display correctly

#### File Processing
- [ ] Plain XML file loads correctly
- [ ] GZIP compressed file (.xml.gz) loads correctly
- [ ] ZIP archive loads correctly
- [ ] Invalid files show error message

#### Report Viewer
- [ ] Report metadata displays correctly
- [ ] Policy information shows
- [ ] Records table populates
- [ ] Pass/fail indicators are color-coded
- [ ] IP geolocation loads (may take a moment)

#### Webmail Integration - Gmail
- [ ] Gmail: DMARC attachments detected in email view
- [ ] Gmail: Blue chart button appears next to attachments
- [ ] Gmail: Clicking button opens viewer with parsed report
- [ ] Gmail: DMARC attachments detected in inbox listing
- [ ] Gmail: Clicking inbox button navigates to email and auto-processes

#### Webmail Integration - Outlook Web (NEEDS TESTING)
> **Note:** Outlook Web integration has been implemented but requires testing.
- [ ] Outlook: DMARC attachments detected
- [ ] Outlook: "View Report" button appears
- [ ] Outlook: Clicking button processes attachment correctly

### Test Files

Sample DMARC reports for testing are available in the project root:
- `*.xml` - Plain XML reports
- `*.xml.gz` - GZIP compressed reports
- `*.zip` - ZIP archived reports

## Code Style

### JavaScript

- Use ES6+ features (const/let, arrow functions, async/await)
- JSDoc comments for functions
- Meaningful variable and function names
- No console.log in production (use for debugging only)

### CSS

- BEM-like naming convention
- CSS variables for colors/spacing
- Mobile-first responsive design

### HTML

- Semantic HTML5 elements
- Accessibility attributes (aria-labels, roles)
- No inline styles or scripts

## Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Test thoroughly (see checklist above)
4. Commit with clear message: `git commit -m "Add feature X"`
5. Push and create pull request

## Troubleshooting

### Extension Not Loading

- Check for syntax errors in manifest.json
- Ensure all referenced files exist
- Check Chrome DevTools console for errors

### Content Scripts Not Running

- Verify host_permissions in manifest.json
- Check that matches patterns are correct
- Reload the page after installing/updating

### Service Worker Issues

- Service workers have a limited lifetime
- Use chrome.storage for persistent data
- Check service worker logs in chrome://extensions

## Resources

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [DMARC Specification (RFC 7489)](https://tools.ietf.org/html/rfc7489)

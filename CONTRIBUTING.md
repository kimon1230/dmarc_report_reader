# Contributing to DMARC Report Reader

Thank you for your interest in contributing to DMARC Report Reader! This document provides guidelines and information for contributors.

## Getting Started

### Prerequisites
- Chrome or Edge browser (version 88+)
- Git
- Node.js (for running tests)
- Text editor or IDE

### Development Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd dmarc_report_reader
   ```

2. Install development dependencies:
   ```bash
   npm install
   ```

3. Load the extension in your browser:
   - Navigate to `chrome://extensions` (or `edge://extensions`)
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dmarc_report_reader` directory

### Running Tests

```bash
# Run all tests
npm run test:all

# Run unit tests only
npm test

# Run integration tests only
npm run test:integration

# Validate vendor libraries
npm run validate-libs
```

All tests must pass before submitting a pull request.

## Code Style

### JavaScript
- ES6+ features (const/let, arrow functions, async/await)
- JSDoc comments for functions
- Meaningful variable and function names
- No console.log in production code

### CSS
- BEM-like naming convention
- CSS variables for colors/spacing
- Mobile-first responsive design

### HTML
- Semantic HTML5 elements
- Accessibility attributes (aria-labels, roles)
- No inline styles or scripts

## Project Structure

```
dmarc_report_reader/
├── src/
│   ├── background/       # Service worker
│   ├── content/          # Gmail/Outlook content scripts
│   ├── parser/           # File handling, DMARC parsing, classification
│   ├── services/         # IP lookup, provider fingerprinting
│   ├── viewer/           # Report viewer (HTML, CSS, JS, modules)
│   ├── lib/              # Shared libraries (errors.js)
│   └── popup/            # Extension popup
├── lib/                  # Vendor libraries (JSZip, pako)
├── tests/                # Test files and fixtures
├── docs/                 # Documentation
└── scripts/              # Build/validation scripts
```

## Pull Request Process

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes:**
   - Follow the code style guidelines
   - Add tests for new functionality
   - Update documentation as needed

3. **Run tests:**
   ```bash
   npm run test:all
   ```

4. **Commit with clear messages:**
   ```bash
   git commit -m "Add feature X: brief description"
   ```

5. **Push and create PR:**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then create a pull request on GitHub.

### PR Requirements
- All tests pass
- No linting errors
- Clear description of changes
- Documentation updated if applicable
- Screenshots for UI changes

## Reporting Issues

### Bug Reports
Include:
- Browser version
- Extension version
- Steps to reproduce
- Expected vs actual behavior
- Sample DMARC file (if applicable, anonymized)

### Feature Requests
Include:
- Use case description
- Proposed solution
- Any alternatives considered

## Areas Needing Help

### High Priority
- **Outlook Web Integration**: Currently experimental. Help testing and improving DOM selector stability.
- **Firefox Support**: Manifest V3 support for Firefox.

### Medium Priority
- Additional email provider integrations
- Localization/internationalization
- Accessibility improvements

### Documentation
- User guides and tutorials
- Video walkthroughs
- Translation

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help newcomers get started
- Report harassment to maintainers

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

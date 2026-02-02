# CLAUDE.md - AI Assistant Guide

This document provides guidance for AI assistants working with the Outlook Add-in Commands Translator codebase.

## Project Overview

**Purpose:** A Microsoft Outlook Add-in that translates selected English text to Russian using the Yandex Translate API. The add-in adds a "Translate" button to Outlook's ribbon in the message composition form.

**Add-in Type:** Office Add-in using the Commands model (Outlook 2016+) with fallback Task Pane support for legacy clients (Outlook 2013, OWA).

## Directory Structure

```
Outlook-Add-in-Commands-Translator/
├── AppCompose/                    # Main application code
│   ├── App.js                     # Shared utilities (notifications)
│   ├── App.css                    # Common styles
│   ├── TranslateHelper.js         # Yandex API integration
│   ├── FunctionFile/              # Command model (Outlook 2016+)
│   │   ├── Home.html              # Entry point for ribbon command
│   │   └── Translator.js          # Command button handler
│   └── Home/                      # Task Pane model (legacy)
│       ├── Home.html              # Task pane UI
│       ├── Home.js                # Task pane handler
│       └── Home.css               # Task pane styles
├── Content/
│   └── Office.css                 # Office UI styling
├── Images/
│   └── Close.png                  # Notification close button
├── readme-images/                 # Documentation screenshots
├── TranslateAppManifest.xml       # Office Add-in manifest
├── Outlook-Add-in-Commands-Translator.yml  # Sample metadata
├── README.md                      # Project documentation
└── LICENSE                        # MIT License
```

## Technology Stack

- **JavaScript (ES5)** - No modern JS features; maintain ES5 compatibility
- **HTML5 / CSS3** - Standard web markup and styling
- **jQuery 1.9.1** - DOM manipulation and AJAX (loaded via CDN)
- **Office.js 1.1** - Office JavaScript API (loaded via CDN)
- **Yandex Translate API v1.5** - Translation service (JSONP)
- **XML** - Office Add-in manifest format

## Build & Development

**No build system** - This project uses direct file serving without npm, webpack, or bundling.

### Setup Steps

1. Clone the repository
2. Replace the Yandex API key placeholder in `AppCompose/TranslateHelper.js`
3. Upload `AppCompose/`, `Content/`, `Images/` to an HTTPS web server
4. Update `YOUR_WEB_SERVER` in `TranslateAppManifest.xml` with your HTTPS URLs
5. Load the manifest in Outlook via "Manage add-ins" > "Add from file"

### Testing

Manual testing only - load the add-in in Outlook, compose a new message, select text, and click "Translate".

## Key Files Reference

| File | Purpose |
|------|---------|
| `TranslateAppManifest.xml` | Office Add-in manifest - defines ribbon buttons, permissions, extension points |
| `AppCompose/FunctionFile/Translator.js` | Main command handler - `translate()` function for ribbon button |
| `AppCompose/Home/Home.js` | Legacy task pane handler for older Outlook versions |
| `AppCompose/TranslateHelper.js` | Shared translation logic - `generateRequestUrl()` for Yandex API |
| `AppCompose/App.js` | Shared utilities - `displayMessage()` for notifications |

## Architecture: Dual-Mode Support

The manifest uses `VersionOverrides` to support two execution modes:

### Command Mode (Outlook 2016+)
- Entry: `AppCompose/FunctionFile/Home.html` → `Translator.js`
- UI: Ribbon button with icon
- Handler: `translate()` function in global scope

### Task Pane Mode (Outlook 2013, OWA)
- Entry: `AppCompose/Home/Home.html` → `Home.js`
- UI: Sidebar panel with button
- Handler: jQuery click binding on `#translate` button

## Code Conventions

### JavaScript
- **ES5 syntax only** - No arrow functions, const/let, template literals, or classes
- Use `'use strict';` at file level
- jQuery for DOM manipulation
- Global functions for Office command handlers (e.g., `function translate()`)
- IIFE pattern for initialization code

### Office API Patterns
```javascript
// Initialize add-in
Office.initialize = function () {
    $(document).ready(function () {
        // Setup code
    });
};

// Get selected text
Office.context.mailbox.item.getSelectedDataAsync(
    Office.CoercionType.Text,
    function (asyncResult) {
        if (asyncResult.status === Office.AsyncResultStatus.Succeeded) {
            // Handle success
        }
    }
);

// Replace selected text
Office.context.mailbox.item.setSelectedDataAsync(
    data,
    { coercionType: Office.CoercionType.Html },
    callback
);

// Show notification
Office.context.mailbox.item.notificationMessages.addAsync(
    "unique-key",
    { type: "informationalMessage", message: "Text", persistent: false }
);
```

### HTML/CSS
- Standard HTML5 doctype
- Office.css for consistent Office UI styling
- CDN-hosted dependencies (jQuery, Office.js)

## Important Notes

### API Key Security
The Yandex API key in `TranslateHelper.js` is a placeholder (`"YOUR API KEY HERE"`). Never commit real API keys.

### HTTPS Requirement
Office Add-ins require HTTPS hosting with valid SSL certificates.

### Cross-Origin Requests
The add-in uses JSONP for Yandex API calls to avoid CORS issues:
```javascript
$.ajax({
    url: requestUrl,
    jsonp: "callback",
    dataType: "jsonp"
});
```

### Translation Flow
1. `getSelectedDataAsync()` retrieves selected text
2. `generateRequestUrl()` builds Yandex API URL (splits by newlines, URL-encodes)
3. JSONP request to `translate.yandex.net` (English → Russian)
4. Response: `{ text: ["line1", "line2", ...] }`
5. `setSelectedDataAsync()` replaces selection with translated HTML

### Manifest Configuration
- **Add-in ID:** `8fbdd69c-2cfb-4a6e-aec4-cc316ed4e5e0`
- **Permissions:** `ReadWriteItem` (required for text replacement)
- **API Set:** `MailBox 1.1`
- **Extension Point:** `MessageComposeCommandSurface`

## Common Tasks

### Adding a New Command Button
1. Edit `TranslateAppManifest.xml`
2. Add `<Control>` element under `<Group>` in `<ExtensionPoint>`
3. Define action type (`ExecuteFunction` or `ShowTaskpane`)
4. Create handler function in `Translator.js`

### Modifying Translation Logic
Edit `AppCompose/TranslateHelper.js`:
- `generateRequestUrl()` - Change language pairs or API endpoint
- Response processing in `Translator.js` or `Home.js`

### Updating UI Messages
Edit `AppCompose/App.js`:
- `displayMessage()` function controls notification display

### Supporting Additional Outlook Surfaces
Edit `TranslateAppManifest.xml`:
- Add new `<ExtensionPoint>` elements (e.g., `MessageReadCommandSurface`)
- Update `<FormSettings>` for task pane fallback

## Limitations

- Single language pair (English → Russian) hardcoded
- No offline functionality
- Dependent on Yandex API availability
- Legacy jQuery version (1.9.1)
- No unit tests or automated testing

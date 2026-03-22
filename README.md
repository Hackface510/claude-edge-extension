# Claude Edge Extension

A fully functional Microsoft Edge (and Chrome) browser extension powered by the **Anthropic Claude API** — featuring a persistent sidebar with Chat, Page Automation, Workflow Recorder, Content Extraction, and Document Analysis.

## Features

- **Chat Sidebar** — Ask Claude anything. Toggle "Include this page" to discuss the current website.
- **Page Automation** — Describe a task in plain English; Claude generates and executes the steps.
- **Workflow Recorder** — Record your browser actions, save them, and replay on demand.
- **Content Extraction** — Summarize pages, extract data, or analyze uploaded documents (TXT, MD, JSON, CSV).
- **Document Support** — Upload and query documents directly.
- **Context Menus** — Right-click any page to Summarize, Explain a selection, or Automate.

## File Structure

```
claude-edge-extension/
├── manifest.json        # Manifest V3 — all permissions, side panel, content scripts
├── background.js        # Service Worker: message router + Claude API caller
├── api-client.js        # Claude API wrapper (streaming + standard)
├── storage.js           # chrome.storage.local typed wrapper
├── content.js           # Page injected script: recorder, toasts, element highlighting
├── side_panel.html      # Full dark-mode sidebar UI (5 panels)
├── side_panel.js        # All UI logic: chat, automate, workflows, extract, settings
└── icons/
    ├── icon.svg         # Source SVG icon (indigo "C" logo)
    └── generate_icons.py  # Script to generate PNG icons from SVG
```

## Installation

### Step 1 — Generate Icons (requires Python + cairosvg or Pillow)

```bash
cd icons
pip install cairosvg
python generate_icons.py
```

Or manually create 16x16, 32x32, 48x48, 128x128 PNG files from `icons/icon.svg` using any image editor and save as `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`.

**Quick alternative (no Python needed):** Use an online SVG-to-PNG converter or simply copy the SVG and rename the files.

### Step 2 — Load into Edge

1. Download or clone this repository
2. Open Microsoft Edge and go to `edge://extensions/`
3. Enable **Developer mode** (bottom-left toggle)
4. Click **Load unpacked** and select the `claude-edge-extension` folder
5. The Claude icon should appear in your toolbar

### Step 3 — Add your API Key

1. Click the Claude icon in the Edge toolbar to open the sidebar
2. Click the **Settings** tab (⚙️)
3. Enter your Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com))
4. Click **Save Key**, then **Test Connection**

## Usage

### Chat
- Type questions in the Chat tab
- Toggle **"Include this page's content"** to talk about the current site
- Right-click a page → "Summarize this page with Claude"

### Automate
- Go to any website, open the extension, click **Automate**
- Describe what you want done: *"Fill the search box with 'AI news' and click search"*
- Review the generated steps, then click **Execute All** or run individual steps

### Workflow Recorder
- Click **Start Recording**, perform actions on the page
- Click **Stop Recording**, name your workflow, and save it
- Run saved workflows from the Workflows panel at any time

### Extract
- Open any page, type what you want extracted (e.g. *"List all prices"*)
- Or upload a TXT/MD/JSON/CSV file and ask questions about it

## Tech Stack

| Component | Tech |
|---|---|
| Extension API | Manifest V3, Chrome/Edge APIs |
| AI Backend | Anthropic Claude API (claude-sonnet-4-5) |
| Storage | chrome.storage.local |
| UI | Vanilla JS + CSS (no frameworks) |
| Side Panel | Edge/Chrome sidePanel API |

## Security Notes

- Your API key is stored locally in `chrome.storage.local` (never sent anywhere except Anthropic)
- The extension uses the `anthropic-dangerous-direct-browser-access` header required for direct browser calls
- No data is collected or sent to third parties

## Requirements

- Microsoft Edge 114+ or Google Chrome 114+ (for sidePanel support)
- An [Anthropic API key](https://console.anthropic.com)
- The extension works without a paid Claude subscription — you pay per API token

---

Built with the Claude API architecture described in [Anthropic's documentation](https://docs.anthropic.com).

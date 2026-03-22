# Snap Links

**Google Chrome Extension** - Select and open multiple links at once using a lasso tool.

## Overview

Snap Links lets you draw a selection box around multiple links on any webpage and open them all at once — in new tabs, new windows, or one window with tabs. No clicks, no menus.

## Features

- **One-button flow** — works right after install, no setup required
- **Lasso selection** — hold Alt + drag to draw a box around links
- **Configurable trigger** — change activation key (Alt / Ctrl / Shift / none) and mouse button
- **Three open modes** — new tabs / new windows / one window with tabs
- **Opening speed** — Fast, Balanced, or Safe mode for large batches
- **Real-time link counter** — see how many links are selected as you draw
- **Auto-scroll** — selection box scrolls the page automatically near edges
- **Browser theme support** — icon adapts to light/dark Chrome theme
- **Keyboard shortcuts** — Alt+S opens popup, Alt+Shift+S switches action

## Quick Start

1. **Install** from Chrome Web Store
2. **It's already ON** — no activation needed
3. **Hold Alt + drag** over links on any webpage
4. **Release** — links open in new tabs automatically

That's it. Open Alt+S popup to change default action or customize behavior.

## How It Works

1. Hold **Alt** and press the **left mouse button**
2. Drag a selection box around links — a counter shows how many are selected
3. Release — links open instantly with your default action

To change what happens after selection: press **Alt+S** → choose action or switch in one click.

## Version History

### Version 0.3.1 (Latest)
- Extension is ON automatically after install — no manual activation
- One-button flow: release lasso → links open with configured default action
- Alt+S shortcut opens popup; Alt+Shift+S switches action with on-screen toast
- Result toast: shows how many links were opened
- Opening speed modes: Fast / Balanced / Safe
- Welcome page on install

### Version 0.3.0
- Activation modifier setting (none / Alt / Shift / Ctrl)
- Optional auto-enable on browser startup
- Automated cws-pack build with minification

### Version 0.2.9
- Fixed critical mouse event handling bugs
- Added browser theme support (light/dark icons)
- Improved window focus detection

### Version 0.2.8
- New lasso selection algorithm
- Real-time link counting
- Auto-scroll functionality
- Multi-button mouse support

### Version 0.2.1
- Initial release with basic lasso selection

## Technical Details

- **Manifest Version:** V3 (MV3)
- **Permissions:** Active tab, Storage, Scripting
- **Compatibility:** Chrome 88+

## Known Limitations

- Works on standard `https://` pages only (not on `chrome://` or PDF pages)
- Some dynamic/JavaScript-generated links may not be selectable
- Does not work on pages with strict Content Security Policy

## Support

For issues or feature requests, please open an issue in the repository.

---

**Happy link opening!**

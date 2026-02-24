Website Time Cost — Chrome Extension

Minimal overlay that shows how much time you’ve already spent on the current site. It’s meant to be super lightweight and screenshot-worthy.

Features
- Per-domain time tracking across days (stored locally)
- Minimal overlay in the top-right corner
- Toggle on/off for the current site by clicking the toolbar icon or the “Hide here” button

Install (Unpacked)
1. Build nothing — it’s plain MV3.
2. Open Chrome → chrome://extensions
3. Enable “Developer mode”.
4. Click “Load unpacked” and select this repository folder (the one containing `manifest.json`).
5. Visit any site to see the overlay.

How it works
- The content script tracks attention time for the current tab when it is visible and focused (approximation of real usage).
- Every ~5s it syncs deltas to the background service worker.
- The background aggregates daily and lifetime totals in `chrome.storage.local`.
- The overlay message: “This page already consumed: ⏱ X of your life” (lifetime on this domain), with time shown as `Yy Dd Hh Mm Ss`, hiding leading zero units (e.g., `2h 7m 0s`, `45s`).

Notes
- “Lifetime” means since installation on your machine.
- Data never leaves your browser. There’s no network access.
- If you want the overlay hidden on a site, click the extension icon or the “Hide here” button in the overlay.

Folder
- manifest.json
- background.js
- contentScript.js

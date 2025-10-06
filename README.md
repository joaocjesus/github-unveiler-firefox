# GitHub Unveiler Firefox

Firefox-only fork of the original GitHub Unveiler extension (v1.9). Use the upstream project for Chrome or other Chromium browsers. All core credit for the concept and initial implementation goes to the original author (@RedRecondite).

Upstream (Chrome) Web Store listing: https://chromewebstore.google.com/detail/github-unveiler/nepdghlcapkfgnficpnefibalbhjofaa  
Upstream source repository: https://github.com/RedRecondite/github-unveiler

This fork focuses on:
* Firefox support (currently MV2 manifest)
* Reduced friction for GitHub Enterprise instances
* Incremental security hardening oriented to Firefox

## Usage

1. Navigate to a GitHub web page.
2. Click on the GitHub Unveiler Firefox icon in the Extensions menu.
3. Allow access.

## Developer Installation (Firefox)

Two options:

### Quick Temporary Install
1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on".
3. Select `manifest.json` (or any file in the folder) – Firefox will load the whole directory.
4. Click the extension icon on a GitHub page to activate (the first click grants activeTab permission and injects the script).

### Using web-ext (auto-reload)
Install dependencies (first time only) then run the helper script:

```
npm install
npm run firefox:run
```

The extension will launch in a temporary Firefox profile with verbose logging.

### Building a signed package (for AMO submission)

```
npm run firefox:build
```

Artifacts will be in `dist/`. During AMO submission you can keep or change the `browser_specific_settings.gecko.id`.

## Notes

* Manifest: Currently MV2 (background script with `browser_action`).
* CSP: Extension pages use a restrictive `content_security_policy` of `script-src 'self'; object-src 'self'` (no remote script execution).
* Cache: Display names cached per-origin with 7‑day aging + soft cap (1000 entries per origin, older non-pinned entries evicted first).
* `background.js` detects absence of `chrome.permissions.request` and falls back to activeTab injection.

## Credits

* Original concept & base implementation: GitHub Unveiler (Chrome) – credit to @RedRecondite (repository: https://github.com/RedRecondite/github-unveiler).

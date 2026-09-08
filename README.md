# OMR Scanner PWA

This repository now provides a browser-first OMR scanner that runs fully on the website and can be installed on mobile as an app.

Live site: `https://mdtonmoyfaraji.github.io/omr/`

## What it supports

- Scan answer key and student sheet from phone camera/gallery
- In-browser OMR parsing and scoring (no server call required)
- PWA install (`Add to Home Screen` / install prompt)
- Offline usage after first load (service worker cache)
- Local recent result history on device

## Use on mobile

1. Open the live site in Chrome/Safari.
2. Install it from the browser install prompt or menu.
3. Open the installed app from your home screen.
4. Capture/upload answer key and student sheet.
5. Tap **Scan & Score**.

## Notes

- For best detection, keep sheet flat, visible, and well lit.
- First online load is required so assets can be cached for offline use.
- Existing FastAPI backend files are still present for local/server workflows, but GitHub Pages usage is fully static.

# FocusPet (frontend)

**Quick Start**

1. Install dependencies

```bash
cd frontend
npm install
```

2. Run the app (development)

```bash
npm start
```

The `start` script runs Electron (`electron .`) and opens the app window. During development the app opens DevTools automatically — you can disable that by editing `index.js`.

**What the Main Parts Do**

- `index.js` (main process)
	- Creates the Electron BrowserWindow and sets security headers (COOP/COEP) required to run MediaPipe WASM in the renderer.
	- Handles camera permission requests and contains IPC handlers to poll the active OS window (uses `active-win` in the main process).
	- Starts/stops forwarding active-window events to the renderer on demand.

- `renderer.js` (renderer bootstrap)
	- Imports and initializes the UI features. Calls `initEyeTrackerUI()` on DOMContentLoaded.

- `features/eyetracking.js` (UI + orchestration)
	- Orchestrates the focus session lifecycle (start/stop), UI timers, and the state machine that classifies `looking` vs `away`.
	- Starts the camera preview and loads the MediaPipe Face Landmarker model for eye/gaze detection.
	- Subscribes to active-window events forwarded from the main process and accumulates per-application time while a session is active.

- `features/camera.js`
	- Encapsulates getUserMedia camera setup and preview element creation/removal.

- `features/landmarker.js`
	- Loads MediaPipe Tasks Vision FaceLandmarker via CDN FilesetResolver and exposes a small detection API.

- `features/activeWindowTracker.js` and `preload.js`
	- `index.js` (main) polls the OS (using `active-win`) and forwards changes via IPC.
	- `preload.js` exposes a safe `window.electronAPI` for the renderer to receive active-window events.
	- `activeWindowTracker.js` accumulates per-app session times in the renderer while a session runs.

- `features/storage.js`
	- Simple localStorage wrapper for persisting per-app totals and the last session breakdown.

- `features/browser-filter/extension/`
	- Companion MV3 Chrome extension (popup + service worker) that can apply dynamic declarativeNetRequest rules to allow/block sites; the extension saves allowlist/blacklist rules to `chrome.storage.local`.

# FocusPet (CSS Animation)

This subfolder contains the animated Husky for FocusPet, currently with two emotional states: Happy and Sad.
It’s a static demo built entirely with HTML and CSS.

**Quick Start**

Open the HTML files in a browser

```bash
# Happy Husky
open css-animation/index.html

# Sad Husky
open css-animation/index2.html
```
**How It Works**

- `index.html` loads `husky.css` for the happy animation.
- `index2.html` loads `husky_sad.css` for the sad animation.
- Each page uses the same HTML structure, containing a nested set of `<div>` elements that form the husky’s body parts (`.husky-head`, `.husky-face`, `.husky-ear`, etc.).
- CSS keyframes animate these parts (e.g. wagging tail, blinking eyes, tilting head) to create lifelike motion.

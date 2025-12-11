# FocusPet

**Quick Start**

1. Install dependencies (frontend)

```bash
cd frontend
npm install
```

2. Run backend (start from root of repo)
```bash
cd FocusBackend
dotnet run
```

3. Run the app (again from root)

```bash
cd frontend
npm start
```
The `start` script runs Electron (`electron .`) and opens the app window.

4. Chrome Extension

	Using our development chrome extension in your browser may take a few steps. 
	- Start by going to Chrome (or a browser that operates on Chromium).
	- Find the 'Extensions' button and click 'Manage Extensions'
	- Toggle 'Developer mode'
	- Then click the 'Load Unpacked' button. This will open a file dialog where you will then have to navigate to wherever the repository is cloned. The navigate to `browser-filter/extension` and select the `extension` directory.

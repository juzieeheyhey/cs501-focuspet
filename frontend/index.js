import { app, BrowserWindow, session, ipcMain } from 'electron';
import path from 'node:path';
import activeWin from 'active-win';

let mainWindow;
let activeWinInterval = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(process.cwd(), 'preload.js'),
            contextIsolation: true, // Run preload script in isolated context
            nodeIntegration: false, // Disable Node.js integration for security
            enableBlinkFeatures: 'SharedArrayBuffer', // Required for MediaPipe
            sandbox: false,
        },
    });


    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const headers = {
            ...details.responseHeaders,
            'Cross-Origin-Opener-Policy': ['same-origin'],
            'Cross-Origin-Embedder-Policy': ['require-corp'],
        };
        callback({ responseHeaders: headers });
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'media') {
            callback(true); // allow camera access
        } else {
            callback(false); // deny all other requests
        }
    });

    mainWindow.loadFile(path.join(process.cwd(), 'index.html'));
    // mainWindow.webContents.openDevTools(); // Open DevTools for debugging

    // NOTE: active-win polling is controlled by renderer requests (start/stop).
    // We do NOT start polling here so the renderer can request polling only when a session is active.

    // On macOS the default is to keep the app running after the window is closed.
    // If you want the app process to exit when the user clicks the red close button,
    // call app.quit() when the window is closed.
    mainWindow.on('closed', () => {
        mainWindow = null;
        // Quit the app entirely (this ensures the process terminates)
        app.quit();
    });


    function startActiveWindowPolling(ms = 1000) {
        if (activeWinInterval) return;
        let prevOwnerName = null;
        // send initial state immediately
        (async () => {
            try {
                const info = await activeWin();
                const ownerName = info?.owner?.name || 'unknown';
                prevOwnerName = ownerName;
                if (info && mainWindow?.webContents) mainWindow.webContents.send('active-window', info);
            } catch (err) { /* ignore */ }
        })();

        activeWinInterval = setInterval(async () => {
            try {
                const info = await activeWin();
                const ownerName = info?.owner?.name || 'unknown';
                // Only forward when the active application changes to reduce noise
                if (ownerName !== prevOwnerName) {
                    prevOwnerName = ownerName;
                    if (info && mainWindow?.webContents) {
                        mainWindow.webContents.send('active-window', info);
                    }
                }
            } catch (err) {
                console.error('active-win error', err);
            }
        }, ms);
    }

    function stopActiveWindowPolling() {
        if (!activeWinInterval) return;
        clearInterval(activeWinInterval);
        activeWinInterval = null;
    }

    // IPC controls (optional): allow renderer to start/stop or request one-shot
    ipcMain.on('active-window-start', () => startActiveWindowPolling());
    ipcMain.on('active-window-stop', () => stopActiveWindowPolling());
    ipcMain.handle('get-active-window', async () => {
        try {
            return await activeWin();
        } catch { return null; }
    });

}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

import { app, BrowserWindow, session, ipcMain } from 'electron';
import path from 'node:path';
import activeWin from 'active-win';
import { spawn } from 'child_process';
import fs from 'fs';

let HOST_BINARY;
// Track spawned native child processes so we can cleanly terminate them on exit
const childProcs = new Set();

// Prevent multiple app instances (keep a single instance running)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    console.warn('Another instance is already running — exiting this instance.');
    app.quit();
}
else {
    app.on('second-instance', (_event, _argv, _cwd) => {
        // Someone tried to start a second instance — focus the existing window
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

let mainWindow;
let activeWinInterval = null;
let lastSessionWindow = null;

function createWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        webPreferences: {
            preload: path.join(process.cwd(), 'preload.js'),
            contextIsolation: true, // Run preload script in isolated context
            nodeIntegration: false, // Disable Node.js integration for security
            enableBlinkFeatures: 'SharedArrayBuffer', // Required for MediaPipe
            sandbox: false,
        },
    });

    // Set up security headers
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

    // Call app.quit() when the window is closed.
    mainWindow.on('closed', () => {
        mainWindow = null;
        try { app.quit(); } catch (e) {}
    });

    // Active window tracking via active-win
    function startActiveWindowPolling(ms = 1000) {
        if (activeWinInterval) return;  // already running
        let prevOwnerName = null;
        let prevUrl = null;
        let prevTitle = null;
        // send initial state immediately
        (async () => {
            try {
                // Get initial active window info
                const info = await activeWin();
                const ownerName = info?.owner?.name || 'unknown';
                prevOwnerName = ownerName;
                prevUrl = info?.url ?? null;
                prevTitle = info?.title ?? null;
                // if info is valid, send to renderer
                if (info && mainWindow?.webContents) mainWindow.webContents.send('active-window', info);
            } catch (err) { console.error('active-win error', err); }
        })();

        // set up interval polling
        activeWinInterval = setInterval(async () => {
            try {
                const info = await activeWin();
                const ownerName = info?.owner?.name || 'unknown';
                const url = info?.url ?? null;
                const title = info?.title ?? null;
                // Forward when the active application changes OR the URL/title changes (to catch intra-app navigation)
                if (ownerName !== prevOwnerName || url !== prevUrl || title !== prevTitle) {
                    prevOwnerName = ownerName;
                    prevUrl = url;
                    prevTitle = title;
                    if (info && mainWindow?.webContents) {
                        mainWindow.webContents.send('active-window', info);     // send new info to renderer
                    }
                }
            } catch (err) {
                console.error('active-win error', err);
            }
        }, ms);
    }

    function stopActiveWindowPolling() {
        // Stop the active window polling interval and cleanup
        if (!activeWinInterval) return;
        clearInterval(activeWinInterval);
        activeWinInterval = null;
    }

    // Function to open the last session popup window
    function openLastSessionWindow(payload) {
        // If already open, just focus and update
        if (lastSessionWindow && !lastSessionWindow.isDestroyed()) {
            lastSessionWindow.webContents.send('last-session-window', payload); // update with new payload
            lastSessionWindow.focus();
            return;
        }
        // define window for last session popup
        lastSessionWindow = new BrowserWindow({
            width: 420,
            height: 520,
            parent: mainWindow,
            modal: true,
            resizable: false,
            minimizable: false,
            maximizable: false,
            webPreferences: {
                preload: path.join(process.cwd(), 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        // cleanup for popup modal
        lastSessionWindow.on('closed', () => {
            lastSessionWindow = null;
        });
        // load the HTML file and send payload
        lastSessionWindow.loadFile(path.join(process.cwd(), 'last-session.html'));
        // wait for the window to finish loading then send payload
        lastSessionWindow.webContents.once('did-finish-load', () => {
            lastSessionWindow.webContents.send('last-session-window', payload);
        });
    }

    // IPC controls: allow renderer to start/stop
    ipcMain.on('active-window-start', () => startActiveWindowPolling());
    ipcMain.on('active-window-stop', () => stopActiveWindowPolling());
    ipcMain.handle('get-active-window', async () => {
        try {
            return await activeWin();
        } catch { return null; }
    });
    ipcMain.on('open-last-session-window', (event, payload) => openLastSessionWindow(payload));
}


app.whenReady().then(createWindow);

// Graceful cleanup: stop intervals and kill any spawned child processes
function gracefulShutdown() {
    try {
        if (activeWinInterval) {
            clearInterval(activeWinInterval);
            activeWinInterval = null;
        }
    } catch (e) {}
    try {
        for (const p of childProcs) {
            try { p.kill(); } catch (e) {}
        }
        childProcs.clear();
    } catch (e) {}
}

app.on('before-quit', () => {
    gracefulShutdown(); // call cleanup function
});

// Also handle signals in case the process is terminated externally
process.on('SIGINT', () => { gracefulShutdown(); process.exit(0); });
process.on('SIGTERM', () => { gracefulShutdown(); process.exit(0); });

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

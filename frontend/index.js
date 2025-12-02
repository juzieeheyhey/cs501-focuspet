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

function resolveHostBinary() {
    const isDev = !app.isPackaged;
    const os = process.platform;
    const arch = process.arch;

    if (isDev) {
        // Development binaries inside repo
        if (os === "darwin") {
            return arch === "arm64"
                ? path.join(process.cwd(), "native/macos-arm64/focuspet-host")
                : path.join(process.cwd(), "native/macos-x64/focuspet-host");
        }
        if (os === "win32") {
            return path.join(process.cwd(), "native/win-x64/focuspet-host.exe");
        }
        return path.join(process.cwd(), "native/linux-x64/focuspet-host");
    }

    // Production: packaged into resources
    if (os === "win32") {
        return path.join(process.resourcesPath, "focuspet-host.exe");
    }
    return path.join(process.resourcesPath, "focuspet-host");
}
HOST_BINARY = resolveHostBinary();
console.log("Native Host path:", HOST_BINARY);

ipcMain.handle("native:send", async (_event, payload) => {
    return new Promise((resolve, reject) => {
        try {
            const proc = spawn(HOST_BINARY, [], { stdio: ["pipe", "pipe", "ignore"], detached: false });
            childProcs.add(proc);

            // Safety: ensure native process doesn't hang forever
            const killTimer = setTimeout(() => {
                try { proc.kill(); } catch (e) { /* ignore */ }
            }, 30_000);

            const json = Buffer.from(JSON.stringify(payload));
            const header = Buffer.alloc(4);
            header.writeUInt32LE(json.length, 0);

            let resolved = false;

            proc.stdout.on("data", () => {
                if (!resolved) {
                    resolved = true;
                    resolve(true);
                }
            });

            proc.on("error", (err) => {
                if (!resolved) {
                    resolved = true;
                    reject(err);
                }
            });

            proc.on("close", (code) => {
                clearTimeout(killTimer);
                childProcs.delete(proc);
                if (!resolved) {
                    code === 0 ? resolve(true) : reject(new Error(`Native host exit ${code}`));
                }
            });

            proc.stdin.write(header);
            proc.stdin.write(json);
            proc.stdin.end();
        } catch (err) {
            reject(err);
        }
    });
});


let mainWindow;
let activeWinInterval = null;
let lastSessionWindow = null;

function createWindow() {
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
        // On macOS we still quit here to ensure standalone app exits when window closed.
        try { app.quit(); } catch (e) { /* ignore */ }
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

    function openLastSessionWindow(payload) {
        if (lastSessionWindow && !lastSessionWindow.isDestroyed()) {
            lastSessionWindow.webContents.send('last-session-window', payload);
            lastSessionWindow.focus();
            return;
        }
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
        lastSessionWindow.on('closed', () => {
            lastSessionWindow = null;
        });
        lastSessionWindow.loadFile(path.join(process.cwd(), 'last-session.html'));
        lastSessionWindow.webContents.once('did-finish-load', () => {
            lastSessionWindow.webContents.send('last-session-window', payload);
        });
    }
    // IPC controls (optional): allow renderer to start/stop or request one-shot

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
    } catch (e) { /* ignore */ }
    try {
        for (const p of childProcs) {
            try { p.kill(); } catch (e) { /* ignore */ }
        }
        childProcs.clear();
    } catch (e) { /* ignore */ }
}

app.on('before-quit', () => {
    gracefulShutdown();
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

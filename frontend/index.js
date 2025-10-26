import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            // preload: path.join(process.cwd(), 'preload.js'),
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
    mainWindow.webContents.openDevTools(); // Open DevTools for debugging


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

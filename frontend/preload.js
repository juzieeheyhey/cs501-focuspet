import { contextBridge, ipcRenderer } from 'electron';

// Expose backend base URL (can be overridden with the BACKEND_BASE env var)
const BACKEND_BASE = process.env.BACKEND_BASE || 'http://localhost:5185';
contextBridge.exposeInMainWorld('BACKEND_BASE', BACKEND_BASE);

// Expose IPC methods for active window polling
contextBridge.exposeInMainWorld('electronAPI', {
    onActiveWindow: (cb) => {
        ipcRenderer.on('active-window', (_event, info) => cb(info));    // listen for active window info
    },
    requestStartPolling: () => ipcRenderer.send('active-window-start'), // start polling for active window
    requestStopPolling: () => ipcRenderer.send('active-window-stop'),   // stop polling for active window
    invokeGetActiveWindow: () => ipcRenderer.invoke('get-active-window'),   // one-shot request for active window
});

contextBridge.exposeInMainWorld('lastSessionPopup', {
    open: (payload) => ipcRenderer.send('last-session-window:openWindow', payload), // open last session popup
    onLoad: (cb) => {
        ipcRenderer.on('last-session-window:load', (_evt, data) => cb(data));   // listen for payload on load
    }
});

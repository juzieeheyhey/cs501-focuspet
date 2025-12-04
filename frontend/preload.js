import { contextBridge, ipcRenderer } from 'electron';

// Expose backend base URL (can be overridden with the BACKEND_BASE env var)
const BACKEND_BASE = process.env.BACKEND_BASE || 'http://localhost:5185';
contextBridge.exposeInMainWorld('BACKEND_BASE', BACKEND_BASE);

contextBridge.exposeInMainWorld('lastSessionPopup', {
    open: (payload) => ipcRenderer.send('last-session-window:openWindow', payload),
    onLoad: (cb) => {
        ipcRenderer.on('last-session-window:load', (_evt, data) => cb(data));
    }
});

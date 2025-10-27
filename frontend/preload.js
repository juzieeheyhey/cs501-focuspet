import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    onActiveWindow: (cb) => {
        ipcRenderer.on('active-window', (_event, info) => cb(info));
    },
    requestStartPolling: () => ipcRenderer.send('active-window-start'),
    requestStopPolling: () => ipcRenderer.send('active-window-stop'),
    invokeGetActiveWindow: () => ipcRenderer.invoke('get-active-window'),
});

// Renderer-side active window tracker. Subscribes to preload -> main forwarded
// 'active-window' events (via window.electronAPI.onActiveWindow)

let appTimes = {};
let lastActiveApp = null;
let lastActiveTs = 0;
let startTs = null;
let running = false;

export function initActiveWindowTracker() {
    try {
        if (window.electronAPI?.onActiveWindow) {
            window.electronAPI.onActiveWindow((info) => {
                if (!running) return;
                const appName = info?.owner?.name || 'unknown';
                const now = Date.now();
                if (lastActiveApp == null) {
                    lastActiveApp = appName;
                    lastActiveTs = now;
                } else if (appName !== lastActiveApp) {
                    const elapsed = now - lastActiveTs;
                    appTimes[lastActiveApp] = (appTimes[lastActiveApp] || 0) + elapsed;
                    lastActiveApp = appName;
                    lastActiveTs = now;
                }
            });
        }
    } catch { }
}

export function startSessionTracking() {
    appTimes = {};
    lastActiveApp = null;
    lastActiveTs = Date.now();
    startTs = Date.now();
    running = true;
    try { window.electronAPI?.requestStartPolling?.(); } catch { }
}

export function stopSessionTracking() {
    running = false;
    const endTs = Date.now();
    const durationSession = Math.round((endTs - startTs));
    if (lastActiveApp != null) {
        const elapsedApp = endTs - lastActiveTs;
        appTimes[lastActiveApp] = (appTimes[lastActiveApp] || 0) + elapsedApp;
    }
    try { window.electronAPI?.requestStopPolling?.(); } catch { }
    return { ...appTimes };
}

export function resetSessionTracking() {
    appTimes = {};
    lastActiveApp = null;
    lastActiveTs = 0;
    running = false;
}

export function getSessionTrackingTotals() {
    return { ...appTimes };
}

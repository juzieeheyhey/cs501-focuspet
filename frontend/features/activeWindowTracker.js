// Renderer-side active window tracker. Subscribes to preload -> main forwarded
// 'active-window' events (via window.electronAPI.onActiveWindow)

let appTimes = {};
let lastActiveApp = null;
let lastActiveTs = 0;
let startTs = null;
let running = false;
let siteTimes = {};
let lastActiveSite = null;
let lastSiteTs = 0;

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

                // --- site tracking for browsers ---
                try {
                    const owner = (info && info.owner && info.owner.name) ? String(info.owner.name) : '';
                    const isBrowser = /chrome|chromium|safari|firefox|edge/i.test(owner);
                    const url = info?.url || null;
                    let hostname = null;
                    if (isBrowser && url && typeof url === 'string') {
                        try {
                            const parsed = new URL(url);
                            hostname = parsed.hostname;
                        } catch (e) {
                            // not a full url (maybe a title) — attempt to extract host-like token
                            const m = String(url).match(/https?:\/\/([^/]+)/i);
                            if (m) hostname = m[1];
                        }
                    }

                    if (hostname) {
                        if (lastActiveSite == null) {
                            lastActiveSite = hostname;
                            lastSiteTs = now;
                        } else if (hostname !== lastActiveSite) {
                            const sElapsed = now - lastSiteTs;
                            siteTimes[lastActiveSite] = (siteTimes[lastActiveSite] || 0) + sElapsed;
                            lastActiveSite = hostname;
                            lastSiteTs = now;
                        }
                    } else {
                        // if we switched away from a browser or lost URL, finalize site timer
                        if (lastActiveSite != null) {
                            const sElapsed = now - lastSiteTs;
                            siteTimes[lastActiveSite] = (siteTimes[lastActiveSite] || 0) + sElapsed;
                            lastActiveSite = null;
                            lastSiteTs = 0;
                        }
                    }
                } catch (e) {
                    // best-effort; do not break app tracking
                }
            });
        }
    } catch { }
}

export function startSessionTracking() {
    appTimes = {};
    lastActiveApp = null;
    lastActiveTs = Date.now();
    siteTimes = {};
    lastActiveSite = null;
    lastSiteTs = Date.now();
    startTs = Date.now();
    running = true;
    try { window.electronAPI?.requestStartPolling?.(); } catch { }
}

export function stopSessionTracking() {

    const endTs = Date.now();
    const durationSession = Math.round((endTs - startTs));
    if (running && lastActiveApp != null) {
        const elapsedApp = endTs - lastActiveTs;
        appTimes[lastActiveApp] = (appTimes[lastActiveApp] || 0) + elapsedApp;
    }
    // finalize site times
    if (running && lastActiveSite != null) {
        const elapsedSite = endTs - lastSiteTs;
        siteTimes[lastActiveSite] = (siteTimes[lastActiveSite] || 0) + elapsedSite;
    }
    running = false;
    try { window.electronAPI?.requestStopPolling?.(); } catch { }
    // persist site times (best-effort) to storage so other parts can consume them
    // import here to avoid circular import at module load time — use dynamic import Promise
    import('./storage.js').then((storage) => {
        try { storage.mergeSiteTotals(siteTimes); } catch (e) { /* ignore */ }
        try { storage.saveLastSiteSession(siteTimes); } catch (e) { /* ignore */ }
    }).catch(() => { /* ignore */ });

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

export function pauseSessionTracking() {
    if (!running) return;

    const now = Date.now();

    // finalize the last active app time up to pause
    if (lastActiveApp != null) {
        const elapsed = now - lastActiveTs;
        appTimes[lastActiveApp] = (appTimes[lastActiveApp] || 0) + elapsed;
    }

    // stop future accumulation
    running = false;
}

export function resumeSessionTracking() {
    if (running) return;

    // resume tracking from now
    lastActiveTs = Date.now();
    running = true;
}


const APP_TOTALS_KEY = 'appTotals';
const LAST_SESSION_KEY = 'lastSessionAppTimes';

export function loadTotals() {
    try {
        return JSON.parse(localStorage.getItem(APP_TOTALS_KEY) || '{}');
    } catch { return {}; }
}

export function saveTotals(totals) {
    try { localStorage.setItem(APP_TOTALS_KEY, JSON.stringify(totals)); } catch { }
}

export function saveLastSession(breakdown) {
    try { localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(breakdown)); } catch { }
}

export function mergeTotals(sessionBreakdown) {
    try {
        const totals = loadTotals();
        for (const [app, ms] of Object.entries(sessionBreakdown)) {
            totals[app] = (totals[app] || 0) + ms;
        }
        saveTotals(totals);
        saveLastSession(sessionBreakdown);
        return totals;
    } catch (e) { console.error('mergeTotals failed', e); return null; }
}

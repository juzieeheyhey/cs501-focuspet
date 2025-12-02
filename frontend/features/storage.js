const APP_TOTALS_KEY = 'appTotals';
const LAST_SESSION_KEY = 'lastSessionAppTimes';
const SITE_TOTALS_KEY = 'siteTotals';
const LAST_SESSION_SITES_KEY = 'lastSessionSiteTimes';

// load the total time spent on each app
export function loadTotals() {
    try {
        return JSON.parse(localStorage.getItem(APP_TOTALS_KEY) || '{}');
    } catch { return {}; }
}

// save the total time spent on each app
export function saveTotals(totals) {
    try { localStorage.setItem(APP_TOTALS_KEY, JSON.stringify(totals)); } catch { }
}

// save the time spent on each app in the last session
export function saveLastSession(breakdown) {
    try { localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(breakdown)); } catch { }
}

// save the time spent on each site in the last session
export function saveLastSiteSession(breakdown) {
    try { localStorage.setItem(LAST_SESSION_SITES_KEY, JSON.stringify(breakdown)); } catch { }
}

// merge site totals
export function mergeSiteTotals(sessionBreakdown) {
    try {
        const totals = JSON.parse(localStorage.getItem(SITE_TOTALS_KEY) || '{}');
        for (const [site, ms] of Object.entries(sessionBreakdown)) {
            totals[site] = (totals[site] || 0) + ms;
        }
        try { localStorage.setItem(SITE_TOTALS_KEY, JSON.stringify(totals)); } catch { }
        saveLastSiteSession(sessionBreakdown);
        return totals;
    } catch (e) { console.error('mergeSiteTotals failed', e); return null; }
}

// merge the total time spent on each app with the time spent on each app in the last session
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

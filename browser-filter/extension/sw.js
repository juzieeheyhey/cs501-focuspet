// sw.js — FocusPet Filter service worker with soft blocking

const HOST_NAME = "com.focuspet.host";
const WL_PRIORITY = 1000;
const BL_PRIORITY = 500;

// Check if URL matches any pattern in a list
function matchesPattern(url, patterns) {
    for (const pattern of patterns) {
        const p = pattern.trim();
        if (!p) continue;

        if (p === "<all_urls>") return true;
        
        // Regex pattern for matching URLs
        if (p.startsWith("re:/") && p.endsWith("/")) {
            const regex = new RegExp(p.slice(3, -1));
            if (regex.test(url)) return true;
        } else {
            // Simple domain matching
            const domain = p.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
            const urlObj = new URL(url);
            if (urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)) {
                return true;
            }
        }
    }
    return false;
}

// Check if navigation should be soft-blocked
async function shouldSoftBlock(url, tabId) {
    const { allowlist = [], blacklist = [], sessionOn = false } = 
        await chrome.storage.local.get(['allowlist', 'blacklist', 'sessionOn']);
    
    if (!sessionOn) return false;

    // Check if there's an active bypass for this tab
    const bypassKey = `bypass_${tabId}`;
    const { [bypassKey]: bypass } = await chrome.storage.session.get([bypassKey]);
    if (bypass && Date.now() - bypass.timestamp < 60000) {
        // Bypass is active for 60 seconds
        await chrome.storage.session.remove([bypassKey]);
        return false;
    }

    // If on blacklist, it will be hard-blocked by DNR rules
    if (matchesPattern(url, blacklist)) return false;

    // If on whitelist, allow without soft block
    if (matchesPattern(url, allowlist)) return false;

    // Not on whitelist and not on blacklist = soft block
    return true;
}

// Intercept navigation and redirect to interstitial if needed
chrome.webNavigation?.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0) return; // Only main frame
    
    const shouldBlock = await shouldSoftBlock(details.url, details.tabId);
    if (shouldBlock) {
        // Store the blocked URL in session storage so interstitial can access it
        const storageKey = `blocked_url_${details.tabId}`;
        await chrome.storage.session.set({
            [storageKey]: {
                url: details.url,
                timestamp: Date.now()
            }
        });
        
        const interstitialUrl = chrome.runtime.getURL('interstitial.html') + 
            '?tabId=' + details.tabId;
        chrome.tabs.update(details.tabId, { url: interstitialUrl });
    }
});

// DNR (Declarative Net Request) helpers - for hard blocking only

function toConditions(pattern) {
    const p = pattern.trim();
    if (!p) return [];

    if (p === "<all_urls>") {
        return [{ type: "urlFilter", value: "" }];
    }
    if (p.startsWith("re:/") && p.endsWith("/")) {
        const regex = p.slice(3, -1);
        return [{ type: "regex", value: regex }];
    }
    if (p.startsWith("/")) {
        return [{ type: "urlFilter", value: p }];
    }
    if (p.includes("/")) {
        return [{ type: "urlFilter", value: p.replace(/^https?:\/\//i, "") }];
    }
    const domain = p.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    const esc = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = `^https?:\\/\\/([^.]+\\.)*${esc}(?::\\d+)?(\\/|$)`;
    return [{ type: "regex", value: regex }];
}

// Create a DNR rule object
function makeRuleBase(id, priority, actionType, condition) {
    const resourceTypes = [
        "main_frame", "sub_frame", "xmlhttprequest", "script", "image", "media",
        "stylesheet", "font", "ping", "websocket", "csp_report", "object", "other",
        "webbundle", "webtransport"
    ];

    let cond;
    if (condition.type === "regex") {
        cond = { regexFilter: condition.value, resourceTypes };
    } else if (condition.type === "domain") {
        cond = { requestDomains: [condition.value], resourceTypes };
    } else {
        cond = { urlFilter: condition.value, resourceTypes };
    }

    return {
        id,
        priority,
        action: { type: actionType },
        condition: cond
    };
}

async function setRules(allowlist, blacklist) {
    const toAdd = [];
    let nextId = 10000;

    // Only add blacklist rules for DNR (hard blocks)
    // Whitelist and soft blocks are handled via webNavigation
    for (const pat of blacklist) {
        for (const c of toConditions(pat)) {
            toAdd.push(makeRuleBase(nextId++, BL_PRIORITY, "block", c));
        }
    }

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existing.map(r => r.id),
        addRules: toAdd
    });
    console.log('setRules: applied rules', { added: toAdd.length, removed: existing.length });
}

// Clear all DNR rules
async function clearRules() {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    if (existing.length) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: existing.map(r => r.id)
        });
        console.log('clearRules: removed rules', { removed: existing.length });
    }
}

// Apply rules from storage
async function applyFromStorage() {
    const { allowlist = [], blacklist = [], sessionOn = false } =
        await chrome.storage.local.get({ allowlist: [], blacklist: [], sessionOn: false });
    if (sessionOn) {
        await setRules(allowlist, blacklist);
    } else {
        await clearRules();
    }
}

// Existing auth/backend helpers (kept)

const BACKEND_BASE = 'http://localhost:5185';

function getAuthToken() {
    return new Promise(resolve => {
        chrome.storage.local.get(['authToken'], (items) => resolve(items?.authToken || null));
    });
}

async function backendFetch(path, opts = {}) {
    const token = await getAuthToken();
    const headers = Object.assign({}, opts.headers || {});
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (token) {
        const auth = (typeof token === 'string' && token.startsWith('Bearer ')) ? token : `Bearer ${token}`;
        headers['Authorization'] = auth;
    }
    const res = await fetch(`${BACKEND_BASE}${path}`, Object.assign({}, opts, { headers }));
    return res;
}

// Lifecycle & message handlers

chrome.runtime.onInstalled.addListener(() => {
    applyFromStorage();
    try { chrome.alarms.create('session-poll', { periodInMinutes: 1 }); } catch (e) { /* ignore */ }
    pollActiveSession().catch(() => { /* ignore */ });
});

chrome.runtime.onStartup?.addListener(() => {
    applyFromStorage();
    try { chrome.alarms.create('session-poll', { periodInMinutes: 1 }); } catch (e) { /* ignore */ }
    pollActiveSession().catch(() => { /* ignore */ });
});

chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === 'session-poll') {
        pollActiveSession().catch((e) => console.warn('session-poll failed', e));
    }
});

async function pollActiveSession() {
    try {
        const resp = await backendFetch('/api/session/active');
        if (!resp) return;
        if (resp.status === 204) {
            await chrome.storage.local.set({ sessionOn: false });
            await clearRules();
            return;
        }
        if (resp.ok) {
            const text = await resp.text();
            if (!text) return;
            let sessionObj = null;
            try { sessionObj = JSON.parse(text); } catch { sessionObj = null; }
            if (sessionObj) {
                const allowlist = sessionObj.activity?.allowlist || sessionObj.allowlist || [];
                const blacklist = sessionObj.activity?.blacklist || sessionObj.blacklist || [];
                await chrome.storage.local.set({ allowlist, blacklist, sessionOn: true });
                await setRules(allowlist, blacklist);
            }
        }
    } catch (e) {
        // network/auth errors are expected sometimes
    }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
        if (msg.type === "APPLY") {
            try {
                // Apply filter lists from payload or storage
                console.log('SW: APPLY message received', { hasPayload: !!msg.payload });
                if (msg.payload) {
                    // Apply filter lists from payload or storage
                    const { allowlist = [], blacklist = [], sessionOn = false } = msg.payload;
                    console.log('SW: applying payload lists', { allowlistLen: allowlist.length, blacklistLen: blacklist.length, sessionOn });
                    await chrome.storage.local.set({ allowlist, blacklist, sessionOn });
                    if (sessionOn) await setRules(allowlist, blacklist); else await clearRules();
                    sendResponse({ ok: true, applied: true });
                } else {
                    await applyFromStorage();
                    sendResponse({ ok: true, applied: false });
                }
            } catch (err) {
                console.error('SW: APPLY handler error', err);
                sendResponse({ ok: false, error: String(err) });
            }
        } else if (msg.type === "CLEAR") {
            await chrome.storage.local.set({ sessionOn: false });
            await clearRules();
            sendResponse({ ok: true });
        } else if (msg.type === 'EXT_LOGIN') {
            console.log('Extension logged in (sw):', msg.userId);
            sendResponse({ ok: true });
        } else if (msg.type === 'EXT_LOGOUT') {
            try { await clearRules(); } catch (e) { /* ignore */ }
            sendResponse({ ok: true });
        } else if (msg.type === 'BACKEND_FETCH') {
            try {
                const resp = await backendFetch(msg.path, msg.opts || {});
                const data = await resp.text();
                sendResponse({ ok: true, status: resp.status, body: data });
            } catch (err) {
                sendResponse({ ok: false, error: String(err) });
            }
        } else if (msg.type === 'SET_BYPASS') {
            // Allow the interstitial page to set a bypass token to visit site anyway
            const { tabId } = msg;
            const bypassKey = `bypass_${tabId}`;
            await chrome.storage.session.set({
                [bypassKey]: { timestamp: Date.now() }
            });
            sendResponse({ ok: true });
        }
    })();
    return true;
});
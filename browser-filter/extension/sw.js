// sw.js — FocusPet Filter service worker

const HOST_NAME = "com.focuspet.host"; // must match your native host manifest "name"
const WL_PRIORITY = 1000;
const BL_PRIORITY = 500;

let nativePort = null;

// ---------- Native messaging wiring ----------

function connectNative() {
    if (nativePort) return;

    try {
        nativePort = chrome.runtime.connectNative(HOST_NAME);

        nativePort.onMessage.addListener(handleNativeMessage);

        nativePort.onDisconnect.addListener(() => {
            console.warn("Native host disconnected", chrome.runtime.lastError);
            nativePort = null;
        });

        // Ask the host for current filters when we first connect
        nativePort.postMessage({ type: "GET_FILTERS" });
    } catch (e) {
        console.error("Failed to connect to native host:", e);
        nativePort = null;
    }
}

async function handleNativeMessage(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === "FILTERS" || msg.type === "SET_FILTERS") {
        // Both initial dump and updates use the same payload shape
        const { allowlist = [], blacklist = [], sessionOn = false } = msg.payload || {};

        // Store for popup UI & debug
        await chrome.storage.local.set({ allowlist, blacklist, sessionOn });

        // Apply or clear rules
        if (sessionOn) {
            await setRules(allowlist, blacklist);
        } else {
            await clearRules();
        }
    } else if (msg.type === "PING") {
        // Optional, just to test connectivity
        nativePort?.postMessage({ type: "PONG" });
    }
}

// ---------- DNR helpers ----------

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

    for (const pat of allowlist) {
        for (const c of toConditions(pat)) {
            toAdd.push(makeRuleBase(nextId++, WL_PRIORITY, "allow", c));
        }
    }
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
}

async function clearRules() {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    if (existing.length) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: existing.map(r => r.id)
        });
    }
}

async function applyFromStorage() {
    const { allowlist = [], blacklist = [], sessionOn = false } =
        await chrome.storage.local.get({ allowlist: [], blacklist: [], sessionOn: false });
    if (sessionOn) {
        await setRules(allowlist, blacklist);
    } else {
        await clearRules();
    }
}

// ---------- Existing auth/backend helpers (kept) ----------

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

// ---------- Lifecycle & message handlers ----------

chrome.runtime.onInstalled.addListener(() => {
    connectNative();
    applyFromStorage();
    // start periodic polling for active sessions (server-driven sync)
    try { chrome.alarms.create('session-poll', { periodInMinutes: 1 }); } catch (e) { /* ignore */ }
    pollActiveSession().catch(() => { /* ignore */ });
});

chrome.runtime.onStartup?.addListener(() => {
    connectNative();
    applyFromStorage();
    try { chrome.alarms.create('session-poll', { periodInMinutes: 1 }); } catch (e) { /* ignore */ }
    pollActiveSession().catch(() => { /* ignore */ });
});

chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === 'session-poll') {
        pollActiveSession().catch((e) => console.warn('session-poll failed', e));
    }
});

// Poll the backend for any active session for the logged-in user. If found,
// store allowlist/blacklist/sessionOn and apply the rules. This enables the
// extension to learn about desktop-started sessions via the backend.
async function pollActiveSession() {
    try {
        // backendFetch already injects Authorization header from stored authToken
        const resp = await backendFetch('/api/session/active');
        if (!resp) return;
        if (resp.status === 204) {
            // no active session
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
                // If backend stores lists on the user, try to read them; otherwise apply empty lists
                const allowlist = sessionObj.activity?.allowlist || sessionObj.allowlist || [];
                const blacklist = sessionObj.activity?.blacklist || sessionObj.blacklist || [];
                // If sessionObj has StartTime and EndTime == MinValue, treat as active
                await chrome.storage.local.set({ allowlist, blacklist, sessionOn: true });
                await setRules(allowlist, blacklist);
            }
        }
    } catch (e) {
        // network/auth errors are expected sometimes
        // console.warn('pollActiveSession error', e);
    }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
        if (msg.type === "APPLY") {
            // In the new model, Electron is the source of truth.
            // We'll just re-apply whatever is already in storage.
            await applyFromStorage();
            sendResponse({ ok: true });
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
        }
    })();
    return true;
});

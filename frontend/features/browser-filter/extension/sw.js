// service worker for browser filtering extension

const WL_PRIORITY = 1000;
const BL_PRIORITY = 500;

// Converts a match pattern to an array of conditions for declarativeNetRequest
function toConditions(pattern) {
    const p = pattern.trim();
    if (!p) return [];

    // match everything
    if (p === "<all_urls>") {
        return [{ type: "urlFilter", value: "" }]; // empty = match all
    }
    // explicit regex: re:/.../
    if (p.startsWith("re:/") && p.endsWith("/")) {
        const regex = p.slice(3, -1);
        return [{ type: "regex", value: regex }];
    }
    // path substring (applies anywhere)
    if (p.startsWith("/")) {
        return [{ type: "urlFilter", value: p }];
    }
    // has a slash → treat as URL substring (host+path)
    if (p.includes("/")) {
        return [{ type: "urlFilter", value: p.replace(/^https?:\/\//i, "") }];
    }
    // fallback: domain → robust regex for host + subdomains
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
    } else { // urlFilter
        cond = { urlFilter: condition.value, resourceTypes };
    }

    return {
        id,
        priority,
        action: { type: actionType }, // "allow" | "block"
        condition: cond
    };
}


async function setRules(allowlist, blacklist) {
    const toAdd = [];
    let nextId = 10000;

    // Whitelist first (higher priority)
    for (const pat of allowlist) {
        for (const c of toConditions(pat)) {
            toAdd.push(makeRuleBase(nextId++, WL_PRIORITY, "allow", c));
        }
    }
    // Blacklist
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


chrome.runtime.onInstalled.addListener(applyFromStorage);
chrome.runtime.onStartup?.addListener(applyFromStorage);
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
        if (msg.type === "APPLY") {
            await chrome.storage.local.set({
                allowlist: msg.allowlist || [],
                blacklist: msg.blacklist || [],
                sessionOn: !!msg.sessionOn
            });
            await applyFromStorage();
            sendResponse({ ok: true });
        } else if (msg.type === "CLEAR") {
            await chrome.storage.local.set({ sessionOn: false });
            await clearRules();
            sendResponse({ ok: true });
        }
    })();
    return true;
});

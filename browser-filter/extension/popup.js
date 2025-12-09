// popup.js
const q = (sel) => document.querySelector(sel);
const BACKEND_BASE = 'http://localhost:5185';

function parseJwt(token) {
    try {
        const base64 = token.split('.')[1];
        const json = atob(base64);
        return JSON.parse(json);
    } catch { return null; }
}

// Attempt login with email and password, store token on success
async function attemptLogin(email, password) {
    const url = `${BACKEND_BASE}/api/auth/login`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Email: email, Password: password })
    });
    if (!resp.ok) {
        const txt = await resp.text().catch(() => resp.statusText || 'Login failed');
        throw new Error(txt || 'Login failed');
    }
    const body = await resp.json();
    if (!body?.token) throw new Error('No token returned');

    // Decode token to extract userId
    const decoded = parseJwt(body.token);
    const userId = decoded?.userId ?? decoded?.name ?? decoded?.sub ?? null;
    // Normalize token: strip leading "Bearer " if present, and trim
    const rawToken = String(body.token || '');
    const normalized = rawToken.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken.trim();
    await chrome.storage.local.set({ authToken: normalized, userId });
    console.log('attemptLogin: saved authToken and userId', { userId });
    chrome.runtime.sendMessage({ type: 'EXT_LOGIN', token: body.token, userId });
    return { token: body.token, userId };
}

async function doLogout() {
    await chrome.storage.local.remove(['authToken', 'userId']);
    chrome.runtime.sendMessage({ type: 'EXT_LOGOUT' });
}

document.addEventListener("DOMContentLoaded", init);

// Initialize the popup UI
async function init() {
    const wl = q("#wl");
    const bl = q("#bl");
    const session = q("#session");
    const statusDot = q("#statusDot");
    const applyBtn = q("#apply");
    const clearBtn = q("#clear");
    const reloadBtn = q('#reloadBtn');

    const emailInput = q('#emailInput');
    const passInput = q('#passwordInput');
    const loginBtn = q('#loginBtn');
    const logoutBtn = q('#logoutBtn');
    const statusEl = q('#status');

    // Load saved state
    const { allowlist = [], blacklist = [], sessionOn = false } =
        await chrome.storage.local.get({ allowlist: [], blacklist: [], sessionOn: false });

    wl.value = allowlist.join("\n");
    bl.value = blacklist.join("\n");
    // make read-only since we fetch from backend
    wl.readOnly = true;
    bl.readOnly = true;
    session.checked = !!sessionOn;
    statusDot.classList.toggle("active", !!sessionOn);

    // auth state
    const items = await chrome.storage.local.get(['authToken']);
    const authToken = items?.authToken;

    // UI state functions
    const features = q('#features');
    const authSection = q('#authSection');

    function showLoggedInState() {
        statusEl.textContent = 'Logged in';
        if (logoutBtn) logoutBtn.style.display = 'block';
        if (loginBtn) loginBtn.style.display = 'none';
        if (emailInput) emailInput.style.display = 'none';
        if (passInput) passInput.style.display = 'none';
        if (features) features.style.display = 'block';
        if (applyBtn) applyBtn.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
        if (reloadBtn) reloadBtn.style.display = 'inline-block';
    }

    function showLoggedOutState() {
        statusEl.textContent = 'Not logged in';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (loginBtn) loginBtn.style.display = 'block';
        if (emailInput) emailInput.style.display = 'block';
        if (passInput) passInput.style.display = 'block';
        if (features) features.style.display = 'none';
        if (applyBtn) applyBtn.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
        if (reloadBtn) reloadBtn.style.display = 'none';
    }

    if (authToken) {
        showLoggedInState();
        // try to sync settings from backend when popup opens
        try { await syncFromBackend(); } catch (e) { /* ignore */ }
    } else {
        showLoggedOutState();
    }

    // Toggle indicator
    session.addEventListener("change", async () => {
        // Persist session state and tell the service worker to apply/clear rules
        const isOn = !!session.checked;
        statusDot.classList.toggle("active", isOn);
        try {
            // persist
            await chrome.storage.local.set({ sessionOn: isOn });
            // read current lists from storage to send to SW
            const stored = await chrome.storage.local.get({ allowlist: [], blacklist: [] });
            const allow = stored?.allowlist || [];
            const block = stored?.blacklist || [];
            if (isOn) {
                // send lists to SW to apply immediately
                try {
                    await chrome.runtime.sendMessage({ type: 'APPLY', payload: { allowlist: allow, blacklist: block, sessionOn: true } });
                } catch (err) {
                    console.warn('session change: failed to message SW, will rely on storage-based apply', err);
                    try { await chrome.runtime.sendMessage({ type: 'APPLY' }); } catch (_) { }
                }
            } else {
                // turn off rules
                try { await chrome.runtime.sendMessage({ type: 'CLEAR' }); } catch (err) { console.warn('session change: CLEAR failed', err); }
            }
        } catch (err) {
            console.error('session change handler error', err);
        }
    });

    // Reload (fetch from backend)
    if (reloadBtn) {
        reloadBtn.addEventListener('click', async () => {
            if (statusEl) statusEl.textContent = 'Reloading...';
            try {
                const ok = await syncFromBackend();
                statusEl.textContent = ok ? 'Refreshed' : 'Refresh failed';
            } catch (e) {
                console.error('reloadBtn handler error', e);
                statusEl.textContent = 'Refresh failed';
            }
            setTimeout(() => { if (statusEl) statusEl.textContent = 'Logged in'; }, 1200);
        });
    }

    // login
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            loginBtn.disabled = true;
            statusEl.textContent = 'Logging in...';
                try {
                    await attemptLogin(emailInput.value.trim(), passInput.value);
                    showLoggedInState();
                    try { await syncFromBackend(); } catch (_) { }
                } catch (err) {
                    statusEl.textContent = 'Login failed: ' + (err.message || err);
                } finally {
                    loginBtn.disabled = false;
                }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await doLogout();
            showLoggedOutState();
        });
    }
}

// Fetch user settings from backend and store them into chrome.storage, then apply rules
async function syncFromBackend() {
    try {
        const items = await chrome.storage.local.get(['authToken']);
        const token = items?.authToken;
        if (!token) {
            console.warn('syncFromBackend: no auth token found');
            return false;
        }

        const authHeader = (typeof token === 'string' && token.startsWith('Bearer '))
            ? token
            : `Bearer ${token}`;

        const url = `${BACKEND_BASE}/api/users/lists`;
        console.log('syncFromBackend: fetching lists', { url, tokenPreview: token?.slice?.(0,8) + '...' });

        const resp = await fetch(url, { headers: { 'Authorization': authHeader } });
        console.log('syncFromBackend: fetch response', { ok: resp.ok, status: resp.status });

        const text = await resp.text();
        console.log('syncFromBackend: response text:', text);
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (err) { console.error('syncFromBackend: JSON parse error', err); }

        if (!resp.ok) {
            console.warn('syncFromBackend: server returned non-ok status', { status: resp.status, body: text });
            return false;
        }

        const allow = json?.WhiteList || json?.whiteList || [];
        const block = json?.BlackList || json?.blackList || [];
        console.log('syncFromBackend: parsed lists', { allow, block });

        // preserve any existing sessionOn state rather than forcing false
        const prev = await chrome.storage.local.get(['sessionOn']);
        const sessionOnStored = prev?.sessionOn ?? false;
        await chrome.storage.local.set({ allowlist: allow, blacklist: block, sessionOn: sessionOnStored });

        // Send the lists directly to the service worker so it can apply immediately
        try {
            await chrome.runtime.sendMessage({ type: 'APPLY', payload: { allowlist: allow, blacklist: block, sessionOn: sessionOnStored } });
        } catch (err) {
            console.warn('syncFromBackend: failed to message SW, will rely on storage-based apply', err);
            try { await chrome.runtime.sendMessage({ type: 'APPLY' }); } catch (_) { }
        }

        // update the textarea values
        const wl = q('#wl');
        const bl = q('#bl');
        if (wl) { wl.value = allow.join('\n'); }
        if (bl) { bl.value = block.join('\n'); }

        // reflect sessionOn in the popup UI
        try {
            const cur = await chrome.storage.local.get(['sessionOn']);
            const curOn = !!cur?.sessionOn;
            session.checked = curOn;
            statusDot.classList.toggle('active', curOn);
        } catch (err) { /* ignore */ }

        return true;
    } catch (e) {
        console.error('syncFromBackend error', e);
        return false;
    }
}


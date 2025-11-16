import { initEyeTrackerUI } from './features/eyetracking.js';

// Backend base URL for auth calls. Update if your backend runs on a different port.
const BACKEND_BASE = window.BACKEND_BASE || 'http://localhost:5000';

// Load and render small HTML view fragments from ./views/{name}.html into #root
const viewCache = new Map();
async function showView(name) {
    const root = document.getElementById('root');
    if (!root) return;

    // load (cached)
    if (!viewCache.has(name)) {
        try {
            const resp = await fetch(`./views/${name}.html`);
            if (!resp.ok) throw new Error(`Failed to load view: ${name}`);
            const txt = await resp.text();
            viewCache.set(name, txt);
        } catch (err) {
            console.error(err);
            root.innerHTML = `<div style="padding:20px;color:#900">Error loading view: ${name}</div>`;
            return;
        }
    }

    root.innerHTML = viewCache.get(name);

    // wire up view-specific handlers after injection
    await attachViewHandlers(name);
}

async function attachViewHandlers(name) {
    if (name === 'auth') {
        const loginBtn = document.getElementById('loginBtn');
        const emailInput = document.getElementById('emailInput');
        const passwordInput = document.getElementById('passwordInput');

        if (loginBtn) {
            loginBtn.addEventListener('click', async () => {
                const email = emailInput?.value?.trim() || '';
                const password = passwordInput?.value || '';
                if (!email || !password) {
                    showAuthMessage('Please enter email and password');
                    return;
                }
                loginBtn.disabled = true;
                showAuthMessage('');
                const res = await attemptLogin(email, password);
                loginBtn.disabled = false;
                if (res.success) {
                    await showView('app');
                } else {
                    showAuthMessage(res.error || 'Login failed');
                }
            });
        }

        if (passwordInput) {
            passwordInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    loginBtn?.click();
                }
            });
        }
    }

    if (name === 'app') {
        const logoutBtn = document.getElementById('logoutBtn');
        const token = localStorage.getItem('authToken');
        if (token && logoutBtn) logoutBtn.style.display = 'inline-block';

        if (logoutBtn) logoutBtn.addEventListener('click', () => logout());

        // start app logic
        try { initEyeTrackerUI(); } catch (e) { console.error('initEyeTrackerUI failed', e); }

        // Ensure modal HTML is present (modal is stored separately in views/modal.html)
        try {
            if (!document.getElementById('lastSessionModel')) {
                if (!viewCache.has('modal')) {
                    const resp = await fetch('./views/modal.html');
                    if (resp.ok) viewCache.set('modal', await resp.text());
                }
                const modalHtml = viewCache.get('modal');
                if (modalHtml) {
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = modalHtml;
                    // append to body so it overlays the app view
                    document.body.appendChild(wrapper);
                    // re-run init to wire modal controls which were not present earlier
                    try { initEyeTrackerUI(); } catch (e) { /* ignore */ }
                }
            }
        } catch (err) { console.warn('Failed to load modal view', err); }
    }

}

function parseJwt(token) {
    try {
        const base64 = token.split('.')[1];
        const json = atob(base64);
        return JSON.parse(json);
    } catch {
        return null;
    }
}

async function attemptLogin(email, password) {
    const url = `${BACKEND_BASE}/api/auth/login`;
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Email: email, PasswordHash: password }),
        });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => resp.statusText || 'Login failed');
            throw new Error(txt || 'Login failed');
        }
        const body = await resp.json();
        if (body?.token) {
            localStorage.setItem('authToken', body.token);
            const decoded = parseJwt(body.token);
            if (decoded) {
                localStorage.setItem('userId', decoded.userId); // store the userId in local storage for posting sessions & future use
            } else {
                console.warn('JWT decoded but no userId claim:', decoded);
            }
            return { success: true };
        }
        throw new Error('Invalid response from server');
    } catch (err) {
        return { success: false, error: err?.message || String(err) };
    }
}

function showAuthMessage(msg) {
    const el = document.getElementById('loginMessage');
    if (el) {
        el.textContent = msg || '';
        el.style.display = msg ? 'block' : 'none';
    }
}

function logout() {
    localStorage.removeItem('authToken');
    // teardown any running tracker UI (if needed)
    try { window.stopSession?.(); } catch { }
    showView('auth');
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.style.display = 'none';
}

window.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('loginBtn');
    const emailInput = document.getElementById('emailInput');
    const passwordInput = document.getElementById('passwordInput');
    const logoutBtn = document.getElementById('logoutBtn');

    const token = localStorage.getItem('authToken');
    if (token) {
        showView('app');
        // show logout control
        if (logoutBtn) logoutBtn.style.display = 'inline-block';
        initEyeTrackerUI();
    } else {
        showView('auth');
    }

    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const email = emailInput?.value?.trim() || '';
            const password = passwordInput?.value || '';
            if (!email || !password) {
                showAuthMessage('Please enter email and password');
                return;
            }
            loginBtn.disabled = true;
            showAuthMessage('');
            const res = await attemptLogin(email, password);
            loginBtn.disabled = false;
            if (res.success) {
                showView('app');
                if (logoutBtn) logoutBtn.style.display = 'inline-block';
                initEyeTrackerUI(); // actually starts the main app logic
            } else {
                showAuthMessage(res.error || 'Login failed');
            }
        });
    }

    if (passwordInput) {
        passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                loginBtn?.click();
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => logout());
    }

    // Listen for active window updates from main (exposed via preload)
    if (window.electronAPI?.onActiveWindow) {
        window.electronAPI.onActiveWindow((info) => {
            console.log('Active window:', info);
            // const el = document.getElementById('activeWindowTitle');
            // if (el) el.textContent = info?.title || '—';
        });
    }
});

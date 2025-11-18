import { initEyeTrackerUI } from './features/eyetracking.js';
import { initAnalytics } from './features/analytics.js';
// Backend base URL for auth calls. Update if your backend runs on a different port.
const BACKEND_BASE = window.BACKEND_BASE || 'http://localhost:5000';

// views that are allowed while logged out
const PUBLIC_VIEWS = new Set(['home', 'auth', 'signup']);

// update nav based on auth state
function updateNav() {
    const token = localStorage.getItem('authToken');
    const loggedOut = document.querySelector('.nav-logged-out');
    const loggedIn = document.querySelector('.nav-logged-in');
    if (loggedOut) loggedOut.style.display = token ? 'none' : 'flex';
    if (loggedIn) loggedIn.style.display = token ? 'flex' : 'none';
}

// handle navigation using data-view attributes
function initNav() {
    const nav = document.querySelector('nav');
    if (!nav) return;

    nav.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLAnchorElement)) return;

        const viewName = target.dataset.view;
        if (!viewName) return;

        e.preventDefault();

        const token = localStorage.getItem('authToken');

        // block protected views if not logged in
        if (!token && !PUBLIC_VIEWS.has(viewName)) {
            showView('home');
            return;
        }

        showView(viewName);
    });
}

// Load and render small HTML view fragments from ./views/{name}.html into #root
const viewCache = new Map();

function setNavVisible(visible) {
    const nav = document.getElementById('mainNav');
    if (!nav) return;
    nav.style.display = visible ? 'flex' : 'none';
}



function initNavBar() {
    const nav = document.getElementById('mainNav');
    if (!nav) return;

    const navLinks = nav.querySelectorAll('.nav-link[data-view]');
    navLinks.forEach(link => {
        link.addEventListener('click', async () => {
            const targetView = link.dataset.view;
            if (!targetView) return;
            await showView(targetView);
        });
    });
}

async function showView(name) {
    const root = document.getElementById('root');
    if (!root) return;

    const token = localStorage.getItem('authToken');

    // guard against accessing protected views while logged out
    if (!token && !PUBLIC_VIEWS.has(name)) {
        console.warn('Blocked access to protected view:', name);
        name = 'home';
    }

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

    // update nav to match the current state
    updateNav();
}

async function attachViewHandlers(name) {
    if (name === 'home') {
        setNavVisible(true);

        const homeButtons = document.querySelectorAll('.home-btn[data-view]');
        homeButtons.forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const targetView = btn.dataset.view;
                if (!targetView) return;
                await showView(targetView);
            });
        });
    }

    if (name === 'auth') {
        setNavVisible(false);
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
                    updateNav();
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
        setNavVisible(true);

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
    if (name === 'analytics') {
        setNavVisible(true);
        try {
            initAnalytics()
        } catch (e) {
            console.error('initAnalytics failed: ', e)
        }
    }
    
    if (name === 'settings') {
        setNavVisible(true);

        const settingsLogoutBtn = document.getElementById('settingsLogoutBtn');
        if (settingsLogoutBtn) {
            settingsLogoutBtn.addEventListener('click', () => logout());
        }
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

// function logout() {
//     localStorage.removeItem('authToken');
//     // teardown any running tracker UI (if needed)
//     try { window.stopSession?.(); } catch { }
//     showView('auth');
//     const logoutBtn = document.getElementById('logoutBtn');
//     if (logoutBtn) logoutBtn.style.display = 'none';
//     // update nav to reflect logged-out state
//     try { updateNav(); } catch (e) { /* ignore */ }
// }

function logout() {
    localStorage.removeItem('authToken');

    // teardown any running tracker UI (if needed)
    try { window.stopSession?.(); } catch { }

    // reflect logged-out state
    updateNav();
    setNavVisible(false);

    // send user back to auth screen
    showView('auth');
}

window.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('loginBtn');
    const emailInput = document.getElementById('emailInput');
    const passwordInput = document.getElementById('passwordInput');
    // const logoutBtn = document.getElementById('logoutBtn');

    // initial nav state & nav handler
    initNav();
    updateNav();

    const token = localStorage.getItem('authToken');

    initNavBar();
    if (token) {

        showView('app');
        // show logout control
        // if (logoutBtn) logoutBtn.style.display = 'inline-block';
        initEyeTrackerUI();
    } else {
        showView('home');
    }

    // update nav visibility based on token
    updateNav();

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
                // if (logoutBtn) logoutBtn.style.display = 'inline-block';
                updateNav();
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

    // if (logoutBtn) {
    //     logoutBtn.addEventListener('click', () => logout());
    // }

    // Listen for active window updates from main (exposed via preload)
    if (window.electronAPI?.onActiveWindow) {
        window.electronAPI.onActiveWindow((info) => {
            console.log('Active window:', info);
            // const el = document.getElementById('activeWindowTitle');
            // if (el) el.textContent = info?.title || '—';
        });
    }
});

import { initEyeTrackerUI } from './features/eyetracking.js';

// Backend base URL for auth calls. Update if your backend runs on a different port.
const BACKEND_BASE = window.BACKEND_BASE || 'http://localhost:5000';

function showView(name) {
    const auth = document.getElementById('authView');
    const app = document.getElementById('appView');
    if (name === 'auth') {
        if (auth) auth.style.display = 'flex';
        if (app) app.style.display = 'none';
    } else {
        if (auth) auth.style.display = 'none';
        if (app) app.style.display = 'block';
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
    try { window.stopSession?.(); } catch {}
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
                initEyeTrackerUI();
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
            const el = document.getElementById('activeWindowTitle');
            if (el) el.textContent = info?.title || '—';
        });
    }
});

/////////////////////////////////////////////////////////////////////////////////
// view loader

const root = document.getElementById('root');

async function loadView(name) {
    try {
        const resp = await fetch(`./views/${name}.html`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        root.innerHTML = await resp.text();
        const initFn = { auth: initAuthView, app: initAppView }[name];
        if (initFn) initFn();
    } catch (err) {
        root.innerHTML = `<div style="padding:20px;color:#c00">Failed to load view "${name}": ${err.message}</div>`;
    }
}

// auth view
function initAuthView() {
    const loginBtn = document.getElementById('loginBtn');
    const email = document.getElementById('emailInput');
    const pass = document.getElementById('passwordInput');
    const msg = document.getElementById('loginMessage');

    loginBtn.addEventListener('click', async () => {
        if (!email.value || !pass.value) {
        msg.style.display = 'block';
        msg.textContent = 'Please enter email and password';
        return;
        }
        // TODO: replace with real auth call
        await loadView('app');
    });
}

// app view
function initAppView() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.style.display = 'inline-block';
        logoutBtn.addEventListener('click', () => loadView('auth'));
    }

    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (startBtn && stopBtn) {
        startBtn.addEventListener('click', () => {
        startBtn.disabled = true;
        stopBtn.disabled = false;
        // ...start session logic...
        });
        stopBtn.addEventListener('click', () => {
        startBtn.disabled = false;
        stopBtn.disabled = true;
        // ...stop session logic...
        });
    }
}

// initial load
loadView('auth');
// import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
// const { FilesetResolver, FaceLandmarker } = vision;

import { startCamera, stopCamera } from './camera.js';
import { loadLandmarker, detectForVideo, closeLandmarker } from './landmarker.js';
import { initActiveWindowTracker, startSessionTracking, stopSessionTracking, resetSessionTracking } from './activeWindowTracker.js';
import { mergeTotals, saveLastSession } from './storage.js';

// import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";

// Optional backend URL (comment out post() calls if you don't use it yet)
// const BACKEND = "http://127.0.0.1:5055";
// async function post(url, body) {
//     try {
//         await fetch(url, {
//             method: "POST",
//             headers: { "Content-Type": "application/json" },
//             body: body == null ? null : JSON.stringify(body),
//         });
//     } catch { }
// }

// ====== UI elements (match your HTML IDs) ======
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const stateIcon = document.getElementById("stateIcon");
const stateText = document.getElementById("stateText");
const timerEl = document.getElementById("timer");
const lookingTimeEl = document.getElementById("lookingTime");
const awayTimeEl = document.getElementById("awayTime");
const focusScoreEl = document.getElementById("focusScore");

// ====== State machine thresholds ======
const ABSENT_MS = 800; // no landmarks for this long → AWAY
const PRESENT_MS = 400; // landmarks present this long → LOOKING
const EYES_CLOSED_MS = 600; // continuous closure → AWAY
const BLINK_GAP_RATIO = 0.025; // lid gap / eye width
const DIRECTION_HOLD_MS = 600; // how long off-direction must persist
const GAZE_X_MAX = 0.6;        // left/right limit (normalized)
const GAZE_Y_MAX_DOWN = 0.35;  // looking down past this => likely phone
const GAZE_Y_MAX_UP = 0.5;     // optional (looking far up)
let offDirSince = null;

// ====== App/session state ======
let sessionActive = false;
let sessionStartTime = 0;
let totalSessionTime = 0;

let lookingTimeTotal = 0;
let awayTimeTotal = 0;
let currentState = "idle";
let stateStartTime = 0;

let timerInterval = null;

// Tracker state
let video = null;
let landmarker = null;
let lastSeenTs = 0;
let eyesClosedSince = null;
let becameLookingAt = null;
let ema = { x: null, y: null }; // for future gaze use
// Active-window tracker is implemented in features/activeWindowTracker.js

// ====== UI helpers ======
const states = {
    idle: { icon: "🐈", text: "IDLE", class: "state-idle" },
    looking: { icon: "😼", text: "LOOKING", class: "state-looking" },
    away: { icon: "😿", text: "AWAY", class: "state-away" },
};

function setState(newState) {
    if (currentState === newState) return;

    // finalize previous state's time
    const now = Date.now();
    const elapsed = now - stateStartTime;
    if (currentState === "looking") lookingTimeTotal += elapsed;
    else if (currentState === "away") awayTimeTotal += elapsed;

    currentState = newState;
    stateStartTime = now;

    const s = states[newState];
    stateIcon.textContent = s.icon;
    stateText.textContent = s.text;
    stateText.className = `state-text ${s.class}`;

    // Optional backend attention flip
    // if (sessionActive) {
    //     post(`${BACKEND}/events/attention`, { present: newState === "looking", ts: now });
    // }
}

function updateTimerUI() {
    if (!sessionActive) return;
    totalSessionTime = Date.now() - sessionStartTime;

    // format hh:mm:ss
    const secs = Math.floor(totalSessionTime / 1000);
    const h = String(Math.floor(secs / 3600)).padStart(2, "0");
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    timerEl.textContent = `${h}:${m}:${s}`;

    // include the ongoing state's elapsed time in the display
    let looking = lookingTimeTotal;
    let away = awayTimeTotal;
    const now = Date.now();
    if (currentState === "looking") looking += now - stateStartTime;
    if (currentState === "away") away += now - stateStartTime;

    lookingTimeEl.textContent = `${Math.floor(looking / 1000)}s`;
    awayTimeEl.textContent = `${Math.floor(away / 1000)}s`;

    const totalActive = looking + away;
    const focusScore = totalActive > 0 ? Math.round((looking / totalActive) * 100) : 0;
    focusScoreEl.textContent = `${focusScore}%`;
}

const smoothEMA = (prev, val, a = 0.25) => (prev == null ? val : prev + a * (val - prev));

// ====== MediaPipe helpers ======
function analyzeLandmarks(lms, w, h) {
    // Left: corners [33,133], lids [159,145], iris [468..472]
    // Right: corners [362,263], lids [386,374], iris [473..477]
    const idx = {
        Lc: [33, 133],
        Rc: [362, 263],
        Ll: [159, 145],
        Rl: [386, 374],
        Li: [468, 469, 470, 471, 472],
        Ri: [473, 474, 475, 476, 477],
    };
    const eye = (corners, lids, irisIdx) => {
        const [c0, c1] = corners.map((i) => lms[i]);
        const [t, b] = lids.map((i) => lms[i]);
        const iris = irisIdx.map((i) => lms[i]);
        const ew = Math.hypot((c0.x - c1.x) * w, (c0.y - c1.y) * h);
        const eh = Math.hypot((t.x - b.x) * w, (t.y - b.y) * h);
        const ec = { x: (c0.x + c1.x) / 2, y: (t.y + b.y) / 2 };
        const ic = iris.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
        ic.x /= iris.length;
        ic.y /= iris.length;
        const dx = (ic.x - ec.x) * w / (ew || 1);
        const dy = (ic.y - ec.y) * h / (eh || 1);
        const lidRatio = eh / (ew || 1);
        return { dx, dy, lidRatio };
    };
    const L = eye(idx.Lc, idx.Ll, idx.Li);
    const R = eye(idx.Rc, idx.Rl, idx.Ri);
    return { dx: (L.dx + R.dx) / 2, dy: (L.dy + R.dy) / 2, lidRatio: (L.lidRatio + R.lidRatio) / 2 };
}

// Camera and landmarker logic have been moved to features/camera.js and features/landmarker.js

async function trackLoop() {
    if (!sessionActive) return;
    const det = await detectForVideo(landmarker, video, performance.now());
    const now = Date.now();

    if (det.faceLandmarks && det.faceLandmarks[0]) {
        // Mark presence
        if (lastSeenTs === 0) lastSeenTs = now;

        const W = video.videoWidth,
            H = video.videoHeight;
        const { dx, dy, lidRatio } = analyzeLandmarks(det.faceLandmarks[0], W, H);
        ema.x = smoothEMA(ema.x, dx);
        ema.y = smoothEMA(ema.y, dy);

        // Off-direction if gaze far left/right OR down for a while
        const offDir =
            Math.abs(ema.x) > GAZE_X_MAX ||
            ema.y > GAZE_Y_MAX_DOWN ||      // looking down (phone)
            ema.y < -GAZE_Y_MAX_UP;         // optional: far up

        if (offDir) {
            if (offDirSince == null) offDirSince = now;
            // Only force-away if we were 'looking' and the off-direction is sustained:
            if (currentState === "looking" && (now - offDirSince) >= DIRECTION_HOLD_MS) {
                setState("away");
                lastSeenTs = 0;
                becameLookingAt = null;
            }
        } else {
            offDirSince = null;
        }


        // LOOKING hysteresis
        if (currentState !== "looking" && now - lastSeenTs >= PRESENT_MS) {
            setState("looking");
            becameLookingAt = now;
        }

        // Long eyes-closed → AWAY
        const eyesClosed = lidRatio < BLINK_GAP_RATIO;
        if (eyesClosed) {
            if (eyesClosedSince == null) eyesClosedSince = now;
            if (now - eyesClosedSince >= EYES_CLOSED_MS && currentState === "looking") {
                setState("away");
                lastSeenTs = 0;
                becameLookingAt = null;
            }
        } else {
            eyesClosedSince = null;
        }

        // (Optional) send a sparse gaze sample to backend
        // if ((now % 150) < 16) {
        //     post(`${BACKEND}/events/gaze`, { x: ema.x, y: ema.y, blink: false, conf: 1.0, ts: now });
        // }
    } else {
        // Absent hysteresis → AWAY
        if (lastSeenTs !== 0 && Date.now() - lastSeenTs >= ABSENT_MS) {
            setState("away");
            lastSeenTs = 0;
            becameLookingAt = null;
        }
    }

    requestAnimationFrame(trackLoop);
}

// ====== Public controls (wired to HTML onclick) ======

async function startSession() {
    if (sessionActive) return;
    sessionActive = true;
    sessionStartTime = Date.now();
    // Reset per-session state counters
    lookingTimeTotal = 0;
    awayTimeTotal = 0;
    currentState = 'idle';
    stateStartTime = sessionStartTime;

    // Start UI timer
    timerInterval = setInterval(updateTimerUI, 250);

    // Reset active-window tracking for this session and request polling
    resetSessionTracking();
    startSessionTracking();

    // Reset tracker/hysteresis state
    offDirSince = null;
    eyesClosedSince = null;
    becameLookingAt = null;
    ema = { x: null, y: null };

    // Camera + model
    video = await startCamera();
    landmarker = await loadLandmarker();

    // Initial state and loop
    setState('away'); // until presence stabilizes
    lastSeenTs = 0;
    eyesClosedSince = null;
    becameLookingAt = null;
    requestAnimationFrame(trackLoop);

    startBtn.disabled = true;
    stopBtn.disabled = false;
}

function stopSession() {
    if (!sessionActive) return;
    sessionActive = false;

    // finalize current state's time
    const now = Date.now();
    const elapsed = now - stateStartTime;
    if (currentState === 'looking') lookingTimeTotal += elapsed;
    else if (currentState === 'away') awayTimeTotal += elapsed;

    // stop UI timer
    clearInterval(timerInterval);
    timerInterval = null;

    // stop camera/model
    try { closeLandmarker(landmarker); } catch { }
    landmarker = null;
    if (video) {
        try { stopCamera(video); } catch { }
        video = null;
        offDirSince = null;
        lastSeenTs = 0;
    }

    // finalize active-window tracking for this session and persist
    try {
        const sessionBreakdown = stopSessionTracking();
        const totals = mergeTotals(sessionBreakdown);
        saveLastSession(sessionBreakdown);
        console.log('Session appTimes saved:', sessionBreakdown, 'totals merged:', totals);
        // refresh UI totals if present
        try { renderAppTotals(); } catch { }
    } catch (e) { console.error('failed to finalize session app times', e); }

    startBtn.disabled = false;
    stopBtn.disabled = true;

    setState('idle');
}

// Expose functions so your HTML onclick handlers work
// window.startSession = startSession;
// window.stopSession = stopSession;

export function initEyeTrackerUI() {
    startBtn.addEventListener('click', startSession);
    stopBtn.addEventListener('click', stopSession);
    // Initialize active-window tracker (it will subscribe to preload events)
    try { initActiveWindowTracker(); } catch { }
    // Render app totals panel if present
    try { renderAppTotals(); } catch { }
    // wire up refresh/clear buttons if present
    try {
        const refreshBtn = document.getElementById('refreshAppTotals');
        const clearBtn = document.getElementById('clearAppTotals');
        if (refreshBtn) refreshBtn.addEventListener('click', renderAppTotals);
        if (clearBtn) clearBtn.addEventListener('click', () => {
            localStorage.removeItem('appTotals');
            localStorage.removeItem('lastSessionAppTimes');
            renderAppTotals();
        });
    } catch { }
}

// Renders app totals into the UI element `#appTotalsList` if present
export function renderAppTotals() {
    try {
        const el = document.getElementById('appTotalsList');
        if (!el) return;
        const totals = JSON.parse(localStorage.getItem('appTotals') || '{}');
        el.innerHTML = '';
        const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) {
            el.textContent = 'No data yet';
            return;
        }
        for (const [app, ms] of entries) {
            const li = document.createElement('li');
            const secs = Math.round(ms / 1000);
            li.textContent = `${app}: ${secs}s`;
            el.appendChild(li);
        }
    } catch (e) { console.error('renderAppTotals failed', e); }
}


import { startCamera, stopCamera } from './camera.js';
import { loadLandmarker, detectForVideo, closeLandmarker } from './landmarker.js';
import { initActiveWindowTracker, startSessionTracking, stopSessionTracking, resetSessionTracking } from './activeWindowTracker.js';
import { mergeTotals, saveLastSession } from './storage.js';
import { postSession, getSession } from '../api/session-api.js';


// ====== UI elements (match your HTML IDs) ======
// NOTE: views are injected dynamically. Resolve DOM elements when the view is mounted
let startBtn = null;
let stopBtn = null;
let stateIcon = null;
let stateText = null;
let timerEl = null;
let lookingTimeEl = null;
let awayTimeEl = null;
let focusScoreEl = null;

// ====== State machine thresholds ======
const ABSENT_MS = 800; // no landmarks for this long → AWAY
const PRESENT_MS = 400; // landmarks present this long → LOOKING
const EYES_CLOSED_MS = 600; // continuous closure → AWAY
const BLINK_GAP_RATIO = 0.025; // lid gap / eye width
const DIRECTION_HOLD_MS = 600; // how long off-direction must persist
const GAZE_X_MAX = 0.6;        // left/right limit (normalized)
const GAZE_Y_MAX_DOWN = 0.35;  // looking down past this => likely phone
const GAZE_Y_MAX_UP = 0.5;     // optional (looking far up)
let offDirSince = null; // time stamp since the user is looking away from the screen

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

// set the state of the tracker
function setState(newState) {
    if (currentState === newState) return; // if the state is the same, do nothing

    // finalize previous state's time
    const now = Date.now();
    const elapsed = now - stateStartTime;
    if (currentState === "looking") lookingTimeTotal += elapsed;
    else if (currentState === "away") awayTimeTotal += elapsed;

    // update the state of the tracker and the time it started
    currentState = newState;
    stateStartTime = Date.now();

    // update the UI to the new state
    const s = states[newState]; // get the state icon and text
    stateIcon.textContent = s.icon;
    stateText.textContent = s.text;
    stateText.className = `state-text ${s.class}`;


}

// update the timer UI, looking time, and away time, and focus score
function updateTimerUI() {
    if (!sessionActive) return; // if the session is not active, do nothing
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
    // analyze the list of landmarks returned by the landmarker and return the eye position and lid ratio

    // inputs:
    // - lms: list of landmarks, each landmark is an object with cordinates. 
    // - w: width of the video
    // - h: height of the video

    // outputs:
    // - dx: horizontal eye position
    // - dy: vertical eye position
    // - lidRatio: ratio of the eye lid to the eye

    // indices of the landmarks for the left and right eye (defined in the MediaPipe documentation)
    const idx = {
        Lc: [33, 133],
        Rc: [362, 263],
        Ll: [159, 145],
        Rl: [386, 374],
        Li: [468, 469, 470, 471, 472],
        Ri: [473, 474, 475, 476, 477],
    };
    const eye = (corners, lids, irisIdx) => {
        // take the landmark coordinates of one eye and compute gaze direction  and lid ratio
        const [c0, c1] = corners.map((i) => lms[i]);
        const [t, b] = lids.map((i) => lms[i]);
        const iris = irisIdx.map((i) => lms[i]);
        const ew = Math.hypot((c0.x - c1.x) * w, (c0.y - c1.y) * h);
        const eh = Math.hypot((t.x - b.x) * w, (t.y - b.y) * h);
        const ec = { x: (c0.x + c1.x) / 2, y: (t.y + b.y) / 2 };
        const ic = iris.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
        ic.x /= iris.length;
        ic.y /= iris.length;
        const dx = (ic.x - ec.x) * w / (ew || 1); // horizontal gaze direction, dx > 0 -> looking right, dx < 0 -> looking left
        const dy = (ic.y - ec.y) * h / (eh || 1); // vertical gaze direction, dy > 0 -> looking down, dy < 0 -> looking up
        const lidRatio = eh / (ew || 1);// ratio of the eye lid to the eye, lidRatio > 0.5 -> eyes are closed, lidRatio < 0.5 -> eyes are open
        return { dx, dy, lidRatio };
    };
    const L = eye(idx.Lc, idx.Ll, idx.Li);
    const R = eye(idx.Rc, idx.Rl, idx.Ri);
    return { dx: (L.dx + R.dx) / 2, dy: (L.dy + R.dy) / 2, lidRatio: (L.lidRatio + R.lidRatio) / 2 };
}

// Camera and landmarker logic have been moved to features/camera.js and features/landmarker.js

// Main tracking loop
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

        // Off-direction if gaze far left/right OR down/up for a while
        const offDir =
            Math.abs(ema.x) > GAZE_X_MAX || // looking far left or right
            ema.y > GAZE_Y_MAX_DOWN ||      // looking down (phone)
            ema.y < -GAZE_Y_MAX_UP;         // looking far up

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

async function stopSession() {
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
        // try { renderAppTotals(); } catch { }
    } catch (e) { console.error('failed to finalize session app times', e); }

    startBtn.disabled = false;
    stopBtn.disabled = true;

    setState('idle');

    try {
        const totals = JSON.parse(localStorage.getItem('lastSessionAppTimes') || '{}');

        // const durationMinutes = (elapsed) / 60000;
        const focusScore = lookingTimeTotal / (lookingTimeTotal + awayTimeTotal);
        const sessionData = {
            userId: localStorage.getItem('userId'),
            startTime: new Date(sessionStartTime).toISOString(),
            endTime: new Date(now).toISOString(),
            durationSession: lookingTimeTotal, // currently in ms
            activity: totals,
            focusScore: Math.round(focusScore * 100),
        };

        console.log("Posting session data:", sessionData);

        const created = await postSession(sessionData);

        const sessionId = created.id || created._id;
        console.log("Created session ID:", sessionId);
        openLastSessionModel(created, totals);

    } catch (err) {
        console.error("Failed to post session:", err);
    }
}

export function initEyeTrackerUI() {
    // Resolve DOM elements for the currently-inserted view
    startBtn = document.getElementById("startBtn");
    stopBtn = document.getElementById("stopBtn");
    stateIcon = document.getElementById("stateIcon");
    stateText = document.getElementById("stateText");
    timerEl = document.getElementById("timer");
    lookingTimeEl = document.getElementById("lookingTime");
    awayTimeEl = document.getElementById("awayTime");
    focusScoreEl = document.getElementById("focusScore");

    if (startBtn) startBtn.addEventListener('click', startSession);
    if (stopBtn) stopBtn.addEventListener('click', stopSession);

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

    // Wire up last-session modal controls
    try {
        const closeLastSessionBtn = document.getElementById('lastSessionModelCloseBtn');
        if (closeLastSessionBtn) closeLastSessionBtn.addEventListener('click', closeLastSessionModel);

        const lastSessionModal = document.getElementById('lastSessionModel');
        if (lastSessionModal) lastSessionModal.addEventListener('click', (e) => {
            if (e.target === lastSessionModal || e.target.classList.contains('last-session-backdrop')) {
                closeLastSessionModel();
            }
        });
    } catch { }
}

// Renders app totals into the UI element `#appTotalsList` if present
// export function renderAppTotals() {
//     try {
//         const el = document.getElementById('appTotalsList');
//         if (!el) return;
//         const totals = JSON.parse(localStorage.getItem('appTotals') || '{}');
//         el.innerHTML = '';
//         const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
//         if (entries.length === 0) {
//             el.textContent = 'No data yet';
//             return;
//         }
//         for (const [app, ms] of entries) {
//             const li = document.createElement('li');
//             const secs = Math.round(ms / 1000);
//             li.textContent = `${app}: ${secs}s`;
//             el.appendChild(li);
//         }
//     } catch (e) { console.error('renderAppTotals failed', e); }
// }

function formatMsToHMS(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000)); // total seconds
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;

    // If you want only h/m (like before)
    if (h > 0) return `${h}h${m}m`;
    if (m > 0) return `${m}m`;
    return `${sec}s`;
}


function openLastSessionModel(session, appTotals = {}) {
    console.log(session)
    const modal = document.getElementById('lastSessionModel');
    if (!modal) return;

    const totalTimeEl = document.getElementById('lastSessionTotalTime');
    const totalFocusTimeEl = document.getElementById('lastSessionTotalFocusTime');
    const focusScoreEl = document.getElementById('lastSessionFocusScore');
    const activityListEl = document.getElementById('lastSessionActivityList');

    // total duration (from backend)

    const end = new Date(session.endTime);
    const start = new Date(session.startTime)
    console.log(end)
    console.log(start)
    const totalMins = end - start ?? 0;
    console.log("totalMins: ", totalMins);

    // approximate focus minutes from score

    const focusScore = session.focusScore ?? 0;
    const focusTime = session.durationSession ?? 0;

    if (totalTimeEl) totalTimeEl.textContent = formatMsToHMS(totalMins);
    if (totalFocusTimeEl) totalFocusTimeEl.textContent = formatMsToHMS(focusTime);
    if (focusScoreEl) focusScoreEl.textContent = focusScore;

    if (activityListEl) {
        activityListEl.innerHTML = '';
        const entries = Object.entries(appTotals).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) {
            const li = document.createElement('li');
            li.innerHTML = '<span>No activity data</span>';
            activityListEl.appendChild(li);
        } else {
            for (const [app, ms] of entries) {
                const li = document.createElement('li');
                const formatted = formatMsToHMS(ms);
                li.innerHTML = `<span>${app}</span><span>${formatted}</span>`;
                activityListEl.appendChild(li);
            }
        }
    }

    modal.classList.remove('hidden');
    const main = document.getElementById('appView');
    if (main) main.classList.add('blur');
}

function closeLastSessionModel() {
    const modal = document.getElementById('lastSessionModel');
    if (!modal) return;
    modal.classList.add('hidden');
    const main = document.getElementById('appView');
    if (main) main.classList.remove('blur');
}

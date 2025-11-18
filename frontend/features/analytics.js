import { getSessionByUser } from "../api/session-api.js";
import { stripTime, formatMsToHMS, formatSessionTitle } from "./utils.js";


export async function initAnalytics() {
    const userId = localStorage.getItem("userId");
    if (!userId) return;
    try {
        const sessions = await getSessionByUser(userId);
        console.log(sessions);
        renderSessionsAnalytics(sessions)
    } catch (err) {
        console.error("Failed to load sessions:", err)
    }
}

function renderSessionsAnalytics(sessions) {
    const recentSessionsListEl = document.getElementById("recentSessionsList");
    const avgFocusScoreEl = document.getElementById("avgFocusScore");
    const totalSessionsEl = document.getElementById("totalSessions");
    const currentStreakEl = document.getElementById("currentStreak");

    const avgScore = getAvgFocusScore(sessions);
    const totalSessions = getTotalSessions(sessions);
    const streak = getCurrentStreak(sessions)

    avgFocusScoreEl.textContent = avgScore + "%";
    totalSessionsEl.textContent = totalSessions;
    currentStreakEl.textContent = streak + (streak <= 1 ? " day" : " days");

    const recentSessions = getRecentSessions(sessions);
    renderRecentSessionsList(recentSessionsListEl, recentSessions);



}

function getAvgFocusScore(sessions) {
    if (!sessions.length) return 0;
    const total = sessions.reduce((acc, s) => acc + (s.focusScore || 0), 0);
    return Math.round(total / sessions.length);
}

function getTotalSessions(sessions) {
    return sessions.length
}

function getCurrentStreak(sessions) {
    if (!sessions || sessions.length === 0) return 0;
    const dates = sessions
        .map(s => new Date(s.startTime))
        .map(d => stripTime(d));

    const uniqueDates = [...new Set(dates.map(d => d.getTime()))].sort().reverse();

    const today = stripTime(new Date());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    let streak = 0;
    let currentDay;


    if (uniqueDates.includes(today.getTime())) {
        streak = 1;
        currentDay = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    } else if (uniqueDates.includes(yesterday.getTime())) {
        streak = 1;
        currentDay = new Date(yesterday.getTime() - 24 * 60 * 60 * 1000);
    } else {
        return 0;
    }

    while (uniqueDates.includes(currentDay.getTime())) {
        streak++;
        currentDay = new Date(currentDay.getTime() - 24 * 60 * 60 * 1000);
    }
    return streak
}

function getRecentSessions(sessions, limit = 5) {
    if (!sessions || sessions.length === 0) return [];
    const sorted = [...sessions].sort(
        (a, b) => new Date(b.startTime) - new Date(a.startTime)
    );
    return sorted.slice(0, limit);
}

function renderRecentSessionsList(containerEl, recentSessions) {
    if (!containerEl) return;

    containerEl.innerHTML = "";

    if (!recentSessions.length) {
        containerEl.textContent = "No sessions yet. Start a focus session to see it here!";
        return;
    }

    recentSessions.forEach(session => {
        const start = new Date(session.startTime);
        const end = session.endTime ? new Date(session.endTime) : null;

        // duration: prefer `total` if you store it, else end-start
        const durationMs =
            (typeof session.total === "number" ? session.total : null) ??
            (end ? end - start : 0);
        const durationText = formatMsToHMS(durationMs);

        const title = formatSessionTitle(start);

        const focusScore = session.focusScore ?? "--";

        const row = document.createElement("div");
        row.className = "session-item";
        row.innerHTML = `
            <div class="session-left">
                <div class="session-emoji">🙂</div>
                <div class="session-text">
                    <div class="session-when">${title}</div>
                    <div class="session-duration">${durationText}</div>
                </div>
            </div>
            <div class="session-score">
                <div class="session-score-value">${focusScore}</div>
                <div class="session-score-label">Focus Score</div>
            </div>
        `;

        containerEl.appendChild(row);
    });
}
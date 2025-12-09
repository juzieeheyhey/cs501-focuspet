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
    const activityListEl = document.getElementById("activityList");

    const avgScore = getAvgFocusScore(sessions);
    const totalSessions = getTotalSessions(sessions);
    const streak = getCurrentStreak(sessions)

    avgFocusScoreEl.textContent = avgScore + "%";
    totalSessionsEl.textContent = totalSessions;
    currentStreakEl.textContent = streak + (streak <= 1 ? " day" : " days");

    const recentSessions = getRecentSessions(sessions);
    renderRecentSessionsList(recentSessionsListEl, recentSessions);

    const activityList = getActivityList(sessions);
    console.log(activityList);
    renderActivityAnalytics(activityListEl, activityList);

    const weekly = computeWeeklyStats(sessions);
    renderWeeklyFocusTrend(weekly);
    renderSessionsPerDay(weekly);


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

        // default
        let emoji = "🙂";
        let bgColor = "#fef3c7";

        if (focusScore > 80) {
            emoji = "😄";
            bgColor = "#d1fae5";
        } else if (focusScore >= 40) {
            emoji = "😐";
            bgColor = "#fef3c7";
        } else {
            emoji = "😢";
            bgColor = "#fee2e2";
        }
        row.innerHTML = `
            <div class="session-left">
                <div class="session-emoji" style="background:${bgColor}">${emoji}</div>
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

function getActivityList(sessions) {
    if (!sessions || sessions.length === 0) return [];

    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000; // last 7 days

    // accumulate total time per app
    const totals = new Map(); // appName -> totalMs

    for (const session of sessions) {
        if (!session || !session.startTime) continue;

        const start = new Date(session.startTime).getTime();
        if (isNaN(start) || start < weekAgo || start > now) continue; // keep only this week

        const activity = session.activity || {};
        for (const [appName, value] of Object.entries(activity)) {
            if (typeof value !== "number" || value <= 0) continue;
            const prev = totals.get(appName) || 0;
            totals.set(appName, prev + value); // assume `value` is milliseconds
        }
    }

    // turn into sorted array
    const items = Array.from(totals.entries())
        .map(([app, totalMs]) => ({
            app,
            totalMs,
            // timeLabel: formatMsToHMS(totalMs),
        }))
        .sort((a, b) => b.totalMs - a.totalMs); // rank: most time first

    return items;
}

function renderActivityAnalytics(containerEl, activity) {

    if (!containerEl) return;

    if (!activity.length) {
        containerEl.textContent = "No activity yet.";
        return;
    }


    containerEl.innerHTML = "";

    activity.forEach((item, index) => {
        const li = document.createElement("li");
        li.className = "activity-item";

        const left = document.createElement("div");
        left.className = "activity-left";

        const badge = document.createElement("div");
        badge.className = "rank-badge";
        badge.textContent = index + 1;

        const name = document.createElement("span");
        name.className = "app-name";
        name.textContent = item.app;

        left.appendChild(badge);
        left.appendChild(name);

        const time = document.createElement("span");
        time.className = "app-time";
        time.textContent = formatMsToHMS(item.totalMs);

        li.appendChild(left);
        li.appendChild(time);

        containerEl.appendChild(li);
    });
}

/ ========== weekly charts helpers ========== /

// Last 7 days (oldest → newest)
function getLast7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);

        const label = d.toLocaleDateString("en-US", {
            month: "short", // Dec
            day: "numeric"  // 8
        });

        const key = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
        days.push({ key, label });
    }
    return days;
}

// Aggregate sessions into last-7-day buckets
function computeWeeklyStats(sessions) {
    const baseDays = getLast7Days();
    const days = baseDays.map(d => ({
        ...d,
        sessionCount: 0,
        scoreSum: 0,
        scoreNum: 0,
        avgScore: 0,
    }));

    if (!sessions || sessions.length === 0) return days;

    const byKey = new Map(days.map(d => [d.key, d]));

    for (const s of sessions) {
        if (!s.startTime) continue;
        const start = new Date(s.startTime);
        if (Number.isNaN(start.getTime())) continue;

        start.setHours(0, 0, 0, 0);
        const key = start.toISOString().slice(0, 10);
        const day = byKey.get(key);
        if (!day) continue; // not in last 7 days

        day.sessionCount += 1;
        const score = typeof s.focusScore === "number" ? s.focusScore : null;
        if (score != null && !Number.isNaN(score)) {
            day.scoreSum += score;
            day.scoreNum += 1;
        }
    }

    for (const d of days) {
        d.avgScore = d.scoreNum > 0 ? d.scoreSum / d.scoreNum : 0;
    }

    return days;
}

// Fill x-axis labels under a chart
function renderXAxisLabels(containerId, days) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "";
    days.forEach(d => {
        const span = document.createElement("span");
        span.textContent = d.label; // e.g. "Dec 8"
        el.appendChild(span);
    });
}

// ========== Weekly Focus Trend (area) ==========

function renderWeeklyFocusTrend(days) {
    const svg = document.getElementById("focusTrendSvg");
    if (!svg || !days || days.length === 0) return;

    renderXAxisLabels("focusTrendLabels", days);

    const width = 320;
    const height = 160;
    const paddingLeft = 32;
    const paddingRight = 8;
    const paddingTop = 8;
    const paddingBottom = 18;

    const innerWidth = width - paddingLeft - paddingRight;
    const innerHeight = height - paddingTop - paddingBottom;

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Y-axis ticks (0,25,50,75,100)
    const yTicks = [0, 25, 50, 75, 100];
    yTicks.forEach(val => {
        const y = paddingTop + innerHeight - (val / 100) * innerHeight;
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", 0);
        label.setAttribute("y", y + 4);
        label.setAttribute("class", "chart-y-label");
        label.textContent = val;
        svg.appendChild(label);
    });

    const n = days.length;
    if (n === 0) return;

    const stepX = innerWidth / (n - 1 || 1);

    let pathD = "";
    days.forEach((d, i) => {
        const x = paddingLeft + i * stepX;
        const score = Math.max(0, Math.min(100, d.avgScore || 0));
        const y = paddingTop + innerHeight - (score / 100) * innerHeight;
        if (i === 0) pathD += `M ${x} ${y}`;
        else pathD += ` L ${x} ${y}`;
    });

    const lastX = paddingLeft + (n - 1) * stepX;
    const baseY = paddingTop + innerHeight;
    const firstX = paddingLeft;

    pathD += ` L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;

    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
    area.setAttribute("d", pathD);
    area.setAttribute("class", "chart-area");
    svg.appendChild(area);
}

// ========== Sessions Per Day (bars) ==========

function renderSessionsPerDay(days) {
    const svg = document.getElementById("sessionsPerDaySvg");
    if (!svg || !days || days.length === 0) return;

    renderXAxisLabels("sessionsPerDayLabels", days);

    const width = 320;
    const height = 160;
    const paddingLeft = 32;
    const paddingRight = 8;
    const paddingTop = 8;
    const paddingBottom = 18;

    const innerWidth = width - paddingLeft - paddingRight;
    const innerHeight = height - paddingTop - paddingBottom;

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const maxCount = Math.max(1, ...days.map(d => d.sessionCount || 0));

    // y ticks 0..maxCount (up to 4)
    const tickCount = Math.min(4, maxCount);
    const step = maxCount / tickCount || 1;
    const yTicks = [];
    for (let i = 0; i <= tickCount; i++) {
        yTicks.push(Math.round(i * step));
    }

    yTicks.forEach(val => {
        const ratio = maxCount === 0 ? 0 : val / maxCount;
        const y = paddingTop + innerHeight - ratio * innerHeight;
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", 0);
        label.setAttribute("y", y + 4);
        label.setAttribute("class", "chart-y-label");
        label.textContent = val;
        svg.appendChild(label);
    });

    const n = days.length;
    const barWidth = innerWidth / (n * 1.4);
    const stepX = innerWidth / n;

    days.forEach((d, i) => {
        const count = d.sessionCount || 0;
        const ratio = maxCount === 0 ? 0 : count / maxCount;
        const barHeight = ratio * innerHeight;

        const x = paddingLeft + i * stepX + (stepX - barWidth) / 2;
        const y = paddingTop + innerHeight - barHeight;

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", barWidth);
        rect.setAttribute("height", barHeight);
        rect.setAttribute("class", "chart-bar");
        svg.appendChild(rect);
    });
}
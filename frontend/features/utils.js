export function formatMsToHMS(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000)); // total seconds
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;

    // If you want only h/m (like before)
    if (h > 0) return `${h}h${m}m`;
    if (m > 0) return `${m}m`;
    return `${sec}s`;
}

export function formatSessionTitle(date) {
    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000;
    const diffDays = Math.floor((stripTime(now) - stripTime(date)) / oneDay);

    const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    if (diffDays === 0) return `Today, ${timeStr}`;
    if (diffDays === 1) return `Yesterday, ${timeStr}`;
    return `${diffDays} days ago, ${timeStr}`;
}

export function stripTime(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

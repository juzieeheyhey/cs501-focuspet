import { initEyeTrackerUI } from './features/eyetracking.js';

window.addEventListener('DOMContentLoaded', () => {
    initEyeTrackerUI();

    // Listen for active window updates from main (exposed via preload)
    if (window.electronAPI?.onActiveWindow) {
        window.electronAPI.onActiveWindow((info) => {
            // Example: log and optionally show in UI if an element exists
            console.log('Active window:', info);
            const el = document.getElementById('activeWindowTitle');
            if (el) el.textContent = info?.title || '—';
        });
    }
});

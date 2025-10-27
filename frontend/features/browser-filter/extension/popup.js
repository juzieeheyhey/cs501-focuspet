// popup.js
const q = (sel) => document.querySelector(sel);

document.addEventListener("DOMContentLoaded", init);

async function init() {
    const wl = q("#wl");
    const bl = q("#bl");
    const session = q("#session");
    const statusDot = q("#statusDot");
    const applyBtn = q("#apply");
    const clearBtn = q("#clear");

    // Load saved state
    const { allowlist = [], blacklist = [], sessionOn = false } =
        await chrome.storage.local.get({ allowlist: [], blacklist: [], sessionOn: false });

    wl.value = allowlist.join("\n");
    bl.value = blacklist.join("\n");
    session.checked = !!sessionOn;
    statusDot.classList.toggle("active", !!sessionOn);

    // Toggle indicator
    session.addEventListener("change", () => {
        statusDot.classList.toggle("active", session.checked);
    });

    // Save & Apply
    applyBtn.addEventListener("click", async () => {
        const newAllow = wl.value.split("\n").map(s => s.trim()).filter(Boolean);
        const newBlock = bl.value.split("\n").map(s => s.trim()).filter(Boolean);
        const on = session.checked;

        await chrome.storage.local.set({ allowlist: newAllow, blacklist: newBlock, sessionOn: on });
        try {
            await chrome.runtime.sendMessage({ type: "APPLY", allowlist: newAllow, blacklist: newBlock, sessionOn: on });
        } catch (_) { }

        window.close();
    });

    // Clear all
    clearBtn.addEventListener("click", async () => {
        wl.value = "";
        bl.value = "";
        session.checked = false;
        statusDot.classList.remove("active");

        await chrome.storage.local.set({ allowlist: [], blacklist: [], sessionOn: false });
        try {
            await chrome.runtime.sendMessage({ type: "CLEAR" });
        } catch (_) { }

        window.close();
    });
}


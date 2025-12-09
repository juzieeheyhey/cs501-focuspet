// interstitial.js - Handles the soft block interstitial page

const params = new URLSearchParams(window.location.search);
const tabId = parseInt(params.get('tabId'), 10);

let targetUrl = null;

// Load the blocked URL from storage
(async () => {
    const storageKey = `blocked_url_${tabId}`;
    const result = await chrome.storage.session.get([storageKey]);
    
    if (result[storageKey]) {
        targetUrl = result[storageKey].url;
        document.getElementById('targetUrl').textContent = targetUrl;
    } else {
        document.getElementById('targetUrl').textContent = 'URL not found';
    }
})();

const proceedBtn = document.getElementById('proceedBtn');

proceedBtn.addEventListener('click', async () => {
    if (!targetUrl || !tabId) {
        console.error('Missing URL or tabId', { targetUrl, tabId });
        alert('Unable to proceed - URL not found');
        return;
    }
    
    try {
        // Disable button to prevent double-clicks
        proceedBtn.disabled = true;
        proceedBtn.textContent = 'Redirecting...';
        
        // Tell the service worker to set a bypass for this tab
        await chrome.runtime.sendMessage({ 
            type: 'SET_BYPASS', 
            tabId: tabId 
        });
        
        console.log('Bypass set, redirecting to:', targetUrl);
        
        // Clean up the stored URL
        const storageKey = `blocked_url_${tabId}`;
        await chrome.storage.session.remove([storageKey]);
        
        // Use chrome.tabs.update to ensure proper navigation
        await chrome.tabs.update(tabId, { url: targetUrl });
    } catch (error) {
        console.error('Error during proceed:', error);
        proceedBtn.disabled = false;
        proceedBtn.textContent = 'Continue Anyway';
        alert('Failed to proceed. Please try again.');
    }
});
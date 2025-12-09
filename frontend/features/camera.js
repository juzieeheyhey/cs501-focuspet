// Camera helper: start and stop a preview video element
export async function startCamera({ width = 640, height = 480, preview = true } = {}) {
    const v = document.createElement('video');
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width, height } });
    v.srcObject = stream;
    await v.play();

    // if preview flag, style and add to DOM (document object model)
    if (preview) {
        v.style.position = 'fixed';
        v.style.top = '16px';
        v.style.right = '16px';
        v.style.width = '240px';
        v.style.height = 'auto';
        v.style.borderRadius = '10px';
        v.style.boxShadow = '0 8px 24px rgba(0,0,0,.25)';
        v.style.zIndex = '9999';
        v.style.pointerEvents = 'none';
        v.style.transform = 'scaleX(-1)';
        document.body.appendChild(v);
    }

    return v;
}

// stop and cleanup camera video element
export function stopCamera(video) {
    if (!video) return;
    try {
        if (video.srcObject) {
            for (const t of video.srcObject.getTracks()) t.stop();
        }
    } catch { }
    try {
        if (video.parentNode) video.parentNode.removeChild(video);
    } catch { }
}

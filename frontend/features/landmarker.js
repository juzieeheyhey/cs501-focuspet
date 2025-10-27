import { FilesetResolver, FaceLandmarker }
    from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs';

export async function loadLandmarker() {
    const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm');
    return await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: 'face_landmarker.task', delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
    });
}

export async function detectForVideo(landmarker, video, nowTs) {
    if (!landmarker) return null;
    return await landmarker.detectForVideo(video, nowTs);
}

export function closeLandmarker(landmarker) {
    try { landmarker?.close(); } catch { }
}

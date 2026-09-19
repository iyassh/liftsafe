// Camera (or test clip) in, pose landmarks out. Written for the warm-up page; js/check.js keeps
// its own copy on purpose so the lift check cannot be broken from here.
import { PoseLandmarker, FilesetResolver } from '../vendor/mediapipe/vision_bundle.mjs';

const BONES = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28]];
const JOINTS = [...new Set(BONES.flat())];

let landmarkerPromise = null;
let lastStamp = 0; // shared: one landmarker serves every camera session on the page

// Loads the model once. A failed load is forgotten, so calling again is a real retry.
export function createLandmarker() {
  landmarkerPromise ??= loadLandmarker().catch((err) => {
    landmarkerPromise = null;
    throw err;
  });
  return landmarkerPromise;
}

async function loadLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: 'vendor/mediapipe/pose_landmarker_lite.task', delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  try {
    return await PoseLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    console.warn('GPU delegate unavailable, using CPU', err);
    return PoseLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

// Opens the camera (or `testVideoUrl`) and calls onFrame(lmsOrNull, now, aspect) for every new
// video frame until stop(). Rejects if the model or the source cannot be opened.
export async function startPoseCamera({ video, canvas, onFrame, onLost, testVideoUrl }) {
  const landmarker = await createLandmarker();
  const ctx = canvas.getContext('2d');
  let stream = null;
  let running = true;
  let rafId = 0;
  let lastVideoTime = -1;
  let frameErrorLogged = false;

  function syncCanvasSize() {
    if (!video.videoWidth) return;
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
  }

  // Fires when the camera is unplugged or revoked, not when stop() ends the track.
  function lost() {
    if (running) onLost?.();
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    video.removeEventListener('loadedmetadata', syncCanvasSize);
    video.removeEventListener('resize', syncCanvasSize);
    if (stream) {
      for (const track of stream.getTracks()) {
        track.removeEventListener('ended', lost);
        track.stop();
      }
      stream = null;
    }
    video.pause();
    video.srcObject = null;
    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function tick(now) {
    if (video.readyState < 2 || !video.videoWidth || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    syncCanvasSize();
    // detectForVideo needs strictly increasing timestamps, even across a looped test video.
    const stamp = Math.max(now, lastStamp + 1);
    lastStamp = stamp;
    const lms = landmarker.detectForVideo(video, stamp).landmarks?.[0] ?? null;
    onFrame(lms, now, video.videoWidth / video.videoHeight);
  }

  function loop() {
    if (!running) return;
    try {
      tick(performance.now());
    } catch (err) {
      // One bad frame must not end the session; log the first so the console stays readable.
      if (!frameErrorLogged) console.error('Frame failed', err);
      frameErrorLogged = true;
    }
    if (running) rafId = requestAnimationFrame(loop);
  }

  try {
    if (testVideoUrl) {
      video.src = testVideoUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
    } else {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia is not available');
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      stream.getVideoTracks()[0]?.addEventListener('ended', lost);
      video.srcObject = stream;
    }
    video.addEventListener('loadedmetadata', syncCanvasSize);
    video.addEventListener('resize', syncCanvasSize);
    await video.play();
  } catch (err) {
    stop(); // never leave a half-open camera behind a failed start
    throw err;
  }
  syncCanvasSize();
  rafId = requestAnimationFrame(loop);
  return { stop };
}

export function drawSkeleton(ctx, canvas, lms, color) {
  const seen = (i) => (lms[i].visibility ?? 0) >= 0.5;
  const px = (i) => [lms[i].x * canvas.width, lms[i].y * canvas.height];
  const unit = canvas.height / 720; // keep line weight constant whatever the camera resolution
  ctx.lineWidth = 6 * unit;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const [a, b] of BONES) {
    if (!seen(a) || !seen(b)) continue;
    ctx.beginPath();
    ctx.moveTo(...px(a));
    ctx.lineTo(...px(b));
    ctx.stroke();
  }
  for (const i of JOINTS) {
    if (!seen(i)) continue;
    ctx.beginPath();
    ctx.arc(...px(i), 7 * unit, 0, Math.PI * 2);
    ctx.fill();
  }
}

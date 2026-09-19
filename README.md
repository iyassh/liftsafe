# LiftSafe

AI lifting-safety trainer for small businesses. A worker does five lifts in front of any camera, gets instant coaching and a Lift Safety Score, and the employer gets a dated training record. Runs entirely in the browser: no video is stored or uploaded.

Built at the Kamloops 2026 Hackathon.

## Run

```bash
npm run dev     # then open http://localhost:8000
npm test        # engine unit tests
```

The camera needs `localhost` or HTTPS; opening the HTML files directly will not work.

Pose estimation: MediaPipe Pose Landmarker (`@mediapipe/tasks-vision` 0.10.14), vendored in `vendor/mediapipe` so the app works offline.

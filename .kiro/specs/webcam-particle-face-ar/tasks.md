# Implementation Plan: Webcam Particle Face AR

## Overview

Triển khai ứng dụng web single-page chạy hoàn toàn client-side trong Chrome, kết hợp MediaPipe (FaceMesh + Hands qua CDN), Three.js (WebGL 2.0), và Web APIs để tạo hiệu ứng AR particle cloud theo thời gian thực. Thứ tự implementation đi từ foundation (HTML skeleton, pure functions) đến rendering, rồi UI và integration.

## Tasks

- [x] 1. Project setup — HTML skeleton, CDN scripts, file structure
  - Tạo `index.html` với đầy đủ `<script>` tags CDN cho Three.js r158, MediaPipe FaceMesh 0.4, MediaPipe Hands 0.4, MediaPipe Camera Utils 0.3, và fast-check
  - Tạo cấu trúc thư mục: `js/` cho các module, `css/` cho styles
  - Tạo `css/style.css` với layout full-screen, canvas overlay, loading screen, error overlay, HUD positioning (4 góc), neon frame CSS animation (pulse 3s, opacity 0.6→1.0)
  - Tạo `js/constants.js` định nghĩa các hằng số: `DEPTH_SCALE = 50`, `DEFAULT_PARTICLE_COUNT = 2000`, `MIN_PARTICLES = 500`, `MAX_PARTICLES = 5000`, `LERP_POSITION = 0.1`, `LERP_SCALE = 0.08`, `LERP_BACK = 0.01`, `JITTER_RADIUS_NORMALIZED = 0.02`, `HAND_DIST_MIN = 0.05`, `HAND_DIST_MAX = 0.8`, `SCALE_MIN = 0.3`, `SCALE_MAX = 3.0`
  - Thêm HTTPS / localhost check và WebGL 2.0 check vào `index.html` inline script (hiển thị error overlay nếu fail)
  - Thêm thông báo quyền riêng tư (privacy notice): kiểm tra `localStorage.getItem('privacy-notice-seen')`; nếu chưa có, hiển thị notice và set key sau khi user dismiss — đảm bảo chỉ hiện đúng một lần
  - _Requirements: 1.5, 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 2. StateManager — localStorage persistence
  - Tạo `js/StateManager.js` với class `StateManager`
  - Implement `load()` đọc từ `localStorage` key `webcam-particle-ar-state`, parse JSON, validate và fallback về defaults nếu giá trị không hợp lệ
  - Implement `save()` ghi JSON vào `localStorage`
  - Implement getters/setters cho `particleCount` (clamp [500, 5000]), `intensityMode`, `mirrorMode`, `isRunning`
  - Mỗi setter tự động gọi `save()` sau khi cập nhật giá trị

  - [x] 2.1 Write property test cho StateManager round-trip
    - **Property 16: AppState Round-Trip Through localStorage**
    - Dùng `fc.record({ particleCount: fc.integer({min:500,max:5000}), intensityMode: fc.boolean(), mirrorMode: fc.boolean(), isRunning: fc.boolean() })` để generate AppState ngẫu nhiên
    - Verify `save()` rồi `load()` trả về state bằng state ban đầu
    - **Validates: Requirements 11.6**

  - _Requirements: 11.6_

- [x] 3. CoordinateMapper — pure coordinate transform functions
  - Tạo `js/CoordinateMapper.js` với class `CoordinateMapper(camera, renderer)`
  - Implement `computeViewport()` → `{ width, height }` theo công thức: `viewportHeight = 2 * tan(37.5° * π/180) * cameraZ`, `viewportWidth = viewportHeight * aspectRatio`
  - Implement `landmarkToWorld(lm, mirrorMode)` → `THREE.Vector3` theo công thức Requirement 13 (normal và mirror mode)
  - Implement `computePalmCenter(handLandmarks, mirrorMode)` → `THREE.Vector3` là trung bình world-space của landmarks 0, 5, 9, 13, 17
  - Implement `computeHandDistance(p1, p2)` → Euclidean distance trong world units
  - Implement `computeMidpoint(p1, p2)` → `THREE.Vector3` trung điểm
  - Implement `mapDistanceToScale(normalizedDist)` → clamp(lerp(0.3, 3.0, (d - 0.05) / 0.75), 0.3, 3.0)
  - Implement `computeFaceBoundingBox(landmarks, mirrorMode)` → `{ x, y, width, height }` screen pixels với padding 5%
  - Implement `mapFaceLandmarks(landmarks, mirrorMode)` → `Float32Array` (x,y,z × 468)

  - [x] 3.1 Write property test cho coordinate mapping (normal mode)
    - **Property 1: Coordinate Mapping Formula Correctness (Normal Mode)**
    - Dùng `fc.record({ x: fc.float({min:0,max:1}), y: fc.float({min:0,max:1}), z: fc.float({min:-1,max:1}) })` và `fc.float({min:0.5,max:3})` cho aspect ratio
    - Verify worldX, worldY, worldZ theo đúng công thức Requirement 13.1, 13.2, 13.3, 13.6
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.6**

  - [x] 3.2 Write property test cho coordinate mapping (mirror mode)
    - **Property 2: Coordinate Mapping Formula Correctness (Mirror Mode)**
    - Verify `worldX_mirrored = -worldX_normal` với cùng landmark
    - Verify trục y và z không bị ảnh hưởng bởi mirror mode
    - **Validates: Requirements 13.4, 13.5, 11.5**

  - [x] 3.3 Write property test cho palm center calculation
    - **Property 3: Palm Center Is Average of Five Landmarks**
    - Dùng `fc.array(fc.record({x,y,z}), {minLength:21,maxLength:21})` để generate 21 landmarks
    - Verify palmCenter = (world(lm[0]) + world(lm[5]) + world(lm[9]) + world(lm[13]) + world(lm[17])) / 5
    - **Validates: Requirements 4.2**

  - [x] 3.4 Write property test cho hand distance
    - **Property 4: Hand Distance Is Euclidean Distance**
    - Dùng `fc.tuple(fc.float(), fc.float(), fc.float())` × 2 để generate hai Vector3
    - Verify distance = sqrt(Σ(p2-p1)²) và tính đối xứng distance(p1,p2) = distance(p2,p1)
    - **Validates: Requirements 4.3**

  - [x] 3.5 Write property test cho scale mapping
    - **Property 5: Hand Distance to Scale Mapping Is Monotonic and Bounded**
    - Dùng `fc.tuple(fc.float({min:0,max:1}), fc.float({min:0,max:1}))` để generate cặp distances
    - Verify monotonicity: d1 ≤ d2 → mapDistanceToScale(d1) ≤ mapDistanceToScale(d2)
    - Verify bounds: với mọi d, mapDistanceToScale(d) ∈ [0.3, 3.0]
    - **Validates: Requirements 7.1, 7.2, 7.5**

  - _Requirements: 4.2, 4.3, 7.1, 7.2, 7.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

- [x] 4. SceneRenderer — Three.js scene, camera, render loop
  - Tạo `js/SceneRenderer.js` với class `SceneRenderer(canvas)`
  - Implement `init()`: tạo `THREE.Scene`, `THREE.PerspectiveCamera(75, aspect, 0.1, 1000)` với `camera.position.z = 100`, `THREE.WebGLRenderer({ canvas, antialias: false, alpha: true })` với `setPixelRatio(min(devicePixelRatio, 2))` và `setClearColor(0x000000, 0)`
  - Implement `startRenderLoop()` dùng `requestAnimationFrame`, tính `deltaTime` từ `performance.now()`
  - Implement `stopRenderLoop()` cancel animation frame
  - Implement `render(deltaTime)` gọi `renderer.render(scene, camera)`
  - Implement `onResize()`: cập nhật `camera.aspect`, gọi `camera.updateProjectionMatrix()`, gọi `renderer.setSize()`; emit event hoặc gọi callback để `CoordinateMapper` recompute viewport sau resize
  - Expose getters `scene`, `camera`, `renderer`
  - _Requirements: 10.1, 10.2, 10.3, 12.5_

- [x] 5. ParticleSystem — BufferGeometry, color animation, intrinsic motion
  - Tạo `js/ParticleSystem.js` với class `ParticleSystem(scene, coordinateMapper, count = 2000)` — nhận `coordinateMapper` để gọi `computeViewport()` lấy `viewportWidth` cho jitter và noise radius
  - Implement `init()`: tạo `THREE.BufferGeometry` với attributes `position` (Float32Array count×3) và `color` (Float32Array count×3); tạo `THREE.PointsMaterial({ vertexColors: true, size: 0.5, sizeAttenuation: true })`; thêm `THREE.Points` vào scene
  - Khởi tạo `basePositions`, `colorPhases` (random [0, 2π]), `cycleDurations` (random [2, 5] giây per particle)
  - Implement `updateFromFace(worldPositions)`: gán `basePositions` từ Float32Array, thêm jitter trong bán kính `0.02 * coordinateMapper.computeViewport().width`; particles mới (khi count tăng) được khởi tạo tại `Vector3(0,0,0)` cho đến khi có face data
  - Implement `updateFromHands(handData)`: cập nhật `targetPosition` từ `handData.midpoint`; cập nhật `targetScale` chỉ khi `handData.handCount === 2` (bỏ qua `handData.targetScale` khi handCount < 2)
  - Implement `applyIntrinsicMotion()`: thêm noise vector bán kính `0.01 * coordinateMapper.computeViewport().width` vào mỗi particle, lerp về basePosition với factor 0.01
  - Implement `updateColors(deltaTime)`: cập nhật `colorPhases`, tính hue bằng circular interpolation `(320 + t * 100) % 360` với `t = (sin(phase)+1)/2`, convert HSL→RGB, ghi vào color buffer; set `needsUpdate = true`
  - Implement `lerpToTarget(targetPosition, factor = 0.1)` và `lerpScale(targetScale, factor = 0.08)`
  - Implement `setParticleCount(count)` với clamp [500, 5000]: dispose geometry cũ, tạo geometry mới; copy basePositions/colorPhases/cycleDurations hiện có (truncate nếu shrink, pad bằng zeros/randoms nếu grow)
  - Implement `reset()`: đặt lại position về center, scale về 1.0
  - Implement `setIntensityMode(enabled)`: lightness 85% khi enabled, 70% khi disabled
  - Expose getters `currentCount`, `currentScale`

  - [x] 5.1 Write property test cho lerp smoothing
    - **Property 6: Lerp Smoothing Correctness**
    - Dùng `fc.tuple(fc.float(), fc.float(), fc.float({min:0.001,max:0.999}))` cho (current, target, factor)
    - Verify lerp(current, target, factor) = current + (target - current) * factor
    - Verify |lerp(c,t,f) - t| < |c - t| (luôn tiến gần target hơn, trừ khi c = t)
    - **Validates: Requirements 5.5, 7.3**

  - [x] 5.2 Write property test cho particle count invariant
    - **Property 7: Particle Count Invariant**
    - Dùng `fc.integer({min:-1000,max:10000})` để generate count ngoài range
    - Verify `setParticleCount(count)` → `currentCount ∈ [500, 5000]`
    - **Validates: Requirements 5.1**

  - [x] 5.3 Write property test cho particle base position near landmark
    - **Property 8: Particle Base Position Near Assigned Landmark**
    - Dùng `fc.array(fc.record({x,y,z}), {minLength:468,maxLength:468})` để generate 468 landmarks
    - Verify mỗi particle i có basePosition trong bán kính `0.02 * viewportWidth` của world(landmarks[i % 468])
    - **Validates: Requirements 5.2**

  - [x] 5.4 Write property test cho cloud position là midpoint
    - **Property 9: Cloud Position Is Midpoint of Two Palm Centers**
    - Dùng `fc.tuple(fc.float(), fc.float(), fc.float())` × 2 để generate p1, p2
    - Verify targetPosition = (p1 + p2) / 2 sau updateFromHands({ handCount: 2, palmCenters: [p1, p2] })
    - **Validates: Requirements 5.3**

  - [x] 5.5 Write property test cho intrinsic motion magnitude
    - **Property 10: Intrinsic Motion Magnitude Bounded**
    - Verify displacement của mỗi particle ≤ `0.01 * viewportWidth` trước lerp-back
    - **Validates: Requirements 5.4**

  - [x] 5.6 Write property test cho particle state preserved khi không có face
    - **Property 11: Particle State Preserved When No Face Detected**
    - Verify basePositions không thay đổi khi `onFaceResults` nhận kết quả rỗng
    - **Validates: Requirements 3.3**

  - [x] 5.7 Write property test cho single hand không thay đổi scale
    - **Property 12: Single Hand Does Not Change Scale**
    - Dùng `fc.float({min:0.3,max:3.0})` để generate currentScale
    - Verify targetScale = currentScale sau updateFromHands({ handCount: 1, ... })
    - **Validates: Requirements 4.4, 7.4**

  - [x] 5.8 Write property test cho color hue spectrum
    - **Property 13: Color Hue Stays in Pink-to-Yellow Spectrum**
    - Dùng `fc.float({min:0,max:6.2832})` để generate phase φ
    - Tính `t = (sin(φ)+1)/2`, `hue = (320 + t * 100) % 360`
    - Verify hue ∈ [0, 60] ∪ [320, 360) — không bao giờ rơi vào vùng xanh lam (100°–300°)
    - Verify với intensityMode bật, lightness = 85%; tắt, lightness = 70%
    - **Validates: Requirements 6.1, 6.2, 6.4**

  - [x] 5.9 Write property test cho color cycle duration
    - **Property 14: Color Cycle Duration Per Particle Is in Valid Range**
    - Verify mỗi particle được khởi tạo có cycleDuration ∈ [2.0, 5.0] giây
    - **Validates: Requirements 6.3**

  - _Requirements: 3.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4_

- [x] 6. Checkpoint — Kiểm tra foundation modules
  - Ensure tất cả unit tests và property tests cho CoordinateMapper, ParticleSystem, StateManager đều pass
  - Ensure SceneRenderer khởi tạo Three.js scene thành công (WebGL 2.0 context)
  - Hỏi user nếu có vấn đề trước khi tiếp tục

- [x] 7. AdaptiveQualityManager — FPS monitoring và auto-adjust
  - Tạo `js/AdaptiveQualityManager.js` với class `AdaptiveQualityManager(particleSystem, stateManager)`
  - Implement `update(currentFPS, deltaTime)`: tích lũy `lowFPSTimer` khi FPS < 45, `highFPSTimer` khi FPS > 55, reset timer khi FPS ra khỏi ngưỡng
  - Khi `lowFPSTimer ≥ 3`: giảm particle count xuống 50% (clamp về 500), reset `lowFPSTimer`
  - Khi `highFPSTimer ≥ 5`: tăng 10% mỗi 2 giây cho đến khi đạt `stateManager.particleCount` (targetCount), reset `highFPSTimer`
  - Lưu `targetCount` riêng để phân biệt với count hiện tại sau khi đã giảm

  - [x] 7.1 Write property test cho adaptive quality
    - **Property 15: Adaptive Quality Reduces Count After Sustained Low FPS**
    - Dùng `fc.array(fc.constant(30), {minLength:180,maxLength:360})` để simulate chuỗi FPS < 45 trong ≥ 3 giây (180 frames ở 60 FPS)
    - Verify particle count giảm 50% sau 3 giây FPS < 45
    - Dùng `fc.array(fc.constant(60), {minLength:300,maxLength:600})` để simulate FPS > 55 trong ≥ 5 giây
    - Verify particle count tăng 10% mỗi 2 giây
    - **Validates: Requirements 10.4, 10.4a**

  - _Requirements: 10.4, 10.4a_

- [x] 8. MediaPipeEngine — FaceMesh + Hands với alternate scheduling
  - Tạo `js/MediaPipeEngine.js` với class `MediaPipeEngine(onFaceResults, onHandResults)`
  - Implement `load()`: tạo `FaceMesh` instance với config `{ maxNumFaces:1, refineLandmarks:true, minDetectionConfidence:0.5, minTrackingConfidence:0.5 }`, tạo `Hands` instance với config `{ maxNumHands:2, modelComplexity:1, minDetectionConfidence:0.5, minTrackingConfidence:0.5 }`
  - Set `onResults` callbacks cho cả hai instances
  - Implement `scheduleDetection(videoElement)`: dùng `requestIdleCallback({ timeout: 16 })`, xen kẽ frame lẻ → `faceMesh.send()`, frame chẵn → `hands.send()`, reschedule sau mỗi lần
  - Implement `setMirrorMode(enabled)` lưu state để truyền vào callbacks
  - Xử lý loading error: nếu script CDN fail, gọi `onError` callback với thông báo tiếng Việt
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 4.1, 4.6, 10.5_

- [x] 9. HUDOverlay — FPS counter, status indicators, neon frame, bounding box
  - Tạo `js/HUDOverlay.js` với class `HUDOverlay(overlayElement)`
  - Implement `update(stats)` nhận `{ fps, faceLandmarkCount, handCount, particleCount, trackingStatus, faceBBox }`
  - Implement `updateFPS(fps)`: cập nhật DOM element góc trên trái, throttle 500ms
  - Implement `updateFaceLandmarkCount(count)`: góc trên phải (0 hoặc 468)
  - Implement `updateHandCount(count)`: góc dưới trái (0, 1, hoặc 2)
  - Implement `updateParticleCount(count)`: góc dưới phải
  - Implement `updateTrackingStatus(status)`: hiển thị "TRACKING" (màu xanh lá `#00FF00`) hoặc "SEARCHING" (màu vàng `#FFFF00`); chuyển sang SEARCHING sau 1 giây không có face
  - Implement `updateFaceBoundingBox(bbox)`: vẽ border neon tím `#FF00FF` quanh vùng khuôn mặt dùng CSS absolute positioning hoặc canvas 2D overlay
  - Implement `startNeonPulse()`: kích hoạt CSS animation pulse cho neon frame cyan `#00FFFF`, border 2px, glow box-shadow 8px
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 10. AppController — orchestration, lifecycle, error handling
  - Tạo `js/AppController.js` với class `AppController`
  - Implement `init()` theo đúng thứ tự: (1) check WebGL 2.0, (2) show loading screen, (3) init SceneRenderer, (4) load MediaPipe scripts, (5) init FaceMesh + Hands, (6) request camera permission, (7) init Camera utility, (8) hide loading screen, (9) start loop
  - Implement `requestCameraPermission()`: `getUserMedia({ video: { width:640, height:480 } })`, xử lý `NotAllowedError` với thông báo tiếng Việt, lắng nghe `MediaStreamTrack.onended` để detect disconnect
  - Implement `onFaceResults(results)`: extract 468 landmarks, gọi `coordinateMapper.mapFaceLandmarks()`, gọi `particleSystem.updateFromFace()`, cập nhật tracking status timer
  - Implement `onHandResults(results)`: extract hand landmarks và handedness, tính palm centers, midpoint, distance, gọi `particleSystem.updateFromHands()`
  - Implement `start()` / `stop()` bật/tắt render loop và MediaPipe scheduling
  - Implement `reset()` gọi `particleSystem.reset()`
  - Implement `handleError(error, context)` hiển thị error overlay với thông báo tiếng Việt theo bảng Error Categories trong design
  - Wire `AdaptiveQualityManager.update(fps, deltaTime)` vào render loop
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.4, 2.5, 3.3, 4.4, 4.5_

- [x] 11. UI Layer — controls và event handlers
  - Thêm HTML controls vào `index.html`: nút Start/Stop, slider particle count [500, 5000] (default 2000), nút Reset, toggle Intensity Mode, toggle Mirror Mode
  - Implement event handlers trong `js/ui.js`:
    - Start/Stop: gọi `appController.start()` / `appController.stop()`, cập nhật `stateManager.isRunning`
    - Slider: cập nhật `stateManager.particleCount`, gọi `particleSystem.setParticleCount()` và `adaptiveQualityManager.targetCount`
    - Reset: gọi `appController.reset()`
    - Intensity Mode toggle: cập nhật `stateManager.intensityMode`, gọi `particleSystem.setIntensityMode()`
    - Mirror Mode toggle: cập nhật `stateManager.mirrorMode`, flip CSS transform (`scaleX(-1)`) trên video element; `AppController` đọc `stateManager.mirrorMode` và truyền vào mỗi lần gọi `coordinateMapper` (ví dụ: `coordinateMapper.mapFaceLandmarks(landmarks, stateManager.mirrorMode)`) — **CoordinateMapper là stateless, mirrorMode được truyền qua tham số, không gọi setter**
  - Khôi phục trạng thái UI từ `stateManager` khi trang load
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 12. Checkpoint — Integration wiring
  - Wire tất cả modules trong `index.html` hoặc `js/main.js`: khởi tạo theo thứ tự, truyền dependencies
  - Verify webcam stream hiển thị (hidden video element), Three.js canvas overlay đúng vị trí
  - Verify loading screen hiển thị trong khi MediaPipe tải, ẩn sau khi sẵn sàng
  - Verify error overlay hiển thị đúng với từng loại lỗi (camera denied, WebGL not supported, HTTPS required)
  - Ensure all tests pass, hỏi user nếu có vấn đề

- [x] 13. Smoke tests và integration tests
  - [x] 13.1 Write smoke test cho WebGL 2.0 detection
    - Test logic `getContext('webgl2')` null → hiển thị error message đúng
    - _Requirements: 12.5_

  - [x] 13.2 Write smoke test cho HTTPS check
    - Mock `location.protocol`, verify error message khi không phải HTTPS/localhost
    - _Requirements: 12.2_

  - [x] 13.3 Write smoke test cho localStorage availability
    - Verify `StateManager` hoạt động khi localStorage available và khi bị block (private mode)
    - _Requirements: 11.6_

  - [x] 13.4 Write integration test cho camera permission flow
    - Mock `getUserMedia` với `NotAllowedError`, verify thông báo lỗi tiếng Việt đúng
    - Mock `getUserMedia` success, verify stream được gán vào video element
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 13.5 Write integration test cho MediaPipe loading
    - Mock CDN script load success/failure, verify loading screen và error handling
    - _Requirements: 2.4, 2.5_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Chạy toàn bộ test suite (unit tests, property tests, smoke tests, integration tests)
  - Verify ứng dụng chạy đúng trong Chrome: webcam stream, face tracking, hand tracking, particle cloud, HUD overlay
  - Verify adaptive quality hoạt động (có thể test bằng cách giả lập FPS thấp)
  - Verify localStorage persistence: reload trang, kiểm tra state được khôi phục
  - Ensure all tests pass, hỏi user nếu có vấn đề

## Notes

- Tasks đánh dấu `*` là optional và có thể bỏ qua để implement MVP nhanh hơn
- Mỗi task tham chiếu requirements cụ thể để đảm bảo traceability
- Checkpoints (task 6, 12, 14) đảm bảo validation từng bước
- Property tests dùng **fast-check** với minimum 100 iterations mỗi property
- Tag format cho PBT: `// Feature: webcam-particle-face-ar, Property N: <property_text>`
- 16 correctness properties được phân bổ gần với implementation tương ứng để phát hiện lỗi sớm
- MediaPipe chạy trên main thread với `requestIdleCallback({ timeout: 16 })` — không dùng Web Worker
- Toàn bộ xử lý client-side, không có network request mang dữ liệu người dùng ra ngoài

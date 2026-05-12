# Design Document: Webcam Particle Face AR

## Overview

Webcam Particle Face AR là một ứng dụng web single-page chạy hoàn toàn client-side trong Chrome. Ứng dụng kết hợp ba công nghệ cốt lõi:

1. **MediaPipe** (qua CDN) — nhận diện 468 điểm khuôn mặt và 21 điểm mỗi bàn tay theo thời gian thực trên WebAssembly
2. **Three.js** (qua CDN) — render đám mây hạt 3D với hiệu ứng neon bằng WebGL 2.0
3. **Web APIs** — `getUserMedia` cho webcam, `requestAnimationFrame` cho vòng lặp render, `requestIdleCallback` cho scheduling MediaPipe

Toàn bộ xử lý diễn ra cục bộ trong trình duyệt; không có backend, không có network request nào mang dữ liệu người dùng ra ngoài.

### Technology Stack

| Thành phần | Thư viện / API | CDN URL |
|---|---|---|
| Face tracking | MediaPipe FaceMesh | `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/face_mesh.js` |
| Hand tracking | MediaPipe Hands | `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js` |
| Camera utils | MediaPipe Camera Utils | `https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3/camera_utils.js` |
| 3D Rendering | Three.js r158 | `https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js` |
| UI | Vanilla HTML/CSS/JS | — |

> Lý do chọn MediaPipe CDN package cũ (0.4): tương thích với DOM context, không cần Web Worker, WASM được tải qua relative URL từ CDN.

---

## Architecture

### High-Level Module Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        index.html                               │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  UI Layer    │  │  HUD Overlay │  │   Canvas (Three.js)   │ │
│  │  (controls)  │  │  (CSS/Canvas)│  │   + Video (hidden)    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬────────────┘ │
│         │                 │                       │             │
│  ┌──────▼───────────────────────────────────────▼────────────┐ │
│  │                    AppController                           │ │
│  │  (orchestrates all modules, manages lifecycle)             │ │
│  └──┬──────────────┬──────────────────────┬──────────────────┘ │
│     │              │                      │                     │
│  ┌──▼──────┐  ┌────▼──────────┐  ┌───────▼──────────────────┐ │
│  │MediaPipe│  │CoordinateMapper│  │    Three.js Renderer     │ │
│  │ Engine  │  │               │  │  ┌────────────────────┐   │ │
│  │┌───────┐│  │ landmark→world│  │  │  ParticleSystem    │   │ │
│  ││ Face  ││  │ coordinate    │  │  │  (BufferGeometry)  │   │ │
│  ││Tracker││  │ transform     │  │  └────────────────────┘   │ │
│  │└───────┘│  └───────────────┘  └──────────────────────────┘ │
│  │┌───────┐│                                                    │
│  ││ Hand  ││                                                    │
│  ││Tracker││                                                    │
│  │└───────┘│                                                    │
│  └─────────┘                                                    │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              StateManager (localStorage)                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Webcam_Stream
     │
     ▼
MediaPipe_Engine (requestIdleCallback, timeout: 16ms)
     │
     ├─── FaceMesh ──► 468 Face Landmarks (normalized [0,1] x,y; [-1,1] z)
     │                        │
     └─── Hands ─────► 0-42 Hand Landmarks (normalized)
                              │
                    CoordinateMapper
                              │
                    World-space positions
                              │
                    ParticleSystem.update()
                              │
                    Three.js Renderer (requestAnimationFrame)
                              │
                    WebGL GPU ──► Canvas display
                              │
                    HUD_Overlay.update() (every 500ms)
```

### Threading Model

Do MediaPipe CDN package cũ không tương thích với Web Worker, toàn bộ xử lý chạy trên main thread:

- **requestAnimationFrame callback**: Three.js render loop (~16.7ms budget)
- **requestIdleCallback({ timeout: 16 })**: MediaPipe detection — chạy khi frame rảnh; do face/hands xen kẽ theo frame và mỗi `send()` tốn ~15–30ms, throughput thực tế là ~15–30 detections/giây mỗi model — đủ cho trải nghiệm real-time mượt mà
- Hai vòng lặp này xen kẽ nhau, không block lẫn nhau

---

## Components and Interfaces

### 1. AppController

Điều phối toàn bộ lifecycle của ứng dụng.

```javascript
class AppController {
  constructor()
  async init()                    // Khởi tạo tất cả module theo thứ tự
  async requestCameraPermission() // getUserMedia với constraints
  start()                         // Bắt đầu vòng lặp render + tracking
  stop()                          // Dừng vòng lặp
  reset()                         // Reset ParticleSystem về mặc định
  handleError(error, context)     // Hiển thị lỗi tiếng Việt
  onFaceResults(results)          // Callback từ FaceMesh
  onHandResults(results)          // Callback từ Hands
}
```

**Thứ tự khởi tạo:**
1. Kiểm tra WebGL 2.0 support
2. Hiển thị loading screen
3. Khởi tạo Three.js Renderer
4. Tải MediaPipe scripts (FaceMesh + Hands)
5. Khởi tạo FaceMesh và Hands instances
6. Yêu cầu quyền camera
7. Khởi tạo Camera utility
8. Ẩn loading screen, hiển thị UI
9. Bắt đầu vòng lặp

### 2. MediaPipe Engine

Wrapper quanh MediaPipe FaceMesh và Hands.

```javascript
class MediaPipeEngine {
  constructor(onFaceResults, onHandResults)
  async load()                    // Tải và khởi tạo cả hai model
  async initFaceMesh()            // FaceMesh với maxNumFaces:1, refineLandmarks:true
  async initHands()               // Hands với maxNumHands:2
  scheduleDetection(videoElement) // requestIdleCallback({ timeout: 16 })
  setMirrorMode(enabled)          // Cập nhật flip state
}
```

**Cấu hình FaceMesh:**
```javascript
{
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
}
```

**Cấu hình Hands:**
```javascript
{
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
}
```

**Detection scheduling:**

FaceMesh và Hands được xen kẽ theo frame (frame lẻ → face, frame chẵn → hands) để tránh vượt quá timeout 16ms. Mỗi lần `send()` với MediaPipe 0.4 tốn ~15–30ms; gọi tuần tự cả hai trong một idle callback sẽ bị browser interrupt giữa chừng.

```javascript
scheduleDetection(videoElement) {
  requestIdleCallback(async () => {
    if (this.frameCount++ % 2 === 0) {
      await this.faceMesh.send({ image: videoElement });
    } else {
      await this.hands.send({ image: videoElement });
    }
    this.scheduleDetection(videoElement); // reschedule
  }, { timeout: 16 });
}
```

### 3. CoordinateMapper

Module thuần túy (pure functions) chuyển đổi tọa độ MediaPipe sang Three.js world space.

```javascript
class CoordinateMapper {
  constructor(camera, renderer)
  
  // Tính viewport dimensions từ camera frustum
  computeViewport()               // → { width, height }
  
  // Ánh xạ một landmark sang world space
  landmarkToWorld(landmark, mirrorMode) // → THREE.Vector3 (mirrorMode là tham số, không phải state)
  
  // Ánh xạ toàn bộ 468 face landmarks
  mapFaceLandmarks(landmarks, mirrorMode) // → Float32Array (x,y,z * 468)
  
  // Tính Palm_Center từ landmarks 0,5,9,13,17
  computePalmCenter(handLandmarks, mirrorMode) // → THREE.Vector3
  
  // Tính Hand_Distance giữa hai Palm_Center
  computeHandDistance(palmCenter1, palmCenter2) // → number (world units)
  
  // Tính midpoint giữa hai Palm_Center
  computeMidpoint(palmCenter1, palmCenter2) // → THREE.Vector3
  
  // Tính bounding box khuôn mặt (cho HUD neon frame)
  computeFaceBoundingBox(landmarks, mirrorMode) // → { x, y, width, height } (screen pixels)
}
```

**Công thức ánh xạ tọa độ (Requirement 13):**

```javascript
computeViewport() {
  const fov = 75; // degrees
  const cameraZ = 100;
  const aspect = this.renderer.domElement.width / this.renderer.domElement.height;
  const viewportHeight = 2 * Math.tan((fov / 2) * Math.PI / 180) * cameraZ;
  const viewportWidth = viewportHeight * aspect;
  return { width: viewportWidth, height: viewportHeight };
}

landmarkToWorld(lm, mirrorMode) {
  const { width, height } = this.computeViewport();
  const worldX = mirrorMode
    ? (0.5 - lm.x) * width
    : (lm.x - 0.5) * width;
  const worldY = (0.5 - lm.y) * height;
  const worldZ = lm.z * DEPTH_SCALE; // DEPTH_SCALE = 50
  return new THREE.Vector3(worldX, worldY, worldZ);
}
```

### 4. ParticleSystem

Quản lý vòng đời và trạng thái của Particle_Cloud.

```javascript
class ParticleSystem {
  constructor(scene, count = 2000)
  
  // Khởi tạo BufferGeometry và Points material
  init()
  
  // Cập nhật vị trí particles từ face landmarks
  updateFromFace(worldPositions)  // Float32Array positions
  
  // Cập nhật vị trí/scale từ hand data
  updateFromHands(handData)       // { midpoint, distance, handCount }
  
  // Áp dụng intrinsic motion (jitter per frame)
  applyIntrinsicMotion()
  
  // Cập nhật màu sắc (color cycling)
  updateColors(deltaTime)
  
  // Lerp vị trí cloud về target
  lerpToTarget(targetPosition, factor = 0.1)
  
  // Lerp scale về target
  lerpScale(targetScale, factor = 0.08)
  
  // Thay đổi số lượng particles (adaptive quality)
  setParticleCount(count)
  
  // Reset về mặc định
  reset()
  
  // Bật/tắt Intensity Mode
  setIntensityMode(enabled)
  
  // Getter
  get currentCount()
  get currentScale()
}
```

**BufferGeometry layout:**
```javascript
// positions: Float32Array(count * 3) — x,y,z per particle
// colors:    Float32Array(count * 3) — r,g,b per particle
// basePositions: Float32Array(count * 3) — face landmark positions (lerp target)
// colorPhases:   Float32Array(count)     — per-particle color animation phase
```

### 5. Three.js Renderer

Wrapper quanh Three.js scene setup và render loop.

```javascript
class SceneRenderer {
  constructor(canvas)
  
  init()                          // Scene, Camera, WebGLRenderer setup
  startRenderLoop()               // requestAnimationFrame loop
  stopRenderLoop()
  render(deltaTime)               // Gọi ParticleSystem.update() + renderer.render()
  onResize()                      // Cập nhật camera aspect + renderer size
  
  // Getters
  get scene()
  get camera()
  get renderer()
}
```

**Camera setup:**
```javascript
const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
camera.position.z = 100;
```

**Renderer setup:**
```javascript
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,  // tắt để tối ưu performance
  alpha: true        // transparent background để thấy video
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0); // transparent
```

### 6. HUD Overlay

Quản lý lớp giao diện AR trên canvas 2D hoặc CSS overlay.

```javascript
class HUDOverlay {
  constructor(overlayElement)
  
  update(stats)                   // Cập nhật tất cả HUD elements
  updateFPS(fps)                  // Góc trên trái, mỗi 500ms
  updateFaceLandmarkCount(count)  // Góc trên phải
  updateHandCount(count)          // Góc dưới trái
  updateParticleCount(count)      // Góc dưới phải
  updateTrackingStatus(status)    // "TRACKING" | "SEARCHING"
  updateFaceBoundingBox(bbox)     // Neon tím quanh khuôn mặt
  
  // Neon frame animation (CSS animation)
  startNeonPulse()
}
```

**HUD layout (CSS absolute positioning):**
```
┌─[FPS: 60]──────────────[Landmarks: 468]─┐
│  ◉ TRACKING                              │  ← neon cyan frame
│                                          │
│         [Three.js canvas]                │
│                                          │
└─[Hands: 2]──────────[Particles: 2000]───┘
```

### 7. StateManager

Quản lý trạng thái người dùng với localStorage persistence.

```javascript
class StateManager {
  constructor()
  
  load()                          // Đọc từ localStorage
  save()                          // Ghi vào localStorage
  
  // State properties
  get particleCount()             // default: 2000
  get intensityMode()             // default: false
  get mirrorMode()                // default: false
  get isRunning()                 // default: true
  
  set particleCount(v)
  set intensityMode(v)
  set mirrorMode(v)
  set isRunning(v)
}
```

**localStorage key:** `webcam-particle-ar-state`

### 8. AdaptiveQualityManager

Theo dõi FPS và tự động điều chỉnh số lượng particles.

```javascript
class AdaptiveQualityManager {
  constructor(particleSystem, stateManager)
  
  update(currentFPS, deltaTime)   // Gọi mỗi frame — cần deltaTime (giây) để tích lũy timer chính xác
  
  // Internal state
  // lowFPSTimer: số giây FPS < 45
  // highFPSTimer: số giây FPS > 55
  // restoreTimer: số giây kể từ lần tăng particle gần nhất
  // targetCount: số particles người dùng đặt
}
```

**Logic (Requirement 10.4 + 10.4a):**
- FPS < 45 trong 3 giây liên tiếp → giảm 50% particle count
- FPS > 55 trong 5 giây liên tiếp → tăng 10% mỗi 2 giây cho đến khi đạt `targetCount`

---

## Data Models

### Landmark (MediaPipe output)

```typescript
interface Landmark {
  x: number;  // [0, 1] — normalized, 0 = left edge
  y: number;  // [0, 1] — normalized, 0 = top edge
  z: number;  // [-1, 1] — relative depth (face) or wrist-relative (hand)
}
```

### HandData (processed)

```typescript
interface HandData {
  handCount: number;            // 0, 1, or 2
  palmCenters: THREE.Vector3[]; // world-space palm centers
  midpoint: THREE.Vector3;      // = avg(palmCenters) nếu 2 tay
                                // = palmCenters[0] nếu 1 tay
                                // = Vector3(0,0,0) nếu 0 tay
  handDistance: number;         // Euclidean distance in world units (0 nếu < 2 tay)
  normalizedDistance: number;   // handDistance / viewportWidth — dùng để map sang scale
  targetScale: number;          // mapped từ normalizedDistance sang [0.3, 3.0]
                                // IGNORED khi handCount < 2 — ParticleSystem giữ nguyên currentScale
}
```

### ParticleState

```typescript
interface ParticleState {
  positions: Float32Array;    // count * 3 — current world positions
  basePositions: Float32Array; // count * 3 — face landmark target positions
  colors: Float32Array;       // count * 3 — RGB values
  colorPhases: Float32Array;  // count — animation phase [0, 2π]
  cloudPosition: THREE.Vector3; // current cloud center (lerped)
  cloudScale: number;         // current scale (lerped)
  targetPosition: THREE.Vector3;
  targetScale: number;
}
```

### AppState

```typescript
interface AppState {
  particleCount: number;      // [500, 5000], default 2000
  intensityMode: boolean;     // default false
  mirrorMode: boolean;        // default false
  isRunning: boolean;         // default true
}
```

### FPSTracker

```typescript
interface FPSTracker {
  currentFPS: number;
  frameCount: number;
  lastTime: number;           // performance.now()
  lowFPSTimer: number;        // seconds below 45 FPS
  highFPSTimer: number;       // seconds above 55 FPS
}
```

---

## Algorithms

### A. Particle Position Initialization

Khi Face_Tracker cung cấp 468 landmarks, các particles được phân bổ như sau:

```
1. Chia 2000 particles cho 468 landmarks → ~4-5 particles per landmark
2. Với mỗi particle i:
   a. landmarkIndex = i % 468
   b. basePos = landmarkToWorld(landmarks[landmarkIndex])
   c. jitterRadius = 0.02 * viewportWidth
      // Convert từ normalized: 0.02 normalized ≈ 3.6 world units với viewport mặc định
      // (viewportWidth ≈ 178 world units với FOV=75°, cameraZ=100, aspect 16:9)
   d. jitter = random vector trong sphere bán kính jitterRadius
   e. particle.basePosition = basePos + jitter
3. Particle positions được lerp về basePositions mỗi frame
```

### B. Scale Mapping (Hand Distance → Cloud Scale)

`computeHandDistance()` trả về khoảng cách Euclidean trong world units. Trước khi map sang scale, cần normalize lại bằng `viewportWidth` để đưa về cùng đơn vị với Req 7.5.

```
// handDistance: Euclidean distance trong world units
// viewportWidth: ~178 world units (FOV=75°, cameraZ=100, aspect 16:9)

normalizedDist = handDistance / viewportWidth
// Ví dụ: hai tay cách nhau 0.3 normalized ≈ 53 world units

targetScale = lerp(0.3, 3.0, (normalizedDist - 0.05) / (0.8 - 0.05))
targetScale = clamp(targetScale, 0.3, 3.0)

// Smooth application:
currentScale = lerp(currentScale, targetScale, 0.08)
```

### C. Color Animation

Mỗi particle có một `colorPhase` riêng, dao động theo thời gian. Dải màu mục tiêu là **hồng → đỏ → cam → vàng**, đi theo chiều ngắn của vòng tròn màu (320° → 360°/0° → 60°). Linear lerp từ 320 → 60 sẽ đi qua 200° (xanh lam) — **sai**. Phải dùng circular hue interpolation:

```
// Khởi tạo: colorPhase[i] = random(0, 2π)
// Mỗi frame:
colorPhase[i] += deltaTime * (2π / cycleDuration)
  where cycleDuration = random(2, 5) seconds per particle

// Tính màu — circular hue interpolation (đi qua 0°/360°):
t = (sin(colorPhase[i]) + 1) / 2   // t ∈ [0, 1]

// Circular lerp từ 320° → 60° theo chiều ngắn (qua 0°):
// Khoảng cách ngắn: 360 - 320 + 60 = 100°
hue = (320 + t * 100) % 360
  // t=0 → 320° (hồng), t=0.6 → 0°/360° (đỏ), t=1 → 60° (vàng)

saturation = 100%
lightness = intensityMode ? 85% : 70%

color = hslToRgb(hue, saturation, lightness)
```

> Lưu ý: `(320 + t * 100) % 360` cho hue đi theo chiều: 320° (hồng) → 360°/0° (đỏ) → 60° (vàng), tạo gradient hồng → đỏ → cam → vàng đúng như thiết kế.

### D. Intrinsic Motion

Noise amplitude được giữ đủ lớn để visible sau lerp-back. Lerp-back factor nhỏ (0.01) để noise không bị triệt tiêu ngay trong 1–2 frame.

```
// Mỗi frame, mỗi particle:
noiseRadius = 0.01 * viewportWidth  // ~1.8 world units với viewport mặc định
noise = random vector trong sphere bán kính noiseRadius
particle.position += noise

// Lerp về base position với factor nhỏ để giữ hiệu ứng sống động:
// factor = 0.01 (thay vì 0.05) để noise tồn tại ~100 frame trước khi tắt dần
particle.position = lerp(particle.position, particle.basePosition, 0.01)
```

> Lưu ý: hai lerp cạnh tranh nhau — cloud movement lerp (factor 0.1 từ Req 5.5) và lerp-back về base (factor 0.01). Khi cloud đứng yên, noise biên độ ~1.8 world units với lerp-back 0.01 tạo dao động visible trong ~100 frame (~1.7 giây ở 60 FPS).

### E. Face Bounding Box (HUD)

```
// Từ 468 landmarks (normalized coords):
minX = min(landmark.x for all landmarks)
maxX = max(landmark.x for all landmarks)
minY = min(landmark.y for all landmarks)
maxY = max(landmark.y for all landmarks)

// Padding 5%:
padX = (maxX - minX) * 0.05
padY = (maxY - minY) * 0.05

// Convert to screen pixels:
screenX = (minX - padX) * canvasWidth
screenY = (minY - padY) * canvasHeight
screenW = (maxX - minX + 2*padX) * canvasWidth
screenH = (maxY - minY + 2*padY) * canvasHeight
```

---

## Error Handling

### Error Categories và Responses

| Error | Trigger | Response (tiếng Việt) |
|---|---|---|
| Camera denied | `getUserMedia` rejected | "Bạn đã từ chối quyền truy cập camera. Vào Settings > Privacy > Camera để cấp quyền lại." |
| Camera disconnected | `MediaStreamTrack.onended` | "Camera bị ngắt kết nối. Vui lòng kiểm tra lại thiết bị." |
| MediaPipe load failed | Script `onerror` | "Không thể tải MediaPipe. Vui lòng kiểm tra kết nối mạng và tải lại trang." |
| WebGL 2.0 not supported | `getContext('webgl2')` null | "Trình duyệt của bạn không hỗ trợ WebGL 2.0. Vui lòng cập nhật Chrome lên phiên bản 90 trở lên." |
| HTTPS required | `location.protocol !== 'https:'` và không phải localhost | "Ứng dụng yêu cầu kết nối HTTPS để truy cập camera." |

### Error Display Component

```javascript
function showError(message, recoverable = false) {
  const overlay = document.getElementById('error-overlay');
  overlay.querySelector('.error-message').textContent = message;
  overlay.querySelector('.retry-btn').style.display = recoverable ? 'block' : 'none';
  overlay.style.display = 'flex';
  // Dừng render loop nếu lỗi nghiêm trọng
  if (!recoverable) appController.stop();
}
```

### Graceful Degradation

- **Không phát hiện khuôn mặt**: Giữ nguyên particle positions từ frame trước (Req 3.3)
- **Không phát hiện tay**: Hiển thị cloud ở center (Req 4.5)
- **Một tay**: Di chuyển cloud đến palm center, giữ scale (Req 4.4, 5.3a)
- **FPS thấp**: AdaptiveQualityManager giảm particle count (Req 10.4)

---

## Testing Strategy

### PBT Applicability Assessment

Feature này bao gồm cả pure functions (coordinate mapping, scale calculation, color animation) lẫn UI/rendering. PBT áp dụng cho các pure functions; UI rendering và MediaPipe integration sử dụng example-based tests.

### Unit Tests (Example-Based)

1. **CoordinateMapper** — test với các landmark cụ thể (corners, center, edge cases)
2. **Scale mapping** — test với hand distances tại boundary values (0.05, 0.8, out-of-range)
3. **Palm center calculation** — test với known landmark positions
4. **Color animation** — test HSL → RGB conversion
5. **AdaptiveQualityManager** — test state transitions với mock FPS values
6. **StateManager** — test localStorage read/write

### Property-Based Tests

Xem phần **Correctness Properties** bên dưới.

**PBT Library:** [fast-check](https://github.com/dubzzz/fast-check) (JavaScript)

**Configuration:** Minimum 100 iterations per property test.

**Tag format:** `// Feature: webcam-particle-face-ar, Property N: <property_text>`

### Integration Tests

1. **MediaPipe loading** — verify scripts load from CDN (1-2 examples)
2. **Camera permission flow** — mock `getUserMedia`, verify error messages
3. **WebGL context creation** — verify Three.js renderer initializes

### Smoke Tests

1. **WebGL 2.0 check** — single test verifying detection logic
2. **HTTPS check** — single test verifying protocol detection
3. **localStorage availability** — single test verifying StateManager can persist


---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Feature này có nhiều pure functions (coordinate mapping, scale calculation, lerp smoothing, color animation, palm center calculation) phù hợp với property-based testing. PBT library được chọn: **[fast-check](https://github.com/dubzzz/fast-check)** cho JavaScript.

---

### Property 1: Coordinate Mapping Formula Correctness (Normal Mode)

*For any* landmark with coordinates (x ∈ [0,1], y ∈ [0,1], z ∈ [-1,1]) và viewport dimensions (width, height) tính từ camera frustum (FOV=75°, cameraZ=100, bất kỳ aspect ratio nào), khi Mirror Mode tắt, hàm `landmarkToWorld` phải trả về:
- `worldX = (landmarkX - 0.5) * viewportWidth`
- `worldY = (0.5 - landmarkY) * viewportHeight`
- `worldZ = landmarkZ * 50` (depthScale mặc định)

Và `viewportHeight = 2 * tan(37.5° * π/180) * 100`, `viewportWidth = viewportHeight * aspectRatio`.

**Validates: Requirements 13.1, 13.2, 13.3, 13.6**

---

### Property 2: Coordinate Mapping Formula Correctness (Mirror Mode)

*For any* landmark với tọa độ x ∈ [0,1] và viewport width bất kỳ, khi Mirror Mode bật, hàm `landmarkToWorld` phải trả về `worldX = (0.5 - landmarkX) * viewportWidth`. Trục y và z không bị ảnh hưởng bởi Mirror Mode.

Hệ quả: với cùng một landmark, `worldX_mirrored = -worldX_normal` (đối xứng qua trục y).

**Validates: Requirements 13.4, 13.5, 11.5**

---

### Property 3: Palm Center Is Average of Five Landmarks

*For any* tập hợp 21 hand landmarks với tọa độ bất kỳ, `computePalmCenter` phải trả về đúng trung bình cộng của tọa độ world-space của các landmarks tại index 0, 5, 9, 13, 17.

Cụ thể: `palmCenter = (world(lm[0]) + world(lm[5]) + world(lm[9]) + world(lm[13]) + world(lm[17])) / 5`

**Validates: Requirements 4.2**

---

### Property 4: Hand Distance Is Euclidean Distance

*For any* hai Palm_Center p1 và p2 trong Three.js world space, `computeHandDistance(p1, p2)` phải trả về đúng khoảng cách Euclidean: `sqrt((p2.x-p1.x)² + (p2.y-p1.y)² + (p2.z-p1.z)²)`.

Hệ quả: distance(p1, p2) = distance(p2, p1) (tính chất đối xứng).

**Validates: Requirements 4.3**

---

### Property 5: Hand Distance to Scale Mapping Is Monotonic and Bounded

`computeHandDistance` trả về world units; trước khi map phải normalize: `normalizedDist = handDistance / viewportWidth`.

*For any* hai normalized distances d1 và d2 trong khoảng [0.0, 1.0], nếu d1 ≤ d2 thì `mapDistanceToScale(d1) ≤ mapDistanceToScale(d2)` (monotonically non-decreasing). Ngoài ra, với mọi distance d bất kỳ (kể cả ngoài range), `mapDistanceToScale(d) ∈ [0.3, 3.0]` (bounded by clamp).

**Validates: Requirements 7.1, 7.2, 7.5**

---

### Property 6: Lerp Smoothing Correctness

*For any* giá trị hiện tại `current` và giá trị đích `target` (số thực hoặc Vector3), và hệ số lerp `factor ∈ (0, 1)`:
- `lerp(current, target, factor) = current + (target - current) * factor`
- Áp dụng cho vị trí cloud (factor = 0.1) và scale (factor = 0.08)
- Hệ quả: `|lerp(current, target, factor) - target| < |current - target|` (luôn tiến gần target hơn)

**Validates: Requirements 5.5, 7.3**

---

### Property 7: Particle Count Invariant

*For any* giá trị count được set (bao gồm cả giá trị ngoài range), `ParticleSystem.setParticleCount(count)` phải đảm bảo `currentCount ∈ [500, 5000]`. Giá trị được clamp về boundary gần nhất.

**Validates: Requirements 5.1**

---

### Property 8: Particle Base Position Near Assigned Landmark

*For any* tập hợp 468 face landmarks với tọa độ bất kỳ trong normalized space, sau khi `updateFromFace(landmarks)`, mỗi particle i phải có `basePosition` trong bán kính jitter của landmark được gán (`i % 468`):

`|particle[i].basePosition - world(landmarks[i % 468])| ≤ jitterRadius`

trong đó `jitterRadius = 0.02 * viewportWidth`.

**Validates: Requirements 5.2**

---

### Property 9: Cloud Position Is Midpoint of Two Palm Centers

*For any* hai Palm_Center p1 và p2 trong world space, sau khi `updateFromHands({ handCount: 2, palmCenters: [p1, p2] })`, `targetPosition` của cloud phải bằng `(p1 + p2) / 2`.

**Validates: Requirements 5.3**

---

### Property 10: Intrinsic Motion Magnitude Bounded

*For any* particle position và một frame của intrinsic motion, displacement của mỗi particle phải thỏa mãn `|displacement| ≤ 0.01 * viewportWidth` (trước khi lerp về base position). Lerp-back factor là 0.01 (không phải 0.05) để noise tồn tại đủ lâu để visible.

**Validates: Requirements 5.4**

---

### Property 11: Particle State Preserved When No Face Detected

*For any* trạng thái particle positions hiện tại, khi `onFaceResults` nhận được kết quả rỗng (không phát hiện khuôn mặt), `basePositions` của particles phải không thay đổi so với frame trước.

**Validates: Requirements 3.3**

---

### Property 12: Single Hand Does Not Change Scale

*For any* giá trị scale hiện tại `currentScale`, khi `updateFromHands({ handCount: 1, ... })` được gọi, `targetScale` phải bằng `currentScale` (không thay đổi).

**Validates: Requirements 4.4, 7.4**

---

### Property 13: Color Hue Stays in Pink-to-Yellow Spectrum

*For any* color phase `φ ∈ [0, 2π]`, hàm tính màu phải dùng circular hue interpolation: `hue = (320 + t * 100) % 360` với `t = (sin(φ) + 1) / 2`. Kết quả hue phải nằm trong `[0, 60] ∪ [320, 360)` — tức là chỉ đi qua vùng hồng, đỏ, cam, vàng, **không bao giờ** rơi vào vùng xanh lam (100°–300°).

Ngoài ra, với Intensity Mode bật, lightness phải là 85%; khi tắt, lightness là 70%.

**Validates: Requirements 6.1, 6.2, 6.4**

---

### Property 14: Color Cycle Duration Per Particle Is in Valid Range

*For any* particle được khởi tạo, `cycleDuration` của particle đó phải nằm trong khoảng `[2.0, 5.0]` giây.

**Validates: Requirements 6.3**

---

### Property 15: Adaptive Quality Reduces Count After Sustained Low FPS

*For any* chuỗi FPS values liên tiếp đều dưới 45 trong ít nhất 3 giây, `AdaptiveQualityManager` phải giảm particle count xuống 50% của giá trị hiện tại (clamped về minimum 500).

Ngược lại, *for any* chuỗi FPS values liên tiếp đều trên 55 trong ít nhất 5 giây, particle count phải tăng 10% mỗi 2 giây cho đến khi đạt `targetCount`.

**Validates: Requirements 10.4, 10.4a**

---

### Property 16: AppState Round-Trip Through localStorage

*For any* `AppState` object với các giá trị hợp lệ (particleCount ∈ [500,5000], intensityMode ∈ {true,false}, mirrorMode ∈ {true,false}, isRunning ∈ {true,false}), sau khi `StateManager.save()` rồi `StateManager.load()`, state phải bằng state ban đầu.

**Validates: Requirements 11.6**


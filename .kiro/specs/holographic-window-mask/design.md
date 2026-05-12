# Design Document: Holographic Window Mask

## Overview

Holographic Window Mask là một pivot kiến trúc render cho ứng dụng Webcam Particle Face AR. Thay vì hiển thị particle cloud toàn màn hình phủ lên khuôn mặt, các hạt sẽ chỉ hiển thị bên trong một "cửa sổ kính holographic" được định nghĩa bởi hai bàn tay của người dùng.

Hai thay đổi cốt lõi:

1. **`ParticleSystem.js`** — Thêm screen-space shader masking (Fragment Shader `discard` ngoài hand box NDC) và nâng cấp `_handPlane` từ invisible thành sci-fi blue glass (`color: 0x0088ff, opacity: 0.2`). Thêm method `updateHandBox(box)` thay thế cặp `updateInsideHandBox(box)` + `setVisible()`.

2. **`AppController.js`** — Cập nhật `onHandResults()` để gọi `particleSystem.updateHandBox(box)` thay vì `updateInsideHandBox(box)` + `setVisible()`. Hai data stream (face + hand) vẫn hoàn toàn độc lập.

`CoordinateMapper.js` không thay đổi.

---

## Architecture

### Module Interaction (sau thay đổi)

```
MediaPipe_Engine
     │
     ├─── FaceMesh ──► onFaceResults() ──► particleSystem.updateFromFace(worldPositions)
     │                                     (luôn chạy, bất kể hand state)
     │
     └─── Hands ─────► onHandResults()
                            │
                            ├─ 2 hands ──► _computeHandBox([lm4,lm8,lm4,lm8], mirror)
                            │                    │
                            │              particleSystem.updateHandBox(box)
                            │                    │
                            │              ┌─────┴──────────────────────────┐
                            │              │  updateHandBox(box)            │
                            │              │  ├─ compute NDC from box       │
                            │              │  ├─ set u_boxMin, u_boxMax     │
                            │              │  ├─ set u_resolution           │
                            │              │  ├─ _updateHandRegionMesh(box) │
                            │              │  └─ _points.visible = true     │
                            │              └────────────────────────────────┘
                            │
                            └─ ≠ 2 hands ► particleSystem.updateHandBox(null)
                                                │
                                           ┌────┴──────────────────────────────┐
                                           │  updateHandBox(null)              │
                                           │  ├─ u_boxMin = u_boxMax = (0,0)  │
                                           │  ├─ _hideHandRegionMesh()        │
                                           │  └─ _points.visible = false      │
                                           └───────────────────────────────────┘
```

### Data Flow: Screen Pixels → NDC → Shader Discard

```
Hand landmarks (normalized [0,1])
     │
     ▼
_computeHandBox([lm4, lm8, lm4, lm8], mirrorMode)
     │  sx = mirrorMode ? (1-p.x)*W : p.x*W
     │  sy = p.y * H
     │  left = min(sx) - 24,  right = max(sx) + 24
     │  top  = min(sy) - 24,  bottom = max(sy) + 24
     ▼
Hand_Box_Screen { left, top, right, bottom }
     │
     ▼
updateHandBox(box) in ParticleSystem
     │  u_boxMin.x = clamp(left  / viewportWidth,  0, 1)
     │  u_boxMin.y = clamp(top   / viewportHeight, 0, 1)
     │  u_boxMax.x = clamp(right / viewportWidth,  0, 1)
     │  u_boxMax.y = clamp(bottom/ viewportHeight, 0, 1)
     ▼
Shader uniforms: u_boxMin, u_boxMax, u_resolution
     │
     ▼
Fragment Shader (per fragment, O(1))
     │  ndc = gl_FragCoord.xy / u_resolution
     │  if outside [u_boxMin, u_boxMax]: discard
     ▼
Visible pixels = only particles inside hand window
```

---

## Modified Components

### ParticleSystem.js — Changes

#### 1. Glass Plane Material (`_initHandRegionMesh`)

**Before:**
```javascript
const planeMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
});
```

**After:**
```javascript
const planeMat = new THREE.MeshBasicMaterial({
    color: 0x0088ff,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
});
```

Rationale: `opacity: 0.0` made the plane completely invisible. The new value `0.2` gives a subtle sci-fi blue glass tint while still showing the particle cloud and video feed behind it. `depthWrite: false` ensures the plane does not occlude particles. `z = -1` keeps it behind the particle cloud.

#### 2. New Shader Uniforms

Three new uniforms added to `ShaderMaterial`:

| Uniform | Type | Purpose |
|---|---|---|
| `u_boxMin` | `THREE.Vector2` | NDC bottom-left corner of hand window `(minX, minY)` in `[0,1]` |
| `u_boxMax` | `THREE.Vector2` | NDC top-right corner of hand window `(maxX, maxY)` in `[0,1]` |
| `u_resolution` | `THREE.Vector2` | Viewport size in pixels `(width, height)` |

Initialized to zero vectors; `u_resolution` is set on `init()` and updated on resize.

#### 3. New Method: `updateHandBox(box)`

Replaces the `updateInsideHandBox(box)` + `setVisible()` pattern. This is the single entry point for hand state changes.

```javascript
/**
 * Update shader mask uniforms and hand region mesh from a screen-space box.
 * Called by AppController.onHandResults() every frame.
 *
 * @param {{ left, top, right, bottom } | null} box
 *   Screen-pixel bounding box, or null when fewer than 2 hands are detected.
 */
updateHandBox(box) {
    if (box === null) {
        // No hands — zero out the mask (discards all particles) and hide mesh
        this._uBoxMin.value.set(0, 0);
        this._uBoxMax.value.set(0, 0);
        this._points.visible = false;
        this._hideHandRegionMesh();
        return;
    }

    const W = window.innerWidth;
    const H = window.innerHeight;

    // Convert screen pixels → NDC [0,1], clamped
    const minX = Math.max(0, Math.min(1, box.left   / W));
    const minY = Math.max(0, Math.min(1, box.top    / H));
    const maxX = Math.max(0, Math.min(1, box.right  / W));
    const maxY = Math.max(0, Math.min(1, box.bottom / H));

    this._uBoxMin.value.set(minX, minY);
    this._uBoxMax.value.set(maxX, maxY);

    // Update mesh (glass plane + corner brackets)
    this._updateHandRegionMesh(box);

    // Show particles — shader mask decides which ones are visible
    this._points.visible = true;
}
```

#### 4. Resize Handler

`u_resolution` must stay in sync with the viewport. `ParticleSystem` exposes an `onResize()` method that `AppController` calls from the existing `SceneRenderer` resize callback:

```javascript
onResize() {
    this._uResolution.value.set(window.innerWidth, window.innerHeight);
}
```

`AppController.init()` already calls `this._sceneRenderer.setResizeCallback(...)` — this callback is extended to also call `this._particleSystem.onResize()`.

#### 5. What Does NOT Change in ParticleSystem

- `updateFromFace(worldPositions)` — face landmark positioning logic is untouched
- `updateColors(deltaTime)` — color animation unchanged
- `tick(deltaTime)` — GPU time uniform unchanged
- `setParticleCount()`, `setIntensityMode()` — configuration unchanged
- `_screenToWorld()` — unprojection helper unchanged
- `_setCorner()` — L-shape corner bracket geometry unchanged
- `_cornerLines` material color (`0x00FFFF`) and `z = 1` position unchanged
- Adaptive quality hooks unchanged

### AppController.js — Changes

#### `onHandResults()` — Before vs After

**Before:**
```javascript
if (handCount !== 2) {
    this._handsVisible = false;
    this._particleSystem.setVisible(false);
    return;
}
// ...
this._particleSystem.updateInsideHandBox(box);
this._particleSystem.setVisible(true);
this._handsVisible = true;
```

**After:**
```javascript
if (handCount !== 2) {
    this._handsVisible = false;
    this._particleSystem.updateHandBox(null);
    return;
}
// ...
this._particleSystem.updateHandBox(box);
this._handsVisible = true;
```

The `setVisible()` calls are removed — `updateHandBox()` manages `_points.visible` internally.

#### `onFaceResults()` — Unchanged

```javascript
onFaceResults(results, mirrorMode) {
    // ... (no changes)
    this._particleSystem.updateFromFace(worldPositions);
}
```

Face results always call `updateFromFace()` regardless of hand state. This ensures particle base positions are always current, so when the user raises their hands, the hologram appears at the correct face position immediately.

#### Resize Callback Extension

In `init()`, the existing resize callback is extended:

```javascript
this._sceneRenderer.setResizeCallback(() => {
    if (this._particleSystem) {
        this._particleSystem.onResize();
    }
});
```

---

## Shader Changes

### Updated Fragment Shader (PARTICLE_FRAGMENT_SHADER)

```glsl
// New uniforms for screen-space masking
uniform vec2 u_boxMin;      // NDC bottom-left of hand window [0,1]
uniform vec2 u_boxMax;      // NDC top-right of hand window [0,1]
uniform vec2 u_resolution;  // Viewport size in pixels

varying vec3  v_color;
varying float v_alpha;

void main() {
    // ── Screen-space mask ────────────────────────────────────────────────────
    // Compute this fragment's NDC position from gl_FragCoord
    // gl_FragCoord.xy is in window pixels (origin = bottom-left in WebGL)
    vec2 ndc = gl_FragCoord.xy / u_resolution;

    // Discard if outside the hand window bounding box
    if (ndc.x < u_boxMin.x || ndc.x > u_boxMax.x ||
        ndc.y < u_boxMin.y || ndc.y > u_boxMax.y) {
        discard;
    }
    // ── End mask ─────────────────────────────────────────────────────────────

    // Soft circular dot — discard corners, smooth glow falloff
    vec2  uv   = gl_PointCoord - vec2(0.5);
    float dist = length(uv);

    if (dist > 0.5) discard;

    // Smooth alpha: bright core, soft halo
    float alpha = 1.0 - smoothstep(0.15, 0.5, dist);
    // Extra glow ring
    float glow  = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 2.5);

    vec3 finalColor = v_color + v_color * glow * 0.6;
    gl_FragColor = vec4(finalColor, alpha * v_alpha);
}
```

**Key design decisions:**

- `gl_FragCoord.xy / u_resolution` — WebGL's `gl_FragCoord` has origin at bottom-left, same as NDC `[0,1]` space used for the box. No axis flip needed.
- The mask check runs **before** the circular dot check — early discard avoids unnecessary computation for out-of-window fragments.
- When `u_boxMin == u_boxMax == vec2(0,0)` (no hands), every fragment satisfies `ndc.x < 0` or `ndc.y < 0` (since NDC is always ≥ 0), so all particles are discarded. This is the "no hands" state.
- O(1) per fragment: exactly 4 float comparisons + conditional discard.

### Vertex Shader — Unchanged

`PARTICLE_VERTEX_SHADER` is not modified. The masking is entirely in the fragment stage.

---

## Data Models

### Hand_Box_Screen

```typescript
interface HandBoxScreen {
    left:    number;  // pixels from left edge of viewport
    top:     number;  // pixels from top edge of viewport
    right:   number;  // pixels from left edge of viewport
    bottom:  number;  // pixels from top edge of viewport
    width:   number;  // right - left
    height:  number;  // bottom - top
    centerX: number;  // (left + right) / 2
    centerY: number;  // (top + bottom) / 2
}
```

### Hand_Box_NDC

```typescript
interface HandBoxNDC {
    minX: number;  // left / viewportWidth,  clamped [0,1]
    minY: number;  // top  / viewportHeight, clamped [0,1]
    maxX: number;  // right / viewportWidth, clamped [0,1]
    maxY: number;  // bottom / viewportHeight, clamped [0,1]
}
```

### New Shader Uniforms (additions to existing uniforms object)

```javascript
uniforms: {
    // Existing
    u_time:          { value: 0.0 },
    u_pointSize:     { value: 3.5 },
    u_intensityMode: { value: 0.0 },
    // New
    u_boxMin:        { value: new THREE.Vector2(0, 0) },
    u_boxMax:        { value: new THREE.Vector2(0, 0) },
    u_resolution:    { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
}
```

---

## Algorithms

### A. Hand Box Computation (`_computeHandBox` — unchanged logic)

```
Input: tipPoints = [hand0[4], hand0[8], hand1[4], hand1[8]], mirrorMode
       W = window.innerWidth, H = window.innerHeight, PADDING = 24

For each point p in tipPoints:
    sx = mirrorMode ? (1 - p.x) * W : p.x * W
    sy = p.y * H

minX = min(sx), maxX = max(sx)
minY = min(sy), maxY = max(sy)

Output:
    left   = minX - PADDING
    top    = minY - PADDING
    right  = maxX + PADDING
    bottom = maxY + PADDING
```

The tight bounding box (before padding) contains all 4 finger tips by construction: `minX ≤ sx_i ≤ maxX` and `minY ≤ sy_i ≤ maxY` for all i.

### B. NDC Conversion (`updateHandBox`)

```
Input: box = { left, top, right, bottom }, W = window.innerWidth, H = window.innerHeight

u_boxMin.x = clamp(box.left   / W, 0.0, 1.0)
u_boxMin.y = clamp(box.top    / H, 0.0, 1.0)
u_boxMax.x = clamp(box.right  / W, 0.0, 1.0)
u_boxMax.y = clamp(box.bottom / H, 0.0, 1.0)
```

Note: `gl_FragCoord` in WebGL has origin at bottom-left. `window.innerHeight - box.top` would be needed if the CSS coordinate system (origin top-left) were used directly. However, since `_computeHandBox` uses `p.y * H` (MediaPipe y=0 is top, y=1 is bottom), and `gl_FragCoord.y` has y=0 at bottom, the y-axis is **inverted** between the two systems.

**Y-axis correction:** The NDC y values must be flipped:

```
u_boxMin.y = clamp((H - box.bottom) / H, 0.0, 1.0)   // CSS bottom → WebGL bottom
u_boxMax.y = clamp((H - box.top)    / H, 0.0, 1.0)   // CSS top    → WebGL top
```

This ensures that a box at the top of the screen (small CSS y) maps to a large WebGL y (near 1.0), matching `gl_FragCoord.y` which is 0 at the bottom.

### C. Glass Plane Sizing (`_updateHandRegionMesh` — unchanged logic)

```
tl = _screenToWorld(box.left,  box.top)
tr = _screenToWorld(box.right, box.top)
bl = _screenToWorld(box.left,  box.bottom)
c  = _screenToWorld(box.centerX, box.centerY)

wWorld = |tr.x - tl.x|
hWorld = |tl.y - bl.y|

_handPlane.scale.set(wWorld, hWorld, 1)
_handPlane.position.set(c.x, c.y, -1)
```

### D. Corner Bracket Arm Length

```
cs = min(wWorld, hWorld) * 0.15

Corner 0 (top-left):     origin=(tl.x, tl.y), dx=+cs (right), dy=-cs (down)
Corner 1 (top-right):    origin=(tr.x, tr.y), dx=-cs (left),  dy=-cs (down)
Corner 2 (bottom-left):  origin=(bl.x, bl.y), dx=+cs (right), dy=+cs (up)
Corner 3 (bottom-right): origin=(br.x, br.y), dx=-cs (left),  dy=+cs (up)
```

Each L-shape is two line segments sharing the corner origin point.

### E. Shader Mask Logic (pure function equivalent)

```javascript
// Equivalent JS for testing — mirrors the GLSL logic exactly
function isDiscarded(fragX, fragY, resW, resH, boxMinX, boxMinY, boxMaxX, boxMaxY) {
    const ndcX = fragX / resW;
    const ndcY = fragY / resH;
    return ndcX < boxMinX || ndcX > boxMaxX || ndcY < boxMinY || ndcY > boxMaxY;
}
```

---

## Interface Changes

### ParticleSystem — New / Changed Methods

| Method | Change | Signature |
|---|---|---|
| `updateHandBox(box)` | **New** | `updateHandBox(box: HandBoxScreen \| null): void` |
| `onResize()` | **New** | `onResize(): void` |
| `updateInsideHandBox(box)` | **Kept** (internal use only, called by `updateHandBox`) | unchanged |
| `setVisible(visible)` | **Kept** (still used by `reset()`) | unchanged |

### AppController — Changed Call Sites

| Location | Before | After |
|---|---|---|
| `onHandResults()` — 2 hands | `updateInsideHandBox(box)` + `setVisible(true)` | `updateHandBox(box)` |
| `onHandResults()` — ≠ 2 hands | `setVisible(false)` | `updateHandBox(null)` |
| `init()` resize callback | _(empty)_ | `particleSystem.onResize()` |

---

## Error Handling

No new error categories are introduced. The existing error handling in `AppController` covers all failure modes:

- If `_particleSystem` is null (not yet initialized), `onHandResults()` and `onFaceResults()` both guard with `if (!this._particleSystem) return` — this guard already exists and is unchanged.
- If `box` coordinates are out of viewport bounds (e.g., user moves hands off-screen), the `clamp(value, 0, 1)` in `updateHandBox()` prevents invalid NDC values from reaching the shader.
- If `window.innerWidth` or `window.innerHeight` is zero (degenerate case), division by zero in NDC computation is guarded by the clamp (0/0 = NaN → clamp to 0).

---

## Testing Strategy

### PBT Applicability Assessment

This feature modifies two modules:

- **`ParticleSystem.js`** — adds pure coordinate math (screen → NDC conversion, clamp), shader uniform updates, and mesh updates. The NDC conversion and masking predicate are pure functions suitable for PBT.
- **`AppController.js`** — changes are behavioral (which method to call), not algorithmic. Example-based tests are appropriate.
- **Fragment Shader** — GLSL cannot be unit-tested directly, but the masking logic can be extracted as a pure JS function and property-tested.

PBT IS applicable for: NDC conversion, hand box containment, mirror mode flip, shader mask predicate.

**PBT Library:** [fast-check](https://github.com/dubzzz/fast-check) (already used in the project's existing property tests)

**Configuration:** Minimum 100 iterations per property test.

**Tag format:** `// Feature: holographic-window-mask, Property N: <property_text>`

### Unit Tests (Example-Based)

1. `updateHandBox(null)` → `_points.visible === false`, uniforms zeroed, mesh hidden
2. `updateHandBox(validBox)` → `_points.visible === true`, uniforms set, mesh visible
3. `onHandResults()` with 0 hands → `updateHandBox(null)` called
4. `onHandResults()` with 1 hand → `updateHandBox(null)` called
5. `onHandResults()` with 2 hands → `updateHandBox(box)` called with correct box
6. `onFaceResults()` always calls `updateFromFace()` regardless of hand state
7. `onResize()` → `u_resolution` updated to new dimensions
8. Glass plane material: `color === 0x0088ff`, `opacity === 0.2`, `transparent === true`, `depthWrite === false`, `side === THREE.DoubleSide`

### Property-Based Tests

See **Correctness Properties** section below.

### Integration Tests

1. Face stream + hand stream called in different orders → no errors, correct state
2. Resize event → `u_resolution` stays in sync with viewport

### Smoke Tests

1. Fragment shader source contains `discard` and `u_boxMin`, `u_boxMax`, `u_resolution`
2. ShaderMaterial uniforms object contains `u_boxMin`, `u_boxMax`, `u_resolution` keys
3. `_handPlane.position.z === -1`
4. All `_cornerLines[i].position.z === 1`

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Hand Box Contains All Four Finger Tips

*For any* 4 finger tip points `{ x, y }` in normalized space `[0, 1]`, the tight bounding box computed by `_computeHandBox()` (before padding) must contain all 4 points:

`left_no_pad ≤ sx_i ≤ right_no_pad` and `top_no_pad ≤ sy_i ≤ bottom_no_pad` for all i ∈ {0, 1, 2, 3}

where `sx_i = p_i.x * W` (or `(1 - p_i.x) * W` in mirror mode) and `sy_i = p_i.y * H`.

**Validates: Requirements 6.2, 6.5**

---

### Property 2: Hand Box NDC Is in [0, 1]

*For any* `Hand_Box_Screen` with arbitrary pixel coordinates (including out-of-bounds values), the NDC values computed by `updateHandBox()` must satisfy:

`0.0 ≤ u_boxMin.x ≤ u_boxMax.x ≤ 1.0` and `0.0 ≤ u_boxMin.y ≤ u_boxMax.y ≤ 1.0`

**Validates: Requirements 4.5**

---

### Property 3: Shader Mask Discards Exactly the Particles Outside the Box

*For any* NDC position `(nx, ny)` and hand box NDC `(u_boxMin, u_boxMax)`, the masking predicate `isDiscarded(nx, ny, boxMin, boxMax)` must return `true` if and only if:

`nx < u_boxMin.x` OR `nx > u_boxMax.x` OR `ny < u_boxMin.y` OR `ny > u_boxMax.y`

And `false` when `u_boxMin.x ≤ nx ≤ u_boxMax.x` AND `u_boxMin.y ≤ ny ≤ u_boxMax.y`.

**Validates: Requirements 3.2, 3.3**

---

### Property 4: NDC Normalization Round-Trip

*For any* pixel coordinate `(px, py)` in `[0, viewportWidth] × [0, viewportHeight]`, normalizing then scaling back must recover the original value within floating-point precision:

`(px / viewportWidth) * viewportWidth ≈ px` (error < 0.001 pixels)

This guarantees the NDC conversion formula is lossless for valid viewport coordinates.

**Validates: Requirements 4.2**

---

### Property 5: Mirror Mode Flips Box Horizontally

*For any* set of 4 finger tip points, the hand box computed with `mirrorMode = true` must be the horizontal mirror of the box computed with `mirrorMode = false`:

`box_mirrored.left  ≈ W - box_normal.right`
`box_mirrored.right ≈ W - box_normal.left`

The y-axis is unaffected: `box_mirrored.top === box_normal.top` and `box_mirrored.bottom === box_normal.bottom`.

**Validates: Requirements 6.4**

---

### Property 6: Face Positions Are Independent of Hand Box

*For any* set of 468 face landmarks and any hand box (or null), calling `updateFromFace(worldPositions)` followed by `updateHandBox(box)` in any order must leave `a_basePosition` equal to the values derived from the face landmarks — the hand box must not affect particle base positions.

**Validates: Requirements 5.1, 7.1**

---

### Property 7: Padding Is Exactly 24px on All Sides

*For any* set of 4 finger tip points, the padded hand box must satisfy:

`box.left   = tight_left   - 24`
`box.top    = tight_top    - 24`
`box.right  = tight_right  + 24`
`box.bottom = tight_bottom + 24`

where `tight_*` are the min/max screen coordinates of the 4 points.

**Validates: Requirements 6.3**

---

### Property 8: Corner Bracket Arm Length Is 15% of Shorter Dimension

*For any* hand box, after `_updateHandRegionMesh(box)` is called, the arm length `cs` of each L-shaped corner bracket must equal `0.15 * min(wWorld, hWorld)` where `wWorld` and `hWorld` are the world-space width and height of the hand box.

**Validates: Requirements 2.3**


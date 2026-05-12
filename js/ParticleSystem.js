// js/ParticleSystem.js
// Feature: webcam-particle-face-ar + holographic-window-mask
// Dense video-texture particle grid — full-body silhouette with X-Ray heatmap coloring.
// Particles are laid out in a 2D grid spanning the camera aspect ratio.
// The vertex shader reads luminance from the live webcam texture to displace Z (depth map).
// The fragment shader discards dark/background pixels and applies a sci-fi thermal gradient.
// Hand-box screen-space masking (u_boxMin / u_boxMax) is preserved from the holographic mask feature.

// ---------------------------------------------------------------------------
// GLSL Shaders
// ---------------------------------------------------------------------------

const PARTICLE_VERTEX_SHADER = /* glsl */`
attribute vec2  a_uv;
attribute float a_phase;
uniform sampler2D u_videoTexture;
uniform float     u_time;
uniform float     u_pointSize;
uniform float     u_aspect;
uniform float     u_mirror;
varying vec2  v_uv;
varying float v_luma;
varying float v_edge;
varying float v_contour;
varying float v_phase;
void main() {
  vec2 readUV = a_uv;
  if (u_mirror > 0.5) readUV.x = 1.0 - readUV.x;
  v_uv = readUV;
  v_phase = a_phase;
  vec3 col = texture2D(u_videoTexture, readUV).rgb;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  v_luma = luma;
  // 1. DÒ VIỀN CƠ BẢN
  float d = 0.004;
  float lR = dot(texture2D(u_videoTexture, readUV + vec2(d, 0)).rgb, vec3(0.299, 0.587, 0.114));
  float lU = dot(texture2D(u_videoTexture, readUV + vec2(0, d)).rgb, vec3(0.299, 0.587, 0.114));
  v_edge = smoothstep(0.01, 0.1, abs(luma - lR) + abs(luma - lU));
  // 2. TỪ TRƯỜNG NHIỄU LOẠN (Magnetic Warp) - Bẻ cong bản đồ địa hình
  // Tạo sóng cuộn để làm các đường thẳng biến thành vân tay uốn lượn
  float warpX = sin(readUV.y * 15.0 + u_time * 2.0) * 0.03;
  float warpY = cos(readUV.x * 15.0 - u_time * 1.5) * 0.03;
  float warpedLuma = dot(texture2D(u_videoTexture, readUV + vec2(warpX, warpY)).rgb, vec3(0.299, 0.587, 0.114));
  v_contour = fract(warpedLuma * 14.0); // Tạo vân tay
  // 3. TỌA ĐỘ 3D VÀ HIỆU ỨNG THỞ (Breathing)
  float halfHeight = 76.73;
  float wx = (a_uv.x - 0.5) * 2.0 * u_aspect * halfHeight;
  float wy = (a_uv.y - 0.5) * 2.0 * halfHeight;
  // Khối 3D sâu hơn, nảy mạnh ở viền
  float wz = (luma * 12.0) + (v_edge * 15.0);
  // Hạt dao động tĩnh điện
  float jx = sin(u_time * 2.0 + a_phase) * 0.2;
  float jy = cos(u_time * 2.3 + a_phase * 1.5) * 0.2;
  vec4 mvPos = modelViewMatrix * vec4(wx + jx, wy + jy, wz, 1.0);
  gl_Position = projectionMatrix * mvPos;
  // Hạt trên vân tay và viền sẽ to, chớp nháy nhẹ
  float isLine = 1.0 - smoothstep(0.0, 0.2, v_contour);
  float sizeMod = 0.5 + v_edge * 1.5 + isLine * 1.2 + (sin(u_time * 5.0 + a_phase) * 0.2);
  gl_PointSize = u_pointSize * sizeMod * (200.0 / max(-mvPos.z, 1.0));
}
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */`
uniform vec2 u_boxMin;
uniform vec2 u_boxMax;
uniform vec2 u_resolution;
uniform float u_time; // Cần thời gian để chạy sọc nhiễu
varying vec2  v_uv;
varying float v_luma;
varying float v_edge;
varying float v_contour;
varying float v_phase;
float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453);
}
void main() {
  vec2 ndc = gl_FragCoord.xy / u_resolution;
  if (ndc.x < u_boxMin.x || ndc.x > u_boxMax.x ||
      ndc.y < u_boxMin.y || ndc.y > u_boxMax.y) discard;
  float r = rand(v_uv + v_phase);
  float isLine = 1.0 - smoothstep(0.0, 0.2, v_contour);
  float structure = 0.0;
  // ĐỤC RỖNG TINH TẾ
  if (v_luma < 0.12) {
    if (r > 0.002) discard; // Bầu trời đêm tĩnh lặng
    structure = 0.2;
  } else {
    structure = (v_edge * 1.0) + (isLine * 0.8);
    if (r > (structure + 0.1)) discard; // Xóa mảng thịt phẳng, chừa lại vân tay
  }
  vec2 pt = gl_PointCoord - vec2(0.5);
  float dist = length(pt);
  if (dist > 0.5) discard;
  // SỌC NHIỄU HOLOGRAM (Holographic Scanlines)
  // Tạo các vạch đen chạy dọc từ trên xuống dưới
  float scanline = sin(v_uv.y * 250.0 - u_time * 10.0) * 0.5 + 0.5;
  float alpha = (1.0 - smoothstep(0.2, 0.5, dist)) * min(structure + 0.3, 1.0);
  alpha *= (0.4 + scanline * 0.6); // Trộn sọc nhiễu vào độ mờ
  // BẢNG MÀU CYBERPUNK (Deep Space, Cyan & Magenta)
  vec3 colBg   = vec3(0.0, 0.2, 0.4);   // Xanh đen
  vec3 colBody = vec3(0.0, 0.6, 0.8);   // Xanh biển điện tử
  vec3 colEdge = vec3(0.0, 1.0, 0.9);   // Lục lam phát sáng (Cyan)
  vec3 colHigh = vec3(1.0, 0.0, 0.8);   // Hồng tím (Magenta) điểm xuyết
  vec3 finalColor;
  if (v_luma < 0.12) {
    finalColor = colBg;
  } else {
    // Viền và vân tay màu Cyan sáng rực
    finalColor = mix(colBody, colEdge, min(v_edge * 1.5 + isLine, 1.0));
    // Điểm xuyết màu Hồng ở những vùng có độ sáng đặc biệt (kính, chóp mũi)
    float high = smoothstep(0.7, 1.0, v_luma);
    finalColor = mix(finalColor, colHigh, high);
  }
  // Nhân độ sáng để kích hoạt mượt bộ lọc Bloom
  gl_FragColor = vec4(finalColor * 2.2, alpha);
}
`;

// ---------------------------------------------------------------------------
// Grid dimensions — ~150×150 ≈ 22 500 particles
// ---------------------------------------------------------------------------
const GRID_COLS = 150;
const GRID_ROWS = 150;
const GRID_TOTAL = GRID_COLS * GRID_ROWS;

// ---------------------------------------------------------------------------
// ParticleSystem class
// ---------------------------------------------------------------------------

class ParticleSystem {
    /**
     * @param {THREE.Scene}  scene   Three.js scene
     * @param {number}       count   Ignored — grid size is fixed; kept for API compat
     */
    constructor(scene, count = GRID_TOTAL) {
        this._scene = scene;

        // BỎ GIỚI HẠN SLIDER, ÉP VẼ TOÀN BỘ LƯỚI
        this._count = GRID_TOTAL;

        // Three.js objects
        this._geometry = null;
        this._material = null;
        this._points = null;

        // Shader uniforms (references set in init())
        this._uTime = { value: 0.0 };
        this._uPointSize = { value: 2.5 };
        this._uIntensityMode = { value: 0.0 };
        this._uBoxMin = null;
        this._uBoxMax = null;
        this._uResolution = null;
        this._uVideoTexture = null;
        this._uAspect = null;
        this._uLumaThreshold = null;

        // Intensity mode flag
        this._intensityMode = false;

        // Camera + raycaster for screenToWorld (hand mesh)
        this._camera = null;
        this._raycaster = null;
        this._zPlane = null;
        this._rayTarget = null;
        this._ndcVec = null;

        // Three.js AR hand region (glass plane + cyan brackets)
        this._handPlane = null;
        this._cornerLines = null;

        // Video texture (updated every frame by AppController)
        this._videoTex = null;

        // Legacy compat
        this._hasFaceData = false;
        this._basePositions = null; // not used for grid, kept for compat
    }

    // -------------------------------------------------------------------------
    // Initialisation
    // -------------------------------------------------------------------------

    init() {
        const TOTAL = GRID_TOTAL;

        // Build UV grid attributes
        const uvArr = new Float32Array(TOTAL * 2);
        const phaseArr = new Float32Array(TOTAL);
        const TWO_PI = 2 * Math.PI;

        for (let row = 0; row < GRID_ROWS; row++) {
            for (let col = 0; col < GRID_COLS; col++) {
                const i = row * GRID_COLS + col;
                // UV: center of each cell, flipped V so y=0 is top of video
                uvArr[i * 2] = (col + 0.5) / GRID_COLS;
                uvArr[i * 2 + 1] = 1.0 - (row + 0.5) / GRID_ROWS;
                phaseArr[i] = Math.random() * TWO_PI;
            }
        }

        // Dummy position attribute (required by Three.js Points)
        const posArr = new Float32Array(TOTAL * 3); // all zeros

        this._geometry = new THREE.BufferGeometry();
        this._geometry.setAttribute('position',
            new THREE.BufferAttribute(posArr, 3));
        this._geometry.setAttribute('a_uv',
            new THREE.BufferAttribute(uvArr, 2));
        this._geometry.setAttribute('a_phase',
            new THREE.BufferAttribute(phaseArr, 1));

        this._geometry.setDrawRange(0, this._count);

        // Create a 1×1 black placeholder texture until the video is ready
        this._videoTex = new THREE.VideoTexture(document.createElement('video'));
        this._videoTex.minFilter = THREE.LinearFilter;
        this._videoTex.magFilter = THREE.LinearFilter;
        this._videoTex.format = THREE.RGBAFormat;

        const aspect = window.innerWidth / window.innerHeight;

        this._material = new THREE.ShaderMaterial({
            vertexShader: PARTICLE_VERTEX_SHADER,
            fragmentShader: PARTICLE_FRAGMENT_SHADER,
            uniforms: {
                u_time: this._uTime,
                u_pointSize: this._uPointSize,
                u_intensityMode: this._uIntensityMode,
                u_videoTexture: { value: this._videoTex },
                u_aspect: { value: aspect },
                u_mirror: { value: 0.0 },
                u_boxMin: { value: new THREE.Vector2(0, 0) },
                u_boxMax: { value: new THREE.Vector2(0, 0) },
                u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                u_lumaThreshold: { value: 0.15 },
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        // Save fast-access references
        this._uBoxMin = this._material.uniforms.u_boxMin;
        this._uBoxMax = this._material.uniforms.u_boxMax;
        this._uResolution = this._material.uniforms.u_resolution;
        this._uVideoTexture = this._material.uniforms.u_videoTexture;
        this._uAspect = this._material.uniforms.u_aspect;
        this._uLumaThreshold = this._material.uniforms.u_lumaThreshold;

        this._points = new THREE.Points(this._geometry, this._material);
        this._points.visible = false;
        this._points.frustumCulled = false;
        this._scene.add(this._points);

        // AR hand region mesh (glass plane + cyan corner brackets)
        this._initHandRegionMesh();
    }

    // -------------------------------------------------------------------------
    // Camera reference
    // -------------------------------------------------------------------------

    setCamera(camera) {
        this._camera = camera;
        this._raycaster = new THREE.Raycaster();
        this._zPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        this._rayTarget = new THREE.Vector3();
        this._ndcVec = new THREE.Vector2();
    }

    // -------------------------------------------------------------------------
    // Video texture update (called every frame by AppController)
    // -------------------------------------------------------------------------

    /**
     * Attach the live webcam video element as the particle texture source.
     * Call once after the video element is playing.
     * @param {HTMLVideoElement} videoEl
     */
    setVideoElement(videoEl) {
        if (!videoEl) return;
        const tex = new THREE.VideoTexture(videoEl);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.format = THREE.RGBAFormat;
        this._videoTex = tex;
        if (this._uVideoTexture) {
            this._uVideoTexture.value = tex;
        }
    }

    /**
     * Mark the video texture as needing a GPU upload this frame.
     * Three.js VideoTexture handles this automatically, but calling
     * needsUpdate = true ensures it syncs even on paused frames.
     */
    updateVideoTexture() {
        if (this._videoTex) this._videoTex.needsUpdate = true;
    }

    // -------------------------------------------------------------------------
    // Face-driven positioning (legacy — kept for HUD compat, no-op for grid)
    // -------------------------------------------------------------------------

    /**
     * No-op in grid mode. FaceMesh still runs for HUD stats but particles
     * are driven entirely by the video texture grid.
     * @param {Float32Array} worldPositions
     */
    updateFromFace(worldPositions) {
        this._hasFaceData = true;
        // Grid mode: face landmarks are not used for particle positioning.
        // The video texture drives everything.
    }

    // -------------------------------------------------------------------------
    // Hand box update — unified entry point for hand state changes
    // -------------------------------------------------------------------------

    /**
     * Update shader mask uniforms and hand region mesh from a screen-space box.
     * Y-axis flip: CSS top-left origin → WebGL bottom-left origin.
     *
     * @param {{ left, top, right, bottom, centerX, centerY } | null} box
     */
    updateHandBox(box) {
        if (box === null) {
            this._uBoxMin.value.set(0, 0);
            this._uBoxMax.value.set(0, 0);
            this._points.visible = false;
            this._hideHandRegionMesh();
            return;
        }

        const W = window.innerWidth;
        const H = window.innerHeight;

        const minX = Math.max(0, Math.min(1, box.left / W));
        const maxX = Math.max(0, Math.min(1, box.right / W));
        const minY = Math.max(0, Math.min(1, (H - box.bottom) / H)); // CSS bottom → WebGL y-min
        const maxY = Math.max(0, Math.min(1, (H - box.top) / H)); // CSS top    → WebGL y-max

        this._uBoxMin.value.set(minX, minY);
        this._uBoxMax.value.set(maxX, maxY);

        this._updateHandRegionMesh(box);
        this._points.visible = true;
    }

    // -------------------------------------------------------------------------
    // Resize handler
    // -------------------------------------------------------------------------

    onResize() {
        this._uResolution.value.set(window.innerWidth, window.innerHeight);
        if (this._uAspect) {
            this._uAspect.value = window.innerWidth / window.innerHeight;
        }
    }

    // -------------------------------------------------------------------------
    // Per-frame updates
    // -------------------------------------------------------------------------

    tick(deltaTime) {
        this._uTime.value += deltaTime;
    }

    /** No-op in grid mode — color is driven by luminance in the shader. */
    updateColors(deltaTime) { }

    // -------------------------------------------------------------------------
    // Visibility / configuration
    // -------------------------------------------------------------------------

    setVisible(visible) {
        if (this._points) this._points.visible = Boolean(visible);
        if (!visible) this._hideHandRegionMesh();
    }

    setParticleCount(count) {
        // KHÔNG LÀM GÌ CẢ. Lưới 2D phải vẽ trọn vẹn không được cắt bớt.
        this._count = GRID_TOTAL;
        if (this._geometry) this._geometry.setDrawRange(0, GRID_TOTAL);
    }

    reset() {
        this.setVisible(false);
        this._hasFaceData = false;
    }

    setIntensityMode(enabled) {
        this._intensityMode = Boolean(enabled);
        this._uIntensityMode.value = this._intensityMode ? 1.0 : 0.0;
    }

    /** Luminance threshold below which particles are discarded (silhouette). */
    setLumaThreshold(t) {
        if (this._uLumaThreshold) this._uLumaThreshold.value = t;
    }

    /** Sync mirror mode with the vertex shader so texture sampling is flipped. */
    setMirrorMode(enabled) {
        if (this._material) {
            this._material.uniforms.u_mirror.value = enabled ? 1.0 : 0.0;
        }
    }

    // -------------------------------------------------------------------------
    // Getters
    // -------------------------------------------------------------------------

    get currentCount() { return this._count; }
    get currentScale() { return 1.0; }

    // -------------------------------------------------------------------------
    // Legacy: updateInsideHandBox (kept for internal compat)
    // -------------------------------------------------------------------------

    updateInsideHandBox(box) {
        // Delegated to updateHandBox in grid mode
        this.updateHandBox(box);
    }

    // -------------------------------------------------------------------------
    // Hand region mesh — sci-fi glass plane + cyan corner brackets
    // -------------------------------------------------------------------------

    _initHandRegionMesh() {
        const planeGeo = new THREE.PlaneGeometry(1, 1);
        const planeMat = new THREE.MeshBasicMaterial({
            color: 0x0088ff,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        this._handPlane = new THREE.Mesh(planeGeo, planeMat);
        this._handPlane.position.z = -1;
        this._handPlane.visible = false;
        this._scene.add(this._handPlane);

        const bracketMat = new THREE.LineBasicMaterial({ color: 0x00FFFF });
        this._cornerLines = [];

        for (let i = 0; i < 4; i++) {
            const geo = new THREE.BufferGeometry();
            const pts = new Float32Array(4 * 3);
            geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
            geo.setDrawRange(0, 4);
            const line = new THREE.LineSegments(geo, bracketMat);
            line.position.z = 1;
            line.visible = false;
            this._scene.add(line);
            this._cornerLines.push(line);
        }
    }

    _updateHandRegionMesh(box) {
        if (!this._camera) return;
        const tl = this._screenToWorld(box.left, box.top);
        const tr = this._screenToWorld(box.right, box.top);
        const bl = this._screenToWorld(box.left, box.bottom);
        const br = this._screenToWorld(box.right, box.bottom);
        const c = this._screenToWorld(box.centerX, box.centerY);

        const wWorld = Math.abs(tr.x - tl.x);
        const hWorld = Math.abs(tl.y - bl.y);

        this._handPlane.scale.set(wWorld, hWorld, 1);
        this._handPlane.position.set(c.x, c.y, -1);
        this._handPlane.visible = true;

        const cs = Math.min(wWorld, hWorld) * 0.15;
        this._setCorner(0, tl.x, tl.y, cs, 0, 0, -cs);
        this._setCorner(1, tr.x, tr.y, -cs, 0, 0, -cs);
        this._setCorner(2, bl.x, bl.y, cs, 0, 0, cs);
        this._setCorner(3, br.x, br.y, -cs, 0, 0, cs);

        for (const line of this._cornerLines) line.visible = true;
    }

    _setCorner(idx, x, y, dx, dy, vx, vy) {
        const pos = this._cornerLines[idx].geometry.attributes.position.array;
        const z = 1;
        pos[0] = x; pos[1] = y; pos[2] = z;
        pos[3] = x + dx; pos[4] = y + dy; pos[5] = z;
        pos[6] = x; pos[7] = y; pos[8] = z;
        pos[9] = x + vx; pos[10] = y + vy; pos[11] = z;
        this._cornerLines[idx].geometry.attributes.position.needsUpdate = true;
    }

    _hideHandRegionMesh() {
        if (this._handPlane) this._handPlane.visible = false;
        if (this._cornerLines) for (const l of this._cornerLines) l.visible = false;
    }

    // -------------------------------------------------------------------------
    // Screen → world unprojection
    // -------------------------------------------------------------------------

    _screenToWorld(px, py) {
        this._ndcVec.set(
            (px / window.innerWidth) * 2 - 1,
            -(py / window.innerHeight) * 2 + 1
        );
        this._raycaster.setFromCamera(this._ndcVec, this._camera);
        this._raycaster.ray.intersectPlane(this._zPlane, this._rayTarget);
        return { x: this._rayTarget.x, y: this._rayTarget.y };
    }
}

// =============================================================================
// Module-level pure utility functions (kept for compat with other modules)
// =============================================================================

function _gaussianRandom(mean, std) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function _hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return [r + m, g + m, b + m];
}

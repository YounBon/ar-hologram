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
varying float v_depth;

void main() {
  vec2 readUV = a_uv;
  if (u_mirror > 0.5) readUV.x = 1.0 - readUV.x;
  v_uv   = readUV;
  v_phase = a_phase;

  vec3 col  = texture2D(u_videoTexture, readUV).rgb;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  v_luma = luma;

  // ── Edge detection (Sobel-lite, 4-tap) ──────────────────────────────────
  float d  = 0.004;
  float lR = dot(texture2D(u_videoTexture, readUV + vec2( d, 0)).rgb, vec3(0.299,0.587,0.114));
  float lL = dot(texture2D(u_videoTexture, readUV + vec2(-d, 0)).rgb, vec3(0.299,0.587,0.114));
  float lU = dot(texture2D(u_videoTexture, readUV + vec2(0,  d)).rgb, vec3(0.299,0.587,0.114));
  float lD = dot(texture2D(u_videoTexture, readUV + vec2(0, -d)).rgb, vec3(0.299,0.587,0.114));
  v_edge = smoothstep(0.01, 0.12,
    sqrt((lR - lL) * (lR - lL) + (lU - lD) * (lU - lD)));

  // ── Magnetic warp contour (fingerprint lines) ────────────────────────────
  float warpX = sin(readUV.y * 18.0 + u_time * 1.8) * 0.025;
  float warpY = cos(readUV.x * 18.0 - u_time * 1.3) * 0.025;
  float wLuma = dot(texture2D(u_videoTexture, readUV + vec2(warpX, warpY)).rgb,
                    vec3(0.299,0.587,0.114));
  v_contour = fract(wLuma * 16.0);

  // ── 3-D displacement ─────────────────────────────────────────────────────
  float halfH = 76.73;
  float wx = (a_uv.x - 0.5) * 2.0 * u_aspect * halfH;
  float wy = (a_uv.y - 0.5) * 2.0 * halfH;
  float wz = luma * 14.0 + v_edge * 18.0;          // deeper depth map
  v_depth  = wz;

  // ── Electrostatic jitter ─────────────────────────────────────────────────
  float jx = sin(u_time * 2.1 + a_phase)        * 0.18;
  float jy = cos(u_time * 2.4 + a_phase * 1.7)  * 0.18;
  // Micro-tremor on edges (plasma shimmer)
  jx += v_edge * sin(u_time * 9.0 + a_phase * 3.1) * 0.12;
  jy += v_edge * cos(u_time * 8.3 + a_phase * 2.7) * 0.12;

  vec4 mvPos = modelViewMatrix * vec4(wx + jx, wy + jy, wz, 1.0);
  gl_Position = projectionMatrix * mvPos;

  // ── Point size: edge/contour particles flicker and pulse ─────────────────
  float isLine  = 1.0 - smoothstep(0.0, 0.18, v_contour);
  float pulse   = sin(u_time * 6.0 + a_phase) * 0.25 + 0.75;   // 0.5 – 1.0
  float sizeMod = (0.4 + v_edge * 1.8 + isLine * 1.4) * pulse;
  gl_PointSize  = u_pointSize * sizeMod * (200.0 / max(-mvPos.z, 1.0));
}
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */`
uniform vec2  u_boxMin;
uniform vec2  u_boxMax;
uniform vec2  u_resolution;
uniform float u_time;

varying vec2  v_uv;
varying float v_luma;
varying float v_edge;
varying float v_contour;
varying float v_phase;
varying float v_depth;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  // Holographic window mask
  vec2 ndc = gl_FragCoord.xy / u_resolution;
  if (ndc.x < u_boxMin.x || ndc.x > u_boxMax.x ||
      ndc.y < u_boxMin.y || ndc.y > u_boxMax.y) discard;

  // Stochastic density culling
  float r      = rand(v_uv + v_phase);
  float isLine = 1.0 - smoothstep(0.0, 0.18, v_contour);
  float structure;
  if (v_luma < 0.10) {
    if (r > 0.0015) discard;
    structure = 0.15;
  } else {
    structure = v_edge * 1.1 + isLine * 0.9;
    if (r > structure + 0.08) discard;
  }

  // Circular soft dot
  vec2  pt   = gl_PointCoord - vec2(0.5);
  float dist = length(pt);
  if (dist > 0.5) discard;

  // Holographic scanlines
  float scan  = sin(v_uv.y * 300.0 - u_time * 12.0) * 0.5 + 0.5;
  float aberr = sin(v_uv.y * 300.0 - u_time * 12.0 + 0.4) * 0.3 + 0.7;

  // Glitch flicker
  float glitchRow   = floor(v_uv.y * 40.0);
  float glitchTime  = floor(u_time * 0.5);
  float glitch      = step(0.97, rand(vec2(glitchRow, glitchTime)));
  float glitchAlpha = 1.0 - glitch * rand(vec2(glitchRow + 1.0, glitchTime)) * 0.8;

  // Alpha
  float softDot = 1.0 - smoothstep(0.15, 0.5, dist);
  float alpha   = softDot * min(structure + 0.28, 1.0);
  alpha *= (0.35 + scan * 0.65) * aberr * glitchAlpha;

  // Colour palette — living hologram with slow hue drift
  float hueShift = sin(u_time * 0.25) * 0.12;
  vec3 colVoid  = vec3(0.0,  0.05 + hueShift, 0.18);
  vec3 colBody  = vec3(0.0,  0.55 + hueShift, 0.85);
  vec3 colEdge  = vec3(0.0,  1.0,             0.92);
  vec3 colHigh  = vec3(1.0,  0.05,            0.75);
  vec3 colCore  = vec3(1.0,  1.0,             1.0);

  vec3 finalColor;
  if (v_luma < 0.10) {
    finalColor = colVoid;
  } else {
    float edgeMix  = min(v_edge * 1.6 + isLine, 1.0);
    finalColor = mix(colBody, colEdge, edgeMix);
    float high = smoothstep(0.68, 1.0, v_luma);
    finalColor = mix(finalColor, colHigh, high);
    float coreGlow = v_edge * smoothstep(0.85, 1.0, v_luma);
    finalColor = mix(finalColor, colCore, coreGlow * 0.6);
  }

  // Chromatic scanline tint
  finalColor.r += scan * v_edge * 0.15;
  finalColor.b += (1.0 - scan) * isLine * 0.2;

  gl_FragColor = vec4(finalColor * 2.4, alpha);
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
        // Animate holographic window overlays every frame
        if (this._handPlane && this._handPlane.visible) {
            this._animateHandRegion(deltaTime);
        }
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
        // ── Glass plane ───────────────────────────────────────────────────────
        const planeGeo = new THREE.PlaneGeometry(1, 1);
        const planeMat = new THREE.MeshBasicMaterial({
            color: 0x0055cc,
            transparent: true,
            opacity: 0.10,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        this._handPlane = new THREE.Mesh(planeGeo, planeMat);
        this._handPlane.position.z = -1;
        this._handPlane.visible = false;
        this._scene.add(this._handPlane);

        // ── Outer corner brackets (cyan) ──────────────────────────────────────
        this._cornerLines = [];
        const matOuter = new THREE.LineBasicMaterial({ color: 0x00FFFF });
        for (let i = 0; i < 4; i++) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
            geo.setDrawRange(0, 4);
            const line = new THREE.LineSegments(geo, matOuter);
            line.position.z = 1.2;
            line.visible = false;
            this._scene.add(line);
            this._cornerLines.push(line);
        }

        // ── Inner corner brackets (white, inset) ──────────────────────────────
        this._cornerLinesInner = [];
        const matInner = new THREE.LineBasicMaterial({ color: 0xffffff });
        for (let i = 0; i < 4; i++) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
            geo.setDrawRange(0, 4);
            const line = new THREE.LineSegments(geo, matInner);
            line.position.z = 1.3;
            line.visible = false;
            this._scene.add(line);
            this._cornerLinesInner.push(line);
        }

        // ── Tick marks along each edge (4 edges × up to 8 ticks) ─────────────
        // Each tick is a short perpendicular line segment.
        // We store them as a single LineSegments with 4×8×2 = 64 vertices.
        this._tickMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.55 });
        const tickGeo = new THREE.BufferGeometry();
        const TICK_VERTS = 4 * 8 * 2; // 4 edges, 8 ticks each, 2 verts per tick
        tickGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TICK_VERTS * 3), 3));
        tickGeo.setDrawRange(0, TICK_VERTS);
        this._tickLines = new THREE.LineSegments(tickGeo, this._tickMat);
        this._tickLines.position.z = 1.1;
        this._tickLines.visible = false;
        this._scene.add(this._tickLines);

        // ── Grid lines inside the window ──────────────────────────────────────
        // 5 horizontal + 5 vertical = 10 lines, each needs 2 verts
        const GRID_LINES = 10;
        this._gridMat = new THREE.LineBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.18 });
        const gridGeo = new THREE.BufferGeometry();
        gridGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GRID_LINES * 2 * 3), 3));
        gridGeo.setDrawRange(0, GRID_LINES * 2);
        this._gridLines = new THREE.LineSegments(gridGeo, this._gridMat);
        this._gridLines.position.z = -0.5;
        this._gridLines.visible = false;
        this._scene.add(this._gridLines);

        // ── Scan line (single horizontal bar that sweeps top→bottom) ─────────
        const scanGeo = new THREE.BufferGeometry();
        scanGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
        scanGeo.setDrawRange(0, 2);
        this._scanMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.7 });
        this._scanLine = new THREE.LineSegments(scanGeo, this._scanMat);
        this._scanLine.position.z = 0.5;
        this._scanLine.visible = false;
        this._scene.add(this._scanLine);

        // ── Running-dot animation along edges ─────────────────────────────────
        // 4 dots (one per corner bracket), each is a tiny Points object
        this._edgeDots = [];
        const dotMat = new THREE.PointsMaterial({ color: 0xffffff, size: 3.5, sizeAttenuation: false, transparent: true, opacity: 0.9 });
        for (let i = 0; i < 4; i++) {
            const dGeo = new THREE.BufferGeometry();
            dGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
            const dot = new THREE.Points(dGeo, dotMat.clone());
            dot.position.z = 1.5;
            dot.visible = false;
            this._scene.add(dot);
            this._edgeDots.push(dot);
        }

        // Internal state
        this._handPlaneTime = 0;
        this._scanT = 0;          // 0→1 scan position
        this._dotT = [0, 0.25, 0.5, 0.75]; // phase offset per dot
        this._lastBox = null;
    }

    _updateHandRegionMesh(box) {
        if (!this._camera) return;
        this._lastBox = box;

        const tl = this._screenToWorld(box.left, box.top);
        const tr = this._screenToWorld(box.right, box.top);
        const bl = this._screenToWorld(box.left, box.bottom);
        const br = this._screenToWorld(box.right, box.bottom);
        const c = this._screenToWorld(box.centerX, box.centerY);

        const wWorld = Math.abs(tr.x - tl.x);
        const hWorld = Math.abs(tl.y - bl.y);

        // ── Glass plane ───────────────────────────────────────────────────────
        const breathe = 0.07 + Math.sin(this._handPlaneTime * 2.0) * 0.035;
        this._handPlane.material.opacity = breathe;
        this._handPlane.scale.set(wWorld, hWorld, 1);
        this._handPlane.position.set(c.x, c.y, -1);
        this._handPlane.visible = true;

        // ── Corner brackets ───────────────────────────────────────────────────
        const cs = Math.min(wWorld, hWorld) * 0.20;
        const inset = Math.min(wWorld, hWorld) * 0.025;
        const ci = cs * 0.5;

        this._setCorner(0, tl.x, tl.y, cs, 0, 0, -cs);
        this._setCorner(1, tr.x, tr.y, -cs, 0, 0, -cs);
        this._setCorner(2, bl.x, bl.y, cs, 0, 0, cs);
        this._setCorner(3, br.x, br.y, -cs, 0, 0, cs);
        for (const l of this._cornerLines) l.visible = true;

        this._setCornerInner(0, tl.x + inset, tl.y - inset, ci, 0, 0, -ci);
        this._setCornerInner(1, tr.x - inset, tr.y - inset, -ci, 0, 0, -ci);
        this._setCornerInner(2, bl.x + inset, bl.y + inset, ci, 0, 0, ci);
        this._setCornerInner(3, br.x - inset, br.y + inset, -ci, 0, 0, ci);
        for (const l of this._cornerLinesInner) l.visible = true;

        // ── Tick marks ────────────────────────────────────────────────────────
        this._updateTickMarks(tl, tr, bl, br, wWorld, hWorld);

        // ── Grid lines ────────────────────────────────────────────────────────
        this._updateGridLines(tl, tr, bl, br, wWorld, hWorld);

        // ── Scan line & dots are animated in _animateHandRegion ───────────────
        this._scanLine.visible = true;
        for (const d of this._edgeDots) d.visible = true;
    }

    /** Called every frame from tick() while the window is active. */
    _animateHandRegion(deltaTime) {
        this._handPlaneTime += deltaTime;

        if (!this._lastBox || !this._camera) return;
        const box = this._lastBox;

        const tl = this._screenToWorld(box.left, box.top);
        const tr = this._screenToWorld(box.right, box.top);
        const bl = this._screenToWorld(box.left, box.bottom);
        const br = this._screenToWorld(box.right, box.bottom);
        const wWorld = Math.abs(tr.x - tl.x);
        const hWorld = Math.abs(tl.y - bl.y);

        // ── Breathing glass opacity ───────────────────────────────────────────
        this._handPlane.material.opacity = 0.07 + Math.sin(this._handPlaneTime * 2.0) * 0.035;

        // ── Grid opacity pulse ────────────────────────────────────────────────
        this._gridMat.opacity = 0.12 + Math.sin(this._handPlaneTime * 1.5) * 0.06;

        // ── Scan line sweep (top → bottom, period ~2.5 s) ─────────────────────
        this._scanT = (this._scanT + deltaTime / 2.5) % 1.0;
        // Interpolate from top edge to bottom edge in world space
        const scanY = tl.y + (bl.y - tl.y) * this._scanT;
        const scanPos = this._scanLine.geometry.attributes.position.array;
        scanPos[0] = tl.x; scanPos[1] = scanY; scanPos[2] = 0;
        scanPos[3] = tr.x; scanPos[4] = scanY; scanPos[5] = 0;
        this._scanLine.geometry.attributes.position.needsUpdate = true;
        // Fade near edges
        const fadeEdge = Math.sin(this._scanT * Math.PI);
        this._scanMat.opacity = 0.15 + fadeEdge * 0.65;

        // ── Running dots along the perimeter ─────────────────────────────────
        // Perimeter: top → right → bottom → left (CCW in world space)
        // Parameterize 0→1 around the rectangle
        const perim = 2 * (wWorld + hWorld);
        for (let i = 0; i < 4; i++) {
            this._dotT[i] = (this._dotT[i] + deltaTime * 0.35) % 1.0;
            const t = this._dotT[i];
            const dist = t * perim;
            let px, py;
            const top = wWorld, right = wWorld + hWorld, bot = 2 * wWorld + hWorld;
            if (dist < top) {
                const f = dist / wWorld;
                px = tl.x + (tr.x - tl.x) * f;
                py = tl.y + (tr.y - tl.y) * f;
            } else if (dist < right) {
                const f = (dist - top) / hWorld;
                px = tr.x + (br.x - tr.x) * f;
                py = tr.y + (br.y - tr.y) * f;
            } else if (dist < bot) {
                const f = (dist - right) / wWorld;
                px = br.x + (bl.x - br.x) * f;
                py = br.y + (bl.y - br.y) * f;
            } else {
                const f = (dist - bot) / hWorld;
                px = bl.x + (tl.x - bl.x) * f;
                py = bl.y + (tl.y - bl.y) * f;
            }
            const dp = this._edgeDots[i].geometry.attributes.position.array;
            dp[0] = px; dp[1] = py; dp[2] = 0;
            this._edgeDots[i].geometry.attributes.position.needsUpdate = true;
            // Pulse brightness
            this._edgeDots[i].material.opacity = 0.6 + Math.sin(this._handPlaneTime * 8 + i * 1.57) * 0.4;
        }
    }

    _updateTickMarks(tl, tr, bl, br, wWorld, hWorld) {
        const TICKS = 6; // per edge
        const tickLen = Math.min(wWorld, hWorld) * 0.025;
        const pos = this._tickLines.geometry.attributes.position.array;
        let vi = 0;

        const writeTick = (ax, ay, bx, by) => {
            pos[vi++] = ax; pos[vi++] = ay; pos[vi++] = 1.1;
            pos[vi++] = bx; pos[vi++] = by; pos[vi++] = 1.1;
        };

        // Top edge (tl → tr), perpendicular = down
        for (let k = 1; k < TICKS + 1; k++) {
            const f = k / (TICKS + 1);
            const mx = tl.x + (tr.x - tl.x) * f;
            const my = tl.y + (tr.y - tl.y) * f;
            writeTick(mx, my, mx, my - tickLen);
        }
        // Bottom edge (bl → br), perpendicular = up
        for (let k = 1; k < TICKS + 1; k++) {
            const f = k / (TICKS + 1);
            const mx = bl.x + (br.x - bl.x) * f;
            const my = bl.y + (br.y - bl.y) * f;
            writeTick(mx, my, mx, my + tickLen);
        }
        // Left edge (tl → bl), perpendicular = right
        for (let k = 1; k < TICKS + 1; k++) {
            const f = k / (TICKS + 1);
            const mx = tl.x + (bl.x - tl.x) * f;
            const my = tl.y + (bl.y - tl.y) * f;
            writeTick(mx, my, mx + tickLen, my);
        }
        // Right edge (tr → br), perpendicular = left
        for (let k = 1; k < TICKS + 1; k++) {
            const f = k / (TICKS + 1);
            const mx = tr.x + (br.x - tr.x) * f;
            const my = tr.y + (br.y - tr.y) * f;
            writeTick(mx, my, mx - tickLen, my);
        }

        this._tickLines.geometry.attributes.position.needsUpdate = true;
        this._tickLines.geometry.setDrawRange(0, vi / 3);
        this._tickLines.visible = true;
    }

    _updateGridLines(tl, tr, bl, br, wWorld, hWorld) {
        const DIVS = 5; // 5 horizontal + 5 vertical
        const pos = this._gridLines.geometry.attributes.position.array;
        let vi = 0;

        const write = (ax, ay, bx, by) => {
            pos[vi++] = ax; pos[vi++] = ay; pos[vi++] = -0.5;
            pos[vi++] = bx; pos[vi++] = by; pos[vi++] = -0.5;
        };

        // Horizontal lines (lerp between top and bottom edges)
        for (let k = 1; k < DIVS; k++) {
            const f = k / DIVS;
            const lx = tl.x + (bl.x - tl.x) * f;
            const ly = tl.y + (bl.y - tl.y) * f;
            const rx = tr.x + (br.x - tr.x) * f;
            const ry = tr.y + (br.y - tr.y) * f;
            write(lx, ly, rx, ry);
        }
        // Vertical lines (lerp between left and right edges)
        for (let k = 1; k < DIVS; k++) {
            const f = k / DIVS;
            const tx = tl.x + (tr.x - tl.x) * f;
            const ty = tl.y + (tr.y - tl.y) * f;
            const bx = bl.x + (br.x - bl.x) * f;
            const by = bl.y + (br.y - bl.y) * f;
            write(tx, ty, bx, by);
        }

        this._gridLines.geometry.attributes.position.needsUpdate = true;
        this._gridLines.geometry.setDrawRange(0, vi / 3);
        this._gridLines.visible = true;
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

    _setCornerInner(idx, x, y, dx, dy, vx, vy) {
        const pos = this._cornerLinesInner[idx].geometry.attributes.position.array;
        const z = 1.1;
        pos[0] = x; pos[1] = y; pos[2] = z;
        pos[3] = x + dx; pos[4] = y + dy; pos[5] = z;
        pos[6] = x; pos[7] = y; pos[8] = z;
        pos[9] = x + vx; pos[10] = y + vy; pos[11] = z;
        this._cornerLinesInner[idx].geometry.attributes.position.needsUpdate = true;
    }

    _hideHandRegionMesh() {
        if (this._handPlane) this._handPlane.visible = false;
        if (this._cornerLines) for (const l of this._cornerLines) l.visible = false;
        if (this._cornerLinesInner) for (const l of this._cornerLinesInner) l.visible = false;
        if (this._tickLines) this._tickLines.visible = false;
        if (this._gridLines) this._gridLines.visible = false;
        if (this._scanLine) this._scanLine.visible = false;
        if (this._edgeDots) for (const d of this._edgeDots) d.visible = false;
        this._lastBox = null;
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

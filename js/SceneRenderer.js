// js/SceneRenderer.js
// Feature: webcam-particle-face-ar
// Three.js scene, camera, render loop, and post-processing (UnrealBloomPass).
// Requirements: 10.1, 10.2, 10.3, 12.5

class SceneRenderer {
    /**
     * @param {HTMLCanvasElement} canvas  The canvas element to render into
     */
    constructor(canvas) {
        this._canvas = canvas;

        // Three.js core objects (set in init())
        this._scene = null;
        this._camera = null;
        this._renderer = null;

        // Post-processing
        this._composer = null; // EffectComposer

        // Render loop state
        this._animationFrameId = null;
        this._lastTime = null;
        this._isRunning = false;

        // Per-frame callback: onRender(deltaTime)
        this._onRender = null;

        // Post-resize callback
        this._onResizeCallback = null;
    }

    // -------------------------------------------------------------------------
    // Initialisation
    // -------------------------------------------------------------------------

    init() {
        // --- Scene ---
        this._scene = new THREE.Scene();
        this._scene.background = null; // transparent — webcam video shows through

        // --- Camera ---
        const aspect = this._canvas.clientWidth / this._canvas.clientHeight || 1;
        this._camera = new THREE.PerspectiveCamera(
            CONSTANTS.CAMERA_FOV,
            aspect,
            CONSTANTS.CAMERA_NEAR,
            CONSTANTS.CAMERA_FAR
        );
        this._camera.position.z = CONSTANTS.CAMERA_Z;

        // --- WebGLRenderer ---
        this._renderer = new THREE.WebGLRenderer({
            canvas: this._canvas,
            antialias: false,
            alpha: true,
        });
        this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this._renderer.setClearColor(0x000000, 0); // fully transparent
        this._renderer.toneMapping = THREE.ReinhardToneMapping;
        this._renderer.toneMappingExposure = 1.2;

        this._updateSize();

        // --- Post-processing: EffectComposer + UnrealBloomPass ---
        this._initPostProcessing();

        window.addEventListener('resize', () => this.onResize());
    }

    /**
     * Set up EffectComposer with RenderPass and UnrealBloomPass.
     * Falls back gracefully if the Three.js addons are not available.
     * @private
     */
    _initPostProcessing() {
        // Three.js r158 ships EffectComposer / passes as ES modules in
        // examples/jsm — but this project loads Three.js via CDN as a global.
        // We use the inline implementations bundled with three.min.js when
        // available, otherwise fall back to direct renderer.render().

        // Check whether the post-processing classes are available globally
        // (they are NOT included in three.min.js by default, so we implement
        // a lightweight bloom-capable composer using the renderer's built-in
        // tone-mapping + a manual two-pass approach via WebGLRenderTarget).

        // ── Lightweight bloom via render-target ping-pong ─────────────────────
        // We use THREE.WebGLRenderTarget + a custom fullscreen quad shader
        // to achieve a bloom effect without requiring the jsm addons.

        const W = this._canvas.clientWidth || window.innerWidth;
        const H = this._canvas.clientHeight || window.innerHeight;

        // Render target for the scene (HDR-like: float texture)
        this._rtScene = new THREE.WebGLRenderTarget(W, H, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
        });

        // Downsampled target for bloom blur (quarter resolution)
        const bW = Math.max(1, W >> 2);
        const bH = Math.max(1, H >> 2);
        this._rtBloomA = new THREE.WebGLRenderTarget(bW, bH, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
        });
        this._rtBloomB = new THREE.WebGLRenderTarget(bW, bH, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
        });

        // Fullscreen quad geometry (shared)
        this._quadGeo = new THREE.PlaneGeometry(2, 2);

        // ── Pass 1: threshold — extract bright pixels ─────────────────────────
        this._thresholdMat = new THREE.ShaderMaterial({
            uniforms: {
                u_tex: { value: null },
                u_threshold: { value: 0.5 }, // low threshold — thermal colors are HDR
            },
            vertexShader: `
                varying vec2 v_uv;
                void main() {
                    v_uv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D u_tex;
                uniform float     u_threshold;
                varying vec2      v_uv;
                void main() {
                    vec4 col = texture2D(u_tex, v_uv);
                    float brightness = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
                    float factor = max(0.0, brightness - u_threshold) / max(brightness, 0.0001);
                    gl_FragColor = vec4(col.rgb * factor, col.a);
                }
            `,
            depthWrite: false,
            depthTest: false,
        });

        // ── Pass 2: Gaussian blur (horizontal + vertical) ─────────────────────
        const blurVert = `
            varying vec2 v_uv;
            void main() {
                v_uv = uv;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `;
        const blurFrag = `
            uniform sampler2D u_tex;
            uniform vec2      u_dir;   // (1/W, 0) or (0, 1/H)
            varying vec2      v_uv;
            // 9-tap Gaussian kernel
            void main() {
                vec4 sum = vec4(0.0);
                float weights[5];
                weights[0] = 0.2270270270;
                weights[1] = 0.1945945946;
                weights[2] = 0.1216216216;
                weights[3] = 0.0540540541;
                weights[4] = 0.0162162162;
                sum += texture2D(u_tex, v_uv) * weights[0];
                for (int i = 1; i <= 4; i++) {
                    vec2 off = u_dir * float(i);
                    sum += texture2D(u_tex, v_uv + off) * weights[i];
                    sum += texture2D(u_tex, v_uv - off) * weights[i];
                }
                gl_FragColor = sum;
            }
        `;

        this._blurHMat = new THREE.ShaderMaterial({
            uniforms: {
                u_tex: { value: null },
                u_dir: { value: new THREE.Vector2(1.0 / bW, 0) },
            },
            vertexShader: blurVert, fragmentShader: blurFrag,
            depthWrite: false, depthTest: false,
        });
        this._blurVMat = new THREE.ShaderMaterial({
            uniforms: {
                u_tex: { value: null },
                u_dir: { value: new THREE.Vector2(0, 1.0 / bH) },
            },
            vertexShader: blurVert, fragmentShader: blurFrag,
            depthWrite: false, depthTest: false,
        });

        // ── Pass 3: composite — additive blend scene + bloom ──────────────────
        this._compositeMat = new THREE.ShaderMaterial({
            uniforms: {
                u_scene: { value: null },
                u_bloom: { value: null },
                u_strength: { value: 0.6 },
            },
            vertexShader: `
                varying vec2 v_uv;
                void main() {
                    v_uv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D u_scene;
                uniform sampler2D u_bloom;
                uniform float     u_strength;
                varying vec2      v_uv;
                void main() {
                    vec4 scene = texture2D(u_scene, v_uv);
                    vec4 bloom = texture2D(u_bloom, v_uv);
                    vec3 col = scene.rgb + bloom.rgb * u_strength;
                    // Force alpha high enough so bright particles aren't invisible
                    // after compositing on a transparent background
                    float maxRGB = max(col.r, max(col.g, col.b));
                    float alpha = clamp(scene.a + maxRGB, 0.0, 1.0);
                    gl_FragColor = vec4(col, alpha);
                }
            `,
            depthWrite: false, depthTest: false,
            transparent: true,
        });

        // Fullscreen quad meshes (one per pass material)
        this._quadThreshold = new THREE.Mesh(this._quadGeo, this._thresholdMat);
        this._quadBlurH = new THREE.Mesh(this._quadGeo, this._blurHMat);
        this._quadBlurV = new THREE.Mesh(this._quadGeo, this._blurVMat);
        this._quadComposite = new THREE.Mesh(this._quadGeo, this._compositeMat);

        // Orthographic camera for fullscreen passes
        this._orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this._orthoScene = new THREE.Scene();
        // (we swap the mesh into orthoScene per-pass)
    }

    // -------------------------------------------------------------------------
    // Render loop
    // -------------------------------------------------------------------------

    startRenderLoop(onRender) {
        if (this._isRunning) return;
        if (typeof onRender === 'function') this._onRender = onRender;
        this._isRunning = true;
        this._lastTime = performance.now();
        this._scheduleFrame();
    }

    stopRenderLoop() {
        this._isRunning = false;
        if (this._animationFrameId !== null) {
            cancelAnimationFrame(this._animationFrameId);
            this._animationFrameId = null;
        }
    }

    render(deltaTime) {
        if (typeof this._onRender === 'function') this._onRender(deltaTime);
        this._renderWithBloom();
    }

    // -------------------------------------------------------------------------
    // Bloom render pipeline
    // -------------------------------------------------------------------------

    /**
     * Multi-pass bloom:
     *  1. Render scene → rtScene
     *  2. Threshold bright pixels → rtBloomA
     *  3. Horizontal blur rtBloomA → rtBloomB
     *  4. Vertical blur rtBloomB → rtBloomA
     *  5. Composite rtScene + rtBloomA → screen (alpha-preserving)
     * @private
     */
    _renderWithBloom() {
        const renderer = this._renderer;
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;

        // ── 1. Render scene to texture ────────────────────────────────────────
        renderer.setRenderTarget(this._rtScene);
        renderer.clear(true, true, true);
        renderer.render(this._scene, this._camera);

        // ── 2. Threshold pass ─────────────────────────────────────────────────
        this._thresholdMat.uniforms.u_tex.value = this._rtScene.texture;
        this._orthoScene.add(this._quadThreshold);
        renderer.setRenderTarget(this._rtBloomA);
        renderer.clear(true, true, true);
        renderer.render(this._orthoScene, this._orthoCamera);
        this._orthoScene.remove(this._quadThreshold);

        // ── 3. Horizontal blur ────────────────────────────────────────────────
        this._blurHMat.uniforms.u_tex.value = this._rtBloomA.texture;
        this._orthoScene.add(this._quadBlurH);
        renderer.setRenderTarget(this._rtBloomB);
        renderer.clear(true, true, true);
        renderer.render(this._orthoScene, this._orthoCamera);
        this._orthoScene.remove(this._quadBlurH);

        // ── 4. Vertical blur ──────────────────────────────────────────────────
        this._blurVMat.uniforms.u_tex.value = this._rtBloomB.texture;
        this._orthoScene.add(this._quadBlurV);
        renderer.setRenderTarget(this._rtBloomA);
        renderer.clear(true, true, true);
        renderer.render(this._orthoScene, this._orthoCamera);
        this._orthoScene.remove(this._quadBlurV);

        // ── 5. Composite to screen ────────────────────────────────────────────
        this._compositeMat.uniforms.u_scene.value = this._rtScene.texture;
        this._compositeMat.uniforms.u_bloom.value = this._rtBloomA.texture;
        this._orthoScene.add(this._quadComposite);
        renderer.setRenderTarget(null); // back to screen
        renderer.clear(true, true, true);
        renderer.render(this._orthoScene, this._orthoCamera);
        this._orthoScene.remove(this._quadComposite);

        renderer.autoClear = autoClear;
    }

    // -------------------------------------------------------------------------
    // Resize handling
    // -------------------------------------------------------------------------

    onResize() {
        this._updateSize();
        if (typeof this._onResizeCallback === 'function') this._onResizeCallback();
    }

    setResizeCallback(callback) {
        this._onResizeCallback = callback;
    }

    // -------------------------------------------------------------------------
    // Getters
    // -------------------------------------------------------------------------

    get scene() { return this._scene; }
    get camera() { return this._camera; }
    get renderer() { return this._renderer; }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    _scheduleFrame() {
        this._animationFrameId = requestAnimationFrame(() => {
            if (!this._isRunning) return;
            const now = performance.now();
            const deltaTime = (now - this._lastTime) / 1000;
            this._lastTime = now;
            this.render(deltaTime);
            this._scheduleFrame();
        });
    }

    _updateSize() {
        const width = this._canvas.clientWidth || window.innerWidth;
        const height = this._canvas.clientHeight || window.innerHeight;

        this._renderer.setSize(width, height, false);

        if (this._camera) {
            this._camera.aspect = width / height;
            this._camera.updateProjectionMatrix();
        }

        // Resize render targets
        if (this._rtScene) {
            this._rtScene.setSize(width, height);
            const bW = Math.max(1, width >> 2);
            const bH = Math.max(1, height >> 2);
            this._rtBloomA.setSize(bW, bH);
            this._rtBloomB.setSize(bW, bH);
            if (this._blurHMat) {
                this._blurHMat.uniforms.u_dir.value.set(1.0 / bW, 0);
                this._blurVMat.uniforms.u_dir.value.set(0, 1.0 / bH);
            }
        }
    }
}

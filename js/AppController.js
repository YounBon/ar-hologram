// js/AppController.js
// Feature: webcam-particle-face-ar
// Orchestrates all modules, manages application lifecycle, and handles errors.
// Requirements: 1.1, 1.2, 1.3, 1.4, 2.4, 2.5, 3.3, 4.4, 4.5

class AppController {
    constructor() {
        // Module instances — created during init()
        this._stateManager = null;
        this._sceneRenderer = null;
        this._coordinateMapper = null;
        this._particleSystem = null;
        this._adaptiveQualityManager = null;
        this._mediaPipeEngine = null;
        this._hudOverlay = null;

        // Webcam stream
        this._videoElement = null;
        this._stream = null;

        // FPS tracking
        this._fpsFrameCount = 0;
        this._fpsAccumulator = 0;   // seconds accumulated since last FPS sample
        this._currentFPS = 60;

        // Tracking status timer (Req 9.6 — switch to SEARCHING after 1s without face)
        this._lastFaceDetectedTime = 0;

        // Current face/hand stats for HUD
        this._faceLandmarkCount = 0;
        this._handCount = 0;

        // Hand mode state
        this._handsVisible = false;

        // Whether the app is currently running
        this._running = false;
    }

    // -------------------------------------------------------------------------
    // Initialisation (Req 1.1, 2.4, 2.5, 12.5)
    // -------------------------------------------------------------------------

    /**
     * Initialise all modules in the required order:
     *  1. Check WebGL 2.0
     *  2. Show loading screen
     *  3. Init SceneRenderer
     *  4. Load MediaPipe scripts (FaceMesh + Hands)
     *  5. Init FaceMesh + Hands
     *  6. Request camera permission
     *  7. Init Camera utility
     *  8. Hide loading screen
     *  9. Start loop
     */
    async init() {
        // Step 0 — HTTPS / localhost check (Req 12.2)
        // The inline <head> script already shows the error overlay, but we also
        // guard here so AppController does not proceed on insecure origins.
        if (
            location.protocol !== 'https:' &&
            location.hostname !== 'localhost' &&
            location.hostname !== '127.0.0.1'
        ) {
            this._showError(
                'Ứng dụng yêu cầu kết nối HTTPS để truy cập camera. Vui lòng mở qua HTTPS hoặc localhost.',
                false
            );
            return;
        }

        // Step 1 — WebGL 2.0 check (Req 12.5)
        const testCanvas = document.createElement('canvas');
        if (!testCanvas.getContext('webgl2')) {
            this._showError(
                'Trình duyệt của bạn không hỗ trợ WebGL 2.0. Vui lòng cập nhật Chrome lên phiên bản 90 trở lên.',
                false
            );
            return;
        }

        // Step 2 — Show loading screen (Req 2.4)
        this._setLoadingMessage('Đang khởi tạo...');
        this._setLoadingProgress(5);
        this._showLoading(true);

        // Initialise StateManager
        this._stateManager = new StateManager();

        // Step 3 — Init SceneRenderer
        try {
            const canvas = document.getElementById('canvas');
            this._sceneRenderer = new SceneRenderer(canvas);
            this._sceneRenderer.init();
        } catch (err) {
            this.handleError(err, 'scene-renderer');
            return;
        }

        // Initialise CoordinateMapper (depends on camera + renderer)
        this._coordinateMapper = new CoordinateMapper(
            this._sceneRenderer.camera,
            this._sceneRenderer.renderer
        );

        // Register resize callback so CoordinateMapper viewport stays in sync
        this._sceneRenderer.setResizeCallback(() => {
            // CoordinateMapper.computeViewport() reads from renderer/camera directly,
            // so no explicit action needed — just a hook for future extensions.
            if (this._particleSystem) {
                this._particleSystem.onResize();
            }
        });

        // Step 4 — Load MediaPipe (Req 2.1, 2.4, 2.5)
        this._setLoadingMessage('Đang tải MediaPipe...');
        this._setLoadingProgress(20);

        this._mediaPipeEngine = new MediaPipeEngine(
            (results, mirrorMode) => this.onFaceResults(results, mirrorMode),
            (results, mirrorMode) => this.onHandResults(results, mirrorMode),
            (msg, err) => this.handleError(err, 'mediapipe-load', msg)
        );

        try {
            // Step 5 — Init FaceMesh + Hands (Req 2.2, 2.3)
            this._setLoadingMessage('Đang khởi tạo FaceMesh...');
            this._setLoadingProgress(40);
            await this._mediaPipeEngine.load();
            this._setLoadingProgress(70);
        } catch (err) {
            // handleError already called by MediaPipeEngine's onError callback
            return;
        }

        // Step 6 — Request camera permission (Req 1.1, 1.2, 1.3)
        this._setLoadingMessage('Đang yêu cầu quyền truy cập camera...');
        this._setLoadingProgress(80);

        try {
            await this.requestCameraPermission();
        } catch (err) {
            // handleError already called inside requestCameraPermission
            return;
        }
        // Initialise ParticleSystem (depends on scene)
        this._particleSystem = new ParticleSystem(
            this._sceneRenderer.scene,
            this._stateManager.particleCount
        );
        this._particleSystem.init();
        this._particleSystem.setCamera(this._sceneRenderer.camera);
        this._particleSystem.setIntensityMode(this._stateManager.intensityMode);

        // Pass the hidden MediaPipe video element as the live texture source.
        // We do this after requestCameraPermission() so the element exists.
        const mediaPipeVid = document.getElementById('video-mediapipe');
        if (mediaPipeVid) {
            this._particleSystem.setVideoElement(mediaPipeVid);
        }

        // Initialise AdaptiveQualityManager
        this._adaptiveQualityManager = new AdaptiveQualityManager(
            this._particleSystem,
            this._stateManager
        );

        // Initialise HUD overlay
        const hudEl = document.getElementById('hud-overlay');
        this._hudOverlay = new HUDOverlay(hudEl);

        // Apply mirror mode to MediaPipe engine
        this._mediaPipeEngine.setMirrorMode(this._stateManager.mirrorMode);

        // Apply mirror mode CSS to video element
        this._applyMirrorCSS(this._stateManager.mirrorMode);

        // Step 7 — Init Camera utility (MediaPipe Camera Utils)
        this._setLoadingMessage('Đang khởi động camera...');
        this._setLoadingProgress(90);

        // _mediaPipeVideoElement is set in requestCameraPermission()
        // _videoElement kept for mirror CSS apply
        this._videoElement = document.getElementById('video');

        // Step 8 — Hide loading screen
        this._setLoadingProgress(100);
        this._showLoading(false);

        // Force a resize sync now that the canvas is fully laid out in the DOM
        this._sceneRenderer.onResize();

        // Step 9 — Start loop (if stateManager says we should be running)
        if (this._stateManager.isRunning) {
            this.start();
        }
    }

    // -------------------------------------------------------------------------
    // Camera permission (Req 1.1, 1.2, 1.3, 1.4)
    // -------------------------------------------------------------------------

    /**
     * Request webcam access via getUserMedia.
     * Handles NotAllowedError with a Vietnamese error message.
     * Listens for MediaStreamTrack.onended to detect disconnection.
     *
     * Uses two video elements:
     *  - #video          : visible display element (shows camera feed to user)
     *  - #video-mediapipe: hidden element fed to MediaPipe (avoids mirror-mode conflict)
     *
     * @throws {Error} Re-throws after calling handleError so init() can bail out.
     */
    async requestCameraPermission() {
        try {
            this._stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: false,
            });

            // Display video — visible to user (z-index: 1, behind canvas)
            const displayVideo = document.getElementById('video');
            displayVideo.srcObject = this._stream;
            displayVideo.style.display = 'block';

            // MediaPipe video — hidden, same stream, used for detection
            const mediaPipeVideo = document.getElementById('video-mediapipe');
            mediaPipeVideo.srcObject = this._stream;

            // Wait for both videos to have metadata
            await Promise.all([
                new Promise((resolve) => { displayVideo.onloadedmetadata = () => resolve(); }),
                new Promise((resolve) => { mediaPipeVideo.onloadedmetadata = () => resolve(); }),
            ]);

            // Start playback on both
            await displayVideo.play();
            await mediaPipeVideo.play();

            // Store reference to the MediaPipe video element
            this._mediaPipeVideoElement = mediaPipeVideo;

            // Detect camera disconnection (Req 1.4)
            const tracks = this._stream.getVideoTracks();
            if (tracks.length > 0) {
                tracks[0].onended = () => {
                    this.handleError(
                        new Error('Camera track ended'),
                        'camera-disconnect'
                    );
                };
            }
        } catch (err) {
            let message;
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                // Req 1.3
                message = 'Bạn đã từ chối quyền truy cập camera. Vào Settings > Privacy > Camera để cấp quyền lại.';
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                message = 'Không tìm thấy camera. Vui lòng kiểm tra thiết bị và thử lại.';
            } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                message = 'Camera đang được sử dụng bởi ứng dụng khác. Vui lòng đóng ứng dụng đó và thử lại.';
            } else {
                message = `Không thể truy cập camera: ${err.message}`;
            }
            this.handleError(err, 'camera-permission', message);
            throw err;
        }
    }

    // -------------------------------------------------------------------------
    // MediaPipe result callbacks
    // -------------------------------------------------------------------------

    /**
     * Called by MediaPipeEngine when FaceMesh produces results.
     * Extracts 468 landmarks, maps to world space, updates ParticleSystem.
     * Updates tracking status timer (Req 3.3, 9.5, 9.6).
     *
     * @param {Object}  results     MediaPipe FaceMesh results object
     * @param {boolean} mirrorMode  Current mirror mode state
     */
    onFaceResults(results, mirrorMode) {
        if (!this._particleSystem || !this._coordinateMapper) return;

        const multiFaceLandmarks = results.multiFaceLandmarks;
        if (multiFaceLandmarks && multiFaceLandmarks.length > 0) {
            const landmarks = multiFaceLandmarks[0]; // maxNumFaces: 1

            // Map 468 landmarks → world-space Float32Array, feed to particle system
            const worldPositions = this._coordinateMapper.mapFaceLandmarks(
                landmarks, mirrorMode
            );
            this._particleSystem.updateFromFace(worldPositions);

            this._faceLandmarkCount = landmarks.length; // 468
            this._lastFaceDetectedTime = performance.now();
        } else {
            this._faceLandmarkCount = 0;
        }
    }

    /**
     * Called by MediaPipeEngine when Hands produces results.
     * Extracts hand landmarks, computes palm centers, midpoint, distance, scale.
     * Calls particleSystem.updateFromHands() (Req 4.4, 4.5).
     *
     * @param {Object}  results     MediaPipe Hands results object
     * @param {boolean} mirrorMode  Current mirror mode state
     */
    onHandResults(results, mirrorMode) {
        if (!this._particleSystem) return;

        const multiHandLandmarks = results.multiHandLandmarks || [];
        const handCount = multiHandLandmarks.length;
        this._handCount = handCount;

        // ── Only activate when EXACTLY 2 hands are detected ──────────────────
        if (handCount !== 2) {
            this._handsVisible = false;
            this._particleSystem.updateHandBox(null);
            return;
        }

        // ── Compute hand box from thumb tip (lm[4]) + index tip (lm[8]) ──────
        const hand0 = multiHandLandmarks[0];
        const hand1 = multiHandLandmarks[1];

        const box = this._computeHandBox(
            [hand0[4], hand0[8], hand1[4], hand1[8]],
            mirrorMode
        );

        // ── Update AR brackets + scatter fallback particles ───────────────────
        this._particleSystem.updateHandBox(box);
        this._handsVisible = true;
    }

    // -------------------------------------------------------------------------
    // Lifecycle: start / stop / reset
    // -------------------------------------------------------------------------

    /**
     * Start the render loop and MediaPipe detection scheduling.
     */
    start() {
        if (this._running) return;
        this._running = true;
        this._stateManager.isRunning = true;

        // Start Three.js render loop with per-frame callback
        this._sceneRenderer.startRenderLoop((deltaTime) => {
            this._onFrame(deltaTime);
        });

        // Start MediaPipe detection loop — use hidden video element
        if (this._mediaPipeEngine && this._mediaPipeVideoElement) {
            this._mediaPipeEngine.start(this._mediaPipeVideoElement);
        }
    }

    /**
     * Stop the render loop and MediaPipe detection scheduling.
     */
    stop() {
        if (!this._running) return;
        this._running = false;
        this._stateManager.isRunning = false;

        this._sceneRenderer.stopRenderLoop();

        if (this._mediaPipeEngine) {
            this._mediaPipeEngine.stop();
        }
    }

    /**
     * Reset the particle cloud to its default position and scale (Req 11.3).
     */
    reset() {
        if (this._particleSystem) {
            this._particleSystem.reset();
        }
    }

    // -------------------------------------------------------------------------
    // Error handling (Req 1.3, 1.4, 2.5, 12.5)
    // -------------------------------------------------------------------------

    /**
     * Display an error overlay with a Vietnamese message.
     * Stops the render loop for non-recoverable errors.
     *
     * Error categories (from design.md):
     *   camera-permission   → NotAllowedError
     *   camera-disconnect   → MediaStreamTrack.onended
     *   mediapipe-load      → CDN script load failure
     *   scene-renderer      → WebGL / Three.js init failure
     *   webgl               → WebGL 2.0 not supported
     *   https               → Not HTTPS / localhost
     *
     * @param {Error}   error    The original error object
     * @param {string}  context  Error category key
     * @param {string}  [customMessage]  Override message (already localised)
     */
    handleError(error, context, customMessage) {
        const messages = {
            'camera-permission':
                'Bạn đã từ chối quyền truy cập camera. Vào Settings > Privacy > Camera để cấp quyền lại.',
            'camera-disconnect':
                'Camera bị ngắt kết nối. Vui lòng kiểm tra lại thiết bị.',
            'mediapipe-load':
                'Không thể tải MediaPipe. Vui lòng kiểm tra kết nối mạng và tải lại trang.',
            'scene-renderer':
                'Không thể khởi tạo WebGL renderer. Vui lòng tải lại trang.',
            'webgl':
                'Trình duyệt của bạn không hỗ trợ WebGL 2.0. Vui lòng cập nhật Chrome lên phiên bản 90 trở lên.',
            'https':
                'Ứng dụng yêu cầu kết nối HTTPS để truy cập camera.',
        };

        const message = customMessage || messages[context] || `Đã xảy ra lỗi: ${error ? error.message : context}`;

        // Recoverable errors: camera-disconnect (user can reconnect)
        const recoverable = context === 'camera-disconnect';

        console.error(`[AppController] Error (${context}):`, error);

        this._showError(message, recoverable);

        // Stop the loop for non-recoverable errors
        if (!recoverable) {
            this.stop();
        }
    }

    // -------------------------------------------------------------------------
    // Public accessors (used by ui.js)
    // -------------------------------------------------------------------------

    get stateManager() { return this._stateManager; }
    get particleSystem() { return this._particleSystem; }
    get adaptiveQualityManager() { return this._adaptiveQualityManager; }
    get mediaPipeEngine() { return this._mediaPipeEngine; }
    get isRunning() { return this._running; }

    // -------------------------------------------------------------------------
    // Per-frame update (wired into SceneRenderer.startRenderLoop)
    // -------------------------------------------------------------------------

    /**
     * Called every animation frame by SceneRenderer.
     * Runs particle updates, adaptive quality, and HUD refresh.
     *
     * @param {number} deltaTime  Elapsed time since last frame, in seconds
     * @private
     */
    _onFrame(deltaTime) {
        // Guard: clamp deltaTime to avoid huge jumps after tab switch
        const dt = Math.min(deltaTime, 0.1);

        // --- FPS calculation ---
        this._fpsFrameCount++;
        this._fpsAccumulator += dt;
        if (this._fpsAccumulator >= 0.5) {
            this._currentFPS = this._fpsFrameCount / this._fpsAccumulator;
            this._fpsFrameCount = 0;
            this._fpsAccumulator = 0;
        }

        if (!this._particleSystem) return;

        // --- Upload latest webcam frame to GPU ---
        this._particleSystem.updateVideoTexture();

        // --- Advance shader time uniform (GPU fluid jitter) ---
        this._particleSystem.tick(dt);

        // --- Color animation (always runs so colors stay alive) ---
        this._particleSystem.updateColors(dt);

        // --- Adaptive quality (Req 10.4, 10.4a) ---
        if (this._adaptiveQualityManager) {
            this._adaptiveQualityManager.update(this._currentFPS, dt);
        }

        // --- HUD update ---
        if (this._hudOverlay) {
            const now = performance.now();
            const timeSinceLastFace = (now - this._lastFaceDetectedTime) / 1000;
            const trackingStatus = timeSinceLastFace < 1.0 ? 'TRACKING' : 'SEARCHING';

            this._hudOverlay.update({
                fps: this._currentFPS,
                faceLandmarkCount: this._faceLandmarkCount,
                handCount: this._handCount,
                particleCount: this._particleSystem.currentCount,
                trackingStatus,
                faceBBox: null, // face bounding box disabled in current UX
            });
        }
    }

    // -------------------------------------------------------------------------
    // Hand region box (AR targeting frame)
    // -------------------------------------------------------------------------

    /**
     * Compute the bounding box (screen pixels) of thumb tips + index tips.
     * Each point is a MediaPipe normalized landmark { x, y } in [0, 1].
     *
     * @param {Array<{x:number, y:number}>} tipPoints  Array of landmark objects
     * @param {boolean} mirrorMode
     * @returns {{ left: number, top: number, width: number, height: number }}
     * @private
     */
    _computeHandBox(tipPoints, mirrorMode) {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const PADDING = 24; // px padding around the tight bounding box

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const p of tipPoints) {
            const sx = mirrorMode ? (1 - p.x) * W : p.x * W;
            const sy = p.y * H;
            if (sx < minX) minX = sx;
            if (sx > maxX) maxX = sx;
            if (sy < minY) minY = sy;
            if (sy > maxY) maxY = sy;
        }

        const left = minX - PADDING;
        const top = minY - PADDING;
        const right = maxX + PADDING;
        const bottom = maxY + PADDING;

        return {
            left,
            top,
            right,
            bottom,
            width: right - left,
            height: bottom - top,
            centerX: (left + right) / 2,
            centerY: (top + bottom) / 2,
        };
    }

    // -------------------------------------------------------------------------
    // Mirror mode (Req 11.5)
    // -------------------------------------------------------------------------

    /**
     * Apply or remove the CSS horizontal flip on the display video element only.
     * The MediaPipe video element (#video-mediapipe) is never flipped so
     * landmark coordinates remain consistent regardless of mirror mode.
     * @param {boolean} enabled
     */
    _applyMirrorCSS(enabled) {
        const video = document.getElementById('video');
        if (video) {
            video.style.transform = enabled ? 'scaleX(-1)' : '';
        }
        // Truyền trạng thái lật cho Shader
        if (this._particleSystem) {
            this._particleSystem.setMirrorMode(enabled);
        }
    }

    // -------------------------------------------------------------------------
    // Camera Utils initialisation
    // -------------------------------------------------------------------------

    /**
     * Initialise the MediaPipe Camera utility to feed frames from the video
     * element into the detection pipeline.
     *
     * MediaPipe Camera Utils handles the getUserMedia stream internally when
     * using the Camera class. Since we already have the stream from
     * requestCameraPermission(), we assign it to the video element and let
     * MediaPipeEngine.start() drive detection via requestIdleCallback.
     *
     * @private
     */
    _initCameraUtils() {
        // The video element already has the stream assigned in requestCameraPermission().
        // MediaPipeEngine.start(videoElement) will feed frames via requestIdleCallback.
        // No additional Camera utility setup is required for this architecture.
        //
        // If MediaPipe Camera Utils (Camera class) is needed in the future, it can be
        // initialised here with:
        //   const camera = new Camera(this._videoElement, { onFrame: async () => { ... } });
        //   camera.start();
        //
        // For now, the video element is ready and MediaPipeEngine.start() will be
        // called from start().
    }

    // -------------------------------------------------------------------------
    // Loading screen helpers
    // -------------------------------------------------------------------------

    /**
     * Show or hide the loading overlay.
     * @param {boolean} visible
     * @private
     */
    _showLoading(visible) {
        const el = document.getElementById('loading-overlay');
        if (el) {
            el.style.display = visible ? 'flex' : 'none';
        }
    }

    /**
     * Update the loading message text.
     * @param {string} message
     * @private
     */
    _setLoadingMessage(message) {
        const el = document.getElementById('loading-message');
        if (el) el.textContent = message;
    }

    /**
     * Update the loading progress bar (0–100).
     * @param {number} percent
     * @private
     */
    _setLoadingProgress(percent) {
        const fill = document.getElementById('loading-fill');
        const bar = document.getElementById('loading-bar');
        if (fill) fill.style.width = `${percent}%`;
        if (bar) bar.setAttribute('aria-valuenow', String(percent));
    }

    // -------------------------------------------------------------------------
    // Error overlay helpers
    // -------------------------------------------------------------------------

    /**
     * Show the error overlay with a message.
     * @param {string}  message      Vietnamese error message
     * @param {boolean} recoverable  Whether to show the retry button
     * @private
     */
    _showError(message, recoverable) {
        // Hide loading screen first
        this._showLoading(false);

        const overlay = document.getElementById('error-overlay');
        const msgEl = document.getElementById('error-message');
        const retryBtn = document.getElementById('retry-btn');

        if (msgEl) msgEl.textContent = message;
        if (retryBtn) retryBtn.style.display = recoverable ? 'block' : 'none';
        if (overlay) overlay.style.display = 'flex';

        // Wire retry button to reload the page
        if (recoverable && retryBtn) {
            retryBtn.onclick = () => window.location.reload();
        }
    }
}

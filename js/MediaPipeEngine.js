// js/MediaPipeEngine.js
// Feature: webcam-particle-face-ar
// Wrapper for MediaPipe FaceMesh and Hands with alternate-frame scheduling.
// Implemented in Task 8.
// References: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 4.1, 4.6, 10.5

class MediaPipeEngine {
    /**
     * @param {function} onFaceResults - Callback invoked with FaceMesh results
     * @param {function} onHandResults - Callback invoked with Hands results
     * @param {function} [onError]     - Optional callback invoked with Vietnamese error message on load failure
     */
    constructor(onFaceResults, onHandResults, onError) {
        this._onFaceResults = onFaceResults;
        this._onHandResults = onHandResults;
        this._onError = onError || null;

        this.faceMesh = null;
        this.hands = null;

        // Alternate-frame scheduling state
        this.frameCount = 0;

        // Mirror mode state — passed into result callbacks
        this.mirrorMode = false;

        // Whether detection loop is active
        this._running = false;

        // Idle callback handle (for cancellation)
        this._idleCallbackId = null;
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    /**
     * Load and initialise both MediaPipe models.
     * Requirement 2.1, 2.2, 2.3
     */
    async load() {
        try {
            await this.initFaceMesh();
            await this.initHands();
        } catch (err) {
            const msg = 'Không thể tải MediaPipe. Vui lòng kiểm tra kết nối mạng và tải lại trang.';
            if (this._onError) {
                this._onError(msg, err);
            } else {
                console.error('[MediaPipeEngine] load() failed:', err);
            }
            throw err;
        }
    }

    /**
     * Initialise FaceMesh with required config.
     * Requirement 2.2 — maxNumFaces:1, refineLandmarks:true
     */
    async initFaceMesh() {
        return new Promise((resolve, reject) => {
            // Guard: FaceMesh must be available from CDN
            if (typeof FaceMesh === 'undefined') {
                reject(new Error('FaceMesh is not defined — CDN script may have failed to load.'));
                return;
            }

            const faceMesh = new FaceMesh({
                locateFile: (file) =>
                    `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
            });

            faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5,
            });

            faceMesh.onResults((results) => {
                this._onFaceResults(results, this.mirrorMode);
            });

            // initialize() triggers WASM loading; resolve when ready
            faceMesh.initialize()
                .then(() => {
                    this.faceMesh = faceMesh;
                    resolve();
                })
                .catch((err) => {
                    reject(err);
                });
        });
    }

    /**
     * Initialise Hands with required config.
     * Requirement 2.3 — maxNumHands:2
     */
    async initHands() {
        return new Promise((resolve, reject) => {
            // Guard: Hands must be available from CDN
            if (typeof Hands === 'undefined') {
                reject(new Error('Hands is not defined — CDN script may have failed to load.'));
                return;
            }

            const hands = new Hands({
                locateFile: (file) =>
                    `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`,
            });

            hands.setOptions({
                maxNumHands: 2,
                modelComplexity: 1,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5,
            });

            hands.onResults((results) => {
                this._onHandResults(results, this.mirrorMode);
            });

            hands.initialize()
                .then(() => {
                    this.hands = hands;
                    resolve();
                })
                .catch((err) => {
                    reject(err);
                });
        });
    }

    /**
     * Schedule alternate-frame detection using requestIdleCallback.
     * Odd frames  → FaceMesh.send()  (frame lẻ → face)
     * Even frames → Hands.send()     (frame chẵn → hands)
     * Requirement 10.5
     *
     * @param {HTMLVideoElement} videoElement
     */
    scheduleDetection(videoElement) {
        if (!this._running) return;

        this._idleCallbackId = requestIdleCallback(
            async () => {
                if (!this._running) return;

                // Skip if video has no valid dimensions yet
                if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
                    this.frameCount++;
                    this.scheduleDetection(videoElement);
                    return;
                }

                try {
                    if (this.frameCount % 2 !== 0) {
                        // Odd frame → FaceMesh (Req 3.1, 3.2)
                        if (this.faceMesh) {
                            await this.faceMesh.send({ image: videoElement });
                        }
                    } else {
                        // Even frame → Hands (Req 4.1)
                        if (this.hands) {
                            await this.hands.send({ image: videoElement });
                        }
                    }
                } catch (err) {
                    // If Hands crashes with ROI/memory error, reinitialize it
                    if (err && err.message && (
                        err.message.includes('memory access out of bounds') ||
                        err.message.includes('Aborted')
                    ) && this.frameCount % 2 === 0) {
                        console.warn('[MediaPipeEngine] Hands crashed, reinitializing...');
                        this.hands = null;
                        try {
                            await this.initHands();
                        } catch (reinitErr) {
                            console.error('[MediaPipeEngine] Hands reinit failed:', reinitErr);
                        }
                    } else {
                        console.warn('[MediaPipeEngine] send() error:', err);
                    }
                }

                this.frameCount++;

                // Reschedule for next frame
                this.scheduleDetection(videoElement);
            },
            { timeout: 16 }
        );
    }

    /**
     * Start the detection loop.
     * @param {HTMLVideoElement} videoElement
     */
    start(videoElement) {
        if (this._running) return;
        this._running = true;
        this.frameCount = 0;
        this.scheduleDetection(videoElement);
    }

    /**
     * Stop the detection loop.
     */
    stop() {
        this._running = false;
        if (this._idleCallbackId !== null) {
            cancelIdleCallback(this._idleCallbackId);
            this._idleCallbackId = null;
        }
    }

    /**
     * Update mirror mode state.
     * The value is forwarded to result callbacks so CoordinateMapper can flip X.
     * Requirement 11.5
     *
     * @param {boolean} enabled
     */
    setMirrorMode(enabled) {
        this.mirrorMode = !!enabled;
    }
}

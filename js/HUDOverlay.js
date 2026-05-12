// js/HUDOverlay.js
// Feature: webcam-particle-face-ar
// HUD overlay: FPS counter, tracking status, neon frame, face bounding box.
// Implemented in Task 9.

class HUDOverlay {
    /**
     * @param {HTMLElement} overlayElement - The #hud-overlay container element
     */
    constructor(overlayElement) {
        this._overlay = overlayElement;

        // Cache DOM references
        this._fpsEl = document.getElementById('fps');
        this._landmarkEl = document.getElementById('landmark-count');
        this._trackingEl = document.getElementById('tracking-status');
        this._handEl = document.getElementById('hand-count');
        this._particleEl = document.getElementById('particle-count');
        this._neonFrame = document.getElementById('neon-frame');
        this._faceBBox = document.getElementById('face-bbox');

        // FPS throttle state (Req 9.1 — update every 500ms)
        this._lastFPSUpdate = 0;

        // Tracking status timeout (Req 9.6 — switch to SEARCHING after 1 second without face)
        this._lastFaceTime = 0;          // timestamp of last face detection
        this._searchingTimer = null;       // setTimeout handle
        this._isTracking = false;

        // Start neon pulse immediately
        this.startNeonPulse();
    }

    // ─────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────

    /**
     * Master update — called every frame (or on demand) with a stats object.
     * @param {{ fps: number, faceLandmarkCount: number, handCount: number,
     *           particleCount: number, trackingStatus: string,
     *           faceBBox: {x:number, y:number, width:number, height:number}|null }} stats
     */
    update(stats) {
        if (stats.fps !== undefined) this.updateFPS(stats.fps);
        if (stats.faceLandmarkCount !== undefined) this.updateFaceLandmarkCount(stats.faceLandmarkCount);
        if (stats.handCount !== undefined) this.updateHandCount(stats.handCount);
        if (stats.particleCount !== undefined) this.updateParticleCount(stats.particleCount);
        if (stats.trackingStatus !== undefined) this.updateTrackingStatus(stats.trackingStatus);
        if (stats.faceBBox !== undefined) this.updateFaceBoundingBox(stats.faceBBox);
    }

    /**
     * Update FPS display — throttled to once per 500ms (Req 9.1).
     * @param {number} fps
     */
    updateFPS(fps) {
        const now = performance.now();
        if (now - this._lastFPSUpdate < 500) return;
        this._lastFPSUpdate = now;

        if (this._fpsEl) {
            this._fpsEl.textContent = `FPS: ${Math.round(fps)}`;
        }
    }

    /**
     * Update face landmark count display — top-right corner (Req 9.2).
     * @param {number} count - 0 or 468
     */
    updateFaceLandmarkCount(count) {
        if (this._landmarkEl) {
            this._landmarkEl.textContent = `Landmarks: ${count}`;
        }
    }

    /**
     * Update hand count display — bottom-left corner (Req 9.3).
     * @param {number} count - 0, 1, or 2
     */
    updateHandCount(count) {
        if (this._handEl) {
            this._handEl.textContent = `Hands: ${count}`;
        }
    }

    /**
     * Update particle count display — bottom-right corner (Req 9.4).
     * @param {number} count
     */
    updateParticleCount(count) {
        if (this._particleEl) {
            this._particleEl.textContent = `Particles: ${count}`;
        }
    }

    /**
     * Update tracking status indicator (Req 9.5, 9.6).
     *
     * Call with status = "TRACKING" when a face is detected.
     * Call with status = "SEARCHING" when no face is detected.
     *
     * Internally, the indicator switches to "SEARCHING" automatically
     * after 1 second without receiving a "TRACKING" call.
     *
     * @param {"TRACKING"|"SEARCHING"} status
     */
    updateTrackingStatus(status) {
        if (status === 'TRACKING') {
            // Record the time of the last face detection
            this._lastFaceTime = performance.now();

            // Clear any pending SEARCHING timer
            if (this._searchingTimer !== null) {
                clearTimeout(this._searchingTimer);
                this._searchingTimer = null;
            }

            // Only update DOM if we weren't already tracking
            if (!this._isTracking) {
                this._isTracking = true;
                this._setTrackingDOM(true);
            }

            // Schedule a fallback to SEARCHING after 1 second of silence
            this._searchingTimer = setTimeout(() => {
                this._searchingTimer = null;
                this._isTracking = false;
                this._setTrackingDOM(false);
            }, 1000);

        } else {
            // Explicit SEARCHING request — cancel timer and update immediately
            if (this._searchingTimer !== null) {
                clearTimeout(this._searchingTimer);
                this._searchingTimer = null;
            }
            if (this._isTracking) {
                this._isTracking = false;
                this._setTrackingDOM(false);
            }
        }
    }

    /**
     * Update face bounding box overlay (Req 8.4).
     * Draws a neon purple (#FF00FF) border around the detected face region
     * using CSS absolute positioning on the #face-bbox element.
     *
     * @param {{ x: number, y: number, width: number, height: number }|null} bbox
     *   Screen-pixel coordinates. Pass null to hide the bounding box.
     */
    updateFaceBoundingBox(bbox) {
        if (!this._faceBBox) return;

        if (!bbox || bbox.width <= 0 || bbox.height <= 0) {
            this._faceBBox.style.display = 'none';
            return;
        }

        this._faceBBox.style.left = `${bbox.x}px`;
        this._faceBBox.style.top = `${bbox.y}px`;
        this._faceBBox.style.width = `${bbox.width}px`;
        this._faceBBox.style.height = `${bbox.height}px`;
        this._faceBBox.style.display = 'block';
    }

    /**
     * Activate the neon pulse CSS animation on the neon frame (Req 8.1, 8.2, 8.3).
     * The animation is defined in style.css as `neonPulse` (3s, opacity 0.6→1.0).
     * Calling this method ensures the animation is running.
     */
    startNeonPulse() {
        if (!this._neonFrame) return;

        // The CSS already defines the animation; ensure it is applied.
        // If the element somehow lost the animation (e.g. class was removed), re-apply.
        const computed = window.getComputedStyle(this._neonFrame);
        if (!computed.animationName || computed.animationName === 'none') {
            this._neonFrame.style.animation = 'neonPulse 3s ease-in-out infinite';
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────

    /**
     * Update the tracking status DOM element.
     * @param {boolean} tracking - true = TRACKING (green), false = SEARCHING (yellow)
     */
    _setTrackingDOM(tracking) {
        if (!this._trackingEl) return;

        if (tracking) {
            this._trackingEl.textContent = 'TRACKING';
            this._trackingEl.style.color = '#00FF00';
            this._trackingEl.classList.add('tracking');
            this._trackingEl.classList.remove('searching');
        } else {
            this._trackingEl.textContent = 'SEARCHING';
            this._trackingEl.style.color = '#FFFF00';
            this._trackingEl.classList.add('searching');
            this._trackingEl.classList.remove('tracking');
        }
    }
}

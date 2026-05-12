// js/AdaptiveQualityManager.js
// Feature: webcam-particle-face-ar
// FPS monitoring and automatic particle count adjustment for performance.
// Implemented in Task 7.
// Requirements: 10.4, 10.4a

class AdaptiveQualityManager {
    /**
     * @param {ParticleSystem} particleSystem  Has setParticleCount(count) and currentCount getter
     * @param {StateManager}   stateManager    Has particleCount getter (user-set target)
     */
    constructor(particleSystem, stateManager) {
        this._particleSystem = particleSystem;
        this._stateManager = stateManager;

        // Timers (in seconds)
        this._lowFPSTimer = 0;   // Accumulated seconds with FPS < 45
        this._highFPSTimer = 0;  // Accumulated seconds with FPS > 55
        this._restoreTimer = 0;  // Seconds since last particle count increase

        // targetCount: the user-set particle count — kept separately so we know
        // what to restore to after an adaptive reduction.
        this._targetCount = stateManager.particleCount;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Called every frame. Accumulates FPS timers and triggers adaptive adjustments.
     *
     * @param {number} currentFPS  Current frames-per-second
     * @param {number} deltaTime   Elapsed time since last frame, in seconds
     */
    update(currentFPS, deltaTime) {
        // Sync targetCount with stateManager in case the user changed it via the slider
        this._targetCount = this._stateManager.particleCount;

        // --- Low FPS path (Requirement 10.4) ---
        if (currentFPS < CONSTANTS.LOW_FPS_THRESHOLD) {
            this._lowFPSTimer += deltaTime;
            this._highFPSTimer = 0; // reset high-FPS timer when FPS is low
        } else {
            this._lowFPSTimer = 0;  // reset when FPS exits the low threshold
        }

        // --- High FPS path (Requirement 10.4a) ---
        if (currentFPS > CONSTANTS.HIGH_FPS_THRESHOLD) {
            this._highFPSTimer += deltaTime;
            this._restoreTimer += deltaTime;
        } else {
            this._highFPSTimer = 0; // reset when FPS exits the high threshold
            this._restoreTimer = 0;
        }

        // --- Trigger: sustained low FPS for >= 3 seconds ---
        if (this._lowFPSTimer >= CONSTANTS.LOW_FPS_DURATION) {
            const current = this._particleSystem.currentCount;
            const reduced = Math.max(CONSTANTS.MIN_PARTICLES, Math.round(current * 0.5));
            this._particleSystem.setParticleCount(reduced);
            this._lowFPSTimer = 0;
        }

        // --- Trigger: sustained high FPS for >= 5 seconds, then increase 10% every 2s ---
        if (this._highFPSTimer >= CONSTANTS.HIGH_FPS_DURATION) {
            if (this._restoreTimer >= CONSTANTS.RESTORE_INTERVAL) {
                const current = this._particleSystem.currentCount;
                if (current < this._targetCount) {
                    const increased = Math.min(
                        this._targetCount,
                        Math.round(current * (1 + CONSTANTS.RESTORE_STEP))
                    );
                    this._particleSystem.setParticleCount(increased);
                }
                this._restoreTimer = 0;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Getters / Setters
    // -------------------------------------------------------------------------

    /** The user-set target particle count. Updated from stateManager each frame. */
    get targetCount() {
        return this._targetCount;
    }

    set targetCount(v) {
        this._targetCount = Math.max(
            CONSTANTS.MIN_PARTICLES,
            Math.min(CONSTANTS.MAX_PARTICLES, Math.round(Number(v)))
        );
    }

    // Expose timers for testing
    get lowFPSTimer() { return this._lowFPSTimer; }
    get highFPSTimer() { return this._highFPSTimer; }
    get restoreTimer() { return this._restoreTimer; }
}

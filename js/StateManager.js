// js/StateManager.js
// Feature: webcam-particle-face-ar
// Manages user-configurable application state with localStorage persistence.
// Implemented in Task 2.

class StateManager {
    static STORAGE_KEY = 'webcam-particle-ar-state';

    static DEFAULTS = {
        particleCount: 2000,
        intensityMode: false,
        mirrorMode: false,
        isRunning: true,
    };

    constructor() {
        // Internal state, initialised to defaults before loading
        this._particleCount = StateManager.DEFAULTS.particleCount;
        this._intensityMode = StateManager.DEFAULTS.intensityMode;
        this._mirrorMode = StateManager.DEFAULTS.mirrorMode;
        this._isRunning = StateManager.DEFAULTS.isRunning;

        this.load();
    }

    // -------------------------------------------------------------------------
    // Persistence
    // -------------------------------------------------------------------------

    /** Read state from localStorage, validate each field, fall back to defaults. */
    load() {
        try {
            const raw = localStorage.getItem(StateManager.STORAGE_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw);

            // particleCount — must be a finite number within [MIN, MAX]
            const minP = (typeof CONSTANTS !== 'undefined') ? CONSTANTS.MIN_PARTICLES : 500;
            const maxP = (typeof CONSTANTS !== 'undefined') ? CONSTANTS.MAX_PARTICLES : 5000;

            if (typeof parsed.particleCount === 'number' && isFinite(parsed.particleCount)) {
                this._particleCount = Math.min(maxP, Math.max(minP, Math.round(parsed.particleCount)));
            }

            // Boolean fields
            if (typeof parsed.intensityMode === 'boolean') {
                this._intensityMode = parsed.intensityMode;
            }
            if (typeof parsed.mirrorMode === 'boolean') {
                this._mirrorMode = parsed.mirrorMode;
            }
            if (typeof parsed.isRunning === 'boolean') {
                this._isRunning = parsed.isRunning;
            }
        } catch (e) {
            // Corrupted data — silently fall back to defaults already set in constructor
            console.warn('[StateManager] Failed to load state from localStorage:', e);
        }
    }

    /** Persist current state to localStorage. */
    save() {
        try {
            const state = {
                particleCount: this._particleCount,
                intensityMode: this._intensityMode,
                mirrorMode: this._mirrorMode,
                isRunning: this._isRunning,
            };
            localStorage.setItem(StateManager.STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn('[StateManager] Failed to save state to localStorage:', e);
        }
    }

    // -------------------------------------------------------------------------
    // Getters / Setters
    // -------------------------------------------------------------------------

    /** Number of particles. Clamped to [MIN_PARTICLES, MAX_PARTICLES]. Default: 2000. */
    get particleCount() {
        return this._particleCount;
    }

    set particleCount(v) {
        const minP = (typeof CONSTANTS !== 'undefined') ? CONSTANTS.MIN_PARTICLES : 500;
        const maxP = (typeof CONSTANTS !== 'undefined') ? CONSTANTS.MAX_PARTICLES : 5000;
        const clamped = Math.min(maxP, Math.max(minP, Math.round(Number(v))));
        this._particleCount = isFinite(clamped) ? clamped : StateManager.DEFAULTS.particleCount;
        this.save();
    }

    /** Whether intensity (brightness) mode is active. Default: false. */
    get intensityMode() {
        return this._intensityMode;
    }

    set intensityMode(v) {
        this._intensityMode = Boolean(v);
        this.save();
    }

    /** Whether the video feed is horizontally mirrored. Default: false. */
    get mirrorMode() {
        return this._mirrorMode;
    }

    set mirrorMode(v) {
        this._mirrorMode = Boolean(v);
        this.save();
    }

    /** Whether the AR experience is currently running. Default: true. */
    get isRunning() {
        return this._isRunning;
    }

    set isRunning(v) {
        this._isRunning = Boolean(v);
        this.save();
    }
}

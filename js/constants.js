// js/constants.js
// Feature: webcam-particle-face-ar
// Global constants shared across all modules.

const CONSTANTS = {
    // Depth mapping
    DEPTH_SCALE: 50,

    // Particle count
    DEFAULT_PARTICLE_COUNT: 2000,
    MIN_PARTICLES: 500,
    MAX_PARTICLES: 5000,

    // Lerp factors
    LERP_POSITION: 0.1,
    LERP_SCALE: 0.08,
    LERP_BACK: 0.01,

    // Jitter / noise
    JITTER_RADIUS_NORMALIZED: 0.02,

    // Hand distance range (normalized)
    HAND_DIST_MIN: 0.05,
    HAND_DIST_MAX: 0.8,

    // Scale range
    SCALE_MIN: 0.3,
    SCALE_MAX: 3.0,

    // Camera settings
    CAMERA_FOV: 75,
    CAMERA_Z: 100,
    CAMERA_NEAR: 0.1,
    CAMERA_FAR: 1000,

    // Adaptive quality thresholds
    LOW_FPS_THRESHOLD: 45,
    HIGH_FPS_THRESHOLD: 55,
    LOW_FPS_DURATION: 3,
    HIGH_FPS_DURATION: 5,
    RESTORE_INTERVAL: 2,
    RESTORE_STEP: 0.1,
};

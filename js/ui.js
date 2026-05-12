// js/ui.js
// Feature: webcam-particle-face-ar
// UI event handlers: Start/Stop, particle slider, Reset, Intensity Mode, Mirror Mode.
// Restores UI state from StateManager on page load.
// Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6

/**
 * Initialise all UI controls and wire them to the application modules.
 *
 * Must be called after AppController.init() has completed so that
 * appController.stateManager, appController.particleSystem, and
 * appController.adaptiveQualityManager are all available.
 *
 * @param {AppController} appController  The fully-initialised app controller
 */
function initUI(appController) {
    const stateManager = appController.stateManager;
    const particleSystem = appController.particleSystem;
    const adaptiveQualityManager = appController.adaptiveQualityManager;

    // -------------------------------------------------------------------------
    // DOM references
    // -------------------------------------------------------------------------
    const startStopBtn = document.getElementById('start-stop-btn');
    const particleSlider = document.getElementById('particle-slider');
    const particleSliderVal = document.getElementById('particle-slider-value');
    const resetBtn = document.getElementById('reset-btn');
    const intensityToggle = document.getElementById('intensity-toggle');
    const mirrorToggle = document.getElementById('mirror-toggle');
    const videoEl = document.getElementById('video');
    const modeParticleBtn = document.getElementById('mode-particle-btn');
    const modeHudBtn = document.getElementById('mode-hud-btn');

    // -------------------------------------------------------------------------
    // Mode selector
    // -------------------------------------------------------------------------
    function setMode(mode) {
        appController.setArMode(mode);
        if (mode === 'particle') {
            modeParticleBtn.classList.add('btn-mode-active');
            modeHudBtn.classList.remove('btn-mode-active');
            modeParticleBtn.setAttribute('aria-pressed', 'true');
            modeHudBtn.setAttribute('aria-pressed', 'false');
        } else {
            modeHudBtn.classList.add('btn-mode-active');
            modeParticleBtn.classList.remove('btn-mode-active');
            modeHudBtn.setAttribute('aria-pressed', 'true');
            modeParticleBtn.setAttribute('aria-pressed', 'false');
        }
    }

    if (modeParticleBtn) modeParticleBtn.addEventListener('click', () => setMode('particle'));
    if (modeHudBtn) modeHudBtn.addEventListener('click', () => setMode('hud'));

    // -------------------------------------------------------------------------
    // Restore UI state from StateManager (Req 11.6)
    // -------------------------------------------------------------------------

    // Start/Stop button label
    _syncStartStopLabel(startStopBtn, appController.isRunning);

    // Particle slider
    particleSlider.value = stateManager.particleCount;
    particleSliderVal.textContent = stateManager.particleCount;

    // Intensity Mode toggle
    intensityToggle.checked = stateManager.intensityMode;

    // Mirror Mode toggle + CSS transform on video element
    mirrorToggle.checked = stateManager.mirrorMode;
    _applyMirrorCSS(videoEl, stateManager.mirrorMode);

    // -------------------------------------------------------------------------
    // Start / Stop (Req 11.1)
    // -------------------------------------------------------------------------
    startStopBtn.addEventListener('click', () => {
        if (appController.isRunning) {
            appController.stop();
            stateManager.isRunning = false;
            _syncStartStopLabel(startStopBtn, false);
        } else {
            appController.start();
            stateManager.isRunning = true;
            _syncStartStopLabel(startStopBtn, true);
        }
    });

    // -------------------------------------------------------------------------
    // Particle count slider (Req 11.2)
    // -------------------------------------------------------------------------
    particleSlider.addEventListener('input', () => {
        const count = parseInt(particleSlider.value, 10);

        // Update live label
        particleSliderVal.textContent = count;

        // Persist to state
        stateManager.particleCount = count;

        // Update particle system immediately
        if (particleSystem) {
            particleSystem.setParticleCount(count);
        }

        // Update adaptive quality manager's target so it restores to the new value
        if (adaptiveQualityManager) {
            adaptiveQualityManager.targetCount = count;
        }
    });

    // -------------------------------------------------------------------------
    // Reset (Req 11.3)
    // -------------------------------------------------------------------------
    resetBtn.addEventListener('click', () => {
        appController.reset();
    });

    // -------------------------------------------------------------------------
    // Intensity Mode toggle (Req 11.4)
    // -------------------------------------------------------------------------
    intensityToggle.addEventListener('change', () => {
        const enabled = intensityToggle.checked;
        stateManager.intensityMode = enabled;
        if (particleSystem) {
            particleSystem.setIntensityMode(enabled);
        }
    });

    // -------------------------------------------------------------------------
    // Mirror Mode toggle (Req 11.5)
    // -------------------------------------------------------------------------
    mirrorToggle.addEventListener('change', () => {
        const enabled = mirrorToggle.checked;
        stateManager.mirrorMode = enabled;

        // Flip the video element horizontally so the live feed looks mirrored
        _applyMirrorCSS(videoEl, enabled);

        // Update MediaPipeEngine so it passes the new mirrorMode value into the
        // onFaceResults / onHandResults callbacks on the next detection cycle.
        // CoordinateMapper is stateless — mirrorMode is forwarded as a parameter
        // from those callbacks, so no setter is needed on CoordinateMapper.
        const mediaPipeEngine = appController.mediaPipeEngine;
        if (mediaPipeEngine) {
            mediaPipeEngine.setMirrorMode(enabled);
        }
    });
}

// =============================================================================
// Private helpers
// =============================================================================

/**
 * Update the Start/Stop button label to reflect the current running state.
 *
 * @param {HTMLButtonElement} btn
 * @param {boolean}           isRunning
 */
function _syncStartStopLabel(btn, isRunning) {
    btn.textContent = isRunning ? 'Stop' : 'Start';
    btn.setAttribute('aria-label', isRunning ? 'Dừng theo dõi' : 'Bắt đầu theo dõi');
}

/**
 * Apply or remove the CSS horizontal flip on the video element.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {boolean}          enabled
 */
function _applyMirrorCSS(videoEl, enabled) {
    if (videoEl) {
        videoEl.style.transform = enabled ? 'scaleX(-1)' : '';
    }
}

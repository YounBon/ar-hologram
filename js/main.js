// js/main.js
// Feature: webcam-particle-face-ar
// Entry point: privacy notice logic, module wiring, app initialization.
// Implemented in Tasks 11 & 12.

// Privacy notice — show only once per browser (tracked via localStorage)
if (!localStorage.getItem('privacy-notice-seen')) {
    document.getElementById('privacy-notice').style.display = 'flex';
}

document.getElementById('privacy-dismiss').addEventListener('click', () => {
    localStorage.setItem('privacy-notice-seen', '1');
    document.getElementById('privacy-notice').style.display = 'none';
});

// -------------------------------------------------------------------------
// Application bootstrap
// -------------------------------------------------------------------------

// Bootstrap — scripts are loaded at end of <body> so DOM is already ready.
// Use a self-invoking async function instead of DOMContentLoaded.
(async () => {
    const appController = new AppController();

    // Expose to window for debugging
    window.appController = appController;

    try {
        await appController.init();
    } catch (err) {
        // Errors are handled inside AppController.init() via handleError().
        console.error('[main] AppController.init() threw:', err);
        return;
    }

    // Wire UI controls now that all modules are initialised (Task 11)
    initUI(appController);
})();

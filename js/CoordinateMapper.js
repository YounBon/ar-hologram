// js/CoordinateMapper.js
// Feature: webcam-particle-face-ar
// Pure coordinate transform functions: MediaPipe normalized space → Three.js world space.
// CoordinateMapper is stateless — mirrorMode is passed as a parameter, not stored as state.

class CoordinateMapper {
    /**
     * @param {THREE.PerspectiveCamera} camera
     * @param {THREE.WebGLRenderer} renderer
     */
    constructor(camera, renderer) {
        this.camera = camera;
        this.renderer = renderer;
    }

    /**
     * Compute viewport dimensions in Three.js world units from the camera frustum.
     * Formula (Requirement 13.6):
     *   viewportHeight = 2 * tan(FOV/2 * π/180) * cameraZ
     *   viewportWidth  = viewportHeight * aspectRatio
     *
     * @returns {{ width: number, height: number }}
     */
    computeViewport() {
        const fov = CONSTANTS.CAMERA_FOV;   // 75 degrees
        const cameraZ = CONSTANTS.CAMERA_Z; // 100
        const aspect =
            this.renderer.domElement.width / this.renderer.domElement.height;
        const viewportHeight =
            2 * Math.tan(((fov / 2) * Math.PI) / 180) * cameraZ;
        const viewportWidth = viewportHeight * aspect;
        return { width: viewportWidth, height: viewportHeight };
    }

    /**
     * Map a single MediaPipe landmark to Three.js world space.
     * Requirements 13.1–13.5:
     *   worldX (normal) = (lm.x - 0.5) * viewportWidth
     *   worldX (mirror) = (0.5 - lm.x) * viewportWidth
     *   worldY          = (0.5 - lm.y) * viewportHeight
     *   worldZ          = lm.z * DEPTH_SCALE
     *
     * @param {{ x: number, y: number, z: number }} lm  Normalized landmark [0,1] x,y; [-1,1] z
     * @param {boolean} mirrorMode
     * @returns {THREE.Vector3}
     */
    landmarkToWorld(lm, mirrorMode) {
        const { width, height } = this.computeViewport();
        const worldX = mirrorMode
            ? (0.5 - lm.x) * width
            : (lm.x - 0.5) * width;
        const worldY = (0.5 - lm.y) * height;
        const worldZ = lm.z * CONSTANTS.DEPTH_SCALE;
        return new THREE.Vector3(worldX, worldY, worldZ);
    }

    /**
     * Compute the palm center as the average world-space position of
     * landmarks at indices 0, 5, 9, 13, 17 (Requirement 4.2).
     *
     * @param {Array<{ x: number, y: number, z: number }>} handLandmarks  21 landmarks
     * @param {boolean} mirrorMode
     * @returns {THREE.Vector3}
     */
    computePalmCenter(handLandmarks, mirrorMode) {
        const indices = [0, 5, 9, 13, 17];
        const sum = new THREE.Vector3(0, 0, 0);
        for (const idx of indices) {
            sum.add(this.landmarkToWorld(handLandmarks[idx], mirrorMode));
        }
        sum.divideScalar(indices.length);
        return sum;
    }

    /**
     * Compute the Euclidean distance between two world-space points (Requirement 4.3).
     *
     * @param {THREE.Vector3} p1
     * @param {THREE.Vector3} p2
     * @returns {number}  Distance in world units
     */
    computeHandDistance(p1, p2) {
        return p1.distanceTo(p2);
    }

    /**
     * Compute the midpoint between two world-space points.
     *
     * @param {THREE.Vector3} p1
     * @param {THREE.Vector3} p2
     * @returns {THREE.Vector3}
     */
    computeMidpoint(p1, p2) {
        return new THREE.Vector3(
            (p1.x + p2.x) / 2,
            (p1.y + p2.y) / 2,
            (p1.z + p2.z) / 2
        );
    }

    /**
     * Map a normalized hand distance to a particle cloud scale value.
     * Formula (Requirements 7.1, 7.2, 7.5):
     *   normalizedDist = handDistance / viewportWidth   (caller's responsibility)
     *   targetScale    = lerp(0.3, 3.0, (d - 0.05) / 0.75)
     *   targetScale    = clamp(targetScale, 0.3, 3.0)
     *
     * @param {number} normalizedDist  handDistance / viewportWidth
     * @returns {number}  Scale in [SCALE_MIN, SCALE_MAX]
     */
    mapDistanceToScale(normalizedDist) {
        const scaleMin = CONSTANTS.SCALE_MIN;   // 0.3
        const scaleMax = CONSTANTS.SCALE_MAX;   // 3.0
        const distMin = CONSTANTS.HAND_DIST_MIN; // 0.05
        const distRange = CONSTANTS.HAND_DIST_MAX - CONSTANTS.HAND_DIST_MIN; // 0.75

        const t = (normalizedDist - distMin) / distRange;
        const scale = scaleMin + t * (scaleMax - scaleMin); // lerp
        return Math.max(scaleMin, Math.min(scaleMax, scale)); // clamp
    }

    /**
     * Compute the face bounding box in screen pixels with 5% padding (Requirement 8.4).
     * Algorithm (design.md §E):
     *   minX/maxX/minY/maxY from all landmarks (normalized)
     *   padX = (maxX - minX) * 0.05
     *   padY = (maxY - minY) * 0.05
     *   screenX = (minX - padX) * canvasWidth
     *   screenY = (minY - padY) * canvasHeight
     *   screenW = (maxX - minX + 2*padX) * canvasWidth
     *   screenH = (maxY - minY + 2*padY) * canvasHeight
     *
     * Note: mirrorMode is accepted for API consistency but the bounding box is
     * computed in normalized screen space (x,y only), so mirroring does not
     * change the box dimensions — only the x-axis direction, which is handled
     * by the CSS transform on the video element.
     *
     * @param {Array<{ x: number, y: number, z: number }>} landmarks  468 face landmarks
     * @param {boolean} mirrorMode
     * @returns {{ x: number, y: number, width: number, height: number }}  Screen pixels
     */
    computeFaceBoundingBox(landmarks, mirrorMode) {
        const canvasWidth = this.renderer.domElement.width;
        const canvasHeight = this.renderer.domElement.height;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const lm of landmarks) {
            const lx = mirrorMode ? 1 - lm.x : lm.x;
            if (lx < minX) minX = lx;
            if (lx > maxX) maxX = lx;
            if (lm.y < minY) minY = lm.y;
            if (lm.y > maxY) maxY = lm.y;
        }

        const padX = (maxX - minX) * 0.05;
        const padY = (maxY - minY) * 0.05;

        return {
            x: (minX - padX) * canvasWidth,
            y: (minY - padY) * canvasHeight,
            width: (maxX - minX + 2 * padX) * canvasWidth,
            height: (maxY - minY + 2 * padY) * canvasHeight,
        };
    }

    /**
     * Map all 468 face landmarks to a flat Float32Array of world-space positions.
     * Layout: [x0, y0, z0, x1, y1, z1, ..., x467, y467, z467]
     *
     * @param {Array<{ x: number, y: number, z: number }>} landmarks  468 face landmarks
     * @param {boolean} mirrorMode
     * @returns {Float32Array}  Length 468 * 3
     */
    mapFaceLandmarks(landmarks, mirrorMode) {
        const out = new Float32Array(landmarks.length * 3);
        for (let i = 0; i < landmarks.length; i++) {
            const v = this.landmarkToWorld(landmarks[i], mirrorMode);
            out[i * 3] = v.x;
            out[i * 3 + 1] = v.y;
            out[i * 3 + 2] = v.z;
        }
        return out;
    }
}

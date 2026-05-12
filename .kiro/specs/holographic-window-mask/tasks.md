# Implementation Plan: Holographic Window Mask

## Overview

Triển khai tính năng Holographic Window Mask bằng cách sửa đổi hai file hiện có: `js/ParticleSystem.js` và `js/AppController.js`. Thay đổi cốt lõi gồm: nâng cấp glass plane material, thêm 3 shader uniforms mới, cập nhật fragment shader với screen-space masking, thêm method `updateHandBox(box)` và `onResize()` vào `ParticleSystem`, và cập nhật `AppController.onHandResults()` để dùng API mới. Các property-based test được viết dưới dạng file `.test.html` độc lập trong `tests/property-tests/`, theo đúng pattern của project.

## Tasks

- [x] 1. Cập nhật Glass Plane Material trong `ParticleSystem._initHandRegionMesh()`
  - Trong `js/ParticleSystem.js`, tìm `_initHandRegionMesh()` và thay đổi `planeMat` từ `opacity: 0.0` (invisible) thành `color: 0x0088ff, opacity: 0.2` (sci-fi blue glass)
  - Giữ nguyên `transparent: true, depthWrite: false, side: THREE.DoubleSide`
  - _Requirements: 1.1, 1.2, 1.5_

- [ ] 2. Thêm Shader Uniforms mới vào `ParticleSystem`
  - [x] 2.1 Khai báo 3 uniform mới trong `uniforms` object của `ShaderMaterial` trong `init()`:
    - `u_boxMin: { value: new THREE.Vector2(0, 0) }`
    - `u_boxMax: { value: new THREE.Vector2(0, 0) }`
    - `u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }`
  - Lưu references: `this._uBoxMin`, `this._uBoxMax`, `this._uResolution` trỏ vào các uniform objects tương ứng
  - _Requirements: 4.1, 4.3_

  - [x] 2.2 Write property test cho NDC normalization round-trip
    - Tạo file `tests/property-tests/holographic-mask-ndc-roundtrip.test.html`
    - **Property 4: NDC Normalization Round-Trip**
    - Dùng `fc.tuple(fc.float({min:0,max:1920,noNaN:true}), fc.float({min:0,max:1080,noNaN:true}))` cho pixel coords và `fc.tuple(fc.integer({min:320,max:3840}), fc.integer({min:240,max:2160}))` cho viewport size
    - Verify `(px / W) * W ≈ px` với sai số < 0.001
    - **Validates: Requirements 4.2**

- [x] 3. Cập nhật Fragment Shader với Screen-Space Masking
  - Trong `js/ParticleSystem.js`, cập nhật `PARTICLE_FRAGMENT_SHADER`:
    - Thêm 3 uniform declarations: `uniform vec2 u_boxMin;`, `uniform vec2 u_boxMax;`, `uniform vec2 u_resolution;`
    - Thêm masking block vào đầu `main()`, TRƯỚC circular dot check:
      ```glsl
      vec2 ndc = gl_FragCoord.xy / u_resolution;
      if (ndc.x < u_boxMin.x || ndc.x > u_boxMax.x ||
          ndc.y < u_boxMin.y || ndc.y > u_boxMax.y) {
          discard;
      }
      ```
  - Khi `u_boxMin == u_boxMax == vec2(0,0)`, tất cả fragment bị discard (trạng thái "no hands")
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 8.1, 8.4_

  - [x] 3.1 Write property test cho shader mask discard logic
    - Tạo file `tests/property-tests/holographic-mask-shader-discard.test.html`
    - **Property 3: Shader Mask Discards Exactly Particles Outside Box**
    - Implement pure JS function `isDiscarded(fragX, fragY, resW, resH, boxMinX, boxMinY, boxMaxX, boxMaxY)` mirroring GLSL logic
    - Dùng `fc.tuple(fc.float({min:0,max:1,noNaN:true}), fc.float({min:0,max:1,noNaN:true}))` cho NDC position và box bounds
    - Verify: `isDiscarded` returns `true` iff `ndc.x < boxMin.x || ndc.x > boxMax.x || ndc.y < boxMin.y || ndc.y > boxMax.y`
    - Verify: `isDiscarded` returns `false` iff `boxMin.x ≤ ndc.x ≤ boxMax.x && boxMin.y ≤ ndc.y ≤ boxMax.y`
    - **Validates: Requirements 3.2, 3.3**

- [x] 4. Thêm method `updateHandBox(box)` vào `ParticleSystem`
  - [x] 4.1 Implement `updateHandBox(box)` trong `js/ParticleSystem.js`:
    - Khi `box === null`: set `this._uBoxMin.value.set(0, 0)`, `this._uBoxMax.value.set(0, 0)`, `this._points.visible = false`, gọi `this._hideHandRegionMesh()`
    - Khi `box` hợp lệ: tính NDC với y-axis flip (WebGL origin bottom-left vs CSS origin top-left):
      - `minX = clamp(box.left / W, 0, 1)`
      - `maxX = clamp(box.right / W, 0, 1)`
      - `minY = clamp((H - box.bottom) / H, 0, 1)` ← CSS bottom → WebGL y-min
      - `maxY = clamp((H - box.top) / H, 0, 1)` ← CSS top → WebGL y-max
    - Set `this._uBoxMin.value.set(minX, minY)`, `this._uBoxMax.value.set(maxX, maxY)`
    - Gọi `this._updateHandRegionMesh(box)`, set `this._points.visible = true`
  - _Requirements: 3.5, 4.2, 4.4, 4.5, 7.2, 7.3_

  - [x] 4.2 Write property test cho Hand Box NDC in [0,1]
    - Tạo file `tests/property-tests/holographic-mask-ndc-bounds.test.html`
    - **Property 2: Hand Box NDC Is in [0, 1]**
    - Implement pure JS function `computeNDC(box, W, H)` mirroring `updateHandBox` NDC logic (với y-flip)
    - Dùng `fc.record({ left: fc.integer({min:-500,max:3000}), top: fc.integer({min:-500,max:2000}), right: fc.integer({min:-500,max:3000}), bottom: fc.integer({min:-500,max:2000}) })` và `fc.tuple(fc.integer({min:320,max:3840}), fc.integer({min:240,max:2160}))` cho viewport
    - Verify `0 ≤ u_boxMin.x ≤ u_boxMax.x ≤ 1` và `0 ≤ u_boxMin.y ≤ u_boxMax.y ≤ 1` (sau khi sort min/max)
    - **Validates: Requirements 4.5**

- [x] 5. Thêm method `onResize()` vào `ParticleSystem`
  - Implement `onResize()` trong `js/ParticleSystem.js`:
    ```javascript
    onResize() {
        this._uResolution.value.set(window.innerWidth, window.innerHeight);
    }
    ```
  - _Requirements: 4.3_

- [x] 6. Checkpoint — Kiểm tra ParticleSystem changes
  - Ensure `_initHandRegionMesh()` tạo glass plane với `color: 0x0088ff, opacity: 0.2`
  - Ensure `init()` có 3 uniforms mới: `u_boxMin`, `u_boxMax`, `u_resolution`
  - Ensure fragment shader source chứa `discard`, `u_boxMin`, `u_boxMax`, `u_resolution`
  - Ensure `updateHandBox(null)` ẩn points và mesh; `updateHandBox(validBox)` hiện points
  - Ensure all tests pass, hỏi user nếu có vấn đề

- [x] 7. Cập nhật `AppController.onHandResults()` để dùng `updateHandBox()`
  - Trong `js/AppController.js`, cập nhật `onHandResults()`:
    - Thay `this._particleSystem.setVisible(false)` → `this._particleSystem.updateHandBox(null)`
    - Thay `this._particleSystem.updateInsideHandBox(box)` + `this._particleSystem.setVisible(true)` → `this._particleSystem.updateHandBox(box)`
  - Xóa dòng `this._particleSystem.setVisible(true)` (không còn cần thiết — `updateHandBox` quản lý visibility nội bộ)
  - _Requirements: 5.3, 5.4, 7.2, 7.3_

- [x] 8. Mở rộng Resize Callback trong `AppController.init()`
  - Trong `js/AppController.js`, cập nhật `setResizeCallback` trong `init()` để cũng gọi `this._particleSystem.onResize()`:
    ```javascript
    this._sceneRenderer.setResizeCallback(() => {
        if (this._particleSystem) {
            this._particleSystem.onResize();
        }
    });
    ```
  - _Requirements: 4.3_

- [x] 9. Checkpoint — Kiểm tra AppController changes
  - Ensure `onHandResults()` với 0 hoặc 1 tay gọi `updateHandBox(null)`
  - Ensure `onHandResults()` với đúng 2 tay gọi `updateHandBox(box)` với box hợp lệ
  - Ensure `onFaceResults()` không thay đổi — vẫn gọi `updateFromFace(worldPositions)` bất kể hand state
  - Ensure resize callback gọi `particleSystem.onResize()`
  - Ensure all tests pass, hỏi user nếu có vấn đề

- [x] 10. Write property tests cho Hand Box Computation
  - [x] 10.1 Write property test cho hand box containment
    - Tạo file `tests/property-tests/holographic-mask-handbox-containment.test.html`
    - **Property 1: Hand Box Contains All Four Finger Tips**
    - Extract `_computeHandBox` logic thành pure JS function để test
    - Dùng `fc.array(fc.record({ x: fc.float({min:0,max:1,noNaN:true}), y: fc.float({min:0,max:1,noNaN:true}) }), {minLength:4,maxLength:4})` cho 4 tip points và `fc.boolean()` cho mirrorMode
    - Verify tight box (trước padding) chứa tất cả 4 điểm: `left_no_pad ≤ sx_i ≤ right_no_pad` và `top_no_pad ≤ sy_i ≤ bottom_no_pad`
    - **Validates: Requirements 6.2, 6.5**

  - [x] 10.2 Write property test cho padding exactly 24px
    - Tạo file `tests/property-tests/holographic-mask-handbox-padding.test.html`
    - **Property 7: Padding Is Exactly 24px on All Sides**
    - Dùng cùng arbitraries như 10.1
    - Verify `box.left = tight_left - 24`, `box.top = tight_top - 24`, `box.right = tight_right + 24`, `box.bottom = tight_bottom + 24`
    - **Validates: Requirements 6.3**

  - [x] 10.3 Write property test cho mirror mode flips box horizontally
    - Tạo file `tests/property-tests/holographic-mask-mirror-flip.test.html`
    - **Property 5: Mirror Mode Flips Box Horizontally**
    - Dùng `fc.array(fc.record({x,y}), {minLength:4,maxLength:4})` và `fc.integer({min:320,max:3840})` cho W, `fc.integer({min:240,max:2160})` cho H
    - Compute `box_normal` (mirrorMode=false) và `box_mirrored` (mirrorMode=true)
    - Verify `box_mirrored.left ≈ W - box_normal.right` và `box_mirrored.right ≈ W - box_normal.left`
    - Verify y-axis không thay đổi: `box_mirrored.top === box_normal.top` và `box_mirrored.bottom === box_normal.bottom`
    - **Validates: Requirements 6.4**

- [x] 11. Write property tests cho Face/Hand Independence và Corner Brackets
  - [x] 11.1 Write property test cho face positions independent of hand box
    - Tạo file `tests/property-tests/holographic-mask-face-independence.test.html`
    - **Property 6: Face Positions Independent of Hand Box**
    - Stub `ParticleSystem` với `_basePositions` array và implement `updateFromFace` + `updateHandBox` logic thuần túy
    - Dùng `fc.array(fc.float({min:-200,max:200,noNaN:true}), {minLength:468*3,maxLength:468*3})` cho worldPositions
    - Verify `a_basePosition` sau `updateFromFace(worldPositions)` không bị thay đổi bởi `updateHandBox(box)` gọi sau đó
    - **Validates: Requirements 5.1, 7.1**

  - [x] 11.2 Write property test cho corner bracket arm length
    - Tạo file `tests/property-tests/holographic-mask-corner-brackets.test.html`
    - **Property 8: Corner Bracket Arm Length Is 15% of Shorter Dimension**
    - Extract `cs = Math.min(wWorld, hWorld) * 0.15` logic thành pure function
    - Dùng `fc.tuple(fc.float({min:0.1,max:100,noNaN:true}), fc.float({min:0.1,max:100,noNaN:true}))` cho `(wWorld, hWorld)`
    - Verify `cs === Math.min(wWorld, hWorld) * 0.15` với floating-point tolerance
    - **Validates: Requirements 2.3**

- [x] 12. Final checkpoint — Ensure all tests pass
  - Chạy toàn bộ property tests mới trong `tests/property-tests/holographic-mask-*.test.html`
  - Verify glass plane hiển thị màu xanh sci-fi khi có 2 tay
  - Verify particle cloud chỉ hiển thị bên trong vùng tay (shader masking hoạt động)
  - Verify resize không làm lệch mask (u_resolution được cập nhật)
  - Ensure all tests pass, hỏi user nếu có vấn đề

## Notes

- Tasks đánh dấu `*` là optional và có thể bỏ qua để implement MVP nhanh hơn
- Mỗi task tham chiếu requirements cụ thể để đảm bảo traceability
- **Y-axis flip quan trọng**: `gl_FragCoord` có origin bottom-left (WebGL), CSS/MediaPipe có origin top-left — `updateHandBox()` phải flip y khi tính NDC
- Property tests dùng **fast-check** (CDN `fast-check@3.13.2`) với minimum 100 iterations mỗi property
- Tag format cho PBT: `// Feature: holographic-window-mask, Property N: <property_text>`
- Chỉ sửa đổi `js/ParticleSystem.js` và `js/AppController.js` — `js/CoordinateMapper.js` không thay đổi
- `updateInsideHandBox(box)` và `setVisible()` vẫn được giữ lại trong `ParticleSystem` (dùng nội bộ bởi `updateHandBox`)

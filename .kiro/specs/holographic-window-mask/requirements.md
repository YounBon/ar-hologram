# Requirements Document
Lệnh chạy: python -m http.server 8080
Link chạy: http://localhost:8080

## Introduction

Tính năng **Holographic Window Mask** (X-Ray / Holographic Window) là một pivot kiến trúc render cho ứng dụng Webcam Particle Face AR. Thay vì hiển thị particle cloud toàn cục phủ lên khuôn mặt, các hạt sẽ hoạt động như một **hologram chỉ hiển thị qua một cửa sổ** được định nghĩa bởi hai bàn tay của người dùng.

Cụ thể: người dùng tạo thành một "cửa sổ kính holographic" bằng cách giơ hai tay lên — ngón cái và ngón trỏ của mỗi tay xác định 4 góc của bounding box. Các particle vẫn được định vị theo 468 điểm landmark khuôn mặt (toàn cục), nhưng chỉ những particle nằm trong vùng 2D của cửa sổ tay mới được hiển thị — tạo hiệu ứng "X-Ray" như đang nhìn qua một tấm kính holographic sci-fi.

Tính năng này yêu cầu thay đổi hai module chính:
- **`ParticleSystem.js`**: Thêm shader masking (screen-space bounding box discard) và tái tạo hand window mesh với phong cách sci-fi glass.
- **`AppController.js`**: Cập nhật vòng lặp để truyền đồng thời face landmarks (định vị particle) và hand bounding box (masking uniform) vào `ParticleSystem`.

## Glossary

- **System**: Toàn bộ ứng dụng web Webcam Particle Face AR
- **Holographic_Window**: Vùng hình chữ nhật 2D được xác định bởi bounding box của ngón cái và ngón trỏ của cả hai bàn tay; đóng vai trò là "cửa sổ kính" để nhìn thấy particle hologram
- **Hand_Box**: Bounding box tính từ 4 điểm: ngón cái (landmark 4) và ngón trỏ (landmark 8) của mỗi bàn tay — tổng 4 điểm, 2 tay
- **Hand_Box_Screen**: Hand_Box được biểu diễn bằng tọa độ pixel màn hình `{ left, top, right, bottom }`
- **Hand_Box_NDC**: Hand_Box được chuẩn hóa về không gian [0, 1] × [0, 1] (Normalized Device Coordinates cho shader), tương ứng với `u_boxMin` và `u_boxMax`
- **Particle_Cloud**: Đám mây hạt 3D được render bằng Three.js, định vị theo 468 điểm landmark khuôn mặt
- **Particle**: Một hạt đơn lẻ trong Particle_Cloud
- **Shader_Mask**: Logic trong Fragment Shader kiểm tra tọa độ màn hình của mỗi Particle so với Hand_Box_NDC và loại bỏ (discard) các hạt nằm ngoài vùng
- **ParticleSystem**: Module `js/ParticleSystem.js` quản lý vòng đời Particle_Cloud, ShaderMaterial, và Hand Window mesh
- **AppController**: Module `js/AppController.js` điều phối face tracking, hand tracking, và cập nhật ParticleSystem
- **CoordinateMapper**: Module `js/CoordinateMapper.js` chuyển đổi tọa độ MediaPipe sang Three.js world space
- **Face_Tracker**: Thành phần xử lý 468 điểm landmark khuôn mặt từ MediaPipe FaceMesh
- **Hand_Tracker**: Thành phần xử lý 21 điểm landmark mỗi bàn tay từ MediaPipe Hands
- **u_boxMin**: Uniform vec2 trong Fragment Shader — góc trên-trái của Hand_Box_NDC, tọa độ (minX, minY) trong [0, 1]
- **u_boxMax**: Uniform vec2 trong Fragment Shader — góc dưới-phải của Hand_Box_NDC, tọa độ (maxX, maxY) trong [0, 1]
- **NDC_Position**: Tọa độ chuẩn hóa của một Particle trên màn hình, tính từ `gl_FragCoord` chia cho viewport dimensions
- **Glass_Plane**: Mesh `THREE.PlaneGeometry` bán trong suốt màu xanh sci-fi đại diện cho mặt kính của Holographic_Window
- **Corner_Brackets**: 4 đường viền hình chữ L màu cyan phát sáng tại 4 góc của Holographic_Window
- **Landmark**: Một điểm tọa độ (x, y, z) được MediaPipe phát hiện trên khuôn mặt hoặc bàn tay, chuẩn hóa trong [0, 1]
- **Frame**: Một khung hình xử lý trong vòng lặp render, mục tiêu 60 FPS

---

## Requirements

### Requirement 1: Holographic Window — Glass Plane Visualization

**User Story:** As a người dùng, I want thấy một tấm kính holographic bán trong suốt màu xanh sci-fi xuất hiện giữa hai bàn tay, so that tôi có cảm giác đang cầm một cửa sổ AR thực sự.

#### Acceptance Criteria

1. WHEN Hand_Tracker phát hiện đúng hai bàn tay, THE ParticleSystem SHALL hiển thị Glass_Plane với màu `0x0088ff` (xanh dương sci-fi), `opacity: 0.2`, và `transparent: true`.
2. THE Glass_Plane SHALL sử dụng `THREE.MeshBasicMaterial` với `side: THREE.DoubleSide` và `depthWrite: false` để không che khuất các Particle phía sau.
3. WHEN Hand_Box thay đổi kích thước hoặc vị trí, THE Glass_Plane SHALL cập nhật `scale` và `position` trong cùng Frame để khớp chính xác với Hand_Box_Screen.
4. WHEN Hand_Tracker không phát hiện đủ hai bàn tay, THE ParticleSystem SHALL ẩn Glass_Plane.
5. THE Glass_Plane SHALL được đặt tại `z = -1` trong Three.js world space để nằm phía sau Particle_Cloud nhưng phía trước nền video.

---

### Requirement 2: Holographic Window — Corner Brackets Visualization

**User Story:** As a người dùng, I want thấy 4 góc khung sáng cyan bao quanh cửa sổ holographic, so that tôi biết chính xác vùng cửa sổ đang hoạt động.

#### Acceptance Criteria

1. THE ParticleSystem SHALL hiển thị 4 Corner_Brackets dưới dạng `THREE.LineSegments` với màu cyan (`0x00FFFF`) tại 4 góc của Holographic_Window.
2. WHEN Hand_Box thay đổi, THE Corner_Brackets SHALL cập nhật vị trí trong cùng Frame để 4 góc khớp chính xác với 4 góc của Hand_Box_Screen sau khi chuyển đổi sang world space.
3. THE Corner_Brackets SHALL có hình dạng chữ L (L-shape) với chiều dài mỗi cạnh bằng `15%` của cạnh ngắn hơn giữa chiều rộng và chiều cao của Holographic_Window.
4. WHEN Hand_Tracker không phát hiện đủ hai bàn tay, THE ParticleSystem SHALL ẩn tất cả Corner_Brackets.
5. THE Corner_Brackets SHALL được đặt tại `z = 1` trong Three.js world space để nằm phía trước Particle_Cloud, tạo hiệu ứng khung nổi.

---

### Requirement 3: Shader Masking — X-Ray Effect

**User Story:** As a người dùng, I want các particle chỉ hiển thị bên trong vùng cửa sổ tay, so that tôi có hiệu ứng X-Ray như đang nhìn qua một tấm kính holographic.

#### Acceptance Criteria

1. THE ParticleSystem SHALL triển khai Shader_Mask trong Fragment Shader của `THREE.ShaderMaterial` để loại bỏ các Particle nằm ngoài Hand_Box_NDC.
2. WHEN một Particle có NDC_Position nằm ngoài khoảng `[u_boxMin, u_boxMax]` (tức là `ndc.x < u_boxMin.x` hoặc `ndc.x > u_boxMax.x` hoặc `ndc.y < u_boxMin.y` hoặc `ndc.y > u_boxMax.y`), THE Fragment_Shader SHALL thực thi `discard` để loại bỏ hoàn toàn Particle đó.
3. WHEN một Particle có NDC_Position nằm trong khoảng `[u_boxMin, u_boxMax]`, THE Fragment_Shader SHALL render Particle đó với màu sắc và alpha bình thường (không bị ảnh hưởng bởi Shader_Mask).
4. THE Fragment_Shader SHALL tính NDC_Position của mỗi Particle từ `gl_FragCoord.xy` chia cho `u_resolution` (uniform vec2 chứa viewport width và height tính bằng pixel).
5. WHEN Hand_Tracker không phát hiện đủ hai bàn tay, THE ParticleSystem SHALL đặt `u_boxMin = vec2(0.0, 0.0)` và `u_boxMax = vec2(0.0, 0.0)` để Shader_Mask loại bỏ tất cả Particle (không hiển thị gì).

---

### Requirement 4: Shader Uniforms — Hand Box Data Pipeline

**User Story:** As a developer, I want tọa độ Hand_Box được truyền chính xác vào shader dưới dạng uniforms chuẩn hóa, so that Shader_Mask hoạt động đúng với mọi kích thước màn hình.

#### Acceptance Criteria

1. THE ParticleSystem SHALL khai báo các uniforms sau trong `THREE.ShaderMaterial`:
   - `u_boxMin`: `THREE.Uniform` kiểu `THREE.Vector2` — góc trên-trái của Hand_Box_NDC
   - `u_boxMax`: `THREE.Uniform` kiểu `THREE.Vector2` — góc dưới-phải của Hand_Box_NDC
   - `u_resolution`: `THREE.Uniform` kiểu `THREE.Vector2` — kích thước viewport tính bằng pixel
2. WHEN AppController cung cấp Hand_Box_Screen `{ left, top, right, bottom }`, THE ParticleSystem SHALL tính Hand_Box_NDC theo công thức:
   - `u_boxMin.x = left / viewportWidth`
   - `u_boxMin.y = top / viewportHeight`
   - `u_boxMax.x = right / viewportWidth`
   - `u_boxMax.y = bottom / viewportHeight`
   trong đó `viewportWidth` và `viewportHeight` là kích thước viewport tính bằng pixel.
3. THE ParticleSystem SHALL cập nhật `u_resolution` mỗi khi viewport thay đổi kích thước để đảm bảo NDC_Position tính trong shader luôn chính xác.
4. WHEN Hand_Box_Screen thay đổi, THE ParticleSystem SHALL cập nhật `u_boxMin` và `u_boxMax` trong cùng Frame trước khi render.
5. THE Hand_Box_NDC SHALL có tọa độ trong khoảng `[0.0, 1.0]` cho cả hai trục x và y; các giá trị ngoài khoảng này phải được clamp về `[0.0, 1.0]` trước khi gán vào uniforms.

---

### Requirement 5: Data Orchestration — Dual Data Stream

**User Story:** As a developer, I want AppController truyền đồng thời face landmarks và hand bounding box vào ParticleSystem, so that particle cloud được định vị theo khuôn mặt nhưng chỉ hiển thị qua cửa sổ tay.

#### Acceptance Criteria

1. THE AppController SHALL duy trì hai luồng dữ liệu độc lập trong mỗi Frame:
   - **Face stream**: 468 face landmarks từ `onFaceResults()` → `ParticleSystem.updateFromFace(worldPositions)`
   - **Hand stream**: Hand_Box_Screen từ `onHandResults()` → `ParticleSystem.updateHandBox(box)`
2. WHEN `onFaceResults()` được gọi, THE AppController SHALL gọi `ParticleSystem.updateFromFace(worldPositions)` để cập nhật vị trí base của các Particle theo khuôn mặt, bất kể trạng thái của hand tracking.
3. WHEN `onHandResults()` phát hiện đúng hai bàn tay, THE AppController SHALL tính Hand_Box_Screen từ ngón cái (landmark 4) và ngón trỏ (landmark 8) của cả hai tay, rồi gọi `ParticleSystem.updateHandBox(box)`.
4. WHEN `onHandResults()` không phát hiện đủ hai bàn tay, THE AppController SHALL gọi `ParticleSystem.updateHandBox(null)` để tắt Holographic_Window và Shader_Mask.
5. THE AppController SHALL không yêu cầu face tracking và hand tracking phải đồng bộ trong cùng một Frame — hai callback có thể được gọi ở các Frame khác nhau mà không gây lỗi.

---

### Requirement 6: Hand Box Computation

**User Story:** As a developer, I want Hand_Box được tính chính xác từ ngón cái và ngón trỏ của cả hai tay, so that Holographic_Window khớp với vùng tay người dùng tạo ra.

#### Acceptance Criteria

1. THE AppController SHALL tính Hand_Box_Screen từ 4 điểm: `hand0[4]` (ngón cái tay 0), `hand0[8]` (ngón trỏ tay 0), `hand1[4]` (ngón cái tay 1), `hand1[8]` (ngón trỏ tay 1).
2. THE AppController SHALL tính bounding box chặt (tight bounding box) của 4 điểm đó: `left = min(sx)`, `top = min(sy)`, `right = max(sx)`, `bottom = max(sy)`, trong đó `sx = p.x * viewportWidth` và `sy = p.y * viewportHeight` (có áp dụng mirror mode).
3. THE AppController SHALL thêm padding `24px` vào mỗi cạnh của bounding box: `left -= 24`, `top -= 24`, `right += 24`, `bottom += 24`.
4. WHEN Mirror Mode được bật, THE AppController SHALL đảo ngược trục x khi tính tọa độ màn hình: `sx = (1 - p.x) * viewportWidth`.
5. THE Hand_Box_Screen SHALL chứa tất cả 4 điểm ngón tay (trước khi thêm padding) — tức là `left ≤ sx ≤ right` và `top ≤ sy ≤ bottom` cho mọi điểm trong 4 điểm.

---

### Requirement 7: Particle Visibility Logic

**User Story:** As a người dùng, I want particle cloud vẫn được định vị theo khuôn mặt ngay cả khi không có tay, so that khi tôi giơ tay lên, hologram xuất hiện đúng vị trí khuôn mặt.

#### Acceptance Criteria

1. THE ParticleSystem SHALL luôn cập nhật `a_basePosition` của các Particle theo face landmarks khi `updateFromFace()` được gọi, bất kể Holographic_Window có đang hiển thị hay không.
2. WHEN Holographic_Window không hoạt động (không đủ hai tay), THE ParticleSystem SHALL ẩn `THREE.Points` object (không render Particle nào).
3. WHEN Holographic_Window hoạt động (đủ hai tay), THE ParticleSystem SHALL hiển thị `THREE.Points` object và để Shader_Mask quyết định Particle nào được render.
4. IF Face_Tracker không phát hiện khuôn mặt, THEN THE ParticleSystem SHALL giữ nguyên `a_basePosition` từ Frame trước — Particle_Cloud vẫn hiển thị qua Holographic_Window tại vị trí khuôn mặt cuối cùng được phát hiện.
5. THE ParticleSystem SHALL không thay đổi logic màu sắc, intrinsic motion (GPU sine-wave jitter), hay adaptive quality khi tính năng Holographic_Window được bật.

---

### Requirement 8: Hiệu suất — Shader Masking Không Ảnh Hưởng FPS

**User Story:** As a người dùng, I want hiệu ứng X-Ray chạy mượt mà ở 60 FPS, so that trải nghiệm AR không bị giật lag.

#### Acceptance Criteria

1. THE Shader_Mask SHALL được triển khai hoàn toàn trong Fragment Shader (GPU-side) bằng lệnh `discard` — không sử dụng CPU-side filtering hay geometry rebuild mỗi Frame.
2. THE ParticleSystem SHALL chỉ cập nhật `u_boxMin`, `u_boxMax`, và `u_resolution` uniforms khi giá trị thay đổi, không upload lại toàn bộ geometry.
3. THE System SHALL duy trì tốc độ render tối thiểu 60 FPS trên thiết bị có GPU tích hợp (Intel HD Graphics hoặc tương đương) với Particle_Cloud chứa 2000 Particle và Shader_Mask đang hoạt động.
4. THE Shader_Mask computation SHALL có độ phức tạp O(1) per fragment — chỉ là 4 phép so sánh số thực và một lệnh `discard`.

---

## Correctness Properties

*Các property sau đây mô tả các bất biến có thể kiểm tra bằng property-based testing (fast-check). Chúng bổ sung cho các acceptance criteria ở trên.*

---

### Property 1: Hand Box Contains All Four Finger Tips

*For any* 4 điểm ngón tay `{ x, y }` trong không gian chuẩn hóa [0, 1], Hand_Box_Screen được tính bởi `_computeHandBox()` phải chứa tất cả 4 điểm (trước khi thêm padding):

`left_no_pad ≤ sx_i ≤ right_no_pad` và `top_no_pad ≤ sy_i ≤ bottom_no_pad` với mọi i ∈ {0, 1, 2, 3}

**Validates: Requirement 6.5**

---

### Property 2: Hand Box NDC Is in [0, 1]

*For any* Hand_Box_Screen với tọa độ pixel hợp lệ (left, top, right, bottom trong khoảng viewport), Hand_Box_NDC được tính bởi `ParticleSystem.updateHandBox()` phải thỏa mãn:

`0.0 ≤ u_boxMin.x ≤ u_boxMax.x ≤ 1.0` và `0.0 ≤ u_boxMin.y ≤ u_boxMax.y ≤ 1.0`

**Validates: Requirement 4.5**

---

### Property 3: Shader Mask Discards Particles Outside Box

*For any* NDC_Position `(nx, ny)` và Hand_Box_NDC `(u_boxMin, u_boxMax)`, hàm masking thuần túy (pure function trích xuất từ Fragment Shader logic) phải trả về `discard = true` khi và chỉ khi:

`nx < u_boxMin.x` hoặc `nx > u_boxMax.x` hoặc `ny < u_boxMin.y` hoặc `ny > u_boxMax.y`

Và `discard = false` khi `u_boxMin.x ≤ nx ≤ u_boxMax.x` và `u_boxMin.y ≤ ny ≤ u_boxMax.y`.

**Validates: Requirement 3.1, 3.2, 3.3**

---

### Property 4: Corner Brackets Match Box Corners

*For any* Hand_Box_Screen, sau khi `_updateHandRegionMesh(box)` được gọi, 4 điểm gốc của Corner_Brackets (điểm đầu tiên của mỗi LineSegments) phải khớp với 4 góc world-space của Hand_Box_Screen:

- Corner 0 (top-left): `screenToWorld(box.left, box.top)`
- Corner 1 (top-right): `screenToWorld(box.right, box.top)`
- Corner 2 (bottom-left): `screenToWorld(box.left, box.bottom)`
- Corner 3 (bottom-right): `screenToWorld(box.right, box.bottom)`

**Validates: Requirement 2.2**

---

### Property 5: Face Positions Independent of Hand Box

*For any* tập hợp 468 face landmarks và bất kỳ Hand_Box nào, sau khi gọi `updateFromFace(worldPositions)` rồi `updateHandBox(box)` (theo thứ tự bất kỳ), `a_basePosition` của các Particle phải bằng giá trị được tính từ face landmarks — không bị ảnh hưởng bởi Hand_Box.

**Validates: Requirement 5.1, 7.1**

---

### Property 6: NDC Normalization Round-Trip

*For any* tọa độ pixel `(px, py)` trong khoảng `[0, viewportWidth] × [0, viewportHeight]`, việc chuẩn hóa rồi nhân ngược lại phải trả về giá trị gốc:

`(px / viewportWidth) * viewportWidth ≈ px` (sai số < 0.001 pixel)

Điều này đảm bảo công thức tính Hand_Box_NDC không mất thông tin.

**Validates: Requirement 4.2**

---

### Property 7: Mirror Mode Flips Box Horizontally

*For any* Hand_Box_Screen tính với `mirrorMode = false` cho ra `box_normal`, và tính với `mirrorMode = true` cho ra `box_mirrored`, phải thỏa mãn:

`box_mirrored.left ≈ viewportWidth - box_normal.right`
`box_mirrored.right ≈ viewportWidth - box_normal.left`

(Trục y không thay đổi: `box_mirrored.top = box_normal.top`, `box_mirrored.bottom = box_normal.bottom`)

**Validates: Requirement 6.4**

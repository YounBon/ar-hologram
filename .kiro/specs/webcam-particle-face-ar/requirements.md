# Requirements Document
Lệnh chạy: python -m http.server 8080
Link chạy: http://localhost:8080
## Introduction

Hệ thống **Webcam Particle Face AR** là một ứng dụng web chạy hoàn toàn trong trình duyệt Chrome, không cần backend hay cài đặt thêm. Hệ thống sử dụng webcam để nhận diện khuôn mặt (468 điểm) và hai bàn tay (42 điểm) theo thời gian thực thông qua MediaPipe chạy trên WebAssembly. Các điểm landmark được chuyển đổi thành đám mây hạt (particle cloud) hiển thị giữa hai lòng bàn tay với hiệu ứng neon và HUD overlay tạo cảm giác AR, render bằng Three.js ở 60 FPS.

## Glossary

- **System**: Toàn bộ ứng dụng web Webcam Particle Face AR
- **MediaPipe_Engine**: Module WebAssembly chạy MediaPipe FaceMesh và Hands trong trình duyệt
- **Face_Tracker**: Thành phần xử lý 468 điểm landmark khuôn mặt từ MediaPipe_Engine
- **Hand_Tracker**: Thành phần xử lý 21 điểm landmark mỗi bàn tay (tổng 42 điểm cho 2 tay) từ MediaPipe_Engine
- **Particle_Cloud**: Đám mây hạt 3D được render bằng Three.js, hiển thị giữa hai lòng bàn tay
- **Particle**: Một hạt đơn lẻ trong Particle_Cloud, có màu từ hồng sáng đến vàng
- **Renderer**: Module Three.js hoặc WebGL chịu trách nhiệm render Particle_Cloud và các hiệu ứng
- **HUD_Overlay**: Lớp giao diện AR hiển thị thông tin trạng thái, neon frame và các chỉ số hệ thống
- **Palm_Center**: Điểm trung tâm tính từ các landmark lòng bàn tay (landmark 0, 5, 9, 13, 17 của mỗi tay)
- **Hand_Distance**: Khoảng cách Euclidean giữa hai Palm_Center
- **Webcam_Stream**: Luồng video từ camera của thiết bị người dùng
- **Landmark**: Một điểm tọa độ (x, y, z) được MediaPipe_Engine phát hiện trên khuôn mặt hoặc bàn tay
- **Frame**: Một khung hình xử lý trong vòng lặp render, mục tiêu 60 FPS
- **Depth_Scale**: Hằng số nhân cho tọa độ z khi ánh xạ từ không gian MediaPipe sang Three.js world space, mặc định 50 đơn vị world

---

## Requirements

### Requirement 1: Khởi tạo và truy cập Webcam

**User Story:** As a người dùng, I want trình duyệt tự động yêu cầu quyền truy cập webcam khi mở ứng dụng, so that tôi không cần cấu hình thêm gì.

#### Acceptance Criteria

1. WHEN người dùng mở ứng dụng lần đầu, THE System SHALL hiển thị hộp thoại yêu cầu quyền truy cập camera của trình duyệt.
2. WHEN người dùng cấp quyền camera, THE System SHALL khởi tạo Webcam_Stream với độ phân giải tối thiểu 640×480 pixels.
3. IF người dùng từ chối quyền camera, THEN THE System SHALL hiển thị thông báo lỗi rõ ràng bằng tiếng Việt hướng dẫn cách cấp quyền lại.
4. IF Webcam_Stream bị ngắt kết nối trong khi chạy, THEN THE System SHALL hiển thị thông báo lỗi và dừng vòng lặp render.
5. THE System SHALL hoạt động hoàn toàn trong trình duyệt Chrome mà không yêu cầu cài đặt plugin, extension, hay backend server.

---

### Requirement 2: Tải và khởi tạo MediaPipe Engine

**User Story:** As a người dùng, I want MediaPipe tải tự động qua CDN, so that tôi không cần cài đặt gì thêm.

#### Acceptance Criteria

1. THE System SHALL tải MediaPipe FaceMesh và MediaPipe Hands từ CDN qua thẻ `<script>` mà không yêu cầu bước cài đặt thủ công.
2. WHEN MediaPipe_Engine hoàn tất tải, THE System SHALL khởi tạo Face_Tracker với cấu hình `maxNumFaces: 1` và `refineLandmarks: true`.
3. WHEN MediaPipe_Engine hoàn tất tải, THE System SHALL khởi tạo Hand_Tracker với cấu hình `maxNumHands: 2`.
4. WHILE MediaPipe_Engine đang tải, THE System SHALL hiển thị màn hình loading với thanh tiến trình.
5. IF MediaPipe_Engine tải thất bại, THEN THE System SHALL hiển thị thông báo lỗi và hướng dẫn kiểm tra kết nối mạng.

---

### Requirement 3: Nhận diện khuôn mặt theo thời gian thực

**User Story:** As a người dùng, I want hệ thống nhận diện 468 điểm trên khuôn mặt tôi theo thời gian thực, so that các điểm này có thể được dùng để tạo particle cloud.

#### Acceptance Criteria

1. WHEN Webcam_Stream đang hoạt động, THE Face_Tracker SHALL xử lý mỗi Frame từ Webcam_Stream và trả về tối đa 468 Landmark của khuôn mặt.
2. WHEN Face_Tracker phát hiện khuôn mặt, THE System SHALL cập nhật vị trí 468 Landmark trong mỗi Frame.
3. IF Face_Tracker không phát hiện khuôn mặt trong Frame hiện tại, THEN THE System SHALL giữ nguyên trạng thái Particle_Cloud từ Frame trước đó.
4. THE Face_Tracker SHALL xử lý Landmark với tọa độ được chuẩn hóa trong khoảng [0, 1] cho trục x và y, và khoảng [-1, 1] cho trục z.

---

### Requirement 4: Nhận diện bàn tay theo thời gian thực

**User Story:** As a người dùng, I want hệ thống nhận diện 21 điểm trên mỗi bàn tay (tổng 42 điểm cho 2 tay), so that tôi có thể điều khiển particle cloud bằng cử chỉ tay.

#### Acceptance Criteria

1. WHEN Webcam_Stream đang hoạt động, THE Hand_Tracker SHALL xử lý mỗi Frame và trả về tối đa 21 Landmark cho mỗi bàn tay được phát hiện.
2. WHEN Hand_Tracker phát hiện ít nhất một bàn tay, THE System SHALL tính toán Palm_Center của mỗi bàn tay từ trung bình tọa độ của các Landmark 0, 5, 9, 13, 17.
3. WHEN Hand_Tracker phát hiện đủ hai bàn tay, THE System SHALL tính toán Hand_Distance là khoảng cách Euclidean giữa hai Palm_Center.
4. WHEN Hand_Tracker chỉ phát hiện đúng một bàn tay, THE Particle_Cloud SHALL di chuyển đến vị trí Palm_Center của bàn tay đó và duy trì kích thước hiện tại (không thay đổi scale).
5. IF Hand_Tracker không phát hiện bàn tay nào, THEN THE System SHALL hiển thị Particle_Cloud ở vị trí mặc định tại trung tâm màn hình.
6. THE Hand_Tracker SHALL phân biệt bàn tay trái và bàn tay phải dựa trên nhãn handedness từ MediaPipe_Engine.

---

### Requirement 5: Tạo và quản lý Particle Cloud

**User Story:** As a người dùng, I want thấy một đám mây hạt đẹp hiển thị giữa hai lòng bàn tay, so that tôi có trải nghiệm AR trực quan.

#### Acceptance Criteria

1. THE Particle_Cloud SHALL chứa tối thiểu 500 Particle và tối đa 5000 Particle, với số lượng mặc định là 2000 Particle.
2. WHEN Face_Tracker cung cấp 468 Landmark, THE Particle_Cloud SHALL phân bổ các Particle dựa trên vị trí của các Landmark khuôn mặt với nhiễu ngẫu nhiên (jitter) trong bán kính 0.02 đơn vị chuẩn hóa (tương đương `0.02 * viewportWidth` trong Three.js world units, xấp xỉ 3.6 world units với cấu hình camera mặc định).
3. WHEN Hand_Tracker phát hiện đủ hai bàn tay, THE Particle_Cloud SHALL hiển thị tại điểm trung điểm giữa hai Palm_Center.
3a. WHEN Hand_Tracker chỉ phát hiện đúng một bàn tay, THE Particle_Cloud SHALL di chuyển đến vị trí Palm_Center của bàn tay đó và duy trì kích thước hiện tại (không thay đổi scale).
4. THE Particle_Cloud SHALL áp dụng chuyển động nội tại (intrinsic motion) cho mỗi Particle với biên độ dao động tối đa 0.01 đơn vị mỗi Frame để tạo hiệu ứng sống động.
5. WHEN Particle_Cloud được cập nhật, THE Renderer SHALL áp dụng nội suy tuyến tính (lerp) với hệ số 0.1 cho vị trí Particle_Cloud để tạo chuyển động mượt mà.

---

### Requirement 6: Màu sắc Particle

**User Story:** As a người dùng, I want các hạt có màu sắc đẹp từ hồng sáng đến vàng, so that hiệu ứng trông sinh động và hấp dẫn.

#### Acceptance Criteria

1. THE Particle_Cloud SHALL gán màu cho mỗi Particle trong dải màu từ hồng sáng (HSL: 320°, 100%, 75%) đến vàng (HSL: 60°, 100%, 65%).
2. WHEN Particle_Cloud được khởi tạo, THE Renderer SHALL gán màu ngẫu nhiên cho mỗi Particle trong dải màu đã định nghĩa.
3. THE Particle_Cloud SHALL cập nhật màu sắc của mỗi Particle theo thời gian với chu kỳ dao động 2–5 giây để tạo hiệu ứng nhấp nháy nhẹ.
4. WHERE người dùng bật chế độ "Intensity Mode", THE Particle_Cloud SHALL tăng độ sáng của tất cả Particle lên 20% so với giá trị mặc định.

---

### Requirement 7: Điều khiển kích thước Particle Cloud bằng cử chỉ tay

**User Story:** As a người dùng, I want mở rộng hoặc thu lại hai tay để thay đổi kích thước particle cloud, so that tôi có thể tương tác trực tiếp với hiệu ứng AR.

#### Acceptance Criteria

1. WHEN Hand_Distance tăng, THE Particle_Cloud SHALL mở rộng tỷ lệ thuận với Hand_Distance, với tỷ lệ scale tối đa là 3.0 so với kích thước mặc định.
2. WHEN Hand_Distance giảm, THE Particle_Cloud SHALL thu nhỏ tỷ lệ nghịch với Hand_Distance, với tỷ lệ scale tối thiểu là 0.3 so với kích thước mặc định.
3. THE Particle_Cloud SHALL áp dụng nội suy tuyến tính (lerp) với hệ số 0.08 cho giá trị scale để tránh thay đổi đột ngột.
4. WHEN chỉ một bàn tay được phát hiện, THE Particle_Cloud SHALL duy trì kích thước hiện tại và không thay đổi scale.
5. THE System SHALL ánh xạ Hand_Distance trong khoảng [0.05, 0.8] đơn vị chuẩn hóa sang scale [0.3, 3.0] của Particle_Cloud.

---

### Requirement 8: Hiệu ứng Neon Frame

**User Story:** As a người dùng, I want thấy khung neon xung quanh màn hình, so that trải nghiệm có cảm giác AR/sci-fi.

#### Acceptance Criteria

1. THE HUD_Overlay SHALL hiển thị khung neon với màu cyan (hex: #00FFFF) và độ rộng 2 pixels dọc theo viền màn hình.
2. THE HUD_Overlay SHALL áp dụng hiệu ứng glow (box-shadow hoặc WebGL blur) với bán kính 8 pixels cho khung neon.
3. THE HUD_Overlay SHALL animate khung neon với hiệu ứng pulse có chu kỳ 3 giây và biên độ opacity từ 0.6 đến 1.0.
4. WHERE Face_Tracker phát hiện khuôn mặt, THE HUD_Overlay SHALL hiển thị thêm các đường viền neon màu tím (hex: #FF00FF) bao quanh vùng khuôn mặt. Bounding box được tính từ giá trị min/max của tọa độ x và y trong toàn bộ 468 Landmark, với padding 5% chiều rộng và chiều cao bounding box để tránh clip các điểm biên.

---

### Requirement 9: HUD Overlay và thông tin trạng thái

**User Story:** As a người dùng, I want thấy thông tin trạng thái hệ thống trên màn hình, so that tôi biết hệ thống đang hoạt động bình thường.

#### Acceptance Criteria

1. THE HUD_Overlay SHALL hiển thị số FPS hiện tại ở góc trên bên trái, cập nhật mỗi 500ms.
2. THE HUD_Overlay SHALL hiển thị số lượng Landmark khuôn mặt đang được theo dõi (0 hoặc 468) ở góc trên bên phải.
3. THE HUD_Overlay SHALL hiển thị số lượng bàn tay đang được phát hiện (0, 1, hoặc 2) ở góc dưới bên trái.
4. THE HUD_Overlay SHALL hiển thị số lượng Particle hiện tại trong Particle_Cloud ở góc dưới bên phải.
5. WHILE Face_Tracker đang xử lý, THE HUD_Overlay SHALL hiển thị chỉ báo trạng thái "TRACKING" màu xanh lá.
6. IF Face_Tracker mất dấu khuôn mặt quá 1 giây, THEN THE HUD_Overlay SHALL thay đổi chỉ báo trạng thái thành "SEARCHING" màu vàng.

---

### Requirement 10: Hiệu suất render 60 FPS

**User Story:** As a người dùng, I want ứng dụng chạy mượt mà ở 60 FPS trên laptop thông thường, so that trải nghiệm AR không bị giật lag.

#### Acceptance Criteria

1. THE Renderer SHALL duy trì tốc độ render tối thiểu 60 FPS trên thiết bị có GPU tích hợp (Intel HD Graphics hoặc tương đương) với Particle_Cloud chứa 2000 Particle.
2. THE Renderer SHALL sử dụng `requestAnimationFrame` để đồng bộ vòng lặp render với tần số làm mới màn hình.
3. THE Renderer SHALL sử dụng Three.js `BufferGeometry` với `Points` material để render Particle_Cloud hiệu quả trên GPU.
4. WHEN FPS giảm xuống dưới 45 trong 3 giây liên tiếp, THE System SHALL tự động giảm số lượng Particle xuống 50% để khôi phục hiệu suất.
4a. WHEN FPS phục hồi trên 55 trong 5 giây liên tiếp, THE System SHALL tăng dần số lượng Particle trở lại giá trị người dùng đã cài đặt, tăng 10% mỗi 2 giây.
5. THE MediaPipe_Engine SHALL chạy trên main thread và sử dụng `requestIdleCallback` với `{ timeout: 16 }` để schedule detection khi frame rảnh. Do mỗi lần `send()` tốn ~15–30ms và face/hands được xen kẽ theo frame, throughput thực tế là ~15–30 detections/giây cho mỗi model — đủ cho trải nghiệm real-time mượt mà. Lý do: CDN package cũ của MediaPipe tải WASM qua relative URL cần DOM context và không tương thích với Web Worker.

---

### Requirement 11: Giao diện người dùng và điều khiển

**User Story:** As a người dùng, I want có các nút điều khiển cơ bản, so that tôi có thể tùy chỉnh trải nghiệm.

#### Acceptance Criteria

1. THE System SHALL cung cấp nút "Start/Stop" để bật/tắt vòng lặp tracking và render.
2. THE System SHALL cung cấp thanh trượt (slider) để điều chỉnh số lượng Particle trong khoảng [500, 5000].
3. THE System SHALL cung cấp nút "Reset" để đặt lại Particle_Cloud về vị trí và kích thước mặc định.
4. THE System SHALL cung cấp nút toggle "Intensity Mode" để bật/tắt chế độ tăng độ sáng particle.
5. WHERE người dùng bật chế độ "Mirror Mode", THE System SHALL lật ngang (flip horizontal) cả Webcam_Stream lẫn Particle_Cloud để đảm bảo particle cloud vẫn khớp với vị trí tay trong chế độ gương.
6. THE System SHALL lưu trạng thái các tùy chọn người dùng vào `localStorage` và khôi phục khi tải lại trang.

---

### Requirement 12: Tương thích trình duyệt và bảo mật

**User Story:** As a người dùng, I want ứng dụng hoạt động ổn định trong Chrome mà không có cảnh báo bảo mật, so that tôi có thể sử dụng ngay mà không lo lắng.

#### Acceptance Criteria

1. THE System SHALL hoạt động trên Chrome phiên bản 90 trở lên mà không yêu cầu flag thực nghiệm.
2. THE System SHALL yêu cầu kết nối HTTPS hoặc localhost để truy cập Webcam_Stream theo chính sách bảo mật của trình duyệt.
3. THE System SHALL không gửi dữ liệu Webcam_Stream hay Landmark ra ngoài trình duyệt; toàn bộ xử lý diễn ra cục bộ (client-side only).
4. THE System SHALL hiển thị thông báo rõ ràng về chính sách quyền riêng tư khi khởi động lần đầu.
5. IF trình duyệt không hỗ trợ WebGL 2.0, THEN THE System SHALL hiển thị thông báo yêu cầu nâng cấp trình duyệt và dừng khởi tạo.

---

### Requirement 13: Ánh xạ tọa độ 2D MediaPipe sang không gian 3D Three.js

**User Story:** As a developer, I want tọa độ Landmark từ MediaPipe được ánh xạ chính xác sang không gian 3D của Three.js, so that particle cloud hiển thị đúng vị trí tương ứng với khuôn mặt và bàn tay trong thực tế.

#### Acceptance Criteria

1. THE System SHALL ánh xạ tọa độ x của Landmark từ khoảng [0, 1] sang Three.js world space theo công thức: `worldX = (landmarkX - 0.5) * viewportWidth`, trong đó `viewportWidth` là chiều rộng viewport Three.js tính bằng đơn vị world.
2. THE System SHALL ánh xạ tọa độ y của Landmark từ khoảng [0, 1] sang Three.js world space theo công thức: `worldY = (0.5 - landmarkY) * viewportHeight`, đảo trục y để khớp với hệ tọa độ Three.js (y tăng lên trên).
3. THE System SHALL ánh xạ tọa độ z của Landmark từ khoảng [-1, 1] sang Three.js world space theo công thức: `worldZ = landmarkZ * depthScale`, trong đó `depthScale` là hằng số cấu hình với giá trị mặc định là 50 đơn vị world, tạo chiều sâu cảm nhận được.
4. WHEN Mirror Mode được tắt, THE System SHALL ánh xạ x theo chiều thuận (landmarkX = 0 tương ứng cạnh trái màn hình).
5. WHEN Mirror Mode được bật, THE System SHALL đảo ngược trục x trong quá trình ánh xạ theo công thức: `worldX = (0.5 - landmarkX) * viewportWidth`.
6. THE System SHALL tính toán `viewportWidth` và `viewportHeight` dựa trên camera frustum của Three.js với các thông số mặc định: FOV = 75°, near = 0.1, far = 1000, camera position z = 100. Công thức: `viewportHeight = 2 * tan(FOV/2 * π/180) * cameraZ`, `viewportWidth = viewportHeight * aspectRatio`.

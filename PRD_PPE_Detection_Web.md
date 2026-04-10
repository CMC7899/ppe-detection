# PRD: Hệ thống Giám sát Bảo hộ Lao động (PPE Detection) trên Web

## 1. Tổng quan

### 1.1. Tên sản phẩm
PPE Detection Web (Offline-first)

### 1.2. Mục tiêu
Xây dựng ứng dụng web chạy trực tiếp trên laptop, sử dụng **camera tích hợp của thiết bị** để kiểm tra trang bị bảo hộ của người lao động trước khi cho phép vào khu vực làm việc.

### 1.3. Phạm vi
- Chạy hoàn toàn trên trình duyệt (client-side).
- AI inference tại chỗ bằng MediaPipe (không gửi ảnh/video lên server).
- Lưu trữ cục bộ bằng IndexedDB (Dexie).
- Không sử dụng relay/controller cửa.

### 1.4. Công nghệ
- Next.js (App Router)
- MediaPipe Vision SDK (`@mediapipe/tasks-vision`)
- IndexedDB + Dexie.js
- TailwindCSS
- Export báo cáo: `xlsx`, `file-saver`

---

## 2. Yêu cầu chức năng

## 2.1. Quản lý luồng video & AI inference (Edge Computing)

### 2.1.1. Camera thiết bị
- Tự động mở camera trên **laptop/device hiện tại** qua `getUserMedia`.
- Ưu tiên camera mặc định (integrated webcam).
- Nếu thiết bị có nhiều camera, cho phép chọn camera từ danh sách.
- Hiển thị trạng thái camera:
  - Đang kết nối
  - Không có quyền truy cập
  - Không tìm thấy camera

### 2.1.2. AI inference tại chỗ
- Sử dụng MediaPipe Tasks Vision để chạy Object Detection trực tiếp trong browser.
- Không upload frame/video lên backend.
- Nhận diện tối thiểu các lớp:
  - `Person`
  - `Hardhat`
  - `Safety Vest`
  - `Gloves`

### 2.1.3. Overlay thời gian thực
- Vẽ bounding box lên canvas đè trên video:
  - Màu xanh: đối tượng PPE đã phát hiện.
  - Màu đỏ: cảnh báo đối tượng thiếu (theo checklist logic).
- Hiển thị nhãn + confidence cho từng detection.

### 2.1.4. ROI (Region of Interest)
- Cho phép người dùng vẽ/chỉnh ROI hình chữ nhật trên màn hình.
- Chỉ kích hoạt kiểm tra PPE khi:
  - phát hiện `Person` nằm trong ROI liên tục > 2 giây.

---

## 2.2. Logic kiểm tra (Business Rules)

### 2.2.1. Quy tắc Đạt
Trạng thái **Đạt / Cho phép vào** khi đồng thời thỏa:
1. Có `Person`
2. Có `Hardhat`
3. Có `Safety Vest`

> `Gloves` là cấu hình mở rộng (có thể bắt buộc hoặc không trong Settings).

### 2.2.2. Checklist trực quan
- Hiển thị checklist realtime bên phải video (Dashboard), ví dụ:
  - `[x] Mũ bảo hộ`
  - `[x] Áo phản quang`
  - `[ ] Găng tay`
- Badge trạng thái tổng:
  - `Cho phép vào` (xanh)
  - `Từ chối` (đỏ)

### 2.2.3. Chống lặp sự kiện
- Dùng debounce/cooldown để không tạo log liên tục theo từng frame.
- Mỗi lượt kiểm tra tạo 1 bản ghi có trạng thái cuối cùng.

---

## 2.3. Lưu trữ cục bộ (IndexedDB với Dexie.js)

### 2.3.1. Bảng logs
Mỗi lần kiểm tra (đạt hoặc thiếu) lưu:
- `id`
- `timestamp`
- `snapshotBase64` (ảnh chụp tại thời điểm kiểm tra)
- `detectedItems[]`
- `missingItems[]`
- `status` (`ALLOWED` | `DENIED`)

### 2.3.2. Bảng settings
Lưu cấu hình hệ thống:
- `confidenceThreshold` (mặc định `0.6`)
- `requiredPPE[]` (mặc định `hardhat`, `safety_vest`)
- `roiRect` (tọa độ ROI tương đối)

### 2.3.3. Nguyên tắc offline-first
- Hoạt động được khi không có mạng.
- Dữ liệu lưu và đọc hoàn toàn local.

---

## 2.4. Giao diện người dùng (UI/UX)

## 2.4.1. Dashboard
Bố cục 2 cột:
- Trái: Video camera + canvas overlay + ROI
- Phải: Checklist PPE + trạng thái hiện tại + 5 log gần nhất

Yêu cầu trải nghiệm:
- Trạng thái rõ ràng, nhìn 1 lần là biết “Đạt/Thiếu”.
- Thông báo lỗi camera thân thiện, dễ hiểu.

## 2.4.2. Lịch sử (`/history`)
- Bảng danh sách logs từ IndexedDB.
- Bộ lọc:
  - Theo thời gian (from/to)
  - Theo trạng thái (`ALLOWED`, `DENIED`, `ALL`)
- Nút `Export Excel` xuất báo cáo trực tiếp từ trình duyệt.

## 2.4.3. Cài đặt (`/settings`)
- Chỉnh `Confidence Threshold`.
- Bật/tắt PPE bắt buộc (`hardhat`, `safety_vest`, `gloves`).
- Lưu ROI mặc định.

---

## 3. Thiết kế giao diện (Theme)

Màu chủ đạo:
- White
- Light Grey
- Light Blue (main)

Gợi ý palette:
- Background: `#F8FAFC`
- Card: `#FFFFFF`
- Border: `#E2E8F0`
- Primary: `#3B82F6`
- Primary soft: `#DBEAFE`
- Success: `#22C55E`
- Danger: `#EF4444`

---

## 4. Yêu cầu phi chức năng

### 4.1. Hiệu năng
- Inference mục tiêu 10–15 FPS trên laptop phổ thông.
- Có cơ chế hạ độ phân giải để giữ độ mượt.

### 4.2. Bảo mật & quyền riêng tư
- Không gửi ảnh/video ra server.
- Toàn bộ xử lý và lưu trữ local.

### 4.3. Tương thích triển khai
- Deploy lên Cloudflare Pages.
- Ưu tiên kiến trúc client-side/static cho các trang camera và dữ liệu local.

---

## 5. Tiêu chí hoàn thành (Acceptance Criteria)

1. Mở Dashboard, camera laptop hoạt động bình thường.
2. Có thể vẽ ROI và chỉ kiểm tra khi người ở trong ROI > 2 giây.
3. Checklist cập nhật realtime theo kết quả detect.
4. Rule pass mặc định hoạt động: `Person + Hardhat + Safety Vest`.
5. Mỗi lượt kiểm tra đều lưu log vào IndexedDB kèm snapshot.
6. History lọc được theo thời gian/trạng thái.
7. Export Excel thành công ngay trên browser.
8. Settings lưu và áp dụng lại sau khi reload trang.
9. Ứng dụng hoạt động mà không cần relay/controller cửa.

---

## 6. Ngoài phạm vi (Out of Scope)

- Tích hợp relay mở cửa vật lý.
- Đồng bộ logs lên server cloud.
- Quản lý người dùng/đăng nhập phân quyền.

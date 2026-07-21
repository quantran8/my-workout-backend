# Session Logging (§4) — Flow & Rules

## Vị trí trong hệ thống
```
program_revision (bài đã kê)
   ↓ user tập
LOG BUỔI (workout_session + logged_set)  ← nguồn sự thật của moat
   ↓ [CODE] computeSessionFeedback()  → phản hồi ngay (free, ~$0)
   ↓ lưu lịch sử
   → [PAID] progress_rollup (§5) đọc lịch sử này để phân tích xu hướng
```

## Nguyên tắc

**1. Log AGAINST prescription.** Mỗi `logged_set.prescriptionId` trỏ về bài đã kê → cho phép so *planned vs actual* và tính `completionPct`. Tập tự do (ngoài plan) thì `prescriptionId = null`, vẫn log được.

**2. Field áp dụng tùy `exercise_type`** (UI chỉ hiện field liên quan):
- resistance → reps + weight
- cardio → duration + distance + pace (+ stroke nếu bơi)
- mobility → duration + rom

**3. Chuỗi nguồn, đáy là manual (§5B).** Thứ gì auto-detect được thì tự điền; không thì buộc user nhập — không field nào trống:
```
distance/pace ← smart_trainer/sensor → GPS → machine_manual → (chỉ duration)
heart_rate    ← wearable → (không có)
effort        ← wearable.hr → RPE (user nhập)
reps/weight   ← user nhập (luôn)
```
Ghi `fieldSources[field] = auto|manual` để §5 hạ `confidence` cho dữ liệu manual.

**4. Kỷ luật buộc nhập tối thiểu** (chống rò retention): chỉ buộc field moat cần (duration/distance-hoặc-resistance/RPE); tự động tối đa phần còn lại; một màn sau buổi, preset + điền sẵn giá trị lần trước.

**5. `wearable` cách ly:** nullable, và KHÔNG field feedback/progress nào phụ thuộc nó. Engine chạy đủ khi wearable = null.

## Phản hồi ngay sau buổi (free, code thuần)
`computeSessionFeedback()` — đã build & test:
- So buổi này với **lần gần nhất cùng bài**; hướng chuẩn hóa (`better` = tiến bộ).
- resistance: khối lượng set tốt nhất ↑ | cardio: pace ↓ hoặc distance ↑ | mobility: hold ↑.
- Bài lần đầu → `baseline` (lưu mốc, không bịa so sánh).
- Câu tổng: "Hoàn thành X% — tiến bộ ở N/M bài so với lần trước."
- **Không LLM.** LLM (nếu muốn) chỉ làm mượt câu, không tạo số.

## Thu data cho CẢ free user
Free tier **vẫn log đầy đủ** (chi phí ~$0 vì code). Lý do:
1. Khi user nâng cấp, progress_rollup có ngay lịch sử để phân tích — không bắt đầu từ 0.
2. Preview khóa ("🔒 đang ghi nhận buổi tập của bạn") hoạt động được.
> Free có phản hồi-sau-buổi + baseline; KHÔNG có phân tích xu hướng (§5, paid). Ranh giới rõ.

## Nối tiếp
- `session-feedback.ts` (free) ← đang ở đây.
- `progress-rollup` (§5, paid) đọc cùng `logged_set` này → verdict xu hướng + metric theo distance_source/effort_basis (§5B). Cùng nguồn sự thật, khác tầng phân tích.

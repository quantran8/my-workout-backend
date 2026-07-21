# Movement Library — build từ Free Exercise DB

## Nguồn
- **Repo:** `yuhonas/free-exercise-db` — 873 bài, JSON, kèm ảnh start/end.
- **License:** Unlicense (public domain) → **dùng thương mại thoải mái, không cần ghi công.**
- Ảnh host trên raw.githubusercontent (CDN) — có thể dùng trực tiếp hoặc tải về tự host.

## Output
| File | Nội dung |
|---|---|
| `build_movement_library.py` | Pipeline re-runnable: exercises.json → library. Chạy lại khi nguồn cập nhật. |
| `movement_library_full.json` | Cả 873 bài đã enrich (tham chiếu). |
| `movement_library_curated.json` | **585 bài** lọc cho target (beginner–intermediate, home/minimal). Đây là pool để duyệt xuống ~150–250. |
| `movement_library_schema.sql` | DDL bảng `exercise` + index + `review_queue` + ví dụ query chọn bài. |

## Mức tin cậy từng field — ĐỌC TRƯỚC KHI DÙNG

Đây là điểm quan trọng nhất. Không phải field nào cũng tin được như nhau:

### ✅ Deterministic — tin, dùng luôn
`name`, `primary_muscles`, `secondary_muscles`, `equipment`, `difficulty*`, `is_compound`,
`exercise_type`, `cues` (instructions từ nguồn kiểm chứng), `media`.
> *`difficulty` map thẳng từ level của nguồn. Cảnh báo: nguồn gán "Barbell Squat = beginner" — với dân văn phòng chưa tập thì KHÔNG đúng. Nên rà lại difficulty cho nhóm bài có kỹ thuật/tải cao.

### ⚠️ Heuristic — máy đề xuất, PHẢI người duyệt (`needs_review = true`)
`movement_pattern`, `goal_fit`, `is_unilateral`.
> Độ chính xác trên bài nền (squat/hinge/press/row) rất cao, nhưng bài lạ/biến thể dễ sai. Duyệt trước khi cho vào production.

### 🚫 An toàn — CHỈ ứng viên, KHÔNG bao giờ auto làm chân lý
`contraindications` — luôn `needs_review = true`, kể cả khi có giá trị.
> Đây là seed heuristic (bài tải lower_back/gối/vai) để **gợi ý cho người duyệt**, không phải kết luận. **Bắt buộc PT/người có chuyên môn xác nhận** trước khi guardrail dựa vào. Sai field này = user chấn thương.

### ✋ Để trống — link tay
`progression_of`, `regression_of` (chuỗi tăng/giảm độ khó), `aliases`, `video_url`.
> Không auto được đáng tin. Link tay dần, ưu tiên các bài nền.

## Quy trình duyệt đề xuất
1. Chạy `review_queue` (trong schema.sql) — ưu tiên bài có `contraindications` (rủi ro an toàn cao nhất).
2. Duyệt xuống **~150–250 bài core** cho v1: giữ các pattern nền (squat/hinge/push/pull/lunge/carry) + phụ trợ chính + mobility. Bỏ bớt isolation trùng lặp (nguồn có 200+ isolation).
3. Với mỗi bài giữ lại: xác nhận `movement_pattern`, `goal_fit`, `difficulty`, và **duyệt `contraindications`**; set `reviewed_by`.
4. Link `progression_of`/`regression_of` cho các bài nền để phần thay thế/điều chỉnh độ khó hoạt động.

## Nối vào data model
- Bảng này = khối **Movement Library (§2)**.
- `contraindications` ← **guardrail (§1 flags)** đọc để loại bài theo `injuries[]` của user.
- `movement_pattern` + `goal_fit` + `equipment` ← filter khi **gen chương trình (§3)** và khi **thay thế bài** (§6.1 concept).
- `exercise_type` ← quyết định field nào log ở **session_log (§4)** và metric progress ở **§5**.

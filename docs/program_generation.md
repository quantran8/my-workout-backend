# Program Generation — LLM Contract + Validate/Repair Loop (Static Plan / Free Path)

## Luồng
```
guardrail (allowedPool + policy + phasePriority)
   ↓  [LLM]  gen chương trình (JSON, CHỈ chọn từ pool, tuân policy)
   ↓  [CODE] validateProgram()  → violations?
        ├─ ok        → lưu revision 1 (static, đóng băng)
        └─ có vi phạm → re-prompt LLM kèm violations (tối đa N lần) → validate lại
```
**Trọng tâm:** LLM sinh, CODE gác. LLM không bao giờ được là lời cuối về an toàn/khối lượng. Đây là lý do validator (`program-validator.ts`) tồn tại — đã test bắt được bài bịa, vượt volume, cardio thừa, thiếu phân giai đoạn.

## Static vs Living (nhắc lại ranh giới free/paid)
- **Static (free):** gen **revision 1, đóng băng**. Không có `progressionRule` động, không phân tích progress. Đây là path đang build.
- **Living (paid):** progress_rollup → sinh revision mới. KHÔNG thuộc phạm vi file này.

---

## System Prompt (gen static program)

> Bạn là bộ soạn chương trình tập. Soạn một chương trình có cấu trúc, xuất **DUY NHẤT một JSON** đúng schema, không thêm chữ ngoài JSON. **Ràng buộc tuyệt đối:**
> 1. **CHỈ dùng bài có `exercise_id` trong `allowed_pool` được cung cấp.** Không bịa bài, không dùng bài ngoài danh sách. Nếu pool thiếu bài cho một pattern, dùng bài gần nhất TRONG pool.
> 2. **Tuân `policy`:**
>    - `max_weekly_sets_per_muscle`: tổng số set mỗi nhóm cơ chính/tuần KHÔNG vượt trần này.
>    - `conservative_start = true`: bắt đầu nhẹ, rep vừa phải, không tối đa tạ.
>    - `allow_calorie_deficit = false`: (phần dinh dưỡng) không đề xuất ăn kiêng/thâm hụt.
>    - `must_resolve_goal_conflict = true`: theo `goal_phase_priority` — giai đoạn 1 ưu tiên nhóm mục tiêu đầu, cardio **tối đa 2 buổi/tuần** cường độ thấp; nâng mục tiêu sau ở giai đoạn 2. Bắt buộc điền `phasePlan`.
> 3. Số buổi/tuần = `schedule.days_per_week`. Mỗi buổi có `focus` rõ.
> 4. `goalSummary`: 1–2 câu giải thích chương trình nhắm gì & vì sao (dựa trên profile) — đây là phần "giải thích vì sao" cho user.
> 5. KHÔNG tự ý đặt `target_weight_kg` cao; để hợp với `conservative_start` và kinh nghiệm user.

## Input gửi cho LLM
```json
{
  "profile": { "constraint": {...}, "target": {...} },
  "allowed_pool": [ {"exercise_id","name","movement_pattern","primary_muscles","goal_fit","equipment","difficulty","exercise_type","default_prescription"}, ... ],
  "policy": {
    "max_weekly_sets_per_muscle": 10,
    "conservative_start": true,
    "allow_calorie_deficit": false,
    "must_resolve_goal_conflict": true,
    "goal_phase_priority": ["strength_hypertrophy_phase1","endurance_phase2"]
  },
  "schedule": { "days_per_week": 3, "minutes_per_session": 45 }
}
```
> Chỉ gửi field cần của mỗi exercise (không gửi cả `cues`/`media`) để tiết kiệm token.

## Output Schema (khớp `program.types.ts`)
```json
{
  "goalSummary": "string",
  "phasePlan": [{"phase":"string","weeks":[1,6],"focus":"string"}],
  "sessions": [
    {
      "weekNumber": 1, "dayNumber": 1, "focus": "Full body A",
      "prescriptions": [
        {"exerciseId":"goblet_squat","order":1,"targetSets":3,"targetReps":[8,12],"targetRpe":7,"restSec":90}
      ]
    }
  ]
}
```
> `programId`/`prescriptionId`/`revisionId` do backend gán (không để LLM sinh). `type='static'`, `currentRevision=1`, `adjustmentReason=null` do backend set.

---

## Validate/Repair Loop (code)

```ts
async function generateStaticProgram(profile, guard, schedule, llm) {
  let lastViolations = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const draft = await llm.generateProgram({
      profile, allowed_pool: slimPool(guard.allowedPool), policy: guard.policy, schedule,
      previous_violations: lastViolations,   // rỗng ở lần đầu
    });
    const program = assembleProgram(draft, profile, /*type*/ 'static'); // backend gán id, set static
    const { ok, violations } = validateProgram(program, guard, { expectedDaysPerWeek: schedule.daysPerWeek });
    if (ok) return program;               // ✓ lưu revision 1 đóng băng
    lastViolations = violations;          // ✗ re-prompt kèm vi phạm cụ thể
  }
  throw new Error('LLM không tạo được chương trình hợp lệ sau 3 lần; fallback template hoặc báo lỗi mềm');
}
```

Khi re-prompt, thêm vào prompt: *"Bản trước vi phạm: [violations]. Sửa đúng những điểm này, giữ nguyên phần còn lại."* Model rẻ thường sửa được ngay lần 2 vì lỗi rất cụ thể.

## Fallback (nếu LLM fail 3 lần)
Với static plan, có thể có **template chương trình mặc định theo goal + experience** (soạn sẵn bằng tay, chỉ dùng bài phổ biến chắc chắn trong pool) để không bao giờ để user tay trắng. An toàn hơn là ép LLM lần 4.

---

## Vì sao lớp này quan trọng
`validateProgram()` đã được test bắt: bài bịa ngoài pool, vượt trần volume (quads+glutes 14>10), cardio thừa khi goal-conflict, thiếu phasePlan. Không có validator, mọi lỗi đó lọt tới user — và đó đúng là loại lỗi "nghe hợp lý nhưng sai" mà tự test bằng mắt không bắt được. Validator biến "LLM có kiểm soát" từ khẩu hiệu thành cơ chế.

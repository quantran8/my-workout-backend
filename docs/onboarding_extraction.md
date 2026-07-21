# Onboarding Extraction — LLM Contract (Profile Draft)

LLM **CHỈ TRÍCH** (extraction), không tính toán, không suy diễn số. Mọi con số/flag an toàn là CODE deterministic sau đó (`flags.ts`). Đây là bước 1 của flow onboarding (concept §A).

## Luồng
```
POST /profile/extract {rawText}
   ↓ [LLM] extractProfile(rawText)  → JSON đúng schema Profile (thiếu bmi/redFlags)
   ↓ [CODE] stamp provenance='llm_extracted'
   ↓ [CODE] computeBmi + computeFlags     (flags.ts — KHÔNG do LLM)
   → trả draft + flags cho màn xác nhận
```

## System Prompt (extraction)

> Bạn là bộ trích xuất hồ sơ tập luyện. Đọc đoạn văn người dùng tự kể và xuất **DUY NHẤT một JSON** đúng schema, không thêm chữ ngoài JSON. **Ràng buộc tuyệt đối:**
> 1. **Chỉ trích những gì người dùng NÓI hoặc HÀM Ý rõ ràng.** Không bịa. Thiếu thông tin → để `null` (scalar) hoặc `[]` (mảng), KHÔNG đoán.
> 2. **KHÔNG tính `bmi`.** KHÔNG tạo `redFlags`. Đó là việc của code. Bỏ hẳn 2 field này khỏi output.
> 3. `constraint`: điền các trường có căn cứ (sex, age, heightCm, weightKg, experienceLevel, injuries[], equipment[], schedule, diet...). Chấn thương phải ghi `area` chuẩn hoá và `active` (mặc định true nếu người dùng nói đang đau).
> 4. `target.inferredNeeds[]`: mỗi nhu cầu suy ra kèm `confidence ∈ {high, medium, low}` và `rationale` ngắn (1 câu, vì sao suy ra). Suy diễn thận trọng — nếu không chắc, `confidence='low'`.
> 5. `target.statedGoals[]` = mục tiêu người dùng nói thẳng; `target.problems[]` = vấn đề họ than phiền.

## Input gửi LLM
```json
{ "rawText": "<đoạn người dùng tự kể>" }
```

## Output Schema (khớp `profile.types.ts`, BỎ bmi/redFlags)
```json
{
  "constraint": {
    "sex": "male|female|other|null",
    "age": "int|null",
    "heightCm": "number|null",
    "weightKg": "number|null",
    "experienceLevel": "beginner|intermediate|advanced|null",
    "injuries": [{ "area": "shoulder|knee|lower_back|hip|elbow|wrist|ankle|neck|upper_back", "severity": "mild|moderate|severe|null", "notes": "string?", "active": true }],
    "mobilityLimits": ["string"],
    "equipment": ["string"],
    "space": "home|gym|outdoor|minimal|null",
    "budgetWillingness": "none|minimal|invest|null",
    "schedule": { "daysPerWeek": "int|null", "minutesPerSession": "int|null", "preferredDays": ["string"] },
    "diet": { "type": "string|null", "allergies": ["string"], "restrictions": ["string"] }
  },
  "target": {
    "statedGoals": ["string"],
    "problems": ["string"],
    "inferredNeeds": [
      { "type": "strength|hypertrophy|endurance|power|mobility|weight_gain|weight_loss", "targetArea": ["string"], "rationale": "string", "confidence": "high|medium|low" }
    ]
  }
}
```

> `bmi` (trong constraint) và `redFlags` do backend điền sau bằng `computeBmi`/`computeFlags`. `provenance` do backend stamp = `llm_extracted`.

## Sau extraction (CODE, không LLM)
- `provenance = 'llm_extracted'` cho toàn draft.
- `computeBmi(weightKg, heightCm)` → gán `constraint.bmi`.
- `computeFlags(profile)` → `redFlags[]` (BMI thấp, chấn thương, xung đột mục tiêu...). Đây là nơi an toàn được quyết định, KHÔNG phải LLM.
- Trả `{ profile, flags }` cho màn xác nhận; user sửa → `PUT /profile` recompute flags trên bản đã sửa.

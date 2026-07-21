-- Movement Library — schema (Postgres; SQLite bỏ JSONB -> TEXT/JSON)
-- Load từ movement_library_curated.json

CREATE TABLE exercise (
    exercise_id        TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    aliases            JSONB DEFAULT '[]',
    exercise_type      TEXT NOT NULL CHECK (exercise_type IN ('resistance','cardio','mobility')),

    -- deterministic (tin cậy, dùng luôn)
    primary_muscles    JSONB NOT NULL,
    secondary_muscles  JSONB DEFAULT '[]',
    equipment          JSONB NOT NULL,
    difficulty         INT CHECK (difficulty BETWEEN 1 AND 5),
    is_compound        BOOLEAN,
    cues               JSONB,               -- instructions từ nguồn kiểm chứng
    media              JSONB,               -- {start_img, end_img, video_url}
    source             JSONB,               -- {repo, license, src_category, src_level}

    -- heuristic (PHẢI duyệt trước khi tin)
    movement_pattern   TEXT,
    goal_fit           JSONB,
    is_unilateral      BOOLEAN,

    -- an toàn: CHỈ ứng viên, không bao giờ auto làm chân lý
    contraindications  JSONB DEFAULT '[]',  -- [{injury_area, reason}]

    -- link tay
    progression_of     TEXT REFERENCES exercise(exercise_id),
    regression_of      TEXT REFERENCES exercise(exercise_id),
    default_prescription JSONB,

    -- trạng thái duyệt
    needs_review       JSONB,               -- {movement_pattern, goal_fit, ... : bool}
    reviewed_by        TEXT,                -- ai đã duyệt (null = chưa)
    reviewed_at        TIMESTAMP
);

-- filter chính khi gen chương trình (mục 6.1 concept):
CREATE INDEX idx_ex_pattern  ON exercise (movement_pattern);
CREATE INDEX idx_ex_type     ON exercise (exercise_type);
CREATE INDEX idx_ex_difficulty ON exercise (difficulty);
-- GIN cho truy vấn theo phần tử trong mảng (equipment/goal_fit/muscles):
CREATE INDEX idx_ex_equipment ON exercise USING GIN (equipment);
CREATE INDEX idx_ex_goalfit   ON exercise USING GIN (goal_fit);
CREATE INDEX idx_ex_primary   ON exercise USING GIN (primary_muscles);

-- Hàng đợi duyệt: bài chưa review, ưu tiên bài có ứng viên contraindication (rủi ro an toàn cao)
CREATE VIEW review_queue AS
SELECT exercise_id, name, movement_pattern, goal_fit, difficulty, contraindications
FROM exercise
WHERE reviewed_by IS NULL
ORDER BY (jsonb_array_length(contraindications) > 0) DESC, exercise_id;

-- Ví dụ truy vấn CHỌN BÀI khi gen chương trình:
--   "hinge, cho hypertrophy, chỉ dumbbell/bodyweight, tránh chấn thương lower_back, đã duyệt"
-- SELECT * FROM exercise
-- WHERE movement_pattern = 'hinge'
--   AND goal_fit ? 'hypertrophy'
--   AND equipment ?| array['dumbbell','bodyweight']
--   AND NOT (contraindications @> '[{"injury_area":"lower_back"}]')
--   AND reviewed_by IS NOT NULL;

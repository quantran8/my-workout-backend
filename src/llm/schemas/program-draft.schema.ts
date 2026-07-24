/**
 * JSON Schema for generateProgram output (khớp program_generation.md §Output Schema).
 * Backend gán programId/prescriptionId/revisionId, set type='static' sau — LLM KHÔNG sinh.
 * targetReps là int | [min,max]: strict mode dùng anyOf.
 */
export const PROGRAM_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['goalSummary', 'durationWeeks', 'phasePlan', 'sessions'],
  properties: {
    goalSummary: { type: 'string' },
    // Tổng số tuần chương trình kéo dài (vd 12 = 3 tháng). Validator kẹp [2,24].
    // sessions phải phủ đúng 1..durationWeeks, mỗi tuần đủ số buổi theo lịch.
    durationWeeks: { type: 'integer' },
    phasePlan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phase', 'weeks', 'focus'],
        properties: {
          phase: { type: 'string' },
          weeks: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 2,
            maxItems: 2,
          },
          focus: { type: 'string' },
        },
      },
    },
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['weekNumber', 'dayNumber', 'focus', 'prescriptions'],
        properties: {
          weekNumber: { type: 'integer' },
          dayNumber: { type: 'integer' },
          focus: { type: 'string' },
          prescriptions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              // strict mode: mọi property phải có trong `required`; field không
              // áp dụng thì LLM trả null.
              required: [
                'exerciseId',
                'order',
                'targetSets',
                'targetReps',
                'targetWeightKg',
                'targetDurationSec',
                'targetDistanceM',
                'targetPaceSecPerKm',
                'targetRpe',
                'restSec',
                'blocks',
              ],
              properties: {
                exerciseId: { type: 'string' },
                order: { type: 'integer' },
                targetSets: { type: 'integer' },
                targetReps: {
                  anyOf: [
                    { type: 'integer' },
                    {
                      type: 'array',
                      items: { type: 'integer' },
                      minItems: 2,
                      maxItems: 2,
                    },
                    { type: 'null' },
                  ],
                },
                targetWeightKg: { type: ['number', 'null'] },
                targetDurationSec: { type: ['integer', 'null'] },
                targetDistanceM: { type: ['integer', 'null'] },
                targetPaceSecPerKm: { type: ['number', 'null'] },
                targetRpe: { type: ['integer', 'null'] },
                restSec: { type: 'integer' },
                /**
                 * null = bài đơn giản. Mảng = interval/circuit (CHỈ cho bài
                 * cardio) — mỗi vòng lặp trải phẳng thành block riêng, không có
                 * field "repeat", để client chạy tuần tự theo `order`.
                 */
                blocks: {
                  anyOf: [
                    {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: [
                          'order',
                          'phase',
                          'durationSec',
                          'distanceM',
                          'targetRpeMin',
                          'targetRpeMax',
                          'targetPaceSecPerKm',
                          'instruction',
                        ],
                        properties: {
                          order: { type: 'integer' },
                          phase: {
                            type: 'string',
                            enum: ['warmup', 'work', 'recovery', 'cooldown'],
                          },
                          durationSec: { type: ['integer', 'null'] },
                          distanceM: { type: ['integer', 'null'] },
                          targetRpeMin: { type: ['integer', 'null'] },
                          targetRpeMax: { type: ['integer', 'null'] },
                          targetPaceSecPerKm: { type: ['number', 'null'] },
                          instruction: { type: 'string' },
                        },
                      },
                    },
                    { type: 'null' },
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

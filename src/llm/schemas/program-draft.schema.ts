/**
 * JSON Schema for generateProgram output (khớp program_generation.md §Output Schema).
 * Backend gán programId/prescriptionId/revisionId, set type='static' sau — LLM KHÔNG sinh.
 * targetReps là int | [min,max]: strict mode dùng anyOf.
 */
export const PROGRAM_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['goalSummary', 'phasePlan', 'sessions'],
  properties: {
    goalSummary: { type: 'string' },
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
              required: [
                'exerciseId',
                'order',
                'targetSets',
                'targetReps',
                'targetWeightKg',
                'targetDurationSec',
                'targetDistanceM',
                'targetRpe',
                'restSec',
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
                targetRpe: { type: ['integer', 'null'] },
                restSec: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  },
} as const;

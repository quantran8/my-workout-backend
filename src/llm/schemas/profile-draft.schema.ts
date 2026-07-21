/**
 * JSON Schema for extractProfile output (khớp onboarding_extraction.md).
 * Shape khớp Profile (profile.types.ts) NHƯNG bỏ bmi/redFlags — code tính sau.
 * OpenAI json_schema strict mode: mọi object cần additionalProperties:false + required
 * liệt kê MỌI key (optional được biểu diễn bằng type ["...", "null"]).
 */
export const PROFILE_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['constraint', 'target'],
  properties: {
    constraint: {
      type: 'object',
      additionalProperties: false,
      required: [
        'sex',
        'age',
        'heightCm',
        'weightKg',
        'experienceLevel',
        'injuries',
        'mobilityLimits',
        'equipment',
        'space',
        'budgetWillingness',
        'schedule',
        'diet',
      ],
      properties: {
        sex: { type: ['string', 'null'], enum: ['male', 'female', 'other', null] },
        age: { type: ['integer', 'null'] },
        heightCm: { type: ['number', 'null'] },
        weightKg: { type: ['number', 'null'] },
        experienceLevel: {
          type: ['string', 'null'],
          enum: ['beginner', 'intermediate', 'advanced', null],
        },
        injuries: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['area', 'severity', 'notes', 'active'],
            properties: {
              area: {
                type: 'string',
                enum: [
                  'shoulder',
                  'knee',
                  'lower_back',
                  'hip',
                  'elbow',
                  'wrist',
                  'ankle',
                  'neck',
                  'upper_back',
                ],
              },
              severity: {
                type: ['string', 'null'],
                enum: ['mild', 'moderate', 'severe', null],
              },
              notes: { type: ['string', 'null'] },
              active: { type: 'boolean' },
            },
          },
        },
        mobilityLimits: { type: 'array', items: { type: 'string' } },
        equipment: { type: 'array', items: { type: 'string' } },
        space: {
          type: ['string', 'null'],
          enum: ['home', 'gym', 'outdoor', 'minimal', null],
        },
        budgetWillingness: {
          type: ['string', 'null'],
          enum: ['none', 'minimal', 'invest', null],
        },
        schedule: {
          type: 'object',
          additionalProperties: false,
          required: ['daysPerWeek', 'minutesPerSession', 'preferredDays'],
          properties: {
            daysPerWeek: { type: ['integer', 'null'] },
            minutesPerSession: { type: ['integer', 'null'] },
            preferredDays: { type: 'array', items: { type: 'string' } },
          },
        },
        diet: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'allergies', 'restrictions'],
          properties: {
            type: { type: ['string', 'null'] },
            allergies: { type: 'array', items: { type: 'string' } },
            restrictions: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    target: {
      type: 'object',
      additionalProperties: false,
      required: ['statedGoals', 'problems', 'inferredNeeds'],
      properties: {
        statedGoals: { type: 'array', items: { type: 'string' } },
        problems: { type: 'array', items: { type: 'string' } },
        inferredNeeds: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'targetArea', 'rationale', 'confidence'],
            properties: {
              type: {
                type: 'string',
                enum: [
                  'strength',
                  'hypertrophy',
                  'endurance',
                  'power',
                  'mobility',
                  'weight_gain',
                  'weight_loss',
                ],
              },
              targetArea: { type: 'array', items: { type: 'string' } },
              rationale: { type: 'string' },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
          },
        },
      },
    },
  },
} as const;

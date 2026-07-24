import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { LlmConfig } from './llm.config';
import { PROFILE_DRAFT_SCHEMA } from './schemas/profile-draft.schema';
import { PROGRAM_DRAFT_SCHEMA } from './schemas/program-draft.schema';
import type { Profile } from '../profile/profile.types';
import type { GenerateProgramInput, ProgramDraft } from './llm.types';

const EXTRACTION_SYSTEM = `Bạn là bộ trích xuất hồ sơ tập luyện. Đọc đoạn văn người dùng tự kể và xuất DUY NHẤT một JSON đúng schema. Ràng buộc tuyệt đối:
1. Chỉ trích những gì người dùng NÓI hoặc HÀM Ý rõ ràng. Không bịa. Thiếu thông tin -> null (scalar) hoặc [] (mảng), KHÔNG đoán.
2. KHÔNG tính bmi. KHÔNG tạo redFlags. Đó là việc của code.
3. Chấn thương: ghi area chuẩn hoá và active (true nếu người dùng nói đang đau).
4. Mỗi inferredNeed kèm confidence (high|medium|low) và rationale ngắn 1 câu. Không chắc -> confidence='low'.`;

const GENERATION_SYSTEM = `Bạn là bộ soạn chương trình tập. Soạn chương trình có cấu trúc, xuất DUY NHẤT một JSON đúng schema. Ràng buộc tuyệt đối:
1. CHỈ dùng exercise_id có trong allowed_pool. Không bịa bài, không dùng bài ngoài danh sách. Pool thiếu bài cho một pattern -> dùng bài gần nhất TRONG pool.
2. Tuân policy: max_weekly_sets_per_muscle (tổng set mỗi nhóm cơ chính/tuần KHÔNG vượt trần); conservative_start=true -> bắt đầu nhẹ; allow_calorie_deficit=false -> không đề xuất ăn kiêng; must_resolve_goal_conflict=true -> theo goal_phase_priority, cardio tối đa 2 buổi/tuần cường độ thấp, BẮT BUỘC điền phasePlan.
3. Số buổi/tuần = schedule.days_per_week. Mỗi buổi có focus rõ.
4. durationWeeks: chọn độ dài hợp lý cho mục tiêu, TRONG khoảng 2..24 tuần (vd hồi phục 4-6, tăng cơ 8-12, chuyển hoá 12+). sessions PHẢI phủ ĐỦ mọi tuần 1..durationWeeks — mỗi tuần đúng schedule.days_per_week buổi. weekNumber chạy 1..durationWeeks, dayNumber chạy 1..days_per_week trong mỗi tuần.
5. goalSummary: 1-2 câu giải thích chương trình nhắm gì và vì sao.
6. Nếu có previous_violations: sửa đúng những điểm đó, giữ nguyên phần còn lại.`;

/**
 * Một chỗ duy nhất gọi model (spec §4). Provider = OpenAI. Structured output qua
 * response_format json_schema; retry+timeout dùng SDK; một vòng structured-retry re-prompt
 * khi JSON.parse fail.
 *
 * LƯU Ý: LlmService là transport "ngu" — mọi quyết định an toàn/khối lượng/validate ở CODE
 * (flags/guardrail/program-validator). generateProgram KHÔNG tự validate; ProgramService
 * chạy vòng validate/repair quanh nó.
 */
@Injectable()
export class LlmService {
  private readonly client: OpenAI;

  constructor(private readonly config: LlmConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      timeout: config.timeoutMs,
      maxRetries: config.maxRetries,
    });
  }

  /** extractProfile: model rẻ, structured. Trả Profile draft (thiếu bmi/redFlags). */
  async extractProfile(rawText: string): Promise<Profile> {
    return this.callStructured<Profile>({
      model: this.config.modelCheap,
      system: EXTRACTION_SYSTEM,
      user: JSON.stringify({ rawText }),
      schemaName: 'profile_draft',
      schema: PROFILE_DRAFT_SCHEMA as unknown as Record<string, unknown>,
    });
  }

  /** generateProgram: model mạnh (hiếm). Input slim. Trả ProgramDraft (chưa gán id). */
  async generateProgram(input: GenerateProgramInput): Promise<ProgramDraft> {
    const user = JSON.stringify({
      profile: input.profile,
      allowed_pool: input.allowedPool,
      policy: {
        max_weekly_sets_per_muscle: input.policy.maxWeeklySetsPerMuscle,
        conservative_start: input.policy.conservativeStart,
        allow_calorie_deficit: input.policy.allowCalorieDeficit,
        must_resolve_goal_conflict: input.policy.mustResolveGoalConflict,
        goal_phase_priority: input.policy.goalPhasePriority,
      },
      schedule: {
        days_per_week: input.schedule.daysPerWeek,
        minutes_per_session: input.schedule.minutesPerSession,
      },
      previous_violations: input.previousViolations ?? [],
    });
    return this.callStructured<ProgramDraft>({
      model: this.config.modelStrong,
      system: GENERATION_SYSTEM,
      user,
      schemaName: 'program_draft',
      schema: PROGRAM_DRAFT_SCHEMA as unknown as Record<string, unknown>,
    });
  }

  /**
   * Core: gọi chat.completions với response_format json_schema (strict), parse, structured-
   * retry khi parse fail (re-prompt kèm lỗi). Semantic validate để cho caller (code).
   */
  private async callStructured<T>(args: {
    model: string;
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
  }): Promise<T> {
    let lastErr = '';
    for (let attempt = 0; attempt <= this.config.structuredRetries; attempt++) {
      const userContent =
        attempt === 0
          ? args.user
          : `${args.user}\n\nBản trước không parse được JSON hợp lệ: ${lastErr}. Xuất lại JSON đúng schema.`;

      let res: OpenAI.Chat.Completions.ChatCompletion;
      try {
        res = await this.client.chat.completions.create({
          model: args.model,
          messages: [
            { role: 'system', content: args.system },
            { role: 'user', content: userContent },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: args.schemaName,
              strict: true,
              schema: args.schema,
            },
          },
        });
      } catch (e) {
        // Upstream (auth, rate limit, bad model, network) — NOT a parse retry.
        // Surface a clean 503 with the real reason instead of leaking the raw
        // OpenAI error, which Nest would otherwise emit as an opaque status.
        throw new ServiceUnavailableException(
          `LLM provider lỗi: ${e instanceof OpenAI.APIError ? `${e.status ?? '?'} ${e.message}` : e instanceof Error ? e.message : String(e)}`,
        );
      }

      const text = res.choices[0]?.message?.content ?? '';
      try {
        return JSON.parse(text) as T;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    throw new InternalServerErrorException(
      `LLM không trả JSON hợp lệ sau ${this.config.structuredRetries + 1} lần: ${lastErr}`,
    );
  }
}

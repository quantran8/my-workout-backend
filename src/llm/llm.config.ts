import { Injectable } from '@nestjs/common';

/**
 * Centralized LLM provider config — ONE place, env-driven (spec §4: "đổi provider tập
 * trung, không hardcode rải rác"). Cheap tier = extraction/interpret; strong tier = gen
 * program (hiếm nên chi phí ok).
 */
@Injectable()
export class LlmConfig {
  readonly apiKey = process.env.OPENAI_API_KEY ?? '';
  readonly modelCheap = process.env.LLM_MODEL_CHEAP ?? 'gpt-4o-mini';
  readonly modelStrong = process.env.LLM_MODEL_STRONG ?? 'gpt-4o';
  readonly timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 60_000);
  readonly maxRetries = Number(process.env.LLM_MAX_RETRIES ?? 2);
  /** Extra structured-retry attempts when JSON.parse / code-validator fails. */
  readonly structuredRetries = 2;
}

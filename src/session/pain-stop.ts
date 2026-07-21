// session/pain-stop.ts
// DETERMINISTIC. Không LLM. INVARIANT §12.3 — pain_stop TUYỆT ĐỐI không map thành too_hard.
// Đây là quy tắc an toàn quan trọng nhất: một event pain_stop luôn dừng bài/pattern,
// luôn schedule follow-up, và tín hiệu tolerance luôn là 'pain_stop' (không bao giờ 'too_hard').
// Guard mang tính CẤU TRÚC: kiểu trả về hardcode status/triggeredFollowup/mappedToleranceSignal,
// nên không có nhánh code nào trong file này có thể phát ra 'too_hard' cho một pain_stop.

export type PainStopAction = 'stop_exercise' | 'stop_related_pattern' | 'end_session';

export interface PainStopEvent {
  executionItemId: string;
  bodyArea?: string | null;
  // interpreter cung cấp boolean thô (cơn đau lan sang pattern liên quan), KHÔNG phải verdict
  spreadsToRelatedPattern: boolean;
}

export interface PainStopOutcome {
  executionItemStatus: 'stopped'; // LUÔN stopped
  actionTaken: PainStopAction; // ép ∈ 3 action dừng
  triggeredFollowup: true; // LUÔN true
  mappedToleranceSignal: 'pain_stop'; // KHÔNG BAO GIỜ 'too_hard'
  ruleVersion: string;
}

const RULE_VERSION = 'painstop/v4.0';

/**
 * Áp quy tắc pain-stop cho một feedback event type='pain_stop'.
 * - lan sang pattern liên quan  -> stop_related_pattern
 * - chỉ khu trú ở một body area  -> stop_exercise
 * - không xác định được vùng     -> end_session (thận trọng nhất)
 */
export function applyPainStop(event: PainStopEvent): PainStopOutcome {
  const actionTaken: PainStopAction = event.spreadsToRelatedPattern
    ? 'stop_related_pattern'
    : event.bodyArea
      ? 'stop_exercise'
      : 'end_session';

  return {
    executionItemStatus: 'stopped',
    actionTaken,
    triggeredFollowup: true,
    mappedToleranceSignal: 'pain_stop',
    ruleVersion: RULE_VERSION,
  };
}

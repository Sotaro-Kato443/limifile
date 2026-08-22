import type {
  TargetFitCandidate,
  TargetFitConditionChecklist,
  TargetFitRequest,
} from "./target-fit-types";

const EXPECTED_MIME_TYPE = "image/jpeg";

/**
 * candidateとrequestから、幅・高さ・容量・形式の4条件を独立に実測判定する純粋関数。
 *
 * アルゴリズム上「幅・高さは常にtargetと一致するはず」「形式は常にJPEGのはず」であっても、
 * このverification layerはそれを前提とせず、渡された値を毎回そのまま比較する
 * (レビューで明示された方針: 達成しているふりをしない。ok:trueを型で決め打ちしない)。
 * target-fit.worker.tsとSignatureResizerWorkbenchの両方から同じ関数を呼び、
 * 判定ロジックの二重実装を避ける。
 */
export function buildConditionChecklist(
  candidate: TargetFitCandidate,
  request: TargetFitRequest,
): TargetFitConditionChecklist {
  return {
    width: {
      ok: candidate.width === request.targetWidth,
      actual: candidate.width,
      target: request.targetWidth,
    },
    height: {
      ok: candidate.height === request.targetHeight,
      actual: candidate.height,
      target: request.targetHeight,
    },
    size: {
      ok: candidate.bytes <= request.maxBytes,
      actualBytes: candidate.bytes,
      maxBytes: request.maxBytes,
    },
    format: {
      ok: candidate.mimeType === EXPECTED_MIME_TYPE,
      actual: candidate.mimeType,
    },
  };
}

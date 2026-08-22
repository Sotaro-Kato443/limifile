import { useEffect, useRef } from "preact/hooks";
import { normalizeToolErrorCode, trackToolEvent } from "./tool-events";

export interface TrackableProcessingStatus {
  kind: string;
  reason?: unknown;
  code?: unknown;
}

/**
 * 1処理jobの終端状態だけを1回ずつ計測する。statusオブジェクトの同一性で重複を防ぐため、
 * 親の再描画では再送せず、再処理で新しいdone/errorオブジェクトになった場合は新しい結果として送る。
 */
export function useTrackProcessingOutcome(status: TrackableProcessingStatus | undefined): void {
  const lastTrackedStatusRef = useRef<TrackableProcessingStatus>();

  useEffect(() => {
    if (!status || lastTrackedStatusRef.current === status) return;

    if (status.kind === "done") {
      lastTrackedStatusRef.current = status;
      trackToolEvent({ name: "process_success" });
      return;
    }

    if (status.kind === "unreachable") {
      lastTrackedStatusRef.current = status;
      trackToolEvent({ name: "process_error", errorCode: "target_unreachable" });
      return;
    }

    if (status.kind === "error") {
      lastTrackedStatusRef.current = status;
      trackToolEvent({
        name: "process_error",
        errorCode: normalizeToolErrorCode(status.reason ?? status.code),
      });
    }
  }, [status]);
}

/**
 * PNG指定容量圧縮エンジンの中核ロジック(色数探索・寸法縮小推定・候補選択)。
 *
 * UPNGのロード(動的import・Worker内window互換処理)には一切関与しない。
 * ブラウザAPI(OffscreenCanvas/createImageBitmap)にも依存しない。
 * 実際のUPNG呼び出し(encode)と、指定寸法でのRGBA取得(getRgbaAtSize、内部でOffscreenCanvasの
 * drawImageを使う想定)は呼び出し側(png-compression.worker.ts)からの依存注入で受け取る。
 * この分離により、本ファイルはブラウザ環境なしで(jsdomはもちろんNode単体でも)テストできる。
 */
import { detectApng } from "../image-intake/apng-detection";
import { readDeclaredDimensions } from "../image-intake/image-header-dimensions";
import { readPngChunks } from "../image-intake/png-chunks";
import {
  colorCountCandidatesForPixelCount,
  DEFAULT_PNG_COMPRESSION_LIMITS,
  PNG_MIME_TYPE,
  type PngCompressionBestCandidate,
  type PngCompressionLimits,
  type UpngEncodeFunction,
} from "./png-compression-types";

export type PngSearchOutcome =
  | {
      status: "done";
      pngBuffer: ArrayBuffer;
      outputBytes: number;
      outputWidth: number;
      outputHeight: number;
      colorCount: number;
      encodeCount: number;
    }
  | { status: "unreachable"; bestCandidate?: PngCompressionBestCandidate; encodeCount: number }
  | { status: "timeout"; bestCandidateBytes?: number }
  | { status: "unsupported-png-encoder" }
  | { status: "error"; message: string };

interface CandidateRecord {
  pngBuffer: ArrayBuffer;
  outputBytes: number;
  width: number;
  height: number;
  colorCount: number;
  meetsTarget: boolean;
}

/**
 * UPNGが返したPNGバイト列を無条件に信用せず、既存のstrict PNG parser・APNG検出器で検証する。
 * 期待したwidth/heightと一致することも確認する。
 */
export function validateUpngOutputBytes(
  pngBuffer: ArrayBuffer,
  expectedWidth: number,
  expectedHeight: number,
): boolean {
  if (pngBuffer.byteLength <= 0) return false;
  const bytes = new Uint8Array(pngBuffer);

  const chunks = readPngChunks(bytes);
  if (chunks === "not-png" || chunks === "malformed") return false;

  const apngCheck = detectApng(bytes);
  if (apngCheck !== "static") return false; // "animated" | "malformed" | "not-png" のいずれも不正

  const dimensions = readDeclaredDimensions(bytes, "png");
  if (!dimensions) return false;
  if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) return false;

  // Blob.type検証(既存のconvertToBlob系Workerと同じ発想の防御チェック)。
  // Blobコンストラクタは常に明示typeをそのまま反映するため通常falseにはならないが、
  // §11の要件を満たすため明示的に確認する。
  const blob = new Blob([pngBuffer], { type: PNG_MIME_TYPE });
  if (blob.type !== PNG_MIME_TYPE) return false;

  return true;
}

interface EncodeCandidateOutcome {
  status: "done" | "error";
  pngBuffer?: ArrayBuffer;
  outputBytes?: number;
  message?: string;
}

function encodeOneCandidate(
  encode: UpngEncodeFunction,
  rgba: ArrayBuffer,
  width: number,
  height: number,
  colorCount: number,
): EncodeCandidateOutcome {
  let pngBuffer: ArrayBuffer;
  try {
    pngBuffer = encode([rgba], width, height, colorCount);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
  if (!validateUpngOutputBytes(pngBuffer, width, height)) {
    return { status: "error", message: "UPNGの出力がstrict PNG検証を通過しませんでした" };
  }
  return { status: "done", pngBuffer, outputBytes: pngBuffer.byteLength };
}

/**
 * §7の選択優先順位をそのまま実装した比較関数:
 * 1. targetBytes以下 2. 寸法が大きい 3. 色数が多い 4. targetBytesに近い
 * 5. 同条件ならファイルサイズが大きい(target以下の中で最も情報量を残すため)
 */
export function selectBestCandidate(
  candidates: readonly CandidateRecord[],
  targetBytes: number,
): CandidateRecord | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.meetsTarget !== b.meetsTarget) return a.meetsTarget ? -1 : 1;
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    if (areaA !== areaB) return areaB - areaA;
    if (a.colorCount !== b.colorCount) return b.colorCount - a.colorCount;
    const distanceA = Math.abs(a.outputBytes - targetBytes);
    const distanceB = Math.abs(b.outputBytes - targetBytes);
    if (distanceA !== distanceB) return distanceA - distanceB;
    return b.outputBytes - a.outputBytes;
  });
  return sorted[0];
}

/**
 * 色数候補リスト(降順)がbudgetを超える場合に間引く。
 *
 * - budget<=0: 空配列
 * - budget===1: 最小色数(降順リストの末尾)のみ。到達可能性を最優先するため
 * - budget>=2: 先頭(最大色数)と末尾(最小色数)を必ず含み、残りの枠を中間から
 *   なるべく均等な間隔で抽出する。高色数(候補の質)側と低色数(target到達可能性)側の
 *   両方を必ずカバーしたうえで、間の解像度を予算いっぱいまで使う。
 *
 * 戻り値は常にlength<=budget・重複なし・元の降順を維持し、全要素が実際にlistに
 * 含まれる値(=実行可能な候補)である。
 */
export function stratifiedSample(list: readonly number[], budget: number): number[] {
  if (budget <= 0) return [];
  if (list.length <= budget) return [...list];
  if (list.length === 0) return [];

  if (budget === 1) return [list[list.length - 1]];

  const largest = list[0];
  const smallest = list[list.length - 1];
  const result: number[] = [largest];

  const middleList = list.slice(1, list.length - 1);
  const middleBudget = budget - 2;
  if (middleBudget > 0 && middleList.length > 0) {
    const step = middleList.length / middleBudget;
    for (let i = 0; i < middleBudget; i++) {
      const candidate = middleList[Math.min(middleList.length - 1, Math.floor(i * step))];
      if (!result.includes(candidate)) result.push(candidate);
    }
  }

  result.push(smallest);
  return result;
}

export interface NextScaleResult {
  width: number;
  height: number;
  scale: number;
}

/**
 * §8の推定式: estimatedScale = sqrt(targetBytes / smallestCandidateBytes) * scaleSafetyFactor
 * を0.25〜0.90へclampし、アスペクト比を維持したまま次の寸法を計算する。
 * 拡大は行わない(scaleは常に1.0未満)。同じ寸法になる場合、または前回からの変化が
 * 小さすぎる場合はnullを返し、呼び出し側で縮小打ち切りと判断させる。
 */
export function estimateNextScale(
  targetBytes: number,
  smallestCandidateBytes: number,
  currentWidth: number,
  currentHeight: number,
  limits: PngCompressionLimits = DEFAULT_PNG_COMPRESSION_LIMITS,
): NextScaleResult | null {
  if (smallestCandidateBytes <= 0) return null;
  const rawScale = Math.sqrt(targetBytes / smallestCandidateBytes) * limits.scaleSafetyFactor;
  const scale = Math.min(limits.maxScale, Math.max(limits.minScale, rawScale));

  const nextWidth = Math.max(1, Math.round(currentWidth * scale));
  const nextHeight = Math.max(1, Math.round(currentHeight * scale));

  if (nextWidth === currentWidth && nextHeight === currentHeight) return null; // 同じ寸法を繰り返さない

  const actualScale = Math.min(nextWidth / currentWidth, nextHeight / currentHeight);
  if (1 - actualScale < limits.minMeaningfulScaleDelta) return null; // 変化が小さすぎる

  return { width: nextWidth, height: nextHeight, scale: actualScale };
}

export interface PngCompressionSearchDeps {
  encode: UpngEncodeFunction;
  /** 指定した幅・高さでのRGBA(getImageData互換、straight alpha)を返す。呼び出し毎に描画し直す想定 */
  getRgbaAtSize: (width: number, height: number) => ArrayBuffer;
  now?: () => number;
}

/**
 * §6〜§9の色数探索+寸法縮小探索の本体。
 *
 * 色数候補は常に高色数→低色数の降順で試す。現在の寸法段階は後続の(より小さい)縮小段階より
 * 常に優先されるため、その段階内でtargetBytes以下になった候補が見つかった時点で、
 * それが「その寸法で到達可能な最大色数」であり、§7の優先順位(target達成→寸法大→色数多→…)上も
 * 最良の選択となる。したがって全候補を試してから比較するのではなく、達成した瞬間に即座にdoneとして
 * 返す(未達の間だけ実測探索を続け、次の候補を試す)。全滅した場合のみ、その段階で最小だった候補の
 * bytesを使ってestimateNextScaleで次の寸法を推定し、縮小後のRGBAを取得して再度色数探索を行う
 * (最大maxResizeStages回)。単純な二分探索は行わない(色数と出力容量は単調ではないため、§7参照)。
 */
export function runPngCompressionSearch(
  deps: PngCompressionSearchDeps,
  originalRgba: ArrayBuffer,
  originalWidth: number,
  originalHeight: number,
  targetBytes: number,
  limits: PngCompressionLimits = DEFAULT_PNG_COMPRESSION_LIMITS,
): PngSearchOutcome {
  const now = deps.now ?? Date.now;
  const deadline = now() + limits.workerTimeBudgetMs;

  let encodeCount = 0;
  let width = originalWidth;
  let height = originalHeight;
  let rgba = originalRgba;
  const allCandidates: CandidateRecord[] = [];
  let timedOut = false;

  for (let stage = 0; stage <= limits.maxResizeStages; stage++) {
    if (stage > 0) {
      const previousStageCandidates = allCandidates.filter(
        (c) => c.width === width && c.height === height,
      );
      const smallest = previousStageCandidates.reduce<number | null>(
        (min, c) => (min === null || c.outputBytes < min ? c.outputBytes : min),
        null,
      );
      if (smallest === null) break; // 前段階で1件も成功していなければ縮小を続けられない
      const next = estimateNextScale(targetBytes, smallest, width, height, limits);
      if (!next) break; // 同じ寸法になる、または変化が小さすぎる場合は打ち切り
      width = next.width;
      height = next.height;
      rgba = deps.getRgbaAtSize(width, height);
    }

    const remainingBudget = limits.maxTotalEncodes - encodeCount;
    if (remainingBudget <= 0) break;

    const pixelCount = width * height;
    const tierList = colorCountCandidatesForPixelCount(pixelCount);
    const candidatesToTry =
      tierList.length <= remainingBudget ? tierList : stratifiedSample(tierList, remainingBudget);

    for (const colorCount of candidatesToTry) {
      // deadline超過時は新しいエンコードを一切開始しない
      if (now() >= deadline) {
        timedOut = true;
        break;
      }
      if (encodeCount >= limits.maxTotalEncodes) break;
      encodeCount++;

      const result = encodeOneCandidate(deps.encode, rgba, width, height, colorCount);
      if (
        result.status === "done" &&
        result.pngBuffer !== undefined &&
        result.outputBytes !== undefined
      ) {
        const meetsTarget = result.outputBytes <= targetBytes;
        allCandidates.push({
          pngBuffer: result.pngBuffer,
          outputBytes: result.outputBytes,
          width,
          height,
          colorCount,
          meetsTarget,
        });
        if (meetsTarget) {
          // 降順探索のため、この候補がこの寸法で到達可能な最大色数。即座に採用して終了する
          // (deadlineを既に超えていても、達成済みのこの結果を成功として返す。
          // 次の候補を新たに開始しないことでdeadline超過後の余計な処理を防ぐ)。
          return {
            status: "done",
            pngBuffer: result.pngBuffer,
            outputBytes: result.outputBytes,
            outputWidth: width,
            outputHeight: height,
            colorCount,
            encodeCount,
          };
        }
      }

      if (now() >= deadline) {
        timedOut = true;
        break;
      }
    }

    if (timedOut) break;
  }

  if (timedOut) {
    const best = selectBestCandidate(allCandidates, targetBytes);
    return { status: "timeout", bestCandidateBytes: best?.outputBytes };
  }

  // encodeを1回以上試みたにもかかわらず、有効な候補が1件も得られなかった場合
  // (毎回UPNG.encode自体が例外を投げた、または出力がstrict検証を全て落ちた場合)は、
  // 「targetに到達できなかった」(unreachable)ではなく「エンコーダ自体が機能していない」
  // (unsupported-png-encoder)として区別する。
  if (encodeCount > 0 && allCandidates.length === 0) {
    return { status: "unsupported-png-encoder" };
  }

  const best = selectBestCandidate(allCandidates, targetBytes);
  if (!best) return { status: "unreachable", encodeCount };
  return {
    status: "unreachable",
    bestCandidate: {
      pngBuffer: best.pngBuffer,
      outputBytes: best.outputBytes,
      outputWidth: best.width,
      outputHeight: best.height,
      colorCount: best.colorCount,
    },
    encodeCount,
  };
}

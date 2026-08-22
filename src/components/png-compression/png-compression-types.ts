/**
 * PNG指定容量圧縮エンジンの型定義・定数。
 * 圧縮エンジン本体(png-compression-engine.ts)・Worker(png-compression.worker.ts)・
 * クライアント(png-compression-client.ts)から共有される。
 */

/**
 * 色数候補は入力ピクセル数に応じて変える。
 *
 * 250,000px以下(例: 500x500程度まで)は既存のPNG圧縮spike実証で全14候補を
 * エンコードしても数秒〜十数秒で完走できることを確認済みのため、フル候補で
 * 最も細かく探索する。
 *
 * 250,001〜2,000,000px(フルHD 1920x1080=2,073,600pxがこの境界のすぐ外側になる想定)は
 * 1回のエンコードに数百ms程度かかりうるため、候補数を8つに間引き、
 * maxTotalEncodes(24)・timeBudgetMs(15秒)の枠内で完走できるようにする。
 *
 * 2,000,000px超(4000x3000=12,000,000px等)は1回のエンコードが数秒規模になりうるため、
 * 候補を4つまで大きく間引く。色数と出力容量は単調ではないため間引いても
 * 「target以下・寸法維持・色数多い」を概ね捉えられるよう、降順のべき等分割に近い間隔で選定した。
 */
export const COLOR_COUNT_CANDIDATES_SMALL = [
  256, 192, 128, 96, 64, 48, 32, 24, 16, 12, 8, 6, 4, 2,
] as const;
export const COLOR_COUNT_CANDIDATES_MEDIUM = [256, 128, 64, 32, 16, 8, 4, 2] as const;
export const COLOR_COUNT_CANDIDATES_LARGE = [128, 32, 8, 2] as const;

export const SMALL_PIXEL_THRESHOLD = 250_000;
export const MEDIUM_PIXEL_THRESHOLD = 2_000_000;

/** 入力(または縮小後)のピクセル数に応じた色数候補リストを返す */
export function colorCountCandidatesForPixelCount(pixelCount: number): readonly number[] {
  if (pixelCount <= SMALL_PIXEL_THRESHOLD) return COLOR_COUNT_CANDIDATES_SMALL;
  if (pixelCount <= MEDIUM_PIXEL_THRESHOLD) return COLOR_COUNT_CANDIDATES_MEDIUM;
  return COLOR_COUNT_CANDIDATES_LARGE;
}

export interface PngCompressionLimits {
  /** 全段階(フルサイズ+縮小)を通じた合計エンコード回数の上限 */
  maxTotalEncodes: number;
  /** Worker全体に許す処理時間(ミリ秒)。超過時は最良候補があってもtimeoutとして扱う */
  workerTimeBudgetMs: number;
  /** 縮小(寸法変更)を試行する最大段階数 */
  maxResizeStages: number;
  /** 推定scaleの下限(これ未満には縮小しない) */
  minScale: number;
  /** 推定scaleの上限(拡大は行わないため1.0未満に固定) */
  maxScale: number;
  /** sqrt(targetBytes/smallestCandidateBytes)に掛ける安全係数(オーバーシュート防止) */
  scaleSafetyFactor: number;
  /** これ未満の(相対的な)scale変化は「変化が小さすぎる」として縮小を打ち切る */
  minMeaningfulScaleDelta: number;
}

/**
 * 初期値(提案値)。PNG圧縮spike実証(spike/png-target-compression)のベンチマーク結果に基づく:
 * - maxTotalEncodes=24: 400x300画像の全候補(最大14)+縮小3段階を賄いつつ、
 *   旧spike実証(全候補×全縮小率で最大127回)から大幅に削減する
 * - workerTimeBudgetMs=15000: 既存Worker(png-to-webp.worker.ts等)のtimeBudgetより短いが、
 *   本エンジンは候補数を絞っているため十分な余裕がある
 * - clientBackstopMs(png-compression-client.tsで定義)はこれより大きく設定する
 */
export const DEFAULT_PNG_COMPRESSION_LIMITS: PngCompressionLimits = {
  maxTotalEncodes: 24,
  workerTimeBudgetMs: 15000,
  maxResizeStages: 3,
  minScale: 0.25,
  maxScale: 0.9,
  scaleSafetyFactor: 0.95,
  minMeaningfulScaleDelta: 0.02,
};

export const PNG_MIME_TYPE = "image/png";

/**
 * PNG入力ファイル(圧縮バイト列)のサイズ上限。arrayBuffer化・Worker送信前の入口制限として
 * UI層(use-png-compression.ts)が使う。HEICのMAX_HEIC_INPUT_BYTES(heic-conversion-types.ts)と
 * 同じ考え方の、独立した安全弁である。デコード後ピクセル数の上限(decode-safety.tsの
 * DECODE_SAFETY_LIMITS、Worker側で適用)を置き換えるものではなく、それより手前の段階で
 * かける追加の制限であり、両者は併用する。
 *
 * 現時点でこの種の「圧縮ファイル自体のサイズ上限」を機能横断で共有する定数・ヘルパーは存在せず、
 * HEIC(MAX_HEIC_INPUT_BYTES)・PNG(この定数)それぞれが機能ごとに個別定義している。将来的に
 * 3つ目以降の機能で同様の上限が必要になった場合は、共通化を検討する価値がある。
 */
export const MAX_PNG_COMPRESSION_INPUT_BYTES = 50 * 1024 * 1024; // 50 MiB

export const PNG_COMPRESSION_TOO_LARGE_MESSAGE =
  "ファイルのサイズが大きすぎるため処理できません(上限50MB)。";

/**
 * Worker処理開始直後、PNG構造解析・createImageBitmap・UPNG動的importより前に検証する
 * targetBytesの実行時安全性チェック。メッセージ経由で渡ってくる値は型システムの外側
 * (postMessageのランタイム値)であり、TypeScriptの型注釈だけでは0・負数・非整数・NaN・
 * Infinity・文字列等の不正値を防げないため、明示的に検証する。
 */
export function isValidTargetBytes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * UPNG.encodeの呼び出しシグネチャのみを抽出した型。png-compression-engine.tsはこの関数を
 * 依存注入として受け取り、UPNG自体のロード(動的import・Worker内window互換処理)には
 * 一切関与しない(png-compression.worker.ts参照)。テストではフェイク実装に差し替える。
 */
export type UpngEncodeFunction = (
  imgs: ArrayBuffer[],
  w: number,
  h: number,
  cnum: number,
) => ArrayBuffer;

/** UPNGモジュールの動的importまたはencode呼び出しが失敗したことを示すtyped error */
export class UpngLoadError extends Error {
  constructor(cause: unknown) {
    super(
      `UPNGモジュールの読み込みに失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "UpngLoadError";
  }
}

export interface PngCompressionBestCandidate {
  pngBuffer: ArrayBuffer;
  outputBytes: number;
  outputWidth: number;
  outputHeight: number;
  colorCount: number;
}

export type PngCompressionOutcome =
  | {
      status: "done";
      pngBuffer: ArrayBuffer;
      pngType: "image/png";
      originalBytes: number;
      outputBytes: number;
      originalWidth: number;
      originalHeight: number;
      outputWidth: number;
      outputHeight: number;
      /** 元ファイルをそのまま返した場合(originalReturned=true)はnull */
      colorCount: number | null;
      encodeCount: number;
      /** 入力が既にtargetBytes以下で、再エンコードせず元ファイルをそのまま返した場合true */
      originalReturned: boolean;
    }
  | {
      status: "unreachable";
      bestCandidate?: PngCompressionBestCandidate;
      encodeCount: number;
    }
  | { status: "animated-png" }
  | { status: "invalid-png" }
  | { status: "invalid-target" }
  | { status: "unsafe-dimensions" }
  | { status: "unsupported-browser" }
  | { status: "unsupported-png-encoder" }
  | { status: "timeout"; bestCandidateBytes?: number }
  | { status: "error"; message: string }
  | { status: "cancelled" };

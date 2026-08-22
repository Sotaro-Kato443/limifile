/**
 * @upng/upng-js@2.2.2 は型定義を同梱していない(node_modules/@upng/upng-jsにdist/*.d.tsが
 * 存在しないことを確認済み)。本番コードが実際に使用する範囲はencodeのみ(decode/toRGBA8は
 * 本番コードでは使用しない)。decode/toRGBA8の型はpng-compression-real-upng.test.ts等の
 * テストにおける結果検証(自己整合性チェック)専用として宣言している。
 *
 * bare specifier(`@upng/upng-js`)ではなくサブパス(`@upng/upng-js/dist/UPNG.esm.js`)を
 * 使う理由: このパッケージのpackage.jsonは`"type":"module"`かつ`"main":"dist/UPNG.cjs.js"`だが、
 * UPNG.cjs.jsの中身は生のCommonJS(require/module.exports)であり、"type":"module"指定により
 * ESMとして解釈されてしまい`ReferenceError: require is not defined`で失敗する(実測済み)。
 * ブラウザ向けconditionsを持たない解決(VitestやNode相当のSSR解決)はmainフィールド経由で
 * この壊れたファイルに到達するため、確実に動くESMビルドを明示的なサブパスで直接指定する。
 */
declare module "@upng/upng-js/dist/UPNG.esm.js" {
  interface UpngImage {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    frames: unknown[];
    tabs: Record<string, unknown>;
    data: ArrayBuffer;
  }
  interface UpngStatic {
    /**
     * imgs: フレームごとのRGBA(8bit/channel)ピクセルデータ。通常PNGは要素数1の配列を渡す。
     * cnum: 0=ロスレス(全色)、2〜256=量子化する色数。
     * 戻り値: PNGファイルのバイナリを表すArrayBuffer。
     */
    encode(imgs: ArrayBuffer[], w: number, h: number, cnum: number, dels?: number[]): ArrayBuffer;
    /** テスト(結果検証専用)でのみ使用する。本番コードからは呼ばない */
    decode(buffer: ArrayBuffer): UpngImage;
    /** テスト(結果検証専用)でのみ使用する。本番コードからは呼ばない */
    toRGBA8(img: UpngImage): ArrayBuffer[];
  }
  const UPNG: UpngStatic;
  export default UPNG;
}

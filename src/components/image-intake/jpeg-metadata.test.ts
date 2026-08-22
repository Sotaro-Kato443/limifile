import { describe, expect, it } from "vitest";
import { MAX_MARKERS, MAX_SCANS, RemoveExifError, removeJpegMetadata } from "./jpeg-metadata";

function u16be(n: number): [number, number] {
  return [Math.floor(n / 256), n % 256];
}

function asciiCodes(str: string): number[] {
  return Array.from(str, (ch) => ch.charCodeAt(0));
}

function segment(marker: number, payload: number[]): number[] {
  const [hi, lo] = u16be(payload.length + 2);
  return [0xff, marker, hi, lo, ...payload];
}

function bytesOf(...parts: number[][]): Uint8Array {
  return new Uint8Array(parts.flat());
}

function jfifPayload(
  opts: {
    versionMajor?: number;
    versionMinor?: number;
    units?: number;
    xDensity?: number;
    yDensity?: number;
    thumbW?: number;
    thumbH?: number;
    thumbData?: number[];
  } = {},
): number[] {
  const [xHi, xLo] = u16be(opts.xDensity ?? 1);
  const [yHi, yLo] = u16be(opts.yDensity ?? 1);
  const thumbW = opts.thumbW ?? 0;
  const thumbH = opts.thumbH ?? 0;
  const thumbData = opts.thumbData ?? new Array(3 * thumbW * thumbH).fill(0);
  return [
    ...asciiCodes("JFIF\0"),
    opts.versionMajor ?? 1,
    opts.versionMinor ?? 1,
    opts.units ?? 0,
    xHi,
    xLo,
    yHi,
    yLo,
    thumbW,
    thumbH,
    ...thumbData,
  ];
}

const ENTROPY_DATA = [0x12, 0x34, 0x56, 0x78];

function sosAndEoi(entropy: number[] = ENTROPY_DATA): number[] {
  return [...segment(0xda, [1, 1, 0, 0, 63, 0]), ...entropy, 0xff, 0xd9];
}

function sosWithoutEoi(entropy: number[] = ENTROPY_DATA): number[] {
  return [...segment(0xda, [1, 1, 0, 0, 63, 0]), ...entropy];
}

function minimalJpeg(
  middleSegments: number[][] = [],
  opts: { withJfif?: boolean } = {},
): Uint8Array {
  const withJfif = opts.withJfif ?? true;
  return bytesOf(
    [0xff, 0xd8],
    withJfif ? segment(0xe0, jfifPayload()) : [],
    ...middleSegments,
    sosAndEoi(),
  );
}

function exifTiff(
  entries: Array<{ tag: number; type: number; count: number; value: number }>,
  opts: { littleEndian?: boolean; ifd0Offset?: number } = {},
): number[] {
  const little = opts.littleEndian ?? true;
  const ifd0Offset = opts.ifd0Offset ?? 8;
  const size = Math.max(8, ifd0Offset) + 2 + entries.length * 12 + 4;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  if (little) {
    dv.setUint8(0, 0x49);
    dv.setUint8(1, 0x49);
  } else {
    dv.setUint8(0, 0x4d);
    dv.setUint8(1, 0x4d);
  }
  dv.setUint16(2, 42, little);
  dv.setUint32(4, ifd0Offset, little);
  dv.setUint16(ifd0Offset, entries.length, little);
  entries.forEach((entry, i) => {
    const off = ifd0Offset + 2 + i * 12;
    dv.setUint16(off, entry.tag, little);
    dv.setUint16(off + 2, entry.type, little);
    dv.setUint32(off + 4, entry.count, little);
    dv.setUint16(off + 8, entry.value, little);
  });
  return [...asciiCodes("Exif\0\0"), ...Array.from(new Uint8Array(buf))];
}

function orientationExifSegment(
  orientation: number,
  opts: { littleEndian?: boolean; type?: number; count?: number; rawValue?: number } = {},
): number[] {
  return segment(
    0xe1,
    exifTiff(
      [
        {
          tag: 0x0112,
          type: opts.type ?? 3,
          count: opts.count ?? 1,
          value: opts.rawValue ?? orientation,
        },
      ],
      { littleEndian: opts.littleEndian },
    ),
  );
}

function xmpSegment(): number[] {
  return segment(0xe1, [...asciiCodes("http://ns.adobe.com/xap/1.0/\0"), ...asciiCodes("<x/>")]);
}

function unknownApp1Segment(): number[] {
  return segment(0xe1, asciiCodes("FOO\0\0\0extra-data"));
}

function iccSegment(chunkIndex = 1, chunkTotal = 1): number[] {
  return segment(0xe2, [...asciiCodes("ICC_PROFILE\0"), chunkIndex, chunkTotal, 1, 2, 3, 4]);
}

function unknownApp2Segment(): number[] {
  return segment(0xe2, asciiCodes("NOT_ICC\0"));
}

function adobeApp14Segment(): number[] {
  return segment(0xee, [...asciiCodes("Adobe"), 0, 100, 0, 0, 0, 0, 1]);
}

function unknownApp14Segment(): number[] {
  return segment(0xee, asciiCodes("Other"));
}

function outputBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

/** SOSヘッダのみ(エントロピーデータ・EOIを含まない)。複数スキャンのテスト用 */
function sosHeader(): number[] {
  return segment(0xda, [1, 1, 0, 0, 63, 0]);
}

const EOI_BYTES = [0xff, 0xd9];

function dhtSegment(id = 0): number[] {
  return segment(0xc4, [id, 1, 2, 3]);
}

function dqtSegment(id = 0): number[] {
  return segment(0xdb, [id, 1, 2, 3]);
}

/** SOI+JFIF+任意のpartsだけからJPEGを組み立てる(複数SOS等、sosAndEoiでは表現できない構造用) */
function buildMultiScanJpeg(parts: number[][]): Uint8Array {
  return bytesOf([0xff, 0xd8], segment(0xe0, jfifPayload()), ...parts);
}

describe("removeJpegMetadata / JPEG解析", () => {
  it("不正なSOIはinvalid-jpegで失敗する", () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer as ArrayBuffer;
    expect(() => removeJpegMetadata(bad)).toThrow(RemoveExifError);
    try {
      removeJpegMetadata(bad);
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("invalid-jpeg");
    }
  });

  it("セグメント長2未満はinvalid-segment-lengthで失敗する", () => {
    const bad = bytesOf([0xff, 0xd8], [0xff, 0xe0, 0x00, 0x01]).buffer as ArrayBuffer;
    try {
      removeJpegMetadata(bad);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("invalid-segment-length");
    }
  });

  it("ファイル末尾を超えるセグメント長はinvalid-segment-lengthで失敗する", () => {
    const bad = bytesOf([0xff, 0xd8], [0xff, 0xe0, 0x00, 0x10]).buffer as ArrayBuffer;
    try {
      removeJpegMetadata(bad);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("invalid-segment-length");
    }
  });

  it("EOI欠落はmissing-eoiで失敗する", () => {
    const bad = bytesOf([0xff, 0xd8], segment(0xe0, jfifPayload()), sosWithoutEoi())
      .buffer as ArrayBuffer;
    try {
      removeJpegMetadata(bad);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("missing-eoi");
    }
  });

  it("マーカー数が上限を超えるとlimit-exceededで失敗する", () => {
    const many: number[][] = [];
    for (let i = 0; i < MAX_MARKERS + 1; i++) many.push(segment(0xef, [0]));
    const bad = bytesOf([0xff, 0xd8], ...many).buffer as ArrayBuffer;
    try {
      removeJpegMetadata(bad);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("limit-exceeded");
    }
  });

  it("SOS以降(エントロピーデータ+EOI)はバイト単位でそのまま維持する", () => {
    const input = minimalJpeg([orientationExifSegment(6)]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    const tail = Array.from(out.slice(out.length - (ENTROPY_DATA.length + 2)));
    expect(tail).toEqual([...ENTROPY_DATA, 0xff, 0xd9]);
  });

  it("最初の有効なEOI以降のバイト列(多重画像コンテナ等)はすべて破棄する", () => {
    const trailing = [0xff, 0xd8, 0x99, 0x99];
    const input = bytesOf([0xff, 0xd8], segment(0xe0, jfifPayload()), sosAndEoi(), trailing);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
    expect(indexOfSubsequence(out, trailing)).toBe(-1);
  });

  it("入力ArrayBufferを変更しない", () => {
    const input = minimalJpeg([orientationExifSegment(6), iccSegment()]);
    const before = Array.from(input);
    removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(Array.from(input)).toEqual(before);
  });
});

describe("removeJpegMetadata / メタデータの許可リスト", () => {
  it("Exif APP1を削除する", () => {
    const input = minimalJpeg([orientationExifSegment(1)]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.removedRegions).toContain("app1-exif");
  });

  it("XMP APP1を削除する", () => {
    const input = minimalJpeg([xmpSegment()]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.removedRegions).toContain("app1-xmp");
  });

  it("識別不能なAPP1を削除する", () => {
    const input = minimalJpeg([unknownApp1Segment()]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.removedRegions).toContain("app1-unknown");
  });

  it("APP13を削除する", () => {
    const input = minimalJpeg([segment(0xed, asciiCodes("Photoshop 3.0\0"))]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.removedRegions).toContain("app13");
  });

  it("COMを削除する", () => {
    const input = minimalJpeg([segment(0xfe, asciiCodes("comment\0"))]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.removedRegions).toContain("com");
  });

  it("JFXX(APP0)を削除する", () => {
    const input = minimalJpeg([segment(0xe0, asciiCodes("JFXX\0test"))]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.removedRegions).toContain("app0-jfxx");
  });

  it("ICC_PROFILEではないAPP2を削除する", () => {
    const input = minimalJpeg([unknownApp2Segment()]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.removedRegions).toContain("app2-unknown");
  });

  it("APP3〜APP12を削除する", () => {
    const input = minimalJpeg([segment(0xe3, [1]), segment(0xec, [2])]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.removedRegions.filter((r) => r === "app3-app12")).toHaveLength(2);
  });

  it("APP15を削除する", () => {
    const input = minimalJpeg([segment(0xef, [1])]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.removedRegions).toContain("app15");
  });

  it("ICC_PROFILEのAPP2は内容を変更せず維持する", () => {
    const icc = iccSegment(1, 1);
    const input = minimalJpeg([icc]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, icc)).toBeGreaterThanOrEqual(0);
    expect(result.iccKept).toBe(true);
  });

  it("複数のICCチャンクをすべて維持する", () => {
    const chunk1 = iccSegment(1, 2);
    const chunk2 = iccSegment(2, 2);
    const input = minimalJpeg([chunk1, chunk2]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, chunk1)).toBeGreaterThanOrEqual(0);
    expect(indexOfSubsequence(out, chunk2)).toBeGreaterThanOrEqual(0);
  });

  it("APP14 Adobeを維持し、未知のAPP14は削除する", () => {
    const adobe = adobeApp14Segment();
    const input = minimalJpeg([adobe, unknownApp14Segment()]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, adobe)).toBeGreaterThanOrEqual(0);
    expect(result.removedRegions).toContain("app14-unknown");
  });
});

describe("removeJpegMetadata / JFIF最小化", () => {
  it("通常のJFIFを最小化(サムネイル無し14byte)する", () => {
    const input = minimalJpeg([], { withJfif: false });
    const withJfif = bytesOf(
      [0xff, 0xd8],
      segment(0xe0, jfifPayload({ units: 1, xDensity: 72, yDensity: 96 })),
      sosAndEoi(),
    );
    const result = removeJpegMetadata(withJfif.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    // APP0マーカー(FF E0)を探し、length=16(payload14byte)であることを確認
    const idx = indexOfSubsequence(out, [0xff, 0xe0]);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(out[idx + 2]).toBe(0x00);
    expect(out[idx + 3]).toBe(0x10);
    void input;
  });

  it("JFIFサムネイルデータを削除する", () => {
    const thumbData = [1, 2, 3, 4, 5, 6];
    const input = bytesOf(
      [0xff, 0xd8],
      segment(0xe0, jfifPayload({ thumbW: 2, thumbH: 1, thumbData })),
      sosAndEoi(),
    );
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, thumbData)).toBe(-1);
    expect(result.removedRegions).toContain("app0-thumbnail");
  });

  it("バージョン・密度単位・density値を維持する", () => {
    const input = bytesOf(
      [0xff, 0xd8],
      segment(
        0xe0,
        jfifPayload({ versionMajor: 1, versionMinor: 2, units: 2, xDensity: 300, yDensity: 150 }),
      ),
      sosAndEoi(),
    );
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    const idx = indexOfSubsequence(out, [0xff, 0xe0]);
    expect(out[idx + 9]).toBe(1); // versionMajor
    expect(out[idx + 10]).toBe(2); // versionMinor
    expect(out[idx + 11]).toBe(2); // units
    expect(out[idx + 12] * 256 + out[idx + 13]).toBe(300); // xDensity
    expect(out[idx + 14] * 256 + out[idx + 15]).toBe(150); // yDensity
    expect(out[idx + 16]).toBe(0); // thumbW
    expect(out[idx + 17]).toBe(0); // thumbH
  });

  it("壊れたJFIF長(14byte未満)はinvalid-jfifで失敗する", () => {
    const input = bytesOf(
      [0xff, 0xd8],
      segment(0xe0, asciiCodes("JFIF\0").concat([1, 1])),
      sosAndEoi(),
    );
    try {
      removeJpegMetadata(input.buffer as ArrayBuffer);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("invalid-jfif");
    }
  });

  it("壊れたJFIFサムネイル長はinvalid-jfifで失敗する", () => {
    const payload = jfifPayload({ thumbW: 5, thumbH: 5, thumbData: [] }).slice(0, 14); // 75byte分のサムネイルが必要だが無い
    const input = bytesOf([0xff, 0xd8], segment(0xe0, payload), sosAndEoi());
    try {
      removeJpegMetadata(input.buffer as ArrayBuffer);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("invalid-jfif");
    }
  });
});

describe("removeJpegMetadata / Orientation", () => {
  it("Orientationが無い場合、Exifを削除しorientationKept=falseになる", () => {
    const input = minimalJpeg([xmpSegment()]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.orientationKept).toBe(false);
    expect(result.orientationValue).toBeNull();
  });

  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`Orientation=${orientation}(little endian)を正しく処理する`, () => {
      const input = minimalJpeg([orientationExifSegment(orientation, { littleEndian: true })]);
      const result = removeJpegMetadata(input.buffer as ArrayBuffer);
      if (orientation === 1) {
        expect(result.orientationKept).toBe(false);
        expect(result.orientationValue).toBeNull();
      } else {
        expect(result.orientationKept).toBe(true);
        expect(result.orientationValue).toBe(orientation);
        const out = outputBytes(result.output);
        expect(indexOfSubsequence(out, asciiCodes("Exif\0\0"))).toBeGreaterThanOrEqual(0);
      }
    });

    it(`Orientation=${orientation}(big endian)を正しく処理する`, () => {
      const input = minimalJpeg([orientationExifSegment(orientation, { littleEndian: false })]);
      const result = removeJpegMetadata(input.buffer as ArrayBuffer);
      if (orientation === 1) {
        expect(result.orientationKept).toBe(false);
      } else {
        expect(result.orientationKept).toBe(true);
        expect(result.orientationValue).toBe(orientation);
      }
    });
  }

  it("元のExif APP1は結果に残らない(最小Exifへ置換される)", () => {
    const input = minimalJpeg([
      segment(
        0xe1,
        exifTiff([
          { tag: 0x0112, type: 3, count: 1, value: 6 },
          { tag: 0x9286, type: 7, count: 4, value: 0 }, // UserComment等、他のタグは保持しない
        ]),
      ),
    ]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    // 最小Exifは26byte(TIFFヘッダ8+IFD18)のみのはず。UserCommentタグ(0x9286)は含まれない
    const exifOffset = indexOfSubsequence(out, asciiCodes("Exif\0\0"));
    expect(exifOffset).toBeGreaterThanOrEqual(0);
    const app1Length = out[exifOffset - 2] * 256 + out[exifOffset - 1];
    expect(app1Length).toBe(2 + 6 + 26); // length field自体 + "Exif\0\0" + TIFF26byte
  });

  it("typeがSHORT以外はmalformed-exifで失敗する", () => {
    const input = minimalJpeg([orientationExifSegment(6, { type: 4 })]);
    try {
      removeJpegMetadata(input.buffer as ArrayBuffer);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("malformed-exif");
    }
  });

  it("countが1以外はmalformed-exifで失敗する", () => {
    const input = minimalJpeg([orientationExifSegment(6, { count: 2 })]);
    try {
      removeJpegMetadata(input.buffer as ArrayBuffer);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("malformed-exif");
    }
  });

  it("値が範囲外(0)はmalformed-exifで失敗する", () => {
    const input = minimalJpeg([orientationExifSegment(1, { rawValue: 0 })]);
    try {
      removeJpegMetadata(input.buffer as ArrayBuffer);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("malformed-exif");
    }
  });

  it("値が範囲外(9)はmalformed-exifで失敗する", () => {
    const input = minimalJpeg([orientationExifSegment(1, { rawValue: 9 })]);
    try {
      removeJpegMetadata(input.buffer as ArrayBuffer);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("malformed-exif");
    }
  });

  it("IFD0オフセットが不正な場合malformed-exifで失敗する", () => {
    const input = minimalJpeg([segment(0xe1, exifTiff([], { ifd0Offset: 999999 }))]);
    try {
      removeJpegMetadata(input.buffer as ArrayBuffer);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("malformed-exif");
    }
  });

  it("TIFFバイトオーダーマークが不正な場合malformed-exifで失敗する", () => {
    const buf = new Uint8Array([0x00, 0x00, 0, 42, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0]);
    const input = minimalJpeg([segment(0xe1, [...asciiCodes("Exif\0\0"), ...Array.from(buf)])]);
    try {
      removeJpegMetadata(input.buffer as ArrayBuffer);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("malformed-exif");
    }
  });

  it("IFDエントリ数が上限を超える場合limit-exceededで失敗する", () => {
    const ifd0Offset = 8;
    const entryCount = 300;
    const buf = new ArrayBuffer(ifd0Offset + 2);
    const dv = new DataView(buf);
    dv.setUint8(0, 0x49);
    dv.setUint8(1, 0x49);
    dv.setUint16(2, 42, true);
    dv.setUint32(4, ifd0Offset, true);
    dv.setUint16(ifd0Offset, entryCount, true);
    const input = minimalJpeg([
      segment(0xe1, [...asciiCodes("Exif\0\0"), ...Array.from(new Uint8Array(buf))]),
    ]);
    try {
      removeJpegMetadata(input.buffer as ArrayBuffer);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("limit-exceeded");
    }
  });

  it("複数Exifが同値のOrientationを持つ場合、1つに統合して成功する", () => {
    const input = minimalJpeg([orientationExifSegment(6), orientationExifSegment(6)]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.orientationKept).toBe(true);
    expect(result.orientationValue).toBe(6);
  });

  it("複数Exifで異なるOrientation値が競合する場合ambiguous-orientationで失敗する", () => {
    const input = minimalJpeg([orientationExifSegment(3), orientationExifSegment(6)]);
    try {
      removeJpegMetadata(input.buffer as ArrayBuffer);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("ambiguous-orientation");
    }
  });

  it("生成した最小Exifは再度removeJpegMetadataへ通しても壊れず、同じOrientationを維持する(再処理耐性)", () => {
    const input = minimalJpeg([orientationExifSegment(6)]);
    const first = removeJpegMetadata(input.buffer as ArrayBuffer);
    const second = removeJpegMetadata(first.output);
    expect(second.orientationKept).toBe(true);
    expect(second.orientationValue).toBe(6);
    expect(Array.from(outputBytes(second.output))).toEqual(Array.from(outputBytes(first.output)));
  });
});

describe("removeJpegMetadata / 結果の一貫性", () => {
  it("SOI/EOIは常に維持され、出力は再解析可能な構造になる", () => {
    const input = minimalJpeg([orientationExifSegment(6), iccSegment(), adobeApp14Segment()]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
    expect(() => removeJpegMetadata(result.output)).not.toThrow();
  });

  it("HEIC変換結果相当(JFIF+ICCのみ、Exif無し)を安全に処理できる", () => {
    const input = minimalJpeg([iccSegment()]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.iccKept).toBe(true);
    expect(result.orientationKept).toBe(false);
    expect(result.removedRegions).not.toContain("app1-exif");
  });
});

describe("removeJpegMetadata / 複数スキャン(プログレッシブJPEG)", () => {
  it("複数SOSを含むJPEGを処理できる", () => {
    const input = buildMultiScanJpeg([
      sosHeader(),
      [0x11, 0x22, 0x33],
      sosHeader(),
      [0x44, 0x55],
      EOI_BYTES,
    ]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
  });

  it("スキャン間のAPP1 Exifが削除される", () => {
    const input = buildMultiScanJpeg([
      sosHeader(),
      [0x11, 0x22],
      orientationExifSegment(1),
      sosHeader(),
      [0x33, 0x44],
      EOI_BYTES,
    ]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.removedRegions).toContain("app1-exif");
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, asciiCodes("Exif\0\0"))).toBe(-1);
  });

  it("スキャン間のXMPが削除される", () => {
    const input = buildMultiScanJpeg([
      sosHeader(),
      [0x11, 0x22],
      xmpSegment(),
      sosHeader(),
      [0x33, 0x44],
      EOI_BYTES,
    ]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.removedRegions).toContain("app1-xmp");
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, asciiCodes("http://ns.adobe.com/xap/1.0/\0"))).toBe(-1);
  });

  it("スキャン間のCOMが削除される", () => {
    const input = buildMultiScanJpeg([
      sosHeader(),
      [0x11, 0x22],
      segment(0xfe, asciiCodes("comment\0")),
      sosHeader(),
      [0x33, 0x44],
      EOI_BYTES,
    ]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(result.removedRegions).toContain("com");
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, asciiCodes("comment\0"))).toBe(-1);
  });

  it("スキャン間のDHT/DQTは維持される", () => {
    const dht = dhtSegment();
    const dqt = dqtSegment();
    const input = buildMultiScanJpeg([
      sosHeader(),
      [0x11, 0x22],
      dht,
      dqt,
      sosHeader(),
      [0x33, 0x44],
      EOI_BYTES,
    ]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, dht)).toBeGreaterThanOrEqual(0);
    expect(indexOfSubsequence(out, dqt)).toBeGreaterThanOrEqual(0);
  });

  it("各スキャンのエントロピー符号化データが処理前後でバイト単位に一致する", () => {
    const scan1 = [0xaa, 0xbb, 0xcc];
    const scan2 = [0xdd, 0xee];
    const input = buildMultiScanJpeg([sosHeader(), scan1, sosHeader(), scan2, EOI_BYTES]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, scan1)).toBeGreaterThanOrEqual(0);
    expect(indexOfSubsequence(out, scan2)).toBeGreaterThanOrEqual(0);
  });

  it("FF 00(バイトスタッフィング)は画像データとして維持され、マーカーと誤認されない", () => {
    const entropyWithStuffing = [0x11, 0xff, 0x00, 0x22, 0xff, 0x00];
    const input = buildMultiScanJpeg([sosHeader(), entropyWithStuffing, EOI_BYTES]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, entropyWithStuffing)).toBeGreaterThanOrEqual(0);
  });

  it("Restart Marker(FF D0〜D7)は画像データの一部として維持される", () => {
    const entropyWithRst = [0x11, 0xff, 0xd0, 0x22, 0xff, 0xd7, 0x33];
    const input = buildMultiScanJpeg([sosHeader(), entropyWithRst, EOI_BYTES]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, entropyWithRst)).toBeGreaterThanOrEqual(0);
  });

  it("連続する0xFF(fill byte)を経て実マーカーの境界を正しく判定する", () => {
    const dht = dhtSegment();
    // entropyWithFillの末尾2byteはfill byte。直後に続くdhtセグメント自身の先頭0xFFと合わせて
    // 3連続0xFFのランを形成し、最後の0xFFがDHTマーカーの開始として正しく判定されるべきケース
    const entropyWithFill = [0x11, 0x22, 0xff, 0xff];
    const input = buildMultiScanJpeg([
      sosHeader(),
      entropyWithFill,
      dht,
      sosHeader(),
      [0x99],
      EOI_BYTES,
    ]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, entropyWithFill)).toBeGreaterThanOrEqual(0);
    expect(indexOfSubsequence(out, dht)).toBeGreaterThanOrEqual(0);
  });

  it("スキャン数が上限を超える場合、安全に拒否する(limit-exceeded)", () => {
    const parts: number[][] = [];
    for (let i = 0; i <= MAX_SCANS; i++) {
      parts.push(sosHeader(), [0x00]);
    }
    parts.push(EOI_BYTES);
    const input = buildMultiScanJpeg(parts);
    try {
      removeJpegMetadata(input.buffer as ArrayBuffer);
      expect.unreachable();
    } catch (e) {
      expect((e as RemoveExifError).code).toBe("limit-exceeded");
    }
  });

  it("最初の有効なEOI以降の任意バイトをすべて破棄する", () => {
    const trailing = [0x01, 0x02, 0x03, 0x04, 0x05];
    const input = buildMultiScanJpeg([sosHeader(), [0x11, 0x22], EOI_BYTES, trailing]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
    expect(indexOfSubsequence(out, trailing)).toBe(-1);
  });

  it("EOI後に連結された2つ目のJPEGを破棄する(単体処理結果と完全一致する)", () => {
    const singleJpegBuffer = bytesOf([0xff, 0xd8], segment(0xe0, jfifPayload()), sosAndEoi())
      .buffer as ArrayBuffer;
    const secondJpeg = minimalJpeg([orientationExifSegment(3)]);
    const concatenated = bytesOf(
      [0xff, 0xd8],
      segment(0xe0, jfifPayload()),
      sosAndEoi(),
      Array.from(secondJpeg),
    );

    const expected = removeJpegMetadata(singleJpegBuffer);
    const result = removeJpegMetadata(concatenated.buffer as ArrayBuffer);

    expect(Array.from(outputBytes(result.output))).toEqual(
      Array.from(outputBytes(expected.output)),
    );
  });

  it("MPO風の末尾データ(EOI後のAPPn風バイト列)を破棄する", () => {
    const mpoLike = segment(0xe2, [...asciiCodes("MPF\0"), 1, 2, 3, 4]);
    const input = buildMultiScanJpeg([sosHeader(), [0x11, 0x22], EOI_BYTES, mpoLike]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(indexOfSubsequence(out, asciiCodes("MPF\0"))).toBe(-1);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
  });

  it("出力は常に最初のEOIで終了する", () => {
    const input = minimalJpeg([orientationExifSegment(6)]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    const out = outputBytes(result.output);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
  });

  it("修正後の出力は再解析可能(自パーサーで再度エラー無く処理できる)", () => {
    const input = buildMultiScanJpeg([
      sosHeader(),
      [0x11, 0xff, 0x00, 0x22],
      dhtSegment(),
      orientationExifSegment(6),
      sosHeader(),
      [0xff, 0xd0, 0x33],
      EOI_BYTES,
    ]);
    const result = removeJpegMetadata(input.buffer as ArrayBuffer);
    expect(() => removeJpegMetadata(result.output)).not.toThrow();
    const reparsed = removeJpegMetadata(result.output);
    expect(reparsed.orientationKept).toBe(true);
    expect(reparsed.orientationValue).toBe(6);
  });
});

/** Uint8Array内でneedle(number[])が最初に出現する位置を返す。見つからない場合は-1 */
function indexOfSubsequence(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

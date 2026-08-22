# HEIC decode test fixtures

These files exist so FileFit's automated tests can exercise the **real**
`@discourse/heic` HEIC decoder (the same one shipped to Production) instead
of a mock, catching future regressions that a mocked `decode()` cannot
detect.

## What these are

- `synthetic-reference.png` — a 64×64 PNG created specifically for this
  purpose: four solid-color quadrants (red / green / blue / yellow), a white
  circle outlined in black centered on the quadrant boundary, and a small
  "FF" text label in two corners. Generated entirely with code (Python +
  Pillow) — **it is not a photograph, and does not depict any real person,
  place, building, or object.**
- `synthetic-fixture.heic` — the same image, re-encoded to HEIC. This is
  the actual file the decode tests read.
- `CC0-1.0.txt` — the canonical CC0 1.0 Universal legal text (fetched
  verbatim from `https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt`),
  included so the public-domain dedication below is backed by the actual
  license text rather than just a claim.

Neither file contains, or was derived from, any real photo. No camera was
involved at any step.

## Rights

**FileFit dedicates both `synthetic-reference.png` and
`synthetic-fixture.heic` to the public domain under CC0 1.0 Universal** (see
`CC0-1.0.txt` in this directory). To the extent any copyright exists in
these files at all, no rights are reserved — use, copy, modify, and
redistribute them freely, for any purpose, without attribution.

This dedication covers only the two image files above. It does not apply to
any other file in the FileFit repository, and does not change the license
of FileFit's own application code or of `@discourse/heic`/libheif/libde265
(see `/THIRD_PARTY_NOTICES.md` and `public/source/filefit-heic-decoder-1.0.0-source.tar.gz`
for those).

## Expected properties

| Property             | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| Pixel dimensions     | 64 × 64                                                            |
| Source PNG size      | 496 bytes                                                          |
| Source PNG SHA-256   | `5139e49ccddf09f66c81d2c669af8e6e36b8dc0dad35ab87e1d6c1305f4bcef0` |
| HEIC fixture size    | 1,111 bytes                                                        |
| HEIC fixture SHA-256 | `b6d321e3aa3451c58830cf3fbe92b498b75a2f5f60c6a0e55ed3d3d21bea52f8` |
| Alpha channel        | none (`hasAlpha: no`, per `sips -g all`)                           |
| Exif / GPS           | none — see "Metadata check" below                                  |

The test suite (`src/components/image-intake/heic-decode-fixture.test.ts`)
asserts the fixture's decoded dimensions and re-checks these hashes are not
needed at test time (the test reads the file directly), but this table lets
a reviewer confirm the committed bytes match what this README describes
without having to regenerate anything.

## How these were generated

Environment: macOS 15.7.7 (Darwin 24.6.0), on the machine this fixture was
authored on.

1. **Reference PNG** — Python 3.10.6 with Pillow 12.3.0:

   ```python
   from PIL import Image, ImageDraw

   W, H = 64, 64
   img = Image.new("RGB", (W, H), (255, 255, 255))
   draw = ImageDraw.Draw(img)
   draw.rectangle([0, 0, W//2 - 1, H//2 - 1], fill=(220, 30, 30))     # top-left: red
   draw.rectangle([W//2, 0, W - 1, H//2 - 1], fill=(30, 160, 30))     # top-right: green
   draw.rectangle([0, H//2, W//2 - 1, H - 1], fill=(30, 60, 220))     # bottom-left: blue
   draw.rectangle([W//2, H//2, W - 1, H - 1], fill=(230, 210, 20))    # bottom-right: yellow
   draw.ellipse([W//2 - 10, H//2 - 10, W//2 + 10, H//2 + 10], fill=(255, 255, 255), outline=(0, 0, 0))
   draw.text((4, 2), "FF", fill=(255, 255, 255))
   draw.text((W - 20, H - 14), "FF", fill=(0, 0, 0))
   img.save("synthetic-reference.png")
   ```

2. **HEIC conversion** — macOS's built-in `sips` (sips-316, part of macOS
   15.7.7), which uses Apple's system HEIC encoder:

   ```bash
   sips -s format heic synthetic-reference.png --out synthetic-fixture.heic
   ```

   `sips` was chosen because it is preinstalled on macOS (no extra
   dependency to introduce for regenerating this fixture) and produces a
   standard-compliant HEIF/HEVC file that libheif/libde265 (via
   `@discourse/heic`) decodes correctly — confirmed manually before
   committing this fixture (see "Metadata check" below for the exact
   inspection commands, and the test suite itself for the ongoing
   verification).

## Regenerating this fixture

Re-run the two commands above from this directory. `sips` output is not
guaranteed byte-identical across macOS versions (the encoder can change),
so regenerating will very likely change `synthetic-fixture.heic`'s exact
bytes (and its SHA-256) even though the decoded pixels stay the same. If you
regenerate:

1. Update the SHA-256/size table above.
2. Re-run the metadata check below and confirm it's still clean.
3. Run `npm test -- heic-decode-fixture` and confirm the decode assertions
   still pass (small per-channel color drift from re-encoding is expected
   and already tolerated by the test; a completely different image is not).

## Metadata check (Exif / GPS)

Verified with two independent methods before committing, both clean:

```bash
sips -g all synthetic-fixture.heic
# -> no exif/gps/make/model fields listed at all (only pixel/format/profile info)

strings -a synthetic-fixture.heic | grep -iE 'exif|gps|make|model|apple|iphone|lens|focal|datetime'
# -> no output (no such strings present anywhere in the file)
```

A byte-level scan of the file's top-level ISOBMFF boxes shows only `ftyp`,
`meta`, and `mdat` — no separate `Exif` item is referenced. Since the source
PNG was generated by Pillow (carrying no Exif of its own) and `sips`'s HEIC
encoder does not synthesize camera/GPS metadata that wasn't present in the
input, this is the expected and confirmed result.

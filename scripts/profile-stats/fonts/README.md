# Receipt fonts

Embedded into the SVG as data URIs, because README images cannot load web fonts.

| File | Font | License |
| --- | --- | --- |
| `space-mono-400.woff2`, `space-mono-700.woff2` | [Space Mono](https://github.com/googlefonts/spacemono) | SIL OFL 1.1 (`OFL-space-mono.txt`) |
| `libre-barcode-39-text-400.woff2` | [Libre Barcode 39 Text](https://github.com/graphicore/librebarcode) | SIL OFL 1.1 (`OFL-libre-barcode-39-text.txt`) |

Taken from the `@fontsource/space-mono` and `@fontsource/libre-barcode-39-text`
packages (latin subset) and cut down to printable ASCII plus a few symbols:

```sh
pyftsubset <input>.woff2 --flavor=woff2 --layout-features='kern,tnum,liga,calt' \
  --unicodes='U+0020-007E,U+00A0,U+00B7,U+00D7,U+2013,U+2014,U+2019,U+201C,U+201D,U+2026,U+2191,U+2192,U+2193,U+25B2,U+25CF,U+2588' \
  --output-file=<output>.woff2
```

`metrics.json` holds each glyph's advance width so the renderer can measure
text exactly; regenerate it with fontTools (`TTFont(...)['hmtx']`) after
changing a font.

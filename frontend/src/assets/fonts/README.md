`figtree-bold.ttf` is Figtree Bold (weight 700), the same font already loaded
via Google Fonts in `App.css` (`--font-ui`) and used for `.tile-letter`/
`.tile-value`. Vendored here so `../../../scripts/generate-icons.mjs` can
embed it directly into the generated icon SVGs (`@font-face` with a base64
data URI) — offline rasterization has no browser page context to run the
`@import url(...)` in `App.css`, so the font has to be self-contained instead.

Fetched from `https://fonts.gstatic.com/s/figtree/...` (the URL Google Fonts'
own CSS API resolves `family=Figtree:wght@700` to). Figtree is licensed under
the SIL Open Font License 1.1: https://github.com/erikdkennedy/figtree

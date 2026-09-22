# Brand masters

The original, full-resolution exports. **Nothing here is served to browsers** — the web-sized files are generated:

```
python3 tools/generate-brand-assets.py
```

| Master | Used for |
| --- | --- |
| `dhanvi-logo.png` | `apps/*/public/brand/logo.png` — lockup on light surfaces (public header, footer, mobile top bar, admin sign-in) |
| `dhanvi-logo-dark.png` | `apps/*/public/brand/logo-dark.png` — reversed lockup for dark grounds |
| `dhanvi-app-icon.png` | `apps/*/public/brand/mark.png` (sidebar and collapsed rail) and `apps/*/src/app/apple-icon.png` (home screen) |
| `dhanvi-favicon.png` | `apps/*/src/app/icon.png` — browser tab icon |

The generator trims the baked-in padding, makes the flat backgrounds transparent (keeping white artwork opaque),
rebuilds the app icon's rounded corners cleanly, and quantises each palette, so every served file is 4–9 KB.

`icon.png` and `apple-icon.png` are picked up automatically by the Next.js app-directory metadata conventions; the
`public/brand/*` files are referenced by `packages/ui/src/brand.tsx`. Replace a master, re-run the generator, commit.

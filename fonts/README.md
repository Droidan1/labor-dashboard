# Sign Studio fonts

These four files are the typefaces Sign Studio prints with. They are **print-only**. The app's
own interface never uses them (DESIGN.md §2.2). The page loads each one under its own family
name, so they cannot collide with the Poppins the app loads from Google Fonts:

| File | Family on the page | Used for |
|---|---|---|
| `poppins-900.ttf` | SS Poppins Black | product names, OFF |
| `poppins-900-italic.ttf` | SS Poppins Black Italic | the sale label, YOU PAY |
| `poppins-700.ttf` | SS Poppins Bold | unit, note, row labels |
| `luckiest-guy-400.ttf` | SS Luckiest Guy | prices, `$`, `¢`, `%` |

## Modified versions

These are **subsets** of the upstream fonts, not the original files. They keep fewer
characters, and they drop the layout and hinting tables.

- **Sources:** github.com/google/fonts at commit `23e54b51ddffbc7713c583748e3bd86f62b1fa4a`:
  - `ofl/poppins/Poppins-Bold.ttf`, sha256 `983676516167748b74de6f4771fb384c664fd913acb8b471122ecacf5da5ea6c`
  - `ofl/poppins/Poppins-Black.ttf`, sha256 `d82aaaf98a9283f9a8edd24e51173337d8eaf09e25cd3d98831f8ec8461748a1`
  - `ofl/poppins/Poppins-BlackItalic.ttf`, sha256 `f4852ca89c29f69d800e14f097ed4d1f0a0cc454e9f77d73bfd6db1f71c287a0`
  - `apache/luckiestguy/LuckiestGuy-Regular.ttf`, sha256 `cfbdd68a039f92df51cf3721506af6242e64594c6325fe0bedbeff3fe385d980`
- **Tool:** fontTools 4.66.0.
- **Command:** Poppins is cut to Basic Latin, Latin-1 and a little punctuation. Luckiest Guy is
  cut to what a price or a percentage uses.

  ```sh
  TEXT="U+0020-007E,U+00A0-00FF,U+0152-0153,U+0178,U+2013-2014,U+2018-2019,U+201C-201D,U+2022,U+2026,U+20AC,U+2122"
  NUM="U+0020,U+0024-0025,U+002C,U+002E,U+0030-0039,U+00A2"
  OPTS="--layout-features= --drop-tables+=GSUB,GPOS,GDEF,kern,DSIG --no-hinting"
  fonttools subset Poppins-Bold.ttf        --unicodes="$TEXT" $OPTS --output-file=poppins-700.ttf
  fonttools subset Poppins-Black.ttf       --unicodes="$TEXT" $OPTS --output-file=poppins-900.ttf
  fonttools subset Poppins-BlackItalic.ttf --unicodes="$TEXT" $OPTS --output-file=poppins-900-italic.ttf
  fonttools subset LuckiestGuy-Regular.ttf --unicodes="$NUM"  $OPTS --output-file=luckiest-guy-400.ttf
  ```

## Why the layout tables are gone

The sign is measured and drawn from these same bytes three times:
- the browser draws the preview;
- a small reader in `index.html` measures widths for the fit rules;
- jsPDF draws the PDF.

jsPDF never kerns or substitutes glyphs. With no kerning or substitution tables in the file,
the browser cannot either, so all three agree to the point. `scripts/test-sign-render.mjs`
checks that none of these tables come back.

Adding a character means re-running the command with it added, on the same source commit.
Then update the alphabet check in `index.html`, which the same test compares with these files.

## Licences

- **Poppins:** SIL Open Font License 1.1, in `OFL.txt`. It declares no Reserved Font Name.
- **Luckiest Guy:** Apache License 2.0, in `LICENSE-2.0.txt`.

Both licence files ship next to the fonts (`scripts/build.sh`).

# The Strings Exam — coach's printout

Six-page PDF handed to the coaching staff: a cover (how Test Day runs), one page per
ball color carrying all 15 tests for that color, and a write-in Test Day score sheet.

Generated straight from `src/lib/pathway/curriculum.ts`, so it can never drift from the
app, the family page, or /pathway/curriculum. Regenerate after any curriculum change:

```
node scripts/strings-exam/render.mjs      # writes public/strings-exam.pdf
```

Requires Chrome installed (headless print-to-pdf). Layout notes:

* Every page is a fixed 8.5x11in box with `overflow:hidden`, so content that does not fit
  is CLIPPED rather than spilling — `render.mjs` measures each page and fails loudly if a
  page overflows. Do not skip that check after editing curriculum text.
* Column A of a color page (strings 1-3, nine tests) is the binding constraint. `SCALE`
  in build.mjs is the type-size knob; 0.88 is the largest that fits Red Ball.
* The printout carries label + RUN IT + PASS BAR. The `what` (MEASURES) line is web-only —
  all four layers on one page forces agate type.

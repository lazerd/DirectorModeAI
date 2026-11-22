# Racquets IRL landing + /play/new overhaul (11/22/26)

## What changed
- `/racquetsirl` and signed-out `/` now render `components/play/landing/Landing.tsx` instead of the
  full-screen self-running tour. The tour is unchanged at `/play/demo` and linked as the deeper demo.
  **Rollback:** render `<DemoTour />` again in `app/racquetsirl/page.tsx` and `app/(home)/page.tsx`.
- Page: hero ("More playing. Less planning.") → Create it / Fill it / Play it → See it in action
  (5 real app screens of one sample game, tap-through, no autoplay) → two benefits → formats + "Find a
  game near me" → final CTA with pricing.
- Every claim lives in `landing/copy.ts`, with the code it was checked against. Prices come from
  `lib/play/pricing.ts`, which the paywall (`lib/play/passes.ts`) now reads too.
- Demo screens are built by `lib/play/demoStages.ts` from the same demo engine as the tour.
- `/play/new`: "Create a game" title, "Create my game" button, shorter say-it example, pricing line
  (first game free, then Host Pass $25/yr, joining free), name error announced + focused next to the
  field, larger tap targets, visible keyboard focus. No logic changes.
- `C.muted` darkened `#6a7b71` → `#5d6e64` (4.1:1 → 4.9:1 on paper, WCAG AA) on all /play screens.

## Second pass (same day)
- "How it works" and "See it in action" merged into one interactive **Create it. Fill it. Play it.**
  (stage tabs drive one real phone; on mobile the switch sits right above it). Mobile page 8,300px → ~4,700px.
- Benefits: 4 bold-led points per side, no checkmark lists. Formats: court diagrams, no fake sport "buttons".
- Section kickers removed; the tagline now signs off the final CTA. Hero names the sports, one-line trust.
- Demo game is deterministic per browser engine (fixed ids + seeded Math.random while building);
  captions never name partners, since the pairing shuffle differs between engines.
- Fixed a hydration mismatch from `>` in the page's inline CSS.

## Funnel events (existing first-party tracker, `trackEvent('feature_use', …)`)
| Event | When |
|---|---|
| `page_view` | already automatic (AnalyticsTracker) |
| `rirl_cta` `{where: nav/hero/story/final}` | "Create a game" clicks |
| `rirl_how` `{where}` | "See how it works" / nav |
| `rirl_demo_step` `{step, how}` | demo interaction |
| `rirl_full_demo`, `rirl_join`, `rirl_nav` | deeper demo, find a game, nav |
| `play_host_open`, `play_draft` | already existed: create page open / creation started |
| `play_created` | already existed: game created |
| `play_share` `{channel, where}` | new: WhatsApp / copy / text / share sheet on a real game |
| `play_join` | new: a player joined a real game |
| `play_started` `{players}` | new: host tapped Start (the game actually happened) |

## A/B tests to run (no uplift claimed until measured)
1. Hero: brand-led ("Racquet Sports. Together. In Real Life.") vs benefit-led ("More playing. Less planning.").
   Metric: `rirl_cta` / landing `page_view`, then `play_created`.
2. Overview: full 8-step tour as the front door vs the three-stage page. Metric: `play_created` per visitor.
3. CTA label: "Host your own" / "Start a game" vs "Create a game — Free". Metric: CTA click-through.
4. Fill story: static explanation vs the roster-filling demo step. Metric: `rirl_demo_step` depth → CTA.
5. Pricing: pricing line on the form vs only at the paywall. Metrics: `play_created` and `play_paywall` → pass purchase.

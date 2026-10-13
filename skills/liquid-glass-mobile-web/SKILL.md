---
name: liquid-glass-mobile-web
description: Design and build Apple "Liquid Glass" (iOS 26 style) UI/UX for mobile web apps and PWAs using HTML, CSS and JS or React. Use whenever the user mentions Liquid Glass, Apple glass design, iOS 26 look, glassmorphism for mobile, frosted/translucent tab bars, nav bars or sheets, "make it feel like an iPhone app", or wants a premium Apple-style mobile interface, even if they don't say "Liquid Glass" explicitly.
---

# Liquid Glass for Mobile Web

Goal: an interface that feels native to iOS 26: content-first, with a floating translucent "glass" layer for controls that refracts and blurs what is behind it, adapts to light/dark, and moves with springy, fluid motion.

## Core principles (decide these first)

1. **Content is the hero, glass is the functional layer.** Glass is only for things that float above content: tab bar, nav bar, toolbars, sheets, floating buttons, menus, segmented controls, alerts. Never make the content cards themselves glass.
2. **No glass on glass.** Never stack glass over glass. Inside a glass container use plain fills, tinted fills, or vibrancy (text/icon opacity), not another blur layer.
3. **Rich backdrop required.** Glass looks dead on flat white. Put colorful imagery, gradients or content behind it. Scroll content must pass under bars (edge-to-edge), not be clipped above them.
4. **Concentric shapes.** Radii nest: inner radius = outer radius - padding. Use capsules (`border-radius: 999px`) for bars and buttons, large continuous radii (28-40px) for sheets and cards.
5. **Tint sparingly.** One accent color for primary actions only (default iOS blue `#0A84FF` / `#007AFF`). Tinted glass = accent at 60-80% alpha over blur. Everything else stays neutral.
6. **Legibility beats effect.** Text on glass needs enough contrast; bump the scrim in light mode, use heavier weights (500-600) for labels.
7. **Motion is physical.** Springs, slight overshoot, morphing between states (tab pill slides, sheet detents, button grows on press). Respect reduced motion.

## Workflow

1. Read `references/glass-css.md` for the tokens and component CSS (glass recipe, tab bar, nav bar, sheet, segmented control, button, toggle, motion).
2. Start from `assets/starter.html` when building a new screen or app shell; it already has safe areas, dark mode, fallbacks and a working tab bar and sheet.
3. Build content first (type, spacing, lists/cards), then add the glass layer on top.
4. Run the checklist at the bottom before delivering.

## Mobile web specifics

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- `<meta name="theme-color">` for both schemes; for PWAs add `apple-mobile-web-app-capable` and `apple-mobile-web-app-status-bar-style=black-translucent`.
- Respect `env(safe-area-inset-*)` on every fixed bar. Tab bar floats 8-12px above the bottom inset.
- Use `100dvh`, not `100vh`. Add `overscroll-behavior: none` on body, scroll inside a container when using fixed bars.
- Touch targets 44x44px minimum. `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation`, `user-select: none` on chrome (not on content text).
- Font: `-apple-system, "SF Pro Text", "SF Pro Display", system-ui, "Inter", sans-serif`. Large title 34px/700, title 17px/600, body 17px/400, footnote 13px. Letter-spacing slightly negative on large sizes (-0.02em).
- Haptics aren't available on iOS Safari; use `navigator.vibrate` only as progressive enhancement (Android).
- RTL/Arabic: use logical properties (`inset-inline-start`, `margin-inline`), mirror the tab order and back chevron.

## The glass recipe (summary)

Layers, bottom to top: backdrop blur + saturation boost, translucent tint fill, inner specular highlight (1px inset light border, brighter on top-left), soft outer shadow, optional subtle noise/gradient sheen. Full CSS in `references/glass-css.md`.

Rules of thumb: blur 16-28px, saturate 160-200%, fill alpha 0.18-0.35 (light) or 0.12-0.25 (dark). Always include `-webkit-backdrop-filter`.

## Components and behavior

- **Tab bar**: floating capsule, 3-5 items, icon + short label, selected item sits in a sliding highlighted pill. Can shrink/minimize on scroll down and expand on scroll up.
- **Nav bar**: large title collapses to inline title on scroll; bar fades in glass only once content scrolls beneath it (no hard divider).
- **Bottom sheet**: detents (peek ~30%, medium ~50%, large ~92%), grabber, 32-40px top radius, drag to resize, glass at small detents, becomes more opaque at large detent.
- **Buttons**: capsule glass; primary = tinted glass; scale to 0.96 on press, with a brighter highlight; spring back.
- **Segmented control / toggles / sliders**: glass track, thumb is a brighter glass blob that stretches slightly while dragging.
- **Menus/popovers**: morph from the trigger (transform-origin at the trigger), 20-24px radius.
- **Lists**: grouped inset lists (16-20px radius) on a slightly tinted background; separators as hairlines inset from the leading edge.

## Accessibility and fallbacks (required)

- `@media (prefers-reduced-transparency: reduce)`: replace blur with a solid `Canvas`-like fill.
- `@media (prefers-contrast: more)`: stronger border, higher-opacity fill.
- `@media (prefers-reduced-motion: reduce)`: disable springs/morphs, use opacity only.
- `@supports not (backdrop-filter: blur(1px))`: opaque fallback fill.
- Both light and dark schemes via CSS variables and `prefers-color-scheme`.
- Real `<button>`/`<nav>`/`role="tablist"` semantics, visible `:focus-visible` ring, `aria-current`/`aria-selected` on the active tab.

## Performance

- Limit simultaneous backdrop-filter layers to about 4 on screen. Don't blur huge areas at high radii.
- Don't animate `backdrop-filter` itself; animate transform and opacity.
- Use `will-change: transform` only on actively moving elements. Avoid backdrop-filter on elements inside scrolling lists.
- The SVG displacement "refraction" effect works only in Chromium and is costly: treat it as optional enhancement behind a feature check, never required (Safari ignores `url()` in backdrop-filter).

## Anti-patterns

Glass cards everywhere; rainbow gradients on every control; heavy dark borders; drop shadows too strong; blur on a flat background; hamburger menus on mobile (use a tab bar); tiny 12px labels on glass; multiple accent colors; ignoring safe areas; fake "iOS status bar" drawn in HTML.

## Delivery checklist

- [ ] Content scrolls under nav and tab bars; nothing glass-on-glass
- [ ] Safe areas + 44px targets verified
- [ ] Light and dark both look right; text contrast OK on glass
- [ ] Fallbacks for no backdrop-filter, reduced transparency/motion, more contrast
- [ ] One accent color; concentric radii; capsule controls
- [ ] Spring motion on tab switch, press, sheet
- [ ] Max ~4 blur layers on screen

# Liquid Glass CSS reference

## Tokens

```css
:root{
  color-scheme: light dark;
  --accent:#0A84FF;
  --bg:#F2F2F7; --label:#000; --label-2:rgba(60,60,67,.6); --sep:rgba(60,60,67,.18);
  --glass-fill:rgba(255,255,255,.28);
  --glass-fill-strong:rgba(255,255,255,.62);
  --glass-edge:rgba(255,255,255,.65);
  --glass-edge-dim:rgba(255,255,255,.12);
  --glass-shadow:0 8px 32px rgba(0,0,0,.14), 0 1px 2px rgba(0,0,0,.08);
  --blur:22px; --sat:180%;
  --spring:cubic-bezier(.34,1.56,.64,1);   /* overshoot */
  --smooth:cubic-bezier(.22,.9,.3,1);
  --font:-apple-system,"SF Pro Text","SF Pro Display",system-ui,"Inter",sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#000; --label:#fff; --label-2:rgba(235,235,245,.6); --sep:rgba(84,84,88,.5);
    --glass-fill:rgba(40,40,46,.34);
    --glass-fill-strong:rgba(44,44,50,.72);
    --glass-edge:rgba(255,255,255,.28);
    --glass-edge-dim:rgba(255,255,255,.06);
    --glass-shadow:0 10px 36px rgba(0,0,0,.5), 0 1px 2px rgba(0,0,0,.4);
  }
}
```

## Base glass surface

```css
.glass{
  position:relative;
  background:var(--glass-fill);
  -webkit-backdrop-filter:blur(var(--blur)) saturate(var(--sat));
          backdrop-filter:blur(var(--blur)) saturate(var(--sat));
  border-radius:999px;
  box-shadow:
    var(--glass-shadow),
    inset 0 1px 0 var(--glass-edge),            /* top specular */
    inset 0 -1px 0 var(--glass-edge-dim),
    inset 1px 0 0 var(--glass-edge-dim),
    inset -1px 0 0 var(--glass-edge-dim);
  isolation:isolate;
}
/* soft sheen */
.glass::before{
  content:""; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  background:linear-gradient(135deg,rgba(255,255,255,.35),rgba(255,255,255,0) 40%,rgba(255,255,255,0) 70%,rgba(255,255,255,.12));
  mix-blend-mode:soft-light; z-index:-1;
}
.glass.tint{ background:color-mix(in srgb,var(--accent) 72%,transparent); color:#fff; }
.glass.strong{ background:var(--glass-fill-strong); }
```

## Fallbacks

```css
@supports not ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){
  .glass{ background:var(--glass-fill-strong); }
}
@media (prefers-reduced-transparency:reduce){
  .glass{ -webkit-backdrop-filter:none; backdrop-filter:none; background:var(--glass-fill-strong); }
}
@media (prefers-contrast:more){
  .glass{ box-shadow:var(--glass-shadow), inset 0 0 0 1.5px var(--label-2); }
}
@media (prefers-reduced-motion:reduce){
  *{ transition-duration:.01ms !important; animation-duration:.01ms !important; }
}
```

## Floating tab bar

```html
<nav class="tabbar glass" role="tablist" style="--n:4;--i:0">
  <span class="pill" aria-hidden="true"></span>
  <button role="tab" aria-selected="true"><svg>…</svg><span>Home</span></button>
  …
</nav>
```
```css
.tabbar{
  position:fixed; z-index:50;
  inset-inline:16px; bottom:calc(env(safe-area-inset-bottom) + 10px);
  display:flex; padding:6px; gap:2px; height:64px;
}
.tabbar button{
  flex:1; position:relative; z-index:1; border:0; background:none; color:var(--label-2);
  font:600 10.5px/1 var(--font); display:flex; flex-direction:column; gap:4px;
  align-items:center; justify-content:center; border-radius:999px; min-width:44px;
  transition:color .25s;
}
.tabbar button[aria-selected=true]{ color:var(--accent); }
.tabbar .pill{
  position:absolute; top:6px; bottom:6px; left:6px; width:calc((100% - 12px)/var(--n,4));
  border-radius:999px; background:rgba(120,120,128,.2);
  box-shadow:inset 0 1px 0 var(--glass-edge-dim);
  transform:translateX(calc(var(--i,0)*100%));
  transition:transform .45s var(--spring);
}
```
JS: on tab click set `--i` on the tabbar to the index. For RTL use `inset-inline-start` and a negative multiplier.

## Nav bar with collapsing large title

```css
.navbar{
  position:fixed; top:0; inset-inline:0; z-index:40;
  padding:calc(env(safe-area-inset-top) + 6px) 16px 8px; height:calc(env(safe-area-inset-top) + 52px);
  display:flex; align-items:center; justify-content:center;
  background:transparent; transition:background .25s;
}
.navbar.scrolled{
  background:linear-gradient(var(--glass-fill),transparent);
  -webkit-backdrop-filter:blur(var(--blur)) saturate(var(--sat)); backdrop-filter:blur(var(--blur)) saturate(var(--sat));
  -webkit-mask-image:linear-gradient(#000 70%,transparent); mask-image:linear-gradient(#000 70%,transparent);
}
.navbar .title{ font:600 17px var(--font); opacity:0; transition:opacity .2s; }
.navbar.scrolled .title{ opacity:1; }
.large-title{ font:700 34px/1.1 var(--font); letter-spacing:-.02em; padding:calc(env(safe-area-inset-top) + 60px) 20px 8px; }
```
Toggle `.scrolled` when `scrollTop > 40` using a passive scroll listener (or an IntersectionObserver on the large title).

## Buttons and controls

```css
.btn{
  min-height:44px; padding:0 20px; border:0; color:var(--label);
  font:600 16px var(--font); display:inline-flex; align-items:center; gap:8px; justify-content:center;
  transition:transform .35s var(--spring);
}
.btn:active{ transform:scale(.95); }
.icon-btn{ width:44px; height:44px; padding:0; }

.segmented{ display:flex; padding:3px; height:40px; position:relative; }
.segmented button{ flex:1; border:0; background:none; font:600 14px var(--font); color:var(--label); z-index:1; }
.segmented .thumb{
  position:absolute; top:3px; bottom:3px; left:3px; width:calc((100% - 6px)/var(--n,2));
  border-radius:999px; background:var(--glass-fill-strong);
  box-shadow:0 2px 8px rgba(0,0,0,.15), inset 0 1px 0 var(--glass-edge);
  transform:translateX(calc(var(--i,0)*100%)); transition:transform .4s var(--spring);
}

.switch{ width:52px; height:32px; border-radius:999px; background:rgba(120,120,128,.32); position:relative; transition:background .25s; }
.switch[aria-checked=true]{ background:#34C759; }
.switch::after{
  content:""; position:absolute; top:2px; left:2px; width:36px; height:28px; border-radius:999px; background:#fff;
  box-shadow:0 2px 6px rgba(0,0,0,.25); transition:transform .4s var(--spring), width .2s;
}
.switch:active::after{ width:42px; }
.switch[aria-checked=true]::after{ transform:translateX(12px); }
.switch[aria-checked=true]:active::after{ transform:translateX(6px); }
```

## Bottom sheet

```css
.sheet{
  position:fixed; inset-inline:8px; bottom:8px; z-index:60; border-radius:36px;
  height:var(--h,50dvh); max-height:calc(100dvh - env(safe-area-inset-top) - 12px);
  padding:10px 20px calc(env(safe-area-inset-bottom) + 16px);
  transform:translateY(calc(100% + 24px)); transition:transform .5s var(--smooth), height .4s var(--smooth);
  overflow:auto;
}
.sheet.open{ transform:none; }
.sheet .grabber{ width:36px; height:5px; border-radius:3px; background:var(--label-2); opacity:.5; margin:0 auto 14px; }
.sheet.large{ --h:92dvh; background:var(--glass-fill-strong); }
.scrim{ position:fixed; inset:0; background:rgba(0,0,0,.25); opacity:0; pointer-events:none; transition:opacity .3s; z-index:55; }
.scrim.on{ opacity:1; pointer-events:auto; }
```
Drag: use Pointer Events on the grabber, track dy, snap to the nearest detent on release (a fast fling goes to the next detent or dismisses).

## Grouped list

```css
.group{ background:var(--glass-fill-strong); border-radius:20px; overflow:hidden; margin:0 16px 20px; }
.row{ min-height:52px; padding:0 16px; display:flex; align-items:center; gap:12px; position:relative; }
.row + .row::before{ content:""; position:absolute; top:0; inset-inline-start:52px; inset-inline-end:0; height:.5px; background:var(--sep); }
```
Content groups use plain fills (no backdrop-filter): avoids glass-on-glass and keeps scrolling smooth. In light mode on a light `--bg`, use `background:#fff` for groups instead.

## Optional: SVG refraction (Chromium only, progressive enhancement)

```html
<svg width="0" height="0"><filter id="lg" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency=".008" numOctaves="2" seed="3" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="24" xChannelSelector="R" yChannelSelector="G"/>
</filter></svg>
```
```css
@supports (backdrop-filter:url(#lg)) and (not (-webkit-touch-callout:none)){
  .glass.refract{ backdrop-filter:url(#lg) blur(8px) saturate(170%); }
}
```
iOS Safari does not support this; never rely on it.

## React notes

Make a small `<Glass as="nav" tint>` component wrapping `.glass`. Keep the active tab index in state and pass `style={{'--i':index,'--n':tabs.length}}` to the container so CSS handles the animation. Track the nav bar `scrolled` state with a passive scroll listener.

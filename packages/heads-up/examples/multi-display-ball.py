#!/usr/bin/env python3
"""Generate per-display HTML for cross-display animations.

When macOS "Displays have separate Spaces" is enabled (the default since
Mavericks), a single NSWindow cannot span multiple displays. The workaround:
create one canvas per display, each showing a viewport slice of a shared
virtual coordinate space. Synchronize animation timing with Date.now().

Usage:
    # Generate HTML for a specific display viewport:
    python3 multi-display-ball.py <viewport_x> <viewport_y> <viewport_w> <viewport_h>

    # Example: three displays, rainbow ball ping-ponging between left and right centers
    python3 multi-display-ball.py 0    171  1920 1200 > ball-left.html   # HP E241i
    python3 multi-display-ball.py 1920 0    1512 982  > ball-mid.html    # Built-in Retina
    python3 multi-display-ball.py 3432 82   1920 1080 > ball-right.html  # HDMI

    # Then create canvases at each display's CG bounds:
    heads-up create --id ball-left  --at -1920,171,1920,1200 --file ball-left.html
    heads-up create --id ball-mid   --at 0,0,1512,982        --file ball-mid.html
    heads-up create --id ball-right --at 1512,82,1920,1080   --file ball-right.html

Virtual canvas coordinate system:
    Origin = top-left of bounding box of all displays (in CG coordinates).
    Each display's viewport offset = (display_cg_x - bbox_left, display_cg_y - bbox_top).

Timing synchronization:
    All canvases use Date.now() as the animation clock, so they stay frame-locked
    even if WKWebView instances start rendering at slightly different times.
"""

import sys

if len(sys.argv) < 5:
    print(__doc__)
    sys.exit(1)

vx, vy, vw, vh = [float(x) for x in sys.argv[1:5]]

print(f'''<!DOCTYPE html>
<html><head><style>
* {{ margin: 0; padding: 0; }}
body {{ background: transparent; overflow: hidden; width: {vw}px; height: {vh}px; }}
#stage {{
  position: absolute;
  left: {-vx}px;
  top: {-vy}px;
  width: 5352px;
  height: 1371px;
}}
#ball {{
  width: 80px; height: 80px;
  border-radius: 50%;
  position: absolute;
  opacity: 0;
  background: conic-gradient(from 0deg, #ff0040, #ff8800, #ffff00, #00ff88, #0088ff, #8800ff, #ff0040);
  box-shadow:
    0 0 20px 10px rgba(255,100,255,0.5),
    0 0 40px 20px rgba(100,100,255,0.3),
    0 0 80px 40px rgba(255,255,100,0.15);
  animation: rainbow-glow 1.5s ease-in-out infinite alternate;
  will-change: left, top, opacity;
}}
#ball::after {{
  content: '';
  position: absolute;
  top: 8px; left: 12px;
  width: 35px; height: 25px;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 100%);
  transform: rotate(-30deg);
}}
@keyframes rainbow-glow {{
  0%   {{ filter: hue-rotate(0deg)   brightness(1)   saturate(1.2); }}
  100% {{ filter: hue-rotate(180deg) brightness(1.4)  saturate(1.5); }}
}}
</style></head><body>
<div id="stage">
  <div id="ball"></div>
</div>
<script>
const ball = document.getElementById("ball");

// Virtual canvas coordinates (ball top-left, centered on display centers)
// Left display center:  CG (-960, 771) -> virtual (960, 771)  -> ball (920, 731)
// Right display center: CG (2472, 622) -> virtual (4392, 622) -> ball (4352, 582)
const sx = 920,  sy = 731;
const ex = 4352, ey = 582;

function elasticOut(t) {{
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}}

const fadeIn  = 1000;
const tripMs  = 2000;    // 2 seconds per trip
const trips   = 10;      // 5 round-trips = 10 one-way trips
const fadeOut = 1200;
const total   = fadeIn + tripMs * trips + fadeOut;

// Wall-clock for cross-canvas synchronization
const t0 = Date.now();

function tick() {{
  const e = Date.now() - t0;
  let x, y, opacity;

  if (e < fadeIn) {{
    const t = e / fadeIn;
    const eased = 1 - Math.pow(1 - t, 3);
    opacity = eased;
    x = sx; y = sy;
    ball.style.transform = "scale(" + (0.3 + 0.7 * eased) + ")";
  }} else if (e < fadeIn + tripMs * trips) {{
    const te = e - fadeIn;
    const ti = Math.floor(te / tripMs);
    const tp = (te - ti * tripMs) / tripMs;
    const eased = elasticOut(tp);
    const fwd = ti % 2 === 0;
    if (fwd) {{
      x = sx + (ex - sx) * eased;
      y = sy + (ey - sy) * eased;
    }} else {{
      x = ex + (sx - ex) * eased;
      y = ey + (sy - ey) * eased;
    }}
    opacity = 1;
    ball.style.transform = "scale(1)";
  }} else if (e < total) {{
    const t = (e - fadeIn - tripMs * trips) / fadeOut;
    const eased = t * t;
    opacity = 1 - eased;
    x = sx; y = sy;
    ball.style.transform = "scale(" + (1 - 0.5 * eased) + ")";
  }} else {{
    ball.style.opacity = "0";
    return;
  }}

  ball.style.opacity = String(opacity);
  ball.style.left = x + "px";
  ball.style.top  = y + "px";
  requestAnimationFrame(tick);
}}
requestAnimationFrame(tick);
</script></body></html>''')

#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: human-needed-surface.sh show|clear <repo-root> <dock> <reason>" >&2
  exit 2
}

command="${1:-}"
repo_root="${2:-}"
dock="${3:-}"
reason="${4:-}"

if [[ -z "$command" || -z "$repo_root" || -z "$dock" || -z "$reason" ]]; then
  usage
fi
case "$command" in show|clear) ;;
  *) usage ;;
esac
case "$dock" in *[!a-zA-Z0-9_.-]*|"") usage ;; esac
case "$reason" in *[!a-zA-Z0-9_.-]*|"") usage ;; esac

aos_bin="${AOS_DOCK_AOS_BIN:-$repo_root/aos}"
open_bin="${AOS_DOCK_OPEN_BIN:-open}"
canvas_id="aos-human-needed-${dock}-${reason}"

if [[ "$command" == "clear" ]]; then
  if [[ -x "$aos_bin" ]]; then
    "$aos_bin" show remove --id "$canvas_id" >/dev/null 2>&1 || true
  fi
  printf 'cleared\n'
  exit 0
fi

if [[ "${AOS_DOCK_DISABLE_SETTINGS_OPEN:-}" != "1" ]] && command -v "$open_bin" >/dev/null 2>&1; then
  "$open_bin" "x-apple.systempreferences:com.apple.preference.security?Privacy" >/dev/null 2>&1 || true
  "$open_bin" "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" >/dev/null 2>&1 || true
  "$open_bin" "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent" >/dev/null 2>&1 || true
  "$open_bin" "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" >/dev/null 2>&1 || true
fi

if ! [[ -x "$aos_bin" ]]; then
  printf 'aos_unavailable\n'
  exit 0
fi

html="$(python3 - <<'PY'
import html

title = "AOS permission reset needed"
body = "Run ./aos permissions reset-runtime --mode repo, then ./aos permissions setup --once. Grant Accessibility, Input Monitoring, and Screen & System Audio Recording if macOS prompts. Manual Settings removal is fallback only if targeted reset reports unavailable or failed."
print(f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root {{ color-scheme: dark; }}
  html, body {{
    margin: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  }}
  .surface {{
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: 22px 24px;
    background: rgba(18, 20, 24, 0.94);
    color: #f5f7fb;
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 8px;
    box-shadow: 0 18px 52px rgba(0,0,0,0.34);
  }}
  h1 {{
    margin: 0 0 12px;
    font-size: 24px;
    line-height: 1.15;
    font-weight: 650;
    letter-spacing: 0;
  }}
  p {{
    margin: 0;
    max-width: 620px;
    color: #d9dee8;
    font-size: 16px;
    line-height: 1.45;
    letter-spacing: 0;
  }}
</style>
</head>
<body>
  <main class="surface" role="status" aria-live="polite">
    <h1>{html.escape(title)}</h1>
    <p>{html.escape(body)}</p>
  </main>
</body>
</html>""")
PY
)"

"$aos_bin" show create \
  --id "$canvas_id" \
  --at "${AOS_DOCK_HUMAN_NEEDED_CANVAS_FRAME:-420,140,680,190}" \
  --window-level floating \
  --ttl "${AOS_DOCK_HUMAN_NEEDED_CANVAS_TTL:-45m}" \
  --html "$html" >/dev/null 2>&1 || true

printf 'shown\n'

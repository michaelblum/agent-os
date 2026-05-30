#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/sigil/visual-harness.sh"

PREFIX="aos-sigil-context-menu-real-input"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_visual_seed_sigil repo

aos_visual_start_isolated_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

aos_visual_launch_sigil_with_inspector avatar-main surface-inspector "" manual-visible

python3 - <<'PY'
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path("tests/lib").resolve()))
from sigil_real_input_context import SigilContextHarness


def selector_for(descriptor_id, suffix=""):
    base = f'.aos-form-field[data-descriptor-id="{descriptor_id}"]'
    return f"{base} {suffix}".strip()


harness = SigilContextHarness()
harness.arm_trace("real-input-context-menu-smoke")
harness.open_context_menu_from_avatar()
main_menu_clearance = harness.assert_menu_clear_avatar("main display")

surface = harness.wait_until(
    lambda: harness.native_point_for('[data-sigil-avatar-control-surface]'),
    label="compact avatar control surface rendered",
)

legacy_check = harness.eval_json(
    """(() => JSON.stringify({
      legacyCards: document.querySelectorAll('.ctx-menu-card').length,
      legacyPopovers: document.querySelectorAll('.ctx-select-popover').length,
      dataCtxNodes: document.querySelectorAll('[data-ctx-tab], [data-ctx-open], [data-ctx-back], [data-ctx-select-option]').length,
      theme: document.querySelector('[data-sigil-avatar-control-surface]')?.dataset.sigilTheme ?? null,
      themedSurface: document.querySelector('[data-sigil-avatar-control-surface]')?.dataset.themedSurface ?? null
    }))()"""
)
if legacy_check["legacyCards"] or legacy_check["legacyPopovers"] or legacy_check["dataCtxNodes"]:
    raise SystemExit(f"FAIL: legacy context menu deck is still rendered: {legacy_check}")
if legacy_check["theme"] != "avatar-control-surface":
    raise SystemExit(f"FAIL: missing compact avatar theme marker: {legacy_check}")

alpha_trigger = harness.native_point_for(selector_for("sigil-menu-shape-select", "[data-aos-select-trigger]"))
if not alpha_trigger:
    raise SystemExit("FAIL: missing alpha geometry toolkit select trigger")
harness.click(alpha_trigger)
alpha_option = harness.wait_until(
    lambda: harness.native_point_for(selector_for("sigil-menu-shape-select", '[data-aos-select-item][data-value="8"]')),
    label="alpha geometry toolkit option list opened from real click",
)
harness.click(alpha_option)
alpha_result = harness.wait_until(
    lambda: (
        lambda state: state if state["geometry"] == 8 and state["type"] == 8 and state["expanded"] is False else None
    )(harness.eval_json(
        """(() => {
          const field = document.querySelector('.aos-form-field[data-descriptor-id="sigil-menu-shape-select"]')
          return JSON.stringify({
            geometry: window.state.currentGeometryType,
            type: window.state.currentType,
            expanded: field?.querySelector('[data-aos-select-trigger]')?.getAttribute('aria-expanded') === 'true'
          })
        })()"""
    )),
    label="real click selected alpha geometry option",
)

omega_tab = harness.native_point_for('[data-aos-tabs-trigger][data-value="omega"]')
if not omega_tab:
    raise SystemExit("FAIL: missing omega tab trigger")
harness.click(omega_tab)
harness.wait_until(
    lambda: True if harness.eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu.activeTab)") == "omega" else None,
    label="omega tab selected",
)
omega_trigger = harness.native_point_for(selector_for("sigil-menu-omega-shape", "[data-aos-select-trigger]"))
if not omega_trigger:
    raise SystemExit("FAIL: missing omega geometry toolkit select trigger")
harness.click(omega_trigger)
omega_option = harness.wait_until(
    lambda: harness.native_point_for(selector_for("sigil-menu-omega-shape", '[data-aos-select-item][data-value="12"]')),
    label="omega geometry toolkit option list opened from real click",
)
harness.click(omega_option)
omega_result = harness.wait_until(
    lambda: (
        lambda state: state if state["omegaGeometry"] == 12 and state["omegaType"] == 12 else None
    )(harness.eval_json(
        """JSON.stringify({
          omegaGeometry: window.state.omegaGeometryType,
          omegaType: window.state.omegaType
        })"""
    )),
    label="real click selected omega geometry option",
)

travel_tab = harness.native_point_for('[data-aos-tabs-trigger][data-value="travel"]')
if not travel_tab:
    raise SystemExit("FAIL: missing travel tab trigger")
harness.click(travel_tab)
harness.wait_until(
    lambda: True if harness.eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu.activeTab)") == "travel" else None,
    label="travel tab selected",
)

before_scroll = harness.eval_json(
    """(() => {
      const surface = document.querySelector('[data-sigil-avatar-control-surface]')
      return JSON.stringify({
        scrollTop: surface?.scrollTop ?? null,
        scrollHeight: surface?.scrollHeight ?? null,
        clientHeight: surface?.clientHeight ?? null
      })
    })()"""
)
after_scroll = before_scroll
if before_scroll["scrollHeight"] > before_scroll["clientHeight"]:
    harness.scroll(surface, -8)
    after_scroll = harness.wait_until(
        lambda: (
            lambda state: state if state["scrollTop"] > before_scroll["scrollTop"] else None
        )(harness.eval_json("JSON.stringify({ scrollTop: document.querySelector('[data-sigil-avatar-control-surface]')?.scrollTop ?? null })")),
        label="compact avatar surface scrollTop changed from real wheel",
    )

harness.eval_json(
    """(() => {
      const field = document.querySelector('.aos-form-field[data-descriptor-id="sigil-menu-line-trail-mode"]')
      field?.scrollIntoView({ block: 'center', inline: 'nearest' })
      return JSON.stringify({
        found: !!field,
        scrollTop: document.querySelector('[data-sigil-avatar-control-surface]')?.scrollTop ?? null
      })
    })()"""
)
line_shrink = harness.native_point_for(selector_for("sigil-menu-line-trail-mode", '.aos-segmented button[data-value="shrink"]'))
if not line_shrink:
    raise SystemExit("FAIL: missing Shrink trail mode toolkit segmented button")
harness.click(line_shrink)
trail_result = harness.wait_until(
    lambda: (
        lambda state: state if state["mode"] == "shrink" and state["clickEvents"] > 0 else None
    )(harness.eval_json(
        """(() => {
          const trace = window.__sigilDebug.interactionTrace()
          return JSON.stringify({
            mode: window.state.fastTravelLineTrailMode,
            clickEvents: trace.entries.filter((entry) => entry.stage === 'context-menu:click').length
          })
        })()"""
    )),
    label="real click selected line trail mode",
)

print("PASS", json.dumps({
    "main_menu_clearance": main_menu_clearance,
    "legacy_check": legacy_check,
    "alpha": alpha_result,
    "omega": omega_result,
    "before_scroll": before_scroll,
    "after_scroll": after_scroll,
    "trail": trail_result,
}, sort_keys=True))
PY

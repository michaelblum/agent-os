import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');
const schemaRelativePath = 'shared/schemas/aos-privileged-capability-ledger-v1.schema.json';
const ledgerRelativePath = 'docs/dev/aos-privileged-capability-ledger-v1.json';
const schemaPath = path.join(repoRoot, schemaRelativePath);
const bootstrapPaths = new Set([
  schemaRelativePath,
  ledgerRelativePath,
  'tests/schemas/aos-privileged-capability-ledger-v1.test.mjs',
  'docs/dev/test-proof-registry.d/privileged-capability-ledger.json',
  'docs/design/aos-sovereign-first-vertical-slice-contract.md',
  'docs/adr/0045-complete-ax-observation-notification-and-coordinate-contract.md',
  'tests/m4-ax-contract-foundation.test.mjs',
]);

const expectedCapabilityIds = [
  "ax-element-observation",
  "ax-element-actions",
  "axobserver-per-pid-notifications",
  "app-lifecycle-control",
  "window-menu-lifecycle-control",
  "display-topology-observation",
  "focus-window-display-events",
  "coregraphics-input-posting",
  "global-input-event-observation",
  "desktop-pixel-still-capture",
  "screencapturekit-screen-video",
  "screencapturekit-system-audio",
  "screencapturekit-microphone-recording-output",
  "avassetwriter-custom-multitrack",
  "microphone-capture-adapter",
  "audio-playback",
  "clipboard-plain-text",
  "apple-events-applescript-shortcuts",
  "app-owned-user-notifications",
  "system-wide-notification-history",
  "native-status-item",
  "operator-annotation-selection",
  "canvas-wkwebview",
  "canvas-host-action-bus",
  "desktopworld-scene",
  "managed-playwright-runtime",
  "arbitrary-spaces-control",
  "protected-content-attribution",
  "iohid-device-apis",
  "driverkit-virtual-hid",
  "undocumented-hid-event-system-routes",
  "undocumented-windowserver-routes"
];
const expectedMilestoneByCapability = {
  "ax-element-observation": "M4",
  "ax-element-actions": "M4",
  "axobserver-per-pid-notifications": "M4",
  "app-lifecycle-control": "M6",
  "window-menu-lifecycle-control": "M6",
  "display-topology-observation": "M4",
  "focus-window-display-events": "M5",
  "coregraphics-input-posting": "M6",
  "global-input-event-observation": "M5",
  "desktop-pixel-still-capture": "M6",
  "screencapturekit-screen-video": "M3",
  "screencapturekit-system-audio": "M3",
  "screencapturekit-microphone-recording-output": "M3",
  "avassetwriter-custom-multitrack": "M3",
  "microphone-capture-adapter": "M2",
  "audio-playback": "M5",
  "clipboard-plain-text": "M5",
  "apple-events-applescript-shortcuts": "M6",
  "app-owned-user-notifications": "M10",
  "system-wide-notification-history": "unsupported",
  "native-status-item": "M2",
  "operator-annotation-selection": "M6",
  "canvas-wkwebview": "M6",
  "canvas-host-action-bus": "M6",
  "desktopworld-scene": "M6",
  "managed-playwright-runtime": "M7",
  "arbitrary-spaces-control": "unsupported",
  "protected-content-attribution": "unsupported",
  "iohid-device-apis": "M5",
  "driverkit-virtual-hid": "M10",
  "undocumented-hid-event-system-routes": "unsupported",
  "undocumented-windowserver-routes": "unsupported"
};
const expectedCliFormIds = {
  "screencapturekit-screen-video": [
    "record-screen"
  ],
  "screencapturekit-system-audio": [
    "record-screen"
  ],
  "ax-element-observation": [
    "see-capture",
    "see-observe",
    "graph-windows",
    "graph-deepen"
  ],
  "ax-element-actions": [
    "do-press",
    "do-set-value",
    "do-focus",
    "do-raise"
  ],
  "app-lifecycle-control": [
    "do-activate",
    "do-quit",
    "do-hide",
    "do-unhide"
  ],
  "window-menu-lifecycle-control": [
    "do-raise",
    "do-move",
    "do-resize",
    "do-close",
    "do-minimize",
    "do-maximize",
    "do-restore",
    "do-menu"
  ],
  "display-topology-observation": [
    "see-list",
    "graph-displays",
    "graph-windows"
  ],
  "focus-window-display-events": [
    "see-observe"
  ],
  "coregraphics-input-posting": [
    "do-click",
    "do-hover",
    "do-drag-native",
    "do-scroll",
    "do-type",
    "do-key",
    "do-session"
  ],
  "global-input-event-observation": [
    "see-observe",
    "listen-hotkey"
  ],
  "desktop-pixel-still-capture": [
    "see-capture",
    "see-capture-save"
  ],
  "microphone-capture-adapter": [
    "listen-microphone",
    "listen-microphone-segmented"
  ],
  "audio-playback": [
    "play-audio-follow",
    "say-text",
    "say-follow",
    "say-list-voices"
  ],
  "apple-events-applescript-shortcuts": [
    "do-tell",
    "shortcut-run"
  ],
  "native-status-item": [
    "status-item-validate",
    "status-item-register",
    "status-item-update",
    "status-item-inspect",
    "status-item-invoke"
  ],
  "operator-annotation-selection": [
    "annotation-select-follow",
    "annotation-target-select-follow"
  ],
  "canvas-wkwebview": [
    "show-create",
    "show-update",
    "show-remove",
    "show-remove-all",
    "show-list",
    "show-audit",
    "show-render",
    "show-eval",
    "show-listen",
    "show-ping",
    "show-wait",
    "show-exists",
    "show-get",
    "show-to-front",
    "show-post",
    "see-capture",
    "do-click",
    "do-drag-canvas",
    "do-set-value"
  ],
  "desktopworld-scene": [
    "scene-follow",
    "scene-cartridge-validate",
    "scene-cartridge-scaffold",
    "scene-extension-validate",
    "scene-extension-scaffold",
    "scene-extension-install",
    "scene-extension-list",
    "scene-effect-trigger",
    "scene-list",
    "scene-inspect",
    "scene-monitor",
    "scene-perf",
    "scene-replay",
    "scene-devtools-open",
    "scene-devtools-status",
    "scene-devtools-update",
    "scene-devtools-transfer",
    "scene-devtools-close"
  ],
  "managed-playwright-runtime": [
    "browser-companion-status",
    "browser-companion-install",
    "browser-companion-update",
    "browser-companion-uninstall",
    "focus-create",
    "focus-update",
    "focus-list",
    "focus-remove",
    "do-scroll-browser",
    "do-type-browser",
    "do-key-browser",
    "do-navigate",
    "see-capture-browser",
    "see-capture-browser-save"
  ]
};
const expectedCliBindingsByCapability = {
  "screencapturekit-screen-video": [
    {
      "form_id": "record-screen",
      "help_source": "manifests/commands/source/aos/42-screen-recording.json",
      "route_path": "record",
      "route_source": "manifests/commands/source/external/50-screen-recording.json",
      "route_selectors": [
        {
          "path": [
            "record"
          ],
          "when": null,
          "executable": "$AOS_PATH",
          "argv_prefix": [
            "__record"
          ]
        }
      ]
    }
  ],
  "screencapturekit-system-audio": [
    {
      "form_id": "record-screen",
      "help_source": "manifests/commands/source/aos/42-screen-recording.json",
      "route_path": "record",
      "route_source": "manifests/commands/source/external/50-screen-recording.json",
      "route_selectors": [
        {
          "path": [
            "record"
          ],
          "when": null,
          "executable": "$AOS_PATH",
          "argv_prefix": [
            "__record"
          ]
        }
      ]
    }
  ],
  "ax-element-observation": [
    {
      "form_id": "see-capture",
      "help_source": "manifests/commands/source/aos/03-see-01-capture.json",
      "route_path": "see capture",
      "route_source": "manifests/commands/source/external/11-see.json",
      "route_selectors": [
        {
          "path": [
            "see",
            "capture"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-see-native.mjs",
            "capture"
          ]
        }
      ]
    },
    {
      "form_id": "see-observe",
      "help_source": "manifests/commands/source/aos/03-see-01-capture.json",
      "route_path": "see observe",
      "route_source": "manifests/commands/source/external/11-see.json",
      "route_selectors": [
        {
          "path": [
            "see",
            "observe"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-see-observe.mjs"
          ]
        }
      ]
    },
    {
      "form_id": "graph-windows",
      "help_source": "manifests/commands/source/aos/16-graph.json",
      "route_path": "graph windows",
      "route_source": "manifests/commands/source/external/36-graph.json",
      "route_selectors": [
        {
          "path": [
            "graph",
            "windows"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-focus-graph.mjs",
            "graph",
            "windows"
          ]
        }
      ]
    },
    {
      "form_id": "graph-deepen",
      "help_source": "manifests/commands/source/aos/16-graph.json",
      "route_path": "graph deepen",
      "route_source": "manifests/commands/source/external/36-graph.json",
      "route_selectors": [
        {
          "path": [
            "graph",
            "deepen"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-focus-graph.mjs",
            "graph",
            "deepen"
          ]
        }
      ]
    }
  ],
  "ax-element-actions": [
    {
      "form_id": "do-press",
      "help_source": "manifests/commands/source/aos/07-do-03-controls.json",
      "route_path": "do press",
      "route_source": "manifests/commands/source/external/07-do-03-controls.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "press"
          ],
          "when": {
            "child_arg_index": 0,
            "prefix": "ref:"
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-ref.mjs",
            "press"
          ]
        },
        {
          "path": [
            "do",
            "press"
          ],
          "when": {
            "child_arg_index": 0,
            "excluded_prefixes": [
              "ref:"
            ]
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "press"
          ]
        }
      ]
    },
    {
      "form_id": "do-set-value",
      "help_source": "manifests/commands/source/aos/07-do-03-controls.json",
      "route_path": "do set-value",
      "route_source": "manifests/commands/source/external/07-do-03-controls.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "set-value"
          ],
          "when": {
            "child_arg_index": 0,
            "prefix": "ref:"
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-ref.mjs",
            "set-value"
          ]
        },
        {
          "path": [
            "do",
            "set-value"
          ],
          "when": {
            "child_arg_index": 0,
            "excluded_prefixes": [
              "ref:",
              "canvas:"
            ]
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "set-value"
          ]
        }
      ]
    },
    {
      "form_id": "do-focus",
      "help_source": "manifests/commands/source/aos/07-do-03-controls.json",
      "route_path": "do focus",
      "route_source": "manifests/commands/source/external/07-do-03-controls.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "focus"
          ],
          "when": {
            "child_arg_index": 0,
            "prefix": "ref:"
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-ref.mjs",
            "focus"
          ]
        },
        {
          "path": [
            "do",
            "focus"
          ],
          "when": {
            "child_arg_index": 0,
            "excluded_prefixes": [
              "ref:"
            ]
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "focus"
          ]
        }
      ]
    },
    {
      "form_id": "do-raise",
      "help_source": "manifests/commands/source/aos/07-do-04-window.json",
      "route_path": "do raise",
      "route_source": "manifests/commands/source/external/07-do-04-window.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "raise"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "raise"
          ]
        }
      ]
    }
  ],
  "app-lifecycle-control": [
    {
      "form_id": "do-activate",
      "help_source": "manifests/commands/source/aos/07-do-06-app-lifecycle.json",
      "route_path": "do activate",
      "route_source": "manifests/commands/source/external/07-do-05-app-lifecycle.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "activate"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "activate"
          ]
        }
      ]
    },
    {
      "form_id": "do-quit",
      "help_source": "manifests/commands/source/aos/07-do-06-app-lifecycle.json",
      "route_path": "do quit",
      "route_source": "manifests/commands/source/external/07-do-05-app-lifecycle.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "quit"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "quit"
          ]
        }
      ]
    },
    {
      "form_id": "do-hide",
      "help_source": "manifests/commands/source/aos/07-do-06-app-lifecycle.json",
      "route_path": "do hide",
      "route_source": "manifests/commands/source/external/07-do-05-app-lifecycle.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "hide"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "hide"
          ]
        }
      ]
    },
    {
      "form_id": "do-unhide",
      "help_source": "manifests/commands/source/aos/07-do-06-app-lifecycle.json",
      "route_path": "do unhide",
      "route_source": "manifests/commands/source/external/07-do-05-app-lifecycle.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "unhide"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "unhide"
          ]
        }
      ]
    }
  ],
  "window-menu-lifecycle-control": [
    {
      "form_id": "do-raise",
      "help_source": "manifests/commands/source/aos/07-do-04-window.json",
      "route_path": "do raise",
      "route_source": "manifests/commands/source/external/07-do-04-window.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "raise"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "raise"
          ]
        }
      ]
    },
    {
      "form_id": "do-move",
      "help_source": "manifests/commands/source/aos/07-do-04-window.json",
      "route_path": "do move",
      "route_source": "manifests/commands/source/external/07-do-04-window.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "move"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "move"
          ]
        }
      ]
    },
    {
      "form_id": "do-resize",
      "help_source": "manifests/commands/source/aos/07-do-04-window.json",
      "route_path": "do resize",
      "route_source": "manifests/commands/source/external/07-do-04-window.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "resize"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "resize"
          ]
        }
      ]
    },
    {
      "form_id": "do-close",
      "help_source": "manifests/commands/source/aos/07-do-04-window.json",
      "route_path": "do close",
      "route_source": "manifests/commands/source/external/07-do-04-window.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "close"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "close"
          ]
        }
      ]
    },
    {
      "form_id": "do-minimize",
      "help_source": "manifests/commands/source/aos/07-do-04-window.json",
      "route_path": "do minimize",
      "route_source": "manifests/commands/source/external/07-do-04-window.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "minimize"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "minimize"
          ]
        }
      ]
    },
    {
      "form_id": "do-maximize",
      "help_source": "manifests/commands/source/aos/07-do-04-window.json",
      "route_path": "do maximize",
      "route_source": "manifests/commands/source/external/07-do-04-window.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "maximize"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "maximize"
          ]
        }
      ]
    },
    {
      "form_id": "do-restore",
      "help_source": "manifests/commands/source/aos/07-do-04-window.json",
      "route_path": "do restore",
      "route_source": "manifests/commands/source/external/07-do-04-window.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "restore"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "restore"
          ]
        }
      ]
    },
    {
      "form_id": "do-menu",
      "help_source": "manifests/commands/source/aos/07-do-07-menu.json",
      "route_path": "do menu",
      "route_source": "manifests/commands/source/external/07-do-06-menu.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "menu"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "menu"
          ]
        }
      ]
    }
  ],
  "display-topology-observation": [
    {
      "form_id": "see-list",
      "help_source": "manifests/commands/source/aos/03-see-01-capture.json",
      "route_path": "see list",
      "route_source": "manifests/commands/source/external/11-see.json",
      "route_selectors": [
        {
          "path": [
            "see",
            "list"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-see-native.mjs",
            "list"
          ]
        }
      ]
    },
    {
      "form_id": "graph-displays",
      "help_source": "manifests/commands/source/aos/16-graph.json",
      "route_path": "graph displays",
      "route_source": "manifests/commands/source/external/36-graph.json",
      "route_selectors": [
        {
          "path": [
            "graph",
            "displays"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-focus-graph.mjs",
            "graph",
            "displays"
          ]
        }
      ]
    },
    {
      "form_id": "graph-windows",
      "help_source": "manifests/commands/source/aos/16-graph.json",
      "route_path": "graph windows",
      "route_source": "manifests/commands/source/external/36-graph.json",
      "route_selectors": [
        {
          "path": [
            "graph",
            "windows"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-focus-graph.mjs",
            "graph",
            "windows"
          ]
        }
      ]
    }
  ],
  "focus-window-display-events": [
    {
      "form_id": "see-observe",
      "help_source": "manifests/commands/source/aos/03-see-01-capture.json",
      "route_path": "see observe",
      "route_source": "manifests/commands/source/external/11-see.json",
      "route_selectors": [
        {
          "path": [
            "see",
            "observe"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-see-observe.mjs"
          ]
        }
      ]
    }
  ],
  "coregraphics-input-posting": [
    {
      "form_id": "do-click",
      "help_source": "manifests/commands/source/aos/07-do-01-pointing.json",
      "route_path": "do click",
      "route_source": "manifests/commands/source/external/07-do-01-pointing.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "click"
          ],
          "when": {
            "child_arg_index": 0,
            "prefix": "ref:"
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-ref.mjs",
            "click"
          ]
        },
        {
          "path": [
            "do",
            "click"
          ],
          "when": {
            "child_arg_index": 0,
            "excluded_prefixes": [
              "browser:",
              "ref:",
              "canvas:"
            ]
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "click"
          ]
        }
      ]
    },
    {
      "form_id": "do-hover",
      "help_source": "manifests/commands/source/aos/07-do-01-pointing.json",
      "route_path": "do hover",
      "route_source": "manifests/commands/source/external/07-do-01-pointing.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "hover"
          ],
          "when": {
            "child_arg_index": 0,
            "prefix": "ref:"
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-ref.mjs",
            "hover"
          ]
        },
        {
          "path": [
            "do",
            "hover"
          ],
          "when": {
            "child_arg_index": 0,
            "excluded_prefixes": [
              "browser:",
              "ref:"
            ]
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "hover"
          ]
        }
      ]
    },
    {
      "form_id": "do-drag-native",
      "help_source": "manifests/commands/source/aos/07-do-01-pointing.json",
      "route_path": "do drag",
      "route_source": "manifests/commands/source/external/07-do-01-pointing.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "drag"
          ],
          "when": {
            "child_arg_index": 0,
            "excluded_prefixes": [
              "browser:",
              "ref:",
              "canvas:"
            ]
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "drag"
          ]
        }
      ]
    },
    {
      "form_id": "do-scroll",
      "help_source": "manifests/commands/source/aos/07-do-01-pointing.json",
      "route_path": "do scroll",
      "route_source": "manifests/commands/source/external/07-do-01-pointing.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "scroll"
          ],
          "when": {
            "child_arg_index": 0,
            "prefix": "ref:"
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-ref.mjs",
            "scroll"
          ]
        },
        {
          "path": [
            "do",
            "scroll"
          ],
          "when": {
            "child_arg_index": 0,
            "excluded_prefixes": [
              "browser:",
              "ref:"
            ]
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "scroll"
          ]
        }
      ]
    },
    {
      "form_id": "do-type",
      "help_source": "manifests/commands/source/aos/07-do-02-text.json",
      "route_path": "do type",
      "route_source": "manifests/commands/source/external/07-do-02-text.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "type"
          ],
          "when": {
            "child_arg_index": 0,
            "excluded_prefixes": [
              "browser:",
              "ref:"
            ]
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "type"
          ]
        }
      ]
    },
    {
      "form_id": "do-key",
      "help_source": "manifests/commands/source/aos/07-do-02-text.json",
      "route_path": "do key",
      "route_source": "manifests/commands/source/external/07-do-02-text.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "key"
          ],
          "when": {
            "child_arg_index": 0,
            "excluded_prefixes": [
              "browser:",
              "ref:"
            ]
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "key"
          ]
        }
      ]
    },
    {
      "form_id": "do-session",
      "help_source": "manifests/commands/source/aos/07-do-05-script-session.json",
      "route_path": "do session",
      "route_source": "manifests/commands/source/external/07-do-07-script-session.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "session"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "session"
          ]
        }
      ]
    }
  ],
  "global-input-event-observation": [
    {
      "form_id": "see-observe",
      "help_source": "manifests/commands/source/aos/03-see-01-capture.json",
      "route_path": "see observe",
      "route_source": "manifests/commands/source/external/11-see.json",
      "route_selectors": [
        {
          "path": [
            "see",
            "observe"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-see-observe.mjs"
          ]
        }
      ]
    },
    {
      "form_id": "listen-hotkey",
      "help_source": "manifests/commands/source/aos/12-listen.json",
      "route_path": "listen",
      "route_source": "manifests/commands/source/external/15-listen.json",
      "route_selectors": [
        {
          "path": [
            "listen"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "--input-type=module",
            "-",
            "listen"
          ]
        }
      ]
    }
  ],
  "desktop-pixel-still-capture": [
    {
      "form_id": "see-capture",
      "help_source": "manifests/commands/source/aos/03-see-01-capture.json",
      "route_path": "see capture",
      "route_source": "manifests/commands/source/external/11-see.json",
      "route_selectors": [
        {
          "path": [
            "see",
            "capture"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-see-native.mjs",
            "capture"
          ]
        }
      ]
    },
    {
      "form_id": "see-capture-save",
      "help_source": "manifests/commands/source/aos/03-see-01-capture.json",
      "route_path": "see capture",
      "route_source": "manifests/commands/source/external/11-see.json",
      "route_selectors": [
        {
          "path": [
            "see",
            "capture"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-see-native.mjs",
            "capture"
          ]
        }
      ]
    }
  ],
  "microphone-capture-adapter": [
    {
      "form_id": "listen-microphone",
      "help_source": "manifests/commands/source/aos/12-listen.json",
      "route_path": "listen",
      "route_source": "manifests/commands/source/external/15-listen.json",
      "route_selectors": [
        {
          "path": [
            "listen"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "--input-type=module",
            "-",
            "listen"
          ]
        }
      ]
    },
    {
      "form_id": "listen-microphone-segmented",
      "help_source": "manifests/commands/source/aos/12-listen.json",
      "route_path": "listen",
      "route_source": "manifests/commands/source/external/15-listen.json",
      "route_selectors": [
        {
          "path": [
            "listen"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "--input-type=module",
            "-",
            "listen"
          ]
        }
      ]
    }
  ],
  "audio-playback": [
    {
      "form_id": "play-audio-follow",
      "help_source": "manifests/commands/source/aos/08-play.json",
      "route_path": "play",
      "route_source": "manifests/commands/source/external/18-play.json",
      "route_selectors": [
        {
          "path": [
            "play"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-play.mjs"
          ]
        }
      ]
    },
    {
      "form_id": "say-text",
      "help_source": "manifests/commands/source/aos/08-say.json",
      "route_path": "say",
      "route_source": "manifests/commands/source/external/18-say.json",
      "route_selectors": [
        {
          "path": [
            "say"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-say.mjs"
          ]
        }
      ]
    },
    {
      "form_id": "say-follow",
      "help_source": "manifests/commands/source/aos/08-say.json",
      "route_path": "say",
      "route_source": "manifests/commands/source/external/18-say.json",
      "route_selectors": [
        {
          "path": [
            "say"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-say.mjs"
          ]
        }
      ]
    },
    {
      "form_id": "say-list-voices",
      "help_source": "manifests/commands/source/aos/08-say.json",
      "route_path": "say",
      "route_source": "manifests/commands/source/external/18-say.json",
      "route_selectors": [
        {
          "path": [
            "say"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-say.mjs"
          ]
        }
      ]
    }
  ],
  "apple-events-applescript-shortcuts": [
    {
      "form_id": "do-tell",
      "help_source": "manifests/commands/source/aos/07-do-05-script-session.json",
      "route_path": "do tell",
      "route_source": "manifests/commands/source/external/07-do-07-script-session.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "tell"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-native.mjs",
            "tell"
          ]
        }
      ]
    },
    {
      "form_id": "shortcut-run",
      "help_source": "manifests/commands/source/aos/22-shortcut.json",
      "route_path": "shortcut run",
      "route_source": "manifests/commands/source/external/25-shortcut.json",
      "route_selectors": [
        {
          "path": [
            "shortcut",
            "run"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-shortcut.mjs",
            "run"
          ]
        }
      ]
    }
  ],
  "native-status-item": [
    {
      "form_id": "status-item-validate",
      "help_source": "manifests/commands/source/aos/40-status-item.json",
      "route_path": "status-item validate",
      "route_source": "manifests/commands/source/external/48-status-item.json",
      "route_selectors": [
        {
          "path": [
            "status-item",
            "validate"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-status-item.mjs",
            "validate"
          ]
        }
      ]
    },
    {
      "form_id": "status-item-register",
      "help_source": "manifests/commands/source/aos/40-status-item.json",
      "route_path": "status-item register",
      "route_source": "manifests/commands/source/external/48-status-item.json",
      "route_selectors": [
        {
          "path": [
            "status-item",
            "register"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-status-item.mjs",
            "register"
          ]
        }
      ]
    },
    {
      "form_id": "status-item-update",
      "help_source": "manifests/commands/source/aos/40-status-item.json",
      "route_path": "status-item update",
      "route_source": "manifests/commands/source/external/48-status-item.json",
      "route_selectors": [
        {
          "path": [
            "status-item",
            "update"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-status-item.mjs",
            "update"
          ]
        }
      ]
    },
    {
      "form_id": "status-item-inspect",
      "help_source": "manifests/commands/source/aos/40-status-item.json",
      "route_path": "status-item inspect",
      "route_source": "manifests/commands/source/external/48-status-item.json",
      "route_selectors": [
        {
          "path": [
            "status-item",
            "inspect"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-status-item.mjs",
            "inspect"
          ]
        }
      ]
    },
    {
      "form_id": "status-item-invoke",
      "help_source": "manifests/commands/source/aos/40-status-item.json",
      "route_path": "status-item invoke",
      "route_source": "manifests/commands/source/external/48-status-item.json",
      "route_selectors": [
        {
          "path": [
            "status-item",
            "invoke"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-status-item.mjs",
            "invoke"
          ]
        }
      ]
    }
  ],
  "operator-annotation-selection": [
    {
      "form_id": "annotation-select-follow",
      "help_source": "manifests/commands/source/aos/03-see-04-annotation.json",
      "route_path": "see annotation select",
      "route_source": "manifests/commands/source/external/11-see.json",
      "route_selectors": [
        {
          "path": [
            "see",
            "annotation",
            "select"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-annotation-select.mjs"
          ]
        }
      ]
    },
    {
      "form_id": "annotation-target-select-follow",
      "help_source": "manifests/commands/source/aos/03-see-04-annotation.json",
      "route_path": "see annotation select",
      "route_source": "manifests/commands/source/external/11-see.json",
      "route_selectors": [
        {
          "path": [
            "see",
            "annotation",
            "select"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-annotation-select.mjs"
          ]
        }
      ]
    }
  ],
  "canvas-wkwebview": [
    {
      "form_id": "show-create",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show create",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "create"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-client.mjs",
            "create"
          ]
        }
      ]
    },
    {
      "form_id": "show-update",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show update",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "update"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-client.mjs",
            "update"
          ]
        }
      ]
    },
    {
      "form_id": "show-remove",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show remove",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "remove"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-client.mjs",
            "remove"
          ]
        }
      ]
    },
    {
      "form_id": "show-remove-all",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show remove-all",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "remove-all"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-client.mjs",
            "remove-all"
          ]
        }
      ]
    },
    {
      "form_id": "show-list",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show list",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "list"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-client.mjs",
            "list"
          ]
        }
      ]
    },
    {
      "form_id": "show-audit",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show audit",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "audit"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-client.mjs",
            "audit"
          ]
        }
      ]
    },
    {
      "form_id": "show-render",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show render",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "render"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-render.mjs"
          ]
        }
      ]
    },
    {
      "form_id": "show-eval",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show eval",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "eval"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-client.mjs",
            "eval"
          ]
        }
      ]
    },
    {
      "form_id": "show-listen",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show listen",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "listen"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-client.mjs",
            "listen"
          ]
        }
      ]
    },
    {
      "form_id": "show-ping",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show ping",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "ping"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-client.mjs",
            "ping"
          ]
        }
      ]
    },
    {
      "form_id": "show-wait",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show wait",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "wait"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-client.mjs",
            "wait"
          ]
        }
      ]
    },
    {
      "form_id": "show-exists",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show exists",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "exists"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-lookup.mjs",
            "exists"
          ]
        }
      ]
    },
    {
      "form_id": "show-get",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show get",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "get"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-lookup.mjs",
            "get"
          ]
        }
      ]
    },
    {
      "form_id": "show-to-front",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show to-front",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "to-front"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-client.mjs",
            "to-front"
          ]
        }
      ]
    },
    {
      "form_id": "show-post",
      "help_source": "manifests/commands/source/aos/04-show.json",
      "route_path": "show post",
      "route_source": "manifests/commands/source/external/20-show.json",
      "route_selectors": [
        {
          "path": [
            "show",
            "post"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-show-client.mjs",
            "post"
          ]
        }
      ]
    },
    {
      "form_id": "see-capture",
      "help_source": "manifests/commands/source/aos/03-see-01-capture.json",
      "route_path": "see capture",
      "route_source": "manifests/commands/source/external/11-see.json",
      "route_selectors": [
        {
          "path": [
            "see",
            "capture"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-see-native.mjs",
            "capture"
          ]
        }
      ]
    },
    {
      "form_id": "do-click",
      "help_source": "manifests/commands/source/aos/07-do-01-pointing.json",
      "route_path": "do click",
      "route_source": "manifests/commands/source/external/07-do-01-pointing.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "click"
          ],
          "when": {
            "child_arg_index": 0,
            "prefix": "canvas:"
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-canvas.mjs",
            "click"
          ]
        }
      ]
    },
    {
      "form_id": "do-drag-canvas",
      "help_source": "manifests/commands/source/aos/07-do-01-pointing.json",
      "route_path": "do drag",
      "route_source": "manifests/commands/source/external/07-do-01-pointing.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "drag"
          ],
          "when": {
            "child_arg_index": 0,
            "prefix": "canvas:"
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-canvas.mjs",
            "drag"
          ]
        }
      ]
    },
    {
      "form_id": "do-set-value",
      "help_source": "manifests/commands/source/aos/07-do-03-controls.json",
      "route_path": "do set-value",
      "route_source": "manifests/commands/source/external/07-do-03-controls.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "set-value"
          ],
          "when": {
            "child_arg_index": 0,
            "prefix": "canvas:"
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "scripts/aos-do-canvas.mjs",
            "set-value"
          ]
        }
      ]
    }
  ],
  "desktopworld-scene": [
    {
      "form_id": "scene-follow",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs"
          ]
        }
      ]
    },
    {
      "form_id": "scene-cartridge-validate",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene cartridge validate",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "cartridge",
            "validate"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "cartridge",
            "validate"
          ]
        }
      ]
    },
    {
      "form_id": "scene-cartridge-scaffold",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene cartridge scaffold",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "cartridge",
            "scaffold"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "cartridge",
            "scaffold"
          ]
        }
      ]
    },
    {
      "form_id": "scene-extension-validate",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene extension validate",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "extension",
            "validate"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "extension",
            "validate"
          ]
        }
      ]
    },
    {
      "form_id": "scene-extension-scaffold",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene extension scaffold",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "extension",
            "scaffold"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "extension",
            "scaffold"
          ]
        }
      ]
    },
    {
      "form_id": "scene-extension-install",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene extension install",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "extension",
            "install"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "extension",
            "install"
          ]
        }
      ]
    },
    {
      "form_id": "scene-extension-list",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene extension list",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "extension",
            "list"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "extension",
            "list"
          ]
        }
      ]
    },
    {
      "form_id": "scene-effect-trigger",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene effect trigger",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "effect",
            "trigger"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "effect",
            "trigger"
          ]
        }
      ]
    },
    {
      "form_id": "scene-list",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene list",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "list"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "list"
          ]
        }
      ]
    },
    {
      "form_id": "scene-inspect",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene inspect",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "inspect"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "inspect"
          ]
        }
      ]
    },
    {
      "form_id": "scene-monitor",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene monitor",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "monitor"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "monitor"
          ]
        }
      ]
    },
    {
      "form_id": "scene-perf",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene perf",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "perf"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "perf"
          ]
        }
      ]
    },
    {
      "form_id": "scene-replay",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene replay",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "replay"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "replay"
          ]
        }
      ]
    },
    {
      "form_id": "scene-devtools-open",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene devtools open",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "devtools",
            "open"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "devtools",
            "open"
          ]
        }
      ]
    },
    {
      "form_id": "scene-devtools-status",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene devtools status",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "devtools",
            "status"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "devtools",
            "status"
          ]
        }
      ]
    },
    {
      "form_id": "scene-devtools-update",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene devtools update",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "devtools",
            "update"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "devtools",
            "update"
          ]
        }
      ]
    },
    {
      "form_id": "scene-devtools-transfer",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene devtools transfer",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "devtools",
            "transfer"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "devtools",
            "transfer"
          ]
        }
      ]
    },
    {
      "form_id": "scene-devtools-close",
      "help_source": "manifests/commands/source/aos/39-scene.json",
      "route_path": "scene devtools close",
      "route_source": "manifests/commands/source/external/47-scene.json",
      "route_selectors": [
        {
          "path": [
            "scene",
            "devtools",
            "close"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-scene.mjs",
            "devtools",
            "close"
          ]
        }
      ]
    }
  ],
  "managed-playwright-runtime": [
    {
      "form_id": "browser-companion-status",
      "help_source": "manifests/commands/source/aos/33-browser-companion.json",
      "route_path": "browser companion status",
      "route_source": "manifests/commands/source/external/22-browser-companion.json",
      "route_selectors": [
        {
          "path": [
            "browser",
            "companion",
            "status"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-browser-companion.mjs",
            "status"
          ]
        }
      ]
    },
    {
      "form_id": "browser-companion-install",
      "help_source": "manifests/commands/source/aos/33-browser-companion.json",
      "route_path": "browser companion install",
      "route_source": "manifests/commands/source/external/22-browser-companion.json",
      "route_selectors": [
        {
          "path": [
            "browser",
            "companion",
            "install"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-browser-companion.mjs",
            "install"
          ]
        }
      ]
    },
    {
      "form_id": "browser-companion-update",
      "help_source": "manifests/commands/source/aos/33-browser-companion.json",
      "route_path": "browser companion update",
      "route_source": "manifests/commands/source/external/22-browser-companion.json",
      "route_selectors": [
        {
          "path": [
            "browser",
            "companion",
            "update"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-browser-companion.mjs",
            "update"
          ]
        }
      ]
    },
    {
      "form_id": "browser-companion-uninstall",
      "help_source": "manifests/commands/source/aos/33-browser-companion.json",
      "route_path": "browser companion uninstall",
      "route_source": "manifests/commands/source/external/22-browser-companion.json",
      "route_selectors": [
        {
          "path": [
            "browser",
            "companion",
            "uninstall"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-browser-companion.mjs",
            "uninstall"
          ]
        }
      ]
    },
    {
      "form_id": "focus-create",
      "help_source": "manifests/commands/source/aos/15-focus.json",
      "route_path": "focus create",
      "route_source": "manifests/commands/source/external/35-focus.json",
      "route_selectors": [
        {
          "path": [
            "focus",
            "create"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-focus-graph.mjs",
            "focus",
            "create"
          ]
        }
      ]
    },
    {
      "form_id": "focus-update",
      "help_source": "manifests/commands/source/aos/15-focus.json",
      "route_path": "focus update",
      "route_source": "manifests/commands/source/external/35-focus.json",
      "route_selectors": [
        {
          "path": [
            "focus",
            "update"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-focus-graph.mjs",
            "focus",
            "update"
          ]
        }
      ]
    },
    {
      "form_id": "focus-list",
      "help_source": "manifests/commands/source/aos/15-focus.json",
      "route_path": "focus list",
      "route_source": "manifests/commands/source/external/35-focus.json",
      "route_selectors": [
        {
          "path": [
            "focus",
            "list"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-focus-graph.mjs",
            "focus",
            "list"
          ]
        }
      ]
    },
    {
      "form_id": "focus-remove",
      "help_source": "manifests/commands/source/aos/15-focus.json",
      "route_path": "focus remove",
      "route_source": "manifests/commands/source/external/35-focus.json",
      "route_selectors": [
        {
          "path": [
            "focus",
            "remove"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-focus-graph.mjs",
            "focus",
            "remove"
          ]
        }
      ]
    },
    {
      "form_id": "do-scroll-browser",
      "help_source": "manifests/commands/source/aos/07-do-01-pointing.json",
      "route_path": "do scroll",
      "route_source": "manifests/commands/source/external/07-do-01-pointing.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "scroll"
          ],
          "when": {
            "child_arg_index": 0,
            "prefix": "browser:"
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-do-browser.mjs",
            "scroll"
          ]
        }
      ]
    },
    {
      "form_id": "do-type-browser",
      "help_source": "manifests/commands/source/aos/07-do-02-text.json",
      "route_path": "do type",
      "route_source": "manifests/commands/source/external/07-do-02-text.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "type"
          ],
          "when": {
            "child_arg_index": 0,
            "prefix": "browser:"
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-do-browser.mjs",
            "type"
          ]
        }
      ]
    },
    {
      "form_id": "do-key-browser",
      "help_source": "manifests/commands/source/aos/07-do-02-text.json",
      "route_path": "do key",
      "route_source": "manifests/commands/source/external/07-do-02-text.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "key"
          ],
          "when": {
            "child_arg_index": 0,
            "prefix": "browser:"
          },
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-do-browser.mjs",
            "key"
          ]
        }
      ]
    },
    {
      "form_id": "do-navigate",
      "help_source": "manifests/commands/source/aos/07-do-02-text.json",
      "route_path": "do navigate",
      "route_source": "manifests/commands/source/external/07-do-02-text.json",
      "route_selectors": [
        {
          "path": [
            "do",
            "navigate"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-do-browser.mjs",
            "navigate"
          ]
        }
      ]
    },
    {
      "form_id": "see-capture-browser",
      "help_source": "manifests/commands/source/aos/03-see-01-capture.json",
      "route_path": "see capture",
      "route_source": "manifests/commands/source/external/11-see.json",
      "route_selectors": [
        {
          "path": [
            "see",
            "capture"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-see-native.mjs",
            "capture"
          ]
        }
      ]
    },
    {
      "form_id": "see-capture-browser-save",
      "help_source": "manifests/commands/source/aos/03-see-01-capture.json",
      "route_path": "see capture",
      "route_source": "manifests/commands/source/external/11-see.json",
      "route_selectors": [
        {
          "path": [
            "see",
            "capture"
          ],
          "when": null,
          "executable": "/usr/bin/env",
          "argv_prefix": [
            "node",
            "$AOS_REPO_ROOT/scripts/aos-see-native.mjs",
            "capture"
          ]
        }
      ]
    }
  ]
};
const expectedAvailabilityCatalog = [
  [
    "ax-element-observation",
    "AXUIElementCreateApplication",
    "ApplicationServices",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "ax-element-observation",
    "AXUIElementCopyAttributeValue",
    "ApplicationServices",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "ax-element-observation",
    "AXUIElementCopyActionNames",
    "ApplicationServices",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "ax-element-observation",
    "AXIsProcessTrusted",
    "ApplicationServices",
    true,
    "known",
    "macos",
    "10.4",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "ax-element-actions",
    "AXUIElementPerformAction",
    "ApplicationServices",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "ax-element-actions",
    "AXUIElementSetAttributeValue",
    "ApplicationServices",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "ax-element-actions",
    "AXUIElementIsAttributeSettable",
    "ApplicationServices",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "ax-element-actions",
    "AXIsProcessTrusted",
    "ApplicationServices",
    true,
    "known",
    "macos",
    "10.4",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "axobserver-per-pid-notifications",
    "AXObserverCreate",
    "ApplicationServices",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "axobserver-per-pid-notifications",
    "AXObserverAddNotification",
    "ApplicationServices",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "axobserver-per-pid-notifications",
    "AXIsProcessTrusted",
    "ApplicationServices",
    true,
    "known",
    "macos",
    "10.4",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "app-lifecycle-control",
    "NSRunningApplication",
    "AppKit",
    true,
    "known",
    "macos",
    "10.6",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSRunningApplication.h"
  ],
  [
    "window-menu-lifecycle-control",
    "AXUIElementPerformAction",
    "ApplicationServices",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "window-menu-lifecycle-control",
    "CGWindowListCopyWindowInfo",
    "CoreGraphics",
    false,
    "known",
    "macos",
    "10.5",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGWindow.h"
  ],
  [
    "window-menu-lifecycle-control",
    "_AXUIElementGetWindow",
    "ApplicationServices",
    false,
    "undocumented_unverified",
    "macos",
    null,
    "source_inventory",
    null,
    "src/perceive/ax.swift"
  ],
  [
    "window-menu-lifecycle-control",
    "AXIsProcessTrusted",
    "ApplicationServices",
    true,
    "known",
    "macos",
    "10.4",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "display-topology-observation",
    "CGGetActiveDisplayList",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.0",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGDirectDisplay.h"
  ],
  [
    "display-topology-observation",
    "CGDisplayBounds",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.0",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGDirectDisplay.h"
  ],
  [
    "display-topology-observation",
    "ColorSyncDeviceCopyDeviceInfo",
    "ColorSync",
    true,
    "known",
    "macos",
    "10.4",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ColorSync.framework/Headers/ColorSyncDevice.h"
  ],
  [
    "display-topology-observation",
    "NSScreen.screens",
    "AppKit",
    false,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSScreen.h"
  ],
  [
    "display-topology-observation",
    "CGWindowListCopyWindowInfo",
    "CoreGraphics",
    false,
    "known",
    "macos",
    "10.5",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGWindow.h"
  ],
  [
    "focus-window-display-events",
    "NSWorkspace.frontmostApplication",
    "AppKit",
    true,
    "known",
    "macos",
    "10.7",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSWorkspace.h"
  ],
  [
    "focus-window-display-events",
    "NSApplication.didChangeScreenParametersNotification",
    "AppKit",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSApplication.h"
  ],
  [
    "focus-window-display-events",
    "CGWindowListCopyWindowInfo",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.5",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGWindow.h"
  ],
  [
    "focus-window-display-events",
    "AXIsProcessTrusted",
    "ApplicationServices",
    true,
    "known",
    "macos",
    "10.4",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "coregraphics-input-posting",
    "CGEventCreate",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.4",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGEvent.h"
  ],
  [
    "coregraphics-input-posting",
    "CGEventPost",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.4",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGEvent.h"
  ],
  [
    "coregraphics-input-posting",
    "CGPreflightPostEventAccess",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.15",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGEvent.h"
  ],
  [
    "global-input-event-observation",
    "CGEventTapCreate",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.4",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGEvent.h"
  ],
  [
    "global-input-event-observation",
    "CGPreflightListenEventAccess",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.15",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGEvent.h"
  ],
  [
    "desktop-pixel-still-capture",
    "SCScreenshotManager.captureImage",
    "ScreenCaptureKit",
    true,
    "known",
    "macos",
    "14.0",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ScreenCaptureKit.framework/Headers/SCScreenshotManager.h"
  ],
  [
    "desktop-pixel-still-capture",
    "SCShareableContent",
    "ScreenCaptureKit",
    true,
    "known",
    "macos",
    "12.3",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ScreenCaptureKit.framework/Headers/SCShareableContent.h"
  ],
  [
    "desktop-pixel-still-capture",
    "CGPreflightScreenCaptureAccess",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.15",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGWindow.h"
  ],
  [
    "screencapturekit-screen-video",
    "SCStream",
    "ScreenCaptureKit",
    true,
    "known",
    "macos",
    "12.3",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ScreenCaptureKit.framework/Headers/SCStream.h"
  ],
  [
    "screencapturekit-screen-video",
    "SCStreamOutputType.screen",
    "ScreenCaptureKit",
    true,
    "known",
    "macos",
    "12.3",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ScreenCaptureKit.framework/Headers/SCStream.h"
  ],
  [
    "screencapturekit-screen-video",
    "SCStreamConfiguration",
    "ScreenCaptureKit",
    true,
    "known",
    "macos",
    "12.3",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ScreenCaptureKit.framework/Headers/SCStream.h"
  ],
  [
    "screencapturekit-screen-video",
    "CGPreflightScreenCaptureAccess",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.15",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGWindow.h"
  ],
  [
    "screencapturekit-system-audio",
    "SCStreamOutputType.audio",
    "ScreenCaptureKit",
    true,
    "known",
    "macos",
    "13.0",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ScreenCaptureKit.framework/Headers/SCStream.h"
  ],
  [
    "screencapturekit-system-audio",
    "SCStreamConfiguration.capturesAudio",
    "ScreenCaptureKit",
    true,
    "known",
    "macos",
    "13.0",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ScreenCaptureKit.framework/Headers/SCStream.h"
  ],
  [
    "screencapturekit-system-audio",
    "CGPreflightScreenCaptureAccess",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.15",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGWindow.h"
  ],
  [
    "screencapturekit-microphone-recording-output",
    "SCStreamConfiguration.captureMicrophone",
    "ScreenCaptureKit",
    true,
    "known",
    "macos",
    "15.0",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ScreenCaptureKit.framework/Headers/SCStream.h"
  ],
  [
    "screencapturekit-microphone-recording-output",
    "SCRecordingOutput",
    "ScreenCaptureKit",
    true,
    "known",
    "macos",
    "15.0",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ScreenCaptureKit.framework/Headers/SCRecordingOutput.h"
  ],
  [
    "screencapturekit-microphone-recording-output",
    "AVCaptureDevice.authorizationStatus",
    "AVFoundation",
    true,
    "known",
    "macos",
    "10.14",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AVFoundation.framework/Headers/AVCaptureDevice.h"
  ],
  [
    "screencapturekit-microphone-recording-output",
    "CGPreflightScreenCaptureAccess",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.15",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGWindow.h"
  ],
  [
    "avassetwriter-custom-multitrack",
    "AVAssetWriter",
    "AVFoundation",
    true,
    "known",
    "macos",
    "10.7",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AVFoundation.framework/Headers/AVAssetWriter.h"
  ],
  [
    "avassetwriter-custom-multitrack",
    "AVAssetWriterInput",
    "AVFoundation",
    true,
    "known",
    "macos",
    "10.7",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AVFoundation.framework/Headers/AVAssetWriterInput.h"
  ],
  [
    "microphone-capture-adapter",
    "AVAudioEngine",
    "AVFAudio",
    true,
    "known",
    "macos",
    "10.10",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AVFAudio.framework/Headers/AVAudioEngine.h"
  ],
  [
    "microphone-capture-adapter",
    "AVAudioInputNode",
    "AVFAudio",
    true,
    "known",
    "macos",
    "10.10",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AVFAudio.framework/Headers/AVAudioIONode.h"
  ],
  [
    "microphone-capture-adapter",
    "AVCaptureDevice.authorizationStatus",
    "AVFoundation",
    true,
    "known",
    "macos",
    "10.14",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AVFoundation.framework/Headers/AVCaptureDevice.h"
  ],
  [
    "microphone-capture-adapter",
    "AVCaptureDevice.requestAccess",
    "AVFoundation",
    true,
    "known",
    "macos",
    "10.14",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AVFoundation.framework/Headers/AVCaptureDevice.h"
  ],
  [
    "audio-playback",
    "AVAudioEngine",
    "AVFAudio",
    true,
    "known",
    "macos",
    "10.10",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AVFAudio.framework/Headers/AVAudioEngine.h"
  ],
  [
    "audio-playback",
    "AVAudioPlayerNode",
    "AVFAudio",
    true,
    "known",
    "macos",
    "10.10",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AVFAudio.framework/Headers/AVAudioPlayerNode.h"
  ],
  [
    "audio-playback",
    "NSSpeechSynthesizer",
    "AppKit",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSSpeechSynthesizer.h"
  ],
  [
    "clipboard-plain-text",
    "NSPasteboard.general",
    "AppKit",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSPasteboard.h"
  ],
  [
    "clipboard-plain-text",
    "NSPasteboard.changeCount",
    "AppKit",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSPasteboard.h"
  ],
  [
    "apple-events-applescript-shortcuts",
    "NSAppleScript",
    "Foundation",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/Foundation.framework/Headers/NSAppleScript.h"
  ],
  [
    "apple-events-applescript-shortcuts",
    "NSUserAppleScriptTask",
    "Foundation",
    false,
    "known",
    "macos",
    "10.8",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/Foundation.framework/Headers/NSUserScriptTask.h"
  ],
  [
    "apple-events-applescript-shortcuts",
    "/usr/bin/shortcuts",
    "external_tool",
    false,
    "not_applicable_external",
    "external",
    null,
    "reviewed_environment",
    null,
    "reviewed macOS 12 environment"
  ],
  [
    "apple-events-applescript-shortcuts",
    "NSAppleEventDescriptor",
    "Foundation",
    false,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/Foundation.framework/Headers/NSAppleEventDescriptor.h"
  ],
  [
    "app-owned-user-notifications",
    "UNUserNotificationCenter",
    "UserNotifications",
    true,
    "known",
    "macos",
    "10.14",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/UserNotifications.framework/Headers/UNUserNotificationCenter.h"
  ],
  [
    "app-owned-user-notifications",
    "UNUserNotificationCenter.getNotificationSettings",
    "UserNotifications",
    false,
    "known",
    "macos",
    "10.14",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/UserNotifications.framework/Headers/UNUserNotificationCenter.h"
  ],
  [
    "system-wide-notification-history",
    "systemWideNotificationHistory",
    "UserNotifications",
    true,
    "unsupported_public_api",
    "macos",
    null,
    "official_documentation",
    null,
    "https://developer.apple.com/documentation/usernotifications"
  ],
  [
    "native-status-item",
    "NSStatusBar.statusItem",
    "AppKit",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSStatusBar.h"
  ],
  [
    "native-status-item",
    "NSStatusItem",
    "AppKit",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSStatusItem.h"
  ],
  [
    "native-status-item",
    "NSMenu",
    "AppKit",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSMenu.h"
  ],
  [
    "operator-annotation-selection",
    "NSPanel",
    "AppKit",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSPanel.h"
  ],
  [
    "operator-annotation-selection",
    "NSScreen",
    "AppKit",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSScreen.h"
  ],
  [
    "operator-annotation-selection",
    "AXUIElementCopyAttributeValue",
    "ApplicationServices",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "operator-annotation-selection",
    "CGWindowListCopyWindowInfo",
    "CoreGraphics",
    false,
    "known",
    "macos",
    "10.5",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGWindow.h"
  ],
  [
    "operator-annotation-selection",
    "AXIsProcessTrusted",
    "ApplicationServices",
    true,
    "known",
    "macos",
    "10.4",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "canvas-wkwebview",
    "WKWebView",
    "WebKit",
    true,
    "known",
    "macos",
    "10.10",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/WebKit.framework/Headers/WKWebView.h"
  ],
  [
    "canvas-wkwebview",
    "WKURLSchemeHandler",
    "WebKit",
    true,
    "known",
    "macos",
    "10.13",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/WebKit.framework/Headers/WKURLSchemeHandler.h"
  ],
  [
    "canvas-wkwebview",
    "NSWindow",
    "AppKit",
    false,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSWindow.h"
  ],
  [
    "canvas-host-action-bus",
    "WKScriptMessageHandler",
    "WebKit",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/WebKit.framework/Headers/WKScriptMessageHandler.h"
  ],
  [
    "canvas-host-action-bus",
    "NSWorkspace.open",
    "AppKit",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSWorkspace.h"
  ],
  [
    "canvas-host-action-bus",
    "NSApplication.terminate",
    "AppKit",
    true,
    "sdk_unannotated",
    "macos",
    null,
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSApplication.h"
  ],
  [
    "desktopworld-scene",
    "WKWebView",
    "WebKit",
    true,
    "known",
    "macos",
    "10.10",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/WebKit.framework/Headers/WKWebView.h"
  ],
  [
    "desktopworld-scene",
    "MTLCreateSystemDefaultDevice",
    "Metal",
    true,
    "known",
    "macos",
    "10.11",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/Metal.framework/Headers/MTLDevice.h"
  ],
  [
    "desktopworld-scene",
    "MTLDevice",
    "Metal",
    true,
    "known",
    "macos",
    "10.11",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/Metal.framework/Headers/MTLDevice.h"
  ],
  [
    "desktopworld-scene",
    "CGGetActiveDisplayList",
    "CoreGraphics",
    true,
    "known",
    "macos",
    "10.0",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGDirectDisplay.h"
  ],
  [
    "desktopworld-scene",
    "ColorSyncDeviceCopyDeviceInfo",
    "ColorSync",
    true,
    "known",
    "macos",
    "10.4",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ColorSync.framework/Headers/ColorSyncDevice.h"
  ],
  [
    "desktopworld-scene",
    "CGPreflightScreenCaptureAccess",
    "CoreGraphics",
    false,
    "known",
    "macos",
    "10.15",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGWindow.h"
  ],
  [
    "desktopworld-scene",
    "CGPreflightListenEventAccess",
    "CoreGraphics",
    false,
    "known",
    "macos",
    "10.15",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGEvent.h"
  ],
  [
    "desktopworld-scene",
    "AXIsProcessTrusted",
    "ApplicationServices",
    false,
    "known",
    "macos",
    "10.4",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h"
  ],
  [
    "managed-playwright-runtime",
    "playwright-cli",
    "external_tool",
    true,
    "not_applicable_external",
    "external",
    null,
    "reviewed_environment",
    null,
    "manifests/companions/playwright-cli-v1.json"
  ],
  [
    "arbitrary-spaces-control",
    "NSWorkspace.activeSpaceDidChangeNotification",
    "AppKit",
    false,
    "known",
    "macos",
    "10.6",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSWorkspace.h"
  ],
  [
    "arbitrary-spaces-control",
    "NSWindow.CollectionBehavior",
    "AppKit",
    false,
    "known",
    "macos",
    "10.5",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/AppKit.framework/Headers/NSWindow.h"
  ],
  [
    "arbitrary-spaces-control",
    "stableArbitrarySpaceIdentityAndReassignment",
    "AppKit",
    true,
    "unsupported_public_api",
    "macos",
    null,
    "official_documentation",
    null,
    "https://developer.apple.com/documentation/appkit/nsworkspace"
  ],
  [
    "protected-content-attribution",
    "SCStream",
    "ScreenCaptureKit",
    false,
    "known",
    "macos",
    "12.3",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/ScreenCaptureKit.framework/Headers/SCStream.h"
  ],
  [
    "protected-content-attribution",
    "protectedContentCauseAttribution",
    "ScreenCaptureKit",
    true,
    "unsupported_public_api",
    "macos",
    null,
    "official_documentation",
    null,
    "https://developer.apple.com/documentation/screencapturekit"
  ],
  [
    "protected-content-attribution",
    "CGPreflightScreenCaptureAccess",
    "CoreGraphics",
    false,
    "known",
    "macos",
    "10.15",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/CoreGraphics.framework/Headers/CGWindow.h"
  ],
  [
    "iohid-device-apis",
    "IOHIDManagerCreate",
    "IOKit",
    true,
    "known",
    "macos",
    "10.5",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/IOKit.framework/Headers/hid/IOHIDManager.h"
  ],
  [
    "iohid-device-apis",
    "IOHIDDeviceOpen",
    "IOKit",
    true,
    "known",
    "macos",
    "10.5",
    "sdk_header",
    "apple-macosx-26.5",
    "System/Library/Frameworks/IOKit.framework/Headers/hid/IOHIDDevice.h"
  ],
  [
    "driverkit-virtual-hid",
    "IOUserHIDDevice",
    "HIDDriverKit",
    true,
    "known",
    "driverkit",
    "19.0",
    "sdk_header",
    "apple-driverkit-25.5",
    "System/DriverKit/System/Library/Frameworks/HIDDriverKit.framework/Headers/IOUserHIDDevice.h"
  ],
  [
    "undocumented-hid-event-system-routes",
    "HIDEventSystemPrivateRoute",
    "IOKit",
    true,
    "undocumented_unverified",
    "macos",
    null,
    "source_inventory",
    null,
    "tracked production source scan: no supported owner"
  ],
  [
    "undocumented-windowserver-routes",
    "WindowServerPrivateRoute",
    "CoreGraphics",
    true,
    "undocumented_unverified",
    "macos",
    null,
    "source_inventory",
    null,
    "tracked production source scan: no supported owner"
  ]
];
const expectedAvailabilityStateTotals = {
  known: 62,
  sdk_unannotated: 26,
  not_applicable_external: 2,
  undocumented_unverified: 3,
  unsupported_public_api: 3,
};
const expectedPlatformEvidenceSources = [
  {
    id: 'apple-macosx-26.5',
    kind: 'apple_sdk',
    platform: 'macos',
    canonical_name: 'macosx26.5',
    version: '26.5',
    locator_base: 'sdkroot_relative',
    identity_locator: 'SDKSettings.json',
  },
  {
    id: 'apple-driverkit-25.5',
    kind: 'apple_sdk',
    platform: 'driverkit',
    canonical_name: 'driverkit25.5',
    version: '25.5',
    locator_base: 'sdkroot_relative',
    identity_locator: 'SDKSettings.json',
  },
];
const expectedMilestoneShape = [
  {
    "id": "M1",
    "ordinal": 1,
    "depends_on": [],
    "deliverable_ids": [
      "privileged_capability_ledger",
      "sovereign_slice_contract",
      "schema_static_proof",
      "authority_routing"
    ],
    "gate_ids": [
      "closed_inventory_32_rows",
      "current_target_separation",
      "source_reachability_bound"
    ],
    "path_count": 4,
    "proof_count": 1
  },
  {
    "id": "M2",
    "ordinal": 2,
    "depends_on": [
      "M1"
    ],
    "deliverable_ids": [
      "peer_identity",
      "operation_registry",
      "lineage_projection",
      "stream_contract",
      "tap_contract",
      "artifact_custody",
      "host_stop_barrier",
      "durable_recovery",
      "microphone_adapter",
      "internal_red_status_projection",
      "owner_root_spawn_record",
      "external_dispatch_spawn_binding",
      "external_command_manifest_v1_cutover",
      "durable_operation_store",
      "atomic_claim_set_admission",
      "per_resource_claim_lifecycle",
      "multiplex_broker_lifecycle",
      "daemon_ipc_cli_surface",
      "internal_canvas_projection"
    ],
    "gate_ids": [
      "owner_bindings_accepted",
      "prepared_before_authority",
      "owner_filter_intersection",
      "live_peer_host_control_projection",
      "prior_generation_recovery_closure",
      "singleton_resource_claim_closure",
      "voice_resource_claim_no_preemption",
      "terminal_residual_invariant",
      "microphone_control_plane",
      "owner_root_skip_proof",
      "external_command_manifest_v1_cutover",
      "external_dispatch_spawn_binding",
      "resource_lifecycle_separation",
      "host_barrier_request_receipts",
      "command_surface_publication"
    ],
    "path_count": 70,
    "proof_count": 23
  },
  {
    "id": "M3",
    "ordinal": 3,
    "depends_on": [
      "M2"
    ],
    "deliverable_ids": [
      "screen_video",
      "system_audio",
      "microphone_track",
      "multitrack_encoder",
      "fixed_geometry",
      "caller_followed_geometry",
      "recording_artifact_custody"
    ],
    "gate_ids": [
      "recording_tracks_independent",
      "geometry_reobserved_and_bound",
      "recording_control_plane",
      "fake_recording_proof",
      "separately_authorized_native_recording"
    ],
    "path_count": 11,
    "proof_count": 5
  },
  {
    "id": "M4",
    "ordinal": 4,
    "depends_on": [
      "M3"
    ],
    "deliverable_ids": [
      "authority_contract",
      "observation_engine",
      "public_observation",
      "coordinate_binding",
      "ax_subscription_lifecycle",
      "raw_ax_actions",
      "integrated_closeout"
    ],
    "gate_ids": [
      "authority_contract_frozen",
      "immutable_bounded_ax_observation",
      "coordinate_identity_bound",
      "subscription_action_integrated_closeout"
    ],
    "path_count": 8,
    "proof_count": 2
  },
  {
    "id": "M5",
    "ordinal": 5,
    "depends_on": [
      "M4"
    ],
    "deliverable_ids": [
      "video_stream",
      "system_audio_stream",
      "microphone_stream",
      "input_stream",
      "focus_stream",
      "window_stream",
      "display_stream",
      "ax_notification_stream",
      "canvas_stream",
      "native_lifecycle_stream",
      "clipboard_stream"
    ],
    "gate_ids": [
      "unified_stream_identity",
      "bounded_taps",
      "transient_default",
      "stream_cancel_kill_cleanup"
    ],
    "path_count": 8,
    "proof_count": 2
  },
  {
    "id": "M6",
    "ordinal": 6,
    "depends_on": [
      "M5"
    ],
    "deliverable_ids": [
      "canonical_cli",
      "canonical_ipc",
      "typescript_sdk",
      "python_sdk",
      "optional_swift_sdk",
      "consent_priming_retirement",
      "canvas_desktopworld_protocol"
    ],
    "gate_ids": [
      "sdk_package_roots_decided",
      "cli_ipc_sdk_parity",
      "consent_owned_by_platform",
      "one_shot_and_stream_control_parity"
    ],
    "path_count": 10,
    "proof_count": 2
  },
  {
    "id": "M7",
    "ordinal": 7,
    "depends_on": [
      "M6"
    ],
    "deliverable_ids": [
      "pinned_playwright_environment",
      "raw_argv_transport",
      "raw_stdin",
      "raw_stdout",
      "raw_stderr",
      "raw_artifact_transport",
      "complete_upstream_grammar",
      "playwright_descriptor_executable",
      "opencli_descriptor_executable",
      "ffmpeg_descriptor_executable",
      "neutral_operation_projection"
    ],
    "gate_ids": [
      "no_semantic_allowlist",
      "pin_and_environment_identity",
      "lifecycle_bounds_only",
      "managed_artifact_custody",
      "playwright_descriptor_executable",
      "opencli_descriptor_executable",
      "ffmpeg_descriptor_executable",
      "neutral_operation_projection_bound"
    ],
    "path_count": 13,
    "proof_count": 5
  },
  {
    "id": "M8",
    "ordinal": 8,
    "depends_on": [
      "M7"
    ],
    "deliverable_ids": [
      "tool_skills",
      "technique_skills",
      "workflow_skills",
      "aos_skill",
      "playwright_skill",
      "opencli_skill",
      "ffmpeg_skill"
    ],
    "gate_ids": [
      "skills_match_executable_truth",
      "layer_ownership_clear",
      "no_runtime_claims_from_skills",
      "playwright_descriptor_ready",
      "opencli_descriptor_ready",
      "ffmpeg_descriptor_ready"
    ],
    "path_count": 9,
    "proof_count": 5
  },
  {
    "id": "M9",
    "ordinal": 9,
    "depends_on": [
      "M8"
    ],
    "deliverable_ids": [
      "arbitrary_python_composition",
      "arbitrary_typescript_composition",
      "arbitrary_shell_composition",
      "active_operation_links",
      "native_flagship",
      "managed_browser_flagship",
      "later_authorized_sim_seam"
    ],
    "gate_ids": [
      "find_center_reobserve_record_native",
      "find_center_reobserve_record_dom",
      "sigil_lineage_attribution_only",
      "no_protected_sim_paths"
    ],
    "path_count": 3,
    "proof_count": 2
  },
  {
    "id": "M10",
    "ordinal": 10,
    "depends_on": [
      "M9"
    ],
    "deliverable_ids": [
      "signed_notarized_identity",
      "update_integrity",
      "crash_acceptance",
      "sigkill_acceptance",
      "power_loss_acceptance",
      "orphan_acceptance",
      "concurrency_acceptance",
      "kill_acceptance",
      "artifact_acceptance",
      "exact_pin_acceptance"
    ],
    "gate_ids": [
      "release_identity_verified",
      "failure_recovery_verified",
      "concurrency_isolated",
      "exact_pins_verified",
      "publication_boundaries_satisfied"
    ],
    "path_count": 3,
    "proof_count": 2
  }
];
const expectedCriticalMilestoneOwners = {
  "M2": {
    "peer_identity": [
      "shared/schemas/aos-operation-lineage-v1.schema.json",
      "src/daemon/operation-registry.swift",
      "src/daemon/operation-control.swift"
    ],
    "operation_registry": [
      "shared/schemas/aos-operation-v1.schema.json",
      "shared/schemas/aos-operation-event-v1.schema.json",
      "src/daemon/operation-registry.swift",
      "src/daemon/operation-control.swift"
    ],
    "lineage_projection": [
      "shared/schemas/aos-operation-lineage-v1.schema.json",
      "src/daemon/operation-registry.swift"
    ],
    "stream_contract": [
      "shared/schemas/aos-stream-v1.schema.json",
      "src/daemon/operation-registry.swift",
      "src/daemon/operation-control.swift"
    ],
    "tap_contract": [
      "shared/schemas/aos-operation-tap-v1.schema.json",
      "src/daemon/operation-registry.swift",
      "src/daemon/operation-control.swift"
    ],
    "artifact_custody": [
      "shared/schemas/aos-artifact-v1.schema.json",
      "src/daemon/operation-registry.swift",
      "src/daemon/operation-recovery.swift"
    ],
    "host_stop_barrier": [
      "shared/schemas/aos-host-stop-barrier-v1.schema.json",
      "src/daemon/operation-control.swift",
      "src/daemon/operation-recovery.swift"
    ],
    "durable_recovery": [
      "shared/schemas/aos-operation-recovery-v1.schema.json",
      "src/daemon/operation-registry.swift",
      "src/daemon/operation-recovery.swift"
    ],
    "microphone_adapter": [
      "shared/schemas/aos-operation-v1.schema.json",
      "shared/schemas/aos-stream-v1.schema.json",
      "src/daemon/microphone-operation-adapter.swift",
      "src/daemon/voice-transport.swift",
      "src/daemon/microphone-authorization.swift",
      "src/daemon/segmented-microphone-capture.swift",
      "src/daemon/audio-playback.swift",
      "manifests/commands/source/aos/12-listen.json",
      "manifests/commands/source/aos/41-operation.json",
      "manifests/commands/source/external/49-operation.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md",
      "docs/api/aos-capabilities.md"
    ],
    "internal_red_status_projection": [
      "shared/schemas/aos-operation-event-v1.schema.json",
      "src/daemon/operation-status-item-projection.swift",
      "src/display/status-item.swift",
      "src/display/status-item-host-controller.swift",
      "manifests/commands/source/aos/41-operation.json",
      "manifests/commands/source/external/49-operation.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md",
      "docs/api/aos-capabilities.md"
    ],
    "owner_root_spawn_record": [
      "shared/schemas/aos-operation-lineage-v1.schema.json",
      "src/daemon/operation-owner-root.swift",
      "src/daemon/operation-spawn-record.swift",
      "shared/swift/ipc/connection.swift"
    ],
    "external_dispatch_spawn_binding": [
      "shared/schemas/aos-operation-lineage-v1.schema.json",
      "src/daemon/operation-spawn-record.swift",
      "src/shared/external-command-dispatch.swift",
      "manifests/commands/source/external/15-listen.json",
      "scripts/aos-tell-listen.mjs",
      "scripts/lib/aos-voice-follow.mjs",
      "scripts/lib/aos-daemon-client.mjs",
      "src/daemon/voice-transport.swift"
    ],
    "external_command_manifest_v1_cutover": [
      "shared/schemas/aos-external-command-manifest-v1.schema.json",
      "manifests/commands/source/external/15-listen.json",
      "scripts/generate-command-manifests.mjs",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md",
      "docs/api/aos-capabilities.md",
      "src/shared/external-command-dispatch.swift",
      "scripts/aos-help-proxy.mjs",
      "scripts/stage-browser-companion-runtime.mjs",
      "scripts/stage-work-record-runtime.mjs",
      "docs/dev/command-surface.md",
      "docs/dev/test-proof-registry.d/command-surface.json",
      "docs/dev/test-proof-registry.json",
      "docs/dev/workflow-rules.json",
      "docs/dev/aos-sovereign-capability-authority-v1.json",
      "manifests/AGENTS.md",
      "shared/AGENTS.md",
      "tests/AGENTS.md",
      "skills/aos-command-surface-maintenance/SKILL.md",
      "scripts/lib/agent-workspace/AGENTS.md"
    ],
    "durable_operation_store": [
      "shared/schemas/aos-operation-v1.schema.json",
      "shared/schemas/aos-operation-recovery-v1.schema.json",
      "src/daemon/operation-store.swift",
      "src/daemon/operation-state.swift"
    ],
    "atomic_claim_set_admission": [
      "shared/schemas/aos-operation-v1.schema.json",
      "src/daemon/operation-resource-transaction.swift",
      "src/daemon/operation-store.swift"
    ],
    "per_resource_claim_lifecycle": [
      "shared/schemas/aos-operation-v1.schema.json",
      "src/daemon/operation-resource-claim.swift",
      "src/daemon/operation-store.swift"
    ],
    "multiplex_broker_lifecycle": [
      "shared/schemas/aos-operation-v1.schema.json",
      "src/daemon/operation-resource-broker.swift",
      "src/daemon/operation-store.swift"
    ],
    "daemon_ipc_cli_surface": [
      "shared/schemas/daemon-request.schema.json",
      "shared/schemas/daemon-response.schema.json",
      "shared/schemas/daemon-event.schema.json",
      "shared/schemas/daemon-ipc.md",
      "src/daemon/unified.swift",
      "shared/swift/ipc/connection.swift",
      "shared/swift/ipc/runtime-paths.swift",
      "src/commands/operation.swift",
      "src/main.swift",
      "manifests/commands/source/aos/41-operation.json",
      "manifests/commands/source/external/49-operation.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md",
      "docs/api/aos-capabilities.md",
      "docs/dev/test-proof-registry.d/operation-control.json",
      "docs/dev/workflow-rules.json"
    ],
    "internal_canvas_projection": [
      "shared/schemas/aos-operation-event-v1.schema.json",
      "src/daemon/operation-canvas-projection.swift",
      "packages/toolkit/runtime/operation-control.js",
      "packages/toolkit/runtime/index.js",
      "packages/toolkit/components/operation-control/model.js",
      "packages/toolkit/components/operation-control/index.js",
      "packages/toolkit/components/operation-control/index.html",
      "packages/toolkit/components/operation-control/styles.css"
    ]
  },
  "M3": {
    "screen_video": [
      "src/daemon/desktop-pixel-native.swift",
      "shared/schemas/aos-screen-recording-v1.schema.json",
      "src/daemon/screen-recording-operation-adapter.swift",
      "manifests/commands/source/aos/42-screen-recording.json",
      "manifests/commands/source/external/50-screen-recording.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "system_audio": [
      "shared/schemas/aos-screen-recording-v1.schema.json",
      "src/daemon/screen-recording-operation-adapter.swift",
      "manifests/commands/source/aos/42-screen-recording.json",
      "manifests/commands/source/external/50-screen-recording.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "microphone_track": [
      "shared/schemas/aos-screen-recording-v1.schema.json",
      "src/daemon/screen-recording-operation-adapter.swift",
      "manifests/commands/source/aos/42-screen-recording.json",
      "manifests/commands/source/external/50-screen-recording.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "multitrack_encoder": [
      "shared/schemas/aos-screen-recording-v1.schema.json",
      "src/daemon/screen-recording-encoder.swift"
    ],
    "fixed_geometry": [
      "src/daemon/desktop-pixel-native.swift",
      "shared/schemas/aos-screen-recording-v1.schema.json",
      "src/daemon/screen-recording-geometry.swift"
    ],
    "caller_followed_geometry": [
      "src/daemon/desktop-pixel-native.swift",
      "shared/schemas/aos-screen-recording-v1.schema.json",
      "src/daemon/screen-recording-geometry.swift",
      "src/daemon/screen-recording-follow-geometry.swift"
    ],
    "recording_artifact_custody": [
      "shared/schemas/aos-screen-recording-v1.schema.json",
      "src/daemon/screen-recording-operation-adapter.swift",
      "src/daemon/screen-recording-encoder.swift"
    ]
  },
  "M7": {
    "pinned_playwright_environment": [
      "shared/schemas/aos-external-tool-descriptor-v1.schema.json",
      "scripts/lib/external-tool/descriptor-loader.mjs",
      "manifests/companions/playwright-cli-v1.json"
    ],
    "raw_argv_transport": [
      "shared/schemas/aos-external-tool-descriptor-v1.schema.json",
      "scripts/lib/external-tool/raw-runner.mjs",
      "scripts/lib/external-tool/descriptor-loader.mjs",
      "manifests/commands/source/aos/46-external-tool-run.json",
      "manifests/commands/source/external/54-external-tool-run.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "raw_stdin": [
      "scripts/lib/external-tool/raw-runner.mjs",
      "manifests/commands/source/aos/46-external-tool-run.json",
      "manifests/commands/source/external/54-external-tool-run.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "raw_stdout": [
      "scripts/lib/external-tool/raw-runner.mjs",
      "manifests/commands/source/aos/46-external-tool-run.json",
      "manifests/commands/source/external/54-external-tool-run.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "raw_stderr": [
      "scripts/lib/external-tool/raw-runner.mjs",
      "manifests/commands/source/aos/46-external-tool-run.json",
      "manifests/commands/source/external/54-external-tool-run.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "raw_artifact_transport": [
      "scripts/lib/external-tool/raw-runner.mjs",
      "src/daemon/external-tool-artifact-adapter.swift",
      "manifests/commands/source/aos/46-external-tool-run.json",
      "manifests/commands/source/external/54-external-tool-run.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "complete_upstream_grammar": [
      "shared/schemas/aos-external-tool-descriptor-v1.schema.json",
      "scripts/lib/external-tool/raw-runner.mjs",
      "scripts/lib/external-tool/descriptor-loader.mjs",
      "manifests/companions/playwright-cli-v1.json"
    ],
    "playwright_descriptor_executable": [
      "shared/schemas/aos-external-tool-descriptor-v1.schema.json",
      "scripts/lib/external-tool/raw-runner.mjs",
      "scripts/lib/external-tool/descriptor-loader.mjs",
      "manifests/companions/playwright-cli-v1.json"
    ],
    "opencli_descriptor_executable": [
      "shared/schemas/aos-external-tool-descriptor-v1.schema.json",
      "scripts/lib/external-tool/raw-runner.mjs",
      "scripts/lib/external-tool/descriptor-loader.mjs",
      "manifests/companions/opencli-v1.json"
    ],
    "ffmpeg_descriptor_executable": [
      "shared/schemas/aos-external-tool-descriptor-v1.schema.json",
      "scripts/lib/external-tool/raw-runner.mjs",
      "scripts/lib/external-tool/descriptor-loader.mjs",
      "manifests/companions/ffmpeg-v1.json"
    ],
    "neutral_operation_projection": [
      "src/daemon/external-tool-operation-adapter.swift",
      "src/daemon/external-tool-artifact-adapter.swift"
    ]
  },
  "M8": {
    "tool_skills": [
      "skills/registry.json",
      "skills/aos-browser/SKILL.md",
      "skills/aos-opencli.proposed/SKILL.md",
      "skills/aos-ffmpeg.proposed/SKILL.md",
      "manifests/companions/playwright-cli-v1.json",
      "manifests/companions/opencli-v1.json",
      "manifests/companions/ffmpeg-v1.json"
    ],
    "technique_skills": [
      "skills/registry.json",
      "skills/aos-desktop/SKILL.md",
      "skills/aos-browser/SKILL.md"
    ],
    "workflow_skills": [
      "skills/registry.json",
      "skills/aos-sovereign-workflows.proposed/SKILL.md"
    ],
    "aos_skill": [
      "skills/registry.json",
      "skills/aos-desktop/SKILL.md"
    ],
    "playwright_skill": [
      "skills/registry.json",
      "skills/aos-browser/SKILL.md",
      "manifests/companions/playwright-cli-v1.json"
    ],
    "opencli_skill": [
      "skills/registry.json",
      "skills/aos-opencli.proposed/SKILL.md",
      "manifests/companions/opencli-v1.json"
    ],
    "ffmpeg_skill": [
      "skills/registry.json",
      "skills/aos-ffmpeg.proposed/SKILL.md",
      "manifests/companions/ffmpeg-v1.json"
    ]
  }
};
const expectedSourceDisposition = {
  "ax-element-observation": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/perceive/ax.swift",
        "classification": "production_source",
        "markers": [
          "AXUIElementCopyAttributeValue"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "ax-element-actions": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/act/actions.swift",
        "classification": "production_source",
        "markers": [
          "AXUIElementPerformAction",
          "AXUIElementSetAttributeValue"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "axobserver-per-pid-notifications": {
    "disposition": "named_negative",
    "source_probes": [],
    "named_absent_symbols": [
      "AXObserverCreate",
      "AXObserverAddNotification"
    ]
  },
  "app-lifecycle-control": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/act/app-lifecycle.swift",
        "classification": "production_source",
        "markers": [
          "NSRunningApplication"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "window-menu-lifecycle-control": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/act/window-lifecycle.swift",
        "classification": "production_source",
        "markers": [
          "cliWindowLifecycle"
        ]
      },
      {
        "path": "src/act/native-menu.swift",
        "classification": "production_source",
        "markers": [
          "cliMenu"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "display-topology-observation": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/perceive/display-topology.swift",
        "classification": "production_source",
        "markers": [
          "buildAOSDisplayTopologySnapshot"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "focus-window-display-events": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/daemon/unified.swift",
        "classification": "production_source",
        "markers": [
          "broadcastEvent",
          "focus_changed"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "coregraphics-input-posting": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/act/event-posting.swift",
        "classification": "production_source",
        "markers": [
          "event.post(tap: .cghidEventTap)"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "global-input-event-observation": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/perceive/daemon.swift",
        "classification": "production_source",
        "markers": [
          "CGEvent.tapCreate"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "desktop-pixel-still-capture": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/daemon/desktop-pixel-native.swift",
        "classification": "production_source",
        "markers": [
          "SCScreenshotManager.captureImage"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "screencapturekit-screen-video": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/daemon/desktop-pixel-native.swift",
        "classification": "production_source",
        "markers": [
          "SCStream",
          ".screen",
          "capturesAudio = false",
          "latestSample"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "screencapturekit-system-audio": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/daemon/screen-recording-operation-adapter.swift",
        "classification": "production_source",
        "markers": [
          "configuration.capturesAudio = request.tracks.systemAudio",
          "type: .audio",
          "sampleRate = 48_000"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "screencapturekit-microphone-recording-output": {
    "disposition": "named_negative",
    "source_probes": [],
    "named_absent_symbols": [
      "captureMicrophone",
      "SCRecordingOutput",
      "SCStreamOutputType.microphone"
    ]
  },
  "avassetwriter-custom-multitrack": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/daemon/screen-recording-encoder.swift",
        "classification": "production_source",
        "markers": [
          "AVAssetWriter(outputURL:",
          "mediaType: .video",
          "AVVideoCodecType.h264",
          "mediaType: .audio",
          "kAudioFormatMPEG4AAC",
          "writer.startSession(atSourceTime:"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "microphone-capture-adapter": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/daemon/microphone-native-session.swift",
        "classification": "production_source",
        "markers": [
          "AVAudioEngine()",
          "input.installTap",
          "inputNode.removeTap"
        ]
      },
      {
        "path": "src/daemon/microphone-authorization.swift",
        "classification": "production_source",
        "markers": [
          "AVCaptureDevice.authorizationStatus",
          "AVCaptureDevice.requestAccess"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "audio-playback": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/daemon/audio-playback.swift",
        "classification": "production_source",
        "markers": [
          "AVAudioPlayerNode()"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "clipboard-plain-text": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/daemon/unified.swift",
        "classification": "production_source",
        "markers": [
          "NSPasteboard.general"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "apple-events-applescript-shortcuts": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/act/actions.swift",
        "classification": "production_source",
        "markers": [
          "NSAppleScript(source:"
        ]
      },
      {
        "path": "scripts/lib/aos-shortcut-run.mjs",
        "classification": "production_source",
        "markers": [
          "/usr/bin/shortcuts"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "app-owned-user-notifications": {
    "disposition": "named_negative",
    "source_probes": [],
    "named_absent_symbols": [
      "UNUserNotificationCenter"
    ]
  },
  "system-wide-notification-history": {
    "disposition": "platform_limit",
    "source_probes": [],
    "named_absent_symbols": [
      "systemWideNotificationHistory"
    ]
  },
  "native-status-item": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/display/status-item.swift",
        "classification": "production_source",
        "markers": [
          "StatusItemManager"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "operator-annotation-selection": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/daemon/annotation-selection.swift",
        "classification": "production_source",
        "markers": [
          "AOSAnnotationSelectionTransport"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "canvas-wkwebview": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/display/canvas.swift",
        "classification": "production_source",
        "markers": [
          "CanvasWebView: WKWebView"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "canvas-host-action-bus": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/daemon/unified.swift",
        "classification": "production_source",
        "markers": [
          "handleAosAction"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "desktopworld-scene": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/daemon/desktop-world-scene-controller.swift",
        "classification": "production_source",
        "markers": [
          "AOSDesktopWorldSceneController"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "managed-playwright-runtime": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "scripts/lib/browser-companion/session-runner.mjs",
        "classification": "production_source",
        "markers": [
          "PLAYWRIGHT_BROWSERS_PATH"
        ]
      },
      {
        "path": "manifests/companions/playwright-cli-v1.json",
        "classification": "managed_descriptor",
        "markers": [
          "playwright"
        ]
      }
    ],
    "named_absent_symbols": []
  },
  "arbitrary-spaces-control": {
    "disposition": "platform_limit",
    "source_probes": [],
    "named_absent_symbols": [
      "CGSSetWorkspace",
      "SLSSetWindowSpace",
      "CGSCopySpaces",
      "SLSCopyManagedDisplaySpaces"
    ]
  },
  "protected-content-attribution": {
    "disposition": "platform_limit",
    "source_probes": [],
    "named_absent_symbols": [
      "protectedContentCauseAttribution",
      "protected_content_cause"
    ]
  },
  "iohid-device-apis": {
    "disposition": "named_negative",
    "source_probes": [],
    "named_absent_symbols": [
      "IOHIDManagerCreate",
      "IOHIDDeviceOpen"
    ]
  },
  "driverkit-virtual-hid": {
    "disposition": "named_negative",
    "source_probes": [],
    "named_absent_symbols": [
      "IOUserHIDDevice"
    ]
  },
  "undocumented-hid-event-system-routes": {
    "disposition": "private_unverified",
    "source_probes": [],
    "named_absent_symbols": [],
    "private_family_pattern_ids": [
      "private_hid_event_system_client_calls",
      "private_hid_service_client_calls"
    ]
  },
  "undocumented-windowserver-routes": {
    "disposition": "private_unverified",
    "source_probes": [],
    "named_absent_symbols": [],
    "private_family_pattern_ids": [
      "private_windowserver_cgs_calls",
      "private_windowserver_sls_calls"
    ]
  }
};
const expectedStatusIndicatorRegistry = [
  {
    "capability_id": "microphone-capture-adapter",
    "status_indicator_class": "recording",
    "provenance": "adapter_registry",
    "binding": "current_capability_row"
  },
  {
    "capability_id": "screencapturekit-screen-video",
    "status_indicator_class": "recording",
    "provenance": "adapter_registry",
    "binding": "current_capability_row"
  },
  {
    "capability_id": "screencapturekit-system-audio",
    "status_indicator_class": "recording",
    "provenance": "adapter_registry",
    "binding": "current_capability_row"
  },
  {
    "capability_id": "screencapturekit-microphone-recording-output",
    "status_indicator_class": "recording",
    "provenance": "adapter_registry",
    "binding": "current_capability_row"
  },
  {
    "capability_id": "avassetwriter-custom-multitrack",
    "status_indicator_class": "neutral",
    "provenance": "adapter_registry",
    "binding": "current_capability_row"
  },
  {
    "capability_id": "managed-playwright-runtime",
    "status_indicator_class": "neutral",
    "provenance": "adapter_registry",
    "binding": "current_capability_row"
  },
  {
    "capability_id": "m7-playwright-external-tool-adapter",
    "status_indicator_class": "neutral",
    "provenance": "adapter_registry",
    "binding": "proposed_m7_adapter"
  },
  {
    "capability_id": "m7-opencli-external-tool-adapter",
    "status_indicator_class": "neutral",
    "provenance": "adapter_registry",
    "binding": "proposed_m7_adapter"
  },
  {
    "capability_id": "m7-ffmpeg-external-tool-adapter",
    "status_indicator_class": "neutral",
    "provenance": "adapter_registry",
    "binding": "proposed_m7_adapter"
  }
];
const expectedPackageSurfaceSnapshot = [
  {
    "capability_id": "display-topology-observation",
    "surface": "typescript_sdk",
    "state": "partial",
    "reachability": "package_export",
    "owners": [
      "packages/toolkit/scene/index.js",
      "packages/toolkit/scene/index.d.ts"
    ],
    "internal_support_paths": [
      "packages/toolkit/runtime/desktop-world-surface-three.js"
    ],
    "forms": [
      "@agent-os/toolkit/scene display topology types and camera transform"
    ],
    "export_bindings": [
      {
        "binding_scope": "selected_symbols",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene",
        "runtime_entry": "packages/toolkit/scene/index.js",
        "types_entry": "packages/toolkit/scene/index.d.ts",
        "symbols": [
          "DesktopWorldSurfaceThree",
          "DesktopWorldSurface3D",
          "deriveOrthoCamera"
        ],
        "type_only_symbols": [
          "DesktopWorldSegment"
        ]
      }
    ]
  },
  {
    "capability_id": "display-topology-observation",
    "surface": "toolkit",
    "state": "partial",
    "reachability": "package_export",
    "owners": [
      "packages/toolkit/scene/index.js",
      "packages/toolkit/scene/index.d.ts"
    ],
    "internal_support_paths": [
      "packages/toolkit/runtime/desktop-world-surface-three.js"
    ],
    "forms": [
      "@agent-os/toolkit/scene"
    ],
    "export_bindings": [
      {
        "binding_scope": "selected_symbols",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene",
        "runtime_entry": "packages/toolkit/scene/index.js",
        "types_entry": "packages/toolkit/scene/index.d.ts",
        "symbols": [
          "DesktopWorldSurfaceThree",
          "DesktopWorldSurface3D",
          "deriveOrthoCamera"
        ],
        "type_only_symbols": [
          "DesktopWorldSegment"
        ]
      }
    ]
  },
  {
    "capability_id": "focus-window-display-events",
    "surface": "toolkit",
    "state": "partial",
    "reachability": "internal_only",
    "owners": [
      "packages/toolkit/runtime/bridge.js",
      "packages/toolkit/runtime/input-events.js"
    ],
    "internal_support_paths": [
      "packages/toolkit/runtime/bridge.js",
      "packages/toolkit/runtime/input-events.js"
    ],
    "forms": [
      "source-only event bridge"
    ],
    "export_bindings": []
  },
  {
    "capability_id": "global-input-event-observation",
    "surface": "toolkit",
    "state": "partial",
    "reachability": "internal_only",
    "owners": [
      "packages/toolkit/runtime/input-events.js",
      "packages/toolkit/runtime/gesture-stream.js"
    ],
    "internal_support_paths": [
      "packages/toolkit/runtime/input-events.js",
      "packages/toolkit/runtime/gesture-stream.js"
    ],
    "forms": [
      "source-only input event helpers"
    ],
    "export_bindings": []
  },
  {
    "capability_id": "desktop-pixel-still-capture",
    "surface": "toolkit",
    "state": "partial",
    "reachability": "internal_only",
    "owners": [
      "packages/toolkit/components/desktop-world-stage/desktop-frame-texture-source.js"
    ],
    "internal_support_paths": [
      "packages/toolkit/components/desktop-world-stage/desktop-frame-texture-source.js"
    ],
    "forms": [
      "source-only desktop frame texture helper"
    ],
    "export_bindings": []
  },
  {
    "capability_id": "clipboard-plain-text",
    "surface": "toolkit",
    "state": "partial",
    "reachability": "internal_only",
    "owners": [
      "packages/toolkit/runtime/canvas.js"
    ],
    "internal_support_paths": [
      "packages/toolkit/runtime/canvas.js"
    ],
    "forms": [
      "source-only canvas clipboard helper"
    ],
    "export_bindings": []
  },
  {
    "capability_id": "native-status-item",
    "surface": "typescript_sdk",
    "state": "complete",
    "reachability": "package_export",
    "owners": [
      "packages/toolkit/status-item/index.js",
      "packages/toolkit/status-item/index.d.ts"
    ],
    "internal_support_paths": [],
    "forms": [
      "@agent-os/toolkit/status-item"
    ],
    "export_bindings": [
      {
        "binding_scope": "complete_entrypoint",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./status-item",
        "runtime_entry": "packages/toolkit/status-item/index.js",
        "types_entry": "packages/toolkit/status-item/index.d.ts",
        "symbols": [],
        "type_only_symbols": []
      }
    ]
  },
  {
    "capability_id": "native-status-item",
    "surface": "toolkit",
    "state": "complete",
    "reachability": "package_export",
    "owners": [
      "packages/toolkit/status-item/index.js",
      "packages/toolkit/status-item/index.d.ts"
    ],
    "internal_support_paths": [],
    "forms": [
      "@agent-os/toolkit/status-item"
    ],
    "export_bindings": [
      {
        "binding_scope": "complete_entrypoint",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./status-item",
        "runtime_entry": "packages/toolkit/status-item/index.js",
        "types_entry": "packages/toolkit/status-item/index.d.ts",
        "symbols": [],
        "type_only_symbols": []
      }
    ]
  },
  {
    "capability_id": "operator-annotation-selection",
    "surface": "toolkit",
    "state": "partial",
    "reachability": "internal_only",
    "owners": [
      "packages/toolkit/runtime/operator-annotation-surface.js",
      "packages/toolkit/runtime/operator-annotation-menu-contract.js"
    ],
    "internal_support_paths": [
      "packages/toolkit/runtime/operator-annotation-surface.js",
      "packages/toolkit/runtime/operator-annotation-menu-contract.js"
    ],
    "forms": [
      "source-only operator annotation helpers"
    ],
    "export_bindings": []
  },
  {
    "capability_id": "canvas-wkwebview",
    "surface": "typescript_sdk",
    "state": "partial",
    "reachability": "package_export",
    "owners": [
      "packages/toolkit/scene/index.js",
      "packages/toolkit/scene/index.d.ts"
    ],
    "internal_support_paths": [
      "packages/toolkit/runtime/canvas.js",
      "packages/toolkit/runtime/canvas-host-runtime.js",
      "packages/toolkit/runtime/canvas-lifecycle.js"
    ],
    "forms": [
      "@agent-os/toolkit/scene narrow canvas lifecycle"
    ],
    "export_bindings": [
      {
        "binding_scope": "selected_symbols",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene",
        "runtime_entry": "packages/toolkit/scene/index.js",
        "types_entry": "packages/toolkit/scene/index.d.ts",
        "symbols": [
          "canvasGeometryCanvasID",
          "canvasLifecycleCanvasID",
          "mergeCanvasGeometryCanvas",
          "mergeCanvasLifecycleCanvas",
          "normalizeCanvasGeometry"
        ],
        "type_only_symbols": []
      }
    ]
  },
  {
    "capability_id": "canvas-wkwebview",
    "surface": "toolkit",
    "state": "partial",
    "reachability": "package_export",
    "owners": [
      "packages/toolkit/scene/index.js",
      "packages/toolkit/scene/index.d.ts"
    ],
    "internal_support_paths": [
      "packages/toolkit/runtime/canvas.js",
      "packages/toolkit/runtime/canvas-host-runtime.js",
      "packages/toolkit/runtime/canvas-lifecycle.js"
    ],
    "forms": [
      "@agent-os/toolkit/scene narrow canvas lifecycle"
    ],
    "export_bindings": [
      {
        "binding_scope": "selected_symbols",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene",
        "runtime_entry": "packages/toolkit/scene/index.js",
        "types_entry": "packages/toolkit/scene/index.d.ts",
        "symbols": [
          "canvasGeometryCanvasID",
          "canvasLifecycleCanvasID",
          "mergeCanvasGeometryCanvas",
          "mergeCanvasLifecycleCanvas",
          "normalizeCanvasGeometry"
        ],
        "type_only_symbols": []
      }
    ]
  },
  {
    "capability_id": "canvas-host-action-bus",
    "surface": "toolkit",
    "state": "partial",
    "reachability": "internal_only",
    "owners": [
      "packages/toolkit/runtime/action.js",
      "packages/toolkit/runtime/canvas.js",
      "packages/toolkit/runtime/canvas-host-runtime.js"
    ],
    "internal_support_paths": [
      "packages/toolkit/runtime/action.js",
      "packages/toolkit/runtime/canvas.js",
      "packages/toolkit/runtime/canvas-host-runtime.js"
    ],
    "forms": [
      "source-only canvas action helpers"
    ],
    "export_bindings": []
  },
  {
    "capability_id": "desktopworld-scene",
    "surface": "typescript_sdk",
    "state": "complete",
    "reachability": "package_export",
    "owners": [
      "packages/toolkit/scene/index.js",
      "packages/toolkit/scene/index.d.ts",
      "packages/toolkit/scene/authoring.js",
      "packages/toolkit/scene/authoring.d.ts",
      "packages/toolkit/scene/runtime.js",
      "packages/toolkit/scene/runtime.d.ts",
      "packages/toolkit/scene/extensions.js",
      "packages/toolkit/scene/extensions.d.ts",
      "packages/toolkit/scene/devtools.js",
      "packages/toolkit/scene/devtools.d.ts"
    ],
    "internal_support_paths": [
      "packages/toolkit/runtime/desktop-world-surface-three.js"
    ],
    "forms": [
      "@agent-os/toolkit/scene",
      "@agent-os/toolkit/scene/authoring",
      "@agent-os/toolkit/scene/runtime",
      "@agent-os/toolkit/scene/extensions",
      "@agent-os/toolkit/scene/devtools"
    ],
    "export_bindings": [
      {
        "binding_scope": "complete_entrypoint",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene",
        "runtime_entry": "packages/toolkit/scene/index.js",
        "types_entry": "packages/toolkit/scene/index.d.ts",
        "symbols": [],
        "type_only_symbols": []
      },
      {
        "binding_scope": "complete_entrypoint",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene/authoring",
        "runtime_entry": "packages/toolkit/scene/authoring.js",
        "types_entry": "packages/toolkit/scene/authoring.d.ts",
        "symbols": [],
        "type_only_symbols": []
      },
      {
        "binding_scope": "complete_entrypoint",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene/runtime",
        "runtime_entry": "packages/toolkit/scene/runtime.js",
        "types_entry": "packages/toolkit/scene/runtime.d.ts",
        "symbols": [],
        "type_only_symbols": []
      },
      {
        "binding_scope": "complete_entrypoint",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene/extensions",
        "runtime_entry": "packages/toolkit/scene/extensions.js",
        "types_entry": "packages/toolkit/scene/extensions.d.ts",
        "symbols": [],
        "type_only_symbols": []
      },
      {
        "binding_scope": "complete_entrypoint",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene/devtools",
        "runtime_entry": "packages/toolkit/scene/devtools.js",
        "types_entry": "packages/toolkit/scene/devtools.d.ts",
        "symbols": [],
        "type_only_symbols": []
      }
    ]
  },
  {
    "capability_id": "desktopworld-scene",
    "surface": "toolkit",
    "state": "complete",
    "reachability": "package_export",
    "owners": [
      "packages/toolkit/scene/index.js",
      "packages/toolkit/scene/index.d.ts",
      "packages/toolkit/scene/authoring.js",
      "packages/toolkit/scene/authoring.d.ts",
      "packages/toolkit/scene/runtime.js",
      "packages/toolkit/scene/runtime.d.ts",
      "packages/toolkit/scene/extensions.js",
      "packages/toolkit/scene/extensions.d.ts",
      "packages/toolkit/scene/devtools.js",
      "packages/toolkit/scene/devtools.d.ts"
    ],
    "internal_support_paths": [
      "packages/toolkit/runtime/desktop-world-surface-three.js"
    ],
    "forms": [
      "@agent-os/toolkit/scene",
      "@agent-os/toolkit/scene/authoring",
      "@agent-os/toolkit/scene/runtime",
      "@agent-os/toolkit/scene/extensions",
      "@agent-os/toolkit/scene/devtools"
    ],
    "export_bindings": [
      {
        "binding_scope": "complete_entrypoint",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene",
        "runtime_entry": "packages/toolkit/scene/index.js",
        "types_entry": "packages/toolkit/scene/index.d.ts",
        "symbols": [],
        "type_only_symbols": []
      },
      {
        "binding_scope": "complete_entrypoint",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene/authoring",
        "runtime_entry": "packages/toolkit/scene/authoring.js",
        "types_entry": "packages/toolkit/scene/authoring.d.ts",
        "symbols": [],
        "type_only_symbols": []
      },
      {
        "binding_scope": "complete_entrypoint",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene/runtime",
        "runtime_entry": "packages/toolkit/scene/runtime.js",
        "types_entry": "packages/toolkit/scene/runtime.d.ts",
        "symbols": [],
        "type_only_symbols": []
      },
      {
        "binding_scope": "complete_entrypoint",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene/extensions",
        "runtime_entry": "packages/toolkit/scene/extensions.js",
        "types_entry": "packages/toolkit/scene/extensions.d.ts",
        "symbols": [],
        "type_only_symbols": []
      },
      {
        "binding_scope": "complete_entrypoint",
        "package_manifest": "packages/toolkit/package.json",
        "subpath": "./scene/devtools",
        "runtime_entry": "packages/toolkit/scene/devtools.js",
        "types_entry": "packages/toolkit/scene/devtools.d.ts",
        "symbols": [],
        "type_only_symbols": []
      }
    ]
  },
  {
    "capability_id": "managed-playwright-runtime",
    "surface": "toolkit",
    "state": "partial",
    "reachability": "internal_only",
    "owners": [
      "packages/toolkit/workbench/browser-evidence-capture.js"
    ],
    "internal_support_paths": [
      "packages/toolkit/workbench/browser-evidence-capture.js"
    ],
    "forms": [
      "source-only managed browser evidence helper"
    ],
    "export_bindings": []
  }
];
const expectedMachineCounts = {
  "operation": {
    "machine_kind": "finite_lifecycle",
    "state_count": 7,
    "transition_count": 37,
    "terminal_states": [
      "terminal"
    ],
    "quiescent_states": []
  },
  "stream": {
    "machine_kind": "finite_lifecycle",
    "state_count": 7,
    "transition_count": 37,
    "terminal_states": [
      "terminal"
    ],
    "quiescent_states": []
  },
  "tap": {
    "machine_kind": "finite_lifecycle",
    "state_count": 7,
    "transition_count": 22,
    "terminal_states": [
      "terminal"
    ],
    "quiescent_states": []
  },
  "artifact": {
    "machine_kind": "finite_lifecycle",
    "state_count": 8,
    "transition_count": 27,
    "terminal_states": [
      "terminal"
    ],
    "quiescent_states": []
  },
  "claim_set_transaction": {
    "machine_kind": "finite_lifecycle",
    "state_count": 7,
    "transition_count": 19,
    "terminal_states": [
      "terminal"
    ],
    "quiescent_states": []
  },
  "resource_claim": {
    "machine_kind": "finite_lifecycle",
    "state_count": 6,
    "transition_count": 17,
    "terminal_states": [
      "terminal"
    ],
    "quiescent_states": []
  },
  "multiplex_broker": {
    "machine_kind": "finite_lifecycle",
    "state_count": 7,
    "transition_count": 24,
    "terminal_states": [
      "terminal"
    ],
    "quiescent_states": []
  },
  "host_barrier": {
    "machine_kind": "cyclic_control",
    "state_count": 6,
    "transition_count": 27,
    "terminal_states": [],
    "quiescent_states": [
      "open",
      "closed"
    ]
  },
  "recovery": {
    "machine_kind": "finite_lifecycle",
    "state_count": 6,
    "transition_count": 16,
    "terminal_states": [
      "terminal"
    ],
    "quiescent_states": []
  }
};
const expectedTerminalTaxonomy = {
  outcomes: ['succeeded', 'cancelled', 'killed', 'rejected', 'failed', 'crashed', 'timed_out', 'orphaned'],
  triggers: [
    'adapter_complete', 'caller_cancel', 'kill_one', 'owner_kill', 'host_stop_all',
    'start_rejected', 'start_failure', 'deadline', 'signal', 'peer_lost',
    'transport_lost', 'daemon_crash', 'boot_recovery', 'platform_failure',
    'permission_failure', 'adapter_failure', 'external_tool_failure', 'artifact_failure',
  ],
  recovery_results: ['recovered', 'retry_scheduled', 'blocked_unresolved'],
  blame_domains: [
    'caller', 'adapter', 'aos_control_plane', 'platform', 'permission',
    'external_tool', 'host_shutdown', 'unknown',
  ],
};
const commandProducingMilestones = new Set(['M2', 'M3', 'M4', 'M5', 'M6', 'M7']);
const sourceExtensions = new Set([
  '.swift', '.m', '.mm', '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp',
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx', '.py', '.sh',
  '.bash', '.zsh', '.html', '.metal',
]);
const binaryExtensions = new Set(['.bin', '.gltf', '.svg']);
const excludedSourceSegments = new Set([
  'node_modules', 'vendor', 'dist', 'build', '.build', 'generated', 'coverage',
  'fixtures', '__snapshots__', 'snapshots', '.cache', 'caches',
]);
const generatedSourceFilenamePattern = /\.(?:generated|gen)(?:\.d)?\.(?:swift|m|mm|c|cc|cpp|cxx|h|hh|hpp|js|mjs|cjs|ts|mts|cts|tsx|jsx|py|sh|bash|zsh|html|metal)$/u;
const privilegedMetadataPaths = new Set(['packaging/Info.plist', 'packaging/aos.entitlements']);
const managedDescriptorPattern = /^manifests\/companions\/[^/]+\.json$/u;
const privateFamilyPatterns = new Map([
  ['private_hid_event_system_client_calls', /\bIOHIDEventSystemClient[A-Za-z0-9_]*\s*\(/u],
  ['private_hid_service_client_calls', /\bIOHIDServiceClient[A-Za-z0-9_]*\s*\(/u],
  ['private_windowserver_cgs_calls', /\bCGS[A-Z][A-Za-z0-9_]*\s*\(/u],
  ['private_windowserver_sls_calls', /\bSLS[A-Z][A-Za-z0-9_]*\s*\(/u],
]);

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), 'utf8');
}
async function json(relativePath) {
  return JSON.parse(await read(relativePath));
}
function clone(value) {
  return structuredClone(value);
}
function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
function gitPaths(args = []) {
  return new Set(runGit(['ls-files', '-z', ...args]).split('\0').filter(Boolean));
}
function gitInventory() {
  const records = runGit(['ls-files', '-s', '-z']).split('\0').filter(Boolean);
  return records.map((record) => {
    const match = /^(100644|100755|120000) [0-9a-f]+ [0-9]+\t(.+)$/u.exec(record);
    assert.ok(match, record);
    return { mode: match[1], path: match[2] };
  });
}
function pathCovered(paths, relativePath) {
  const prefix = relativePath.endsWith('/') ? relativePath : relativePath + '/';
  return paths.has(relativePath) || [...paths].some((candidate) => candidate.startsWith(prefix));
}
function schemaValidation(instance) {
  const validatorCode = [
    'import json, sys',
    'from pathlib import Path',
    'from jsonschema import Draft202012Validator',
    'schema = json.loads(Path(sys.argv[1]).read_text())',
    'instance = json.loads(sys.stdin.read())',
    'Draft202012Validator.check_schema(schema)',
    'errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.absolute_path))',
    'for error in errors[:40]: print("/".join(map(str, error.absolute_path)), error.message)',
    'sys.exit(1 if errors else 0)',
  ].join('\n');
  return spawnSync('python3', ['-c', validatorCode, schemaPath], {
    encoding: 'utf8',
    input: JSON.stringify(instance),
    maxBuffer: 64 * 1024 * 1024,
  });
}
function byId(ledger) {
  return new Map(ledger.capabilities.map((capability) => [capability.id, capability]));
}
function packageSurfaceSnapshot(ledger) {
  return ledger.capabilities.flatMap((row) => ['typescript_sdk', 'toolkit'].flatMap((surfaceName) => {
    const surface = row.current.exposure[surfaceName];
    if (surface.state === 'absent') return [];
    return [{
      capability_id: row.id,
      surface: surfaceName,
      state: surface.state,
      reachability: surface.reachability,
      owners: surface.owners,
      internal_support_paths: surface.internal_support_paths,
      forms: surface.forms,
      export_bindings: surface.export_bindings.map((binding) => ({
        binding_scope: binding.binding_scope,
        package_manifest: binding.package_manifest,
        subpath: binding.subpath,
        runtime_entry: binding.runtime_entry,
        types_entry: binding.types_entry,
        symbols: binding.symbols,
        type_only_symbols: binding.type_only_symbols,
      })),
    }];
  }));
}
function semanticError(code, detail) {
  return { code, detail };
}
function codes(errors) {
  return errors.map(({ code }) => code);
}
function expectCode(errors, code) {
  assert.ok(codes(errors).includes(code), JSON.stringify(errors, null, 2));
}
function expectNoErrors(errors) {
  assert.deepEqual(errors, []);
}
function reachable(transitions, start, target) {
  const pending = [start];
  const seen = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const transition of transitions) if (transition.from === current) pending.push(transition.to);
  }
  return false;
}
function transitionKey(ref) {
  return [ref.machine, ref.from, ref.event, ref.to].join('\0');
}
function transitionEventKey(ref) {
  return [ref.machine, ref.from, ref.event].join('\0');
}
function machinesFromLedger(ledger) {
  const machines = Object.values(ledger.target_design)
    .filter((value) => value && typeof value === 'object' && value.machine_kind);
  return [...machines, ledger.flagship_workflow];
}
function transitionCatalog(ledger) {
  const exact = new Map();
  const byEvent = new Map();
  const terminal = new Map();
  for (const machine of machinesFromLedger(ledger)) {
    terminal.set(machine.id, new Set(machine.terminal_states));
    for (const transition of machine.transitions) {
      const ref = { machine: machine.id, from: transition.from, event: transition.event, to: transition.to };
      exact.set(transitionKey(ref), transition);
      const eventKey = transitionEventKey(ref);
      if (!byEvent.has(eventKey)) byEvent.set(eventKey, []);
      byEvent.get(eventKey).push(ref);
    }
  }
  return { exact, byEvent, terminal };
}
function resolveTransition(catalog, ref, prefix, errors) {
  if (catalog.exact.has(transitionKey(ref))) return true;
  if (catalog.byEvent.has(transitionEventKey(ref))) {
    errors.push(semanticError(prefix + '_TO_MISMATCH', transitionKey(ref)));
  } else {
    errors.push(semanticError(prefix + '_UNKNOWN', transitionKey(ref)));
  }
  return false;
}

export function validateGraph(machine) {
  const errors = [];
  const states = new Set(machine.states);
  if (!states.has(machine.initial_state)) errors.push(semanticError('INITIAL_STATE_UNKNOWN', machine.id));
  for (const state of [...machine.terminal_states, ...machine.quiescent_states]) {
    if (!states.has(state)) errors.push(semanticError('DECLARED_STATE_UNKNOWN', machine.id + ':' + state));
  }
  const eventKeys = new Set();
  for (const transition of machine.transitions) {
    if (!states.has(transition.from) || !states.has(transition.to)) {
      errors.push(semanticError('TRANSITION_ENDPOINT_UNKNOWN', machine.id + ':' + transition.event));
    }
    const key = transition.from + '\0' + transition.event;
    if (eventKeys.has(key)) errors.push(semanticError('TRANSITION_EVENT_DUPLICATE', machine.id + ':' + key));
    eventKeys.add(key);
    if (transition.outcome_on_terminal !== undefined && transition.outcome_on_terminal !== null
      && !expectedTerminalTaxonomy.outcomes.includes(transition.outcome_on_terminal)) {
      errors.push(semanticError('TERMINAL_OUTCOME_UNKNOWN', machine.id + ':' + transition.outcome_on_terminal));
    }
  }
  if (machine.machine_kind === 'finite_lifecycle' || machine.machine_kind === 'finite_workflow') {
    for (const terminal of machine.terminal_states) {
      if (machine.transitions.some(({ from }) => from === terminal)) {
        errors.push(semanticError('TERMINAL_HAS_OUTGOING', machine.id + ':' + terminal));
      }
    }
    if (machine.quiescent_states.length !== 0) errors.push(semanticError('FINITE_HAS_QUIESCENT', machine.id));
    for (const state of machine.states) {
      if (machine.terminal_states.includes(state)) continue;
      if (!machine.terminal_states.some((terminal) => reachable(machine.transitions, state, terminal))) {
        errors.push(semanticError('NO_TERMINAL_ROUTE', machine.id + ':' + state));
      }
    }
  } else if (machine.machine_kind === 'cyclic_control') {
    if (machine.terminal_states.length !== 0 || machine.quiescent_states.length === 0) {
      errors.push(semanticError('CYCLIC_QUIESCENCE_INVALID', machine.id));
    }
    for (const quiescent of machine.quiescent_states) {
      if (!reachable(machine.transitions, machine.initial_state, quiescent)) {
        errors.push(semanticError('QUIESCENT_UNREACHABLE', machine.id + ':' + quiescent));
      }
    }
  }
  for (const state of machine.states) {
    if (!reachable(machine.transitions, machine.initial_state, state)) {
      errors.push(semanticError('STATE_UNREACHABLE', machine.id + ':' + state));
    }
  }
  if (machine.id === 'recovery') {
    const blocked = machine.transitions.filter(({ from }) => from === 'blocked_unresolved');
    if (!blocked.some(({ event, to }) => event === 'operator_acknowledge' && to === 'blocked_unresolved')
      || !blocked.some(({ event, to }) => event === 'retry_authorized' && to === 'recovering')
      || !blocked.some(({ event, to }) => event === 'mechanical_absence_verified' && to === 'terminal')) {
      errors.push(semanticError('BLOCKED_DURABILITY_INVALID', machine.id));
    }
  }
  return errors;
}

export function validateM2AuthorityClosure(ledger) {
  const errors = [];
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const requireTransitionBinding = (machine, expected, code) => {
    const transition = machine?.transitions.find(({ from, event, to }) => (
      from === expected.from && event === expected.event && to === expected.to
    ));
    if (!transition
      || transition.guard_id !== expected.guard_id
      || (expected.trigger !== undefined && transition.trigger !== expected.trigger)
      || !expected.guard_markers.every((marker) => transition.guard.includes(marker))) {
      errors.push(semanticError(code, `${machine?.id || 'missing'}:${expected.from}:${expected.event}`));
    }
  };
  const expectedBindings = [
    {
      id: 'ordinary-owner-root',
      status: 'accepted_by_adr_0044',
      decision_code: 'darwin_peer_nearest_verified_non_aos_ancestor_v1',
      contract_ref: 'target_design.identity_contract.ordinary_owner_root',
      authority: 'docs/adr/0044-operation-owner-roots-host-control-and-resource-claims.md',
    },
    {
      id: 'same-effective-uid-host-control',
      status: 'accepted_by_adr_0044',
      decision_code: 'live_same_effective_uid_host_control_v1',
      contract_ref: 'target_design.host_control_contract',
      authority: 'docs/adr/0044-operation-owner-roots-host-control-and-resource-claims.md',
    },
  ];
  if (!same(ledger.accepted_m2_owner_bindings, expectedBindings)) {
    errors.push(semanticError('M2_OWNER_BINDING_INVALID', JSON.stringify(ledger.accepted_m2_owner_bindings)));
  }

  const identity = ledger.target_design.identity_contract;
  const ordinary = identity.ordinary_owner_root;
  if (!same(ordinary.peer_required_fields, ['audit_token', 'effective_uid', 'pid', 'pid_generation'])
    || ordinary.capture_phase !== 'local_socket_accept'
    || ordinary.walk_direction !== 'immediate_parent_outward'
    || ordinary.selection !== 'nearest_mechanically_verified_non_aos_ancestor'
    || ordinary.unverified_node_result !== 'select_conservative_immediate_mechanical_boundary_or_reject'
    || ordinary.unverified_edge_rule.widen_to_ancestor !== false
    || ordinary.unverified_edge_rule.rejection_required_when_immediate_boundary_stale !== true
    || !same(ordinary.resolver_outcomes, [
      'direct_non_aos_peer',
      'verified_non_aos_ancestor',
      'conservative_immediate_peer_boundary',
      'stale_ancestry',
      'unverified_adapter',
    ])) {
    errors.push(semanticError('ORDINARY_OWNER_ROOT_INVALID', ordinary?.selection || 'missing'));
  }
  const expectedSkipProofs = [
    {
      kind: 'exact_aos_image',
      source: 'runtime_image_attestation',
      publication_phase: 'socket_accept_reauthentication',
      common_required_fields: [
        'child_pid',
        'child_effective_uid',
        'child_proc_start_time_sample_1',
        'child_proc_start_time_sample_2',
        'parent_pid',
        'parent_effective_uid',
        'parent_proc_start_time_sample_1',
        'parent_proc_start_time_sample_2',
        'same_observation_parent_edge_receipt',
        'adapter_registration_id',
        'adapter_registration_revision',
        'executable_identity',
        'executable_digest',
      ],
      immediate_peer_additional_fields: ['child_audit_token'],
      ancestor_additional_fields: [],
      ancestor_audit_token_requirement: 'forbidden_unavailable',
    },
    {
      kind: 'generation_bound_daemon_spawn_record',
      source: 'daemon_durable_spawn_record',
      publication_phase: 'before_helper_authority',
      common_required_fields: [
        'spawn_record_id',
        'child_pid',
        'child_pid_generation',
        'parent_pid',
        'parent_pid_generation',
        'same_observation_parent_edge_receipt',
        'operation_id',
        'operation_generation',
        'adapter_id',
        'adapter_registration_revision',
        'executable_identity',
        'executable_digest',
      ],
      evidence_variants: [
        {
          evidence_scope: 'immediate_socket_peer',
          generation_source: 'socket_audit_token_pidversion',
          additional_required_fields: ['child_audit_token'],
          forbidden_fields: [],
        },
        {
          evidence_scope: 'verified_ancestor',
          generation_source: 'double_sampled_proc_bsdinfo',
          additional_required_fields: [],
          forbidden_fields: ['child_audit_token'],
        },
      ],
    },
  ];
  const expectedAncestorGenerationEvidence = {
    source: 'double_sampled_proc_bsdinfo',
    audit_token_availability: 'immediate_socket_peer_only',
    required_fields: [
      'child_pid',
      'child_effective_uid',
      'child_proc_start_time_sample_1',
      'child_proc_start_time_sample_2',
      'parent_pid',
      'parent_effective_uid',
      'parent_proc_start_time_sample_1',
      'parent_proc_start_time_sample_2',
      'same_observation_parent_edge_receipt',
      'executable_identity',
      'executable_digest',
    ],
    stable_sample_guard: 'both child and parent start-time samples and the parent edge remain identical across the observation window',
    ancestor_audit_token_requirement: 'forbidden_unavailable',
  };
  if (!same(ordinary.skip_proofs, expectedSkipProofs)
    || !same(ordinary.ancestor_generation_evidence, expectedAncestorGenerationEvidence)) {
    errors.push(semanticError('OWNER_SKIP_PROOF_INVALID', JSON.stringify(ordinary.skip_proofs)));
  }
  const dispatchBinding = ordinary.external_dispatch_spawn_binding;
  if (dispatchBinding.route_registration.binding !== 'authored_optional_external_route_registration'
    || !same(dispatchBinding.route_registration.required_fields, [
      'route_source_id',
      'route_source_revision',
      'adapter_registration_id',
      'adapter_registration_revision',
      'activation_predicate',
      'executable_resolution_policy',
      'expected_script_identity',
      'expected_script_digest',
      'reviewed_dependencies',
      'reviewed_dependency_set_digest',
      'canonical_argv_shape_digest',
    ])
    || !same(dispatchBinding.route_registration.activation_predicate, {
      grammar: 'listen_microphone_v1',
      authority_scope: 'only_exact_matching_invocations_prepare_an_operation_claim_and_require_dynamic_child_admission',
      nonmatching_invocations: 'no_operation_intent_no_resource_claim_no_child_admission',
    })
    || !same(dispatchBinding.route_registration.executable_resolution_policy, {
      launcher_shape: 'usr_bin_env_node',
      resolution_owner: 'native_external_dispatch',
      resolution_phase: 'immediately_before_spawn',
      search_source: 'sanitized_path',
      command_name: 'node',
      designated_requirement: 'anchor apple generic and identifier "node" and certificate leaf[subject.OU] = "HX7739G8FX"',
      signing_identifier: 'node',
      signing_team_identifier: 'HX7739G8FX',
      requires_hardened_runtime: true,
      platform_code_directory_hash_algorithm: 'sha256_truncated_cdhash_20_bytes',
      reviewed_source_max_bytes: 131072,
      reviewed_bundle_max_bytes: 524288,
      durable_observation_fields: [
        'resolved_executable_path_digest',
        'observed_executable_identity_digest',
        'observed_executable_device',
        'observed_executable_inode',
        'observed_executable_code_identity',
        'observed_executable_file_digest',
        'platform_code_directory_hash',
        'signing_identifier',
        'signing_team_identifier',
      ],
      authored_static_executable_digest: 'forbidden_host_variable',
      transient_absolute_path_retention: 'in_memory_resolution_only_never_durable_or_public',
      finalization_comparison: 'dynamic_seccode_and_mapped_vnode_match_exact_intent_platform_cdhash_device_inode_and_trusted_node_identity',
    })
    || dispatchBinding.route_registration.path_or_basename_shortcut !== 'forbidden'
    || !same(dispatchBinding.durable_script_identity_contract, {
      authored_registration_field: 'expected_script_identity',
      authored_registration_rule: 'normalized_repo_relative_no_absolute_or_parent_segments',
      digest_algorithm: 'sha256',
      digest_input: 'utf8_normalized_repo_relative_script_identity',
      digest_encoding: 'lowercase_hex_64',
      spawn_intent_field: 'expected_script_identity_digest',
      finalization_field: 'script_identity_digest',
      raw_value_retention: 'resolver_memory_only_until_digest_then_discard',
      forbidden_durable_fields: [
        'expected_script_identity', 'script_identity', 'script_path',
        'script_basename', 'resolved_script_path',
      ],
    })
    || !same(dispatchBinding.reviewed_dependency_contract, {
      authored_dependencies_field: 'reviewed_dependencies',
      authored_set_digest_field: 'reviewed_dependency_set_digest',
      exact_identities: [
        'scripts/lib/aos-daemon-client.mjs',
        'scripts/lib/aos-voice-follow.mjs',
      ],
      dependency_digest_input: 'raw_file_bytes',
      set_digest_input: 'utf8_sorted_canonical_json_dependency_identity_and_digest_array',
      digest_algorithm: 'sha256',
      digest_encoding: 'lowercase_hex_64',
      spawn_intent_field: 'reviewed_dependency_set_digest',
      finalization_field: 'reviewed_dependency_set_digest',
      durable_retention: 'set_digest_only',
      validation_rule: 'generator_and_dispatcher_verify_exact_closed_dependency_bytes_under_canonical_aos_root_then_daemon_binds_the_content_free_set_digest_to_the_admitted_in_memory_bundle',
    })
    || !same(dispatchBinding.binding_token_contract, {
      scope: 'exact_authenticated_intent_parent_only',
      uses: ['child_admit', 'abandon'],
      child_transport: 'forbidden',
      durable_form: 'domain_separated_digest_only',
      finalize_requirement: 'token_forbidden_finalize_is_peer_bound',
    })
    || !same(dispatchBinding.child_admission_contract, {
      request_fields: ['request_id', 'one_time_binding_token', 'child_pid'],
      parent_authentication: 'exact_intent_parent_pid_generation_and_aos_dispatcher_image',
      child_evidence: [
        'child_pid_generation', 'same_observation_parent_edge_receipt',
        'dynamic_seccode_validity', 'apple_generic_developer_id_anchor',
        'signing_identifier_node', 'signing_team_identifier_HX7739G8FX',
        'hardened_runtime', 'platform_code_directory_hash_sha256_truncated_20_bytes',
        'mapped_main_executable_device_inode',
      ],
      publication_order: 'durably_admit_exact_child_before_any_reviewed_module_bytes_are_written',
    })
    || !same(dispatchBinding.in_memory_bundle_contract, {
      source_bytes: [
        'scripts/aos-tell-listen.mjs',
        'scripts/lib/aos-daemon-client.mjs',
        'scripts/lib/aos-voice-follow.mjs',
      ],
      construction: 'deterministic_nested_esm_data_urls_from_already_verified_raw_bytes',
      transport: 'stdin_after_durable_child_admission',
      child_pathnames: 'forbidden',
      binding_token: 'forbidden',
      pre_admission_child_input: 'empty',
    })
    || !same(dispatchBinding.pending_intent_cleanup_contract, {
      limit: 4096,
      ttl_milliseconds: 30000,
      closure_paths: ['parent_authenticated_abandon', 'daemon_expiry', 'boot_recovery', 'finalization_failure'],
      result: 'terminalize_prepared_operation_and_release_exact_resource_claim_without_authority',
      closed_receipt_retention: 'bounded_4096',
    })
    || dispatchBinding.rejected_environment_authority !== 'AOS_EXTERNAL_DISPATCH_PARENT_PID'
    || dispatchBinding.lifecycle_parent_observation !== 'dispatcher_injected_pid_is_deleted_at_module_initialization_never_sent_to_daemon_and_never_authority'
    || dispatchBinding.finalization_phase !== 'tokenless_exact_admitted_child_same_socket_before_microphone_authority'
    || !same(dispatchBinding.spawn_intent_required_fields, [
      'spawn_record_id',
      'one_time_binding_token_digest',
      'parent_pid',
      'parent_pid_generation',
      'operation_id',
      'operation_generation',
      'adapter_id',
      'adapter_registration_revision',
      'route_source_id',
      'route_source_revision',
      'resolved_executable_path_digest',
      'observed_executable_identity_digest',
      'observed_executable_device',
      'observed_executable_inode',
      'observed_executable_code_identity',
      'observed_executable_file_digest',
      'platform_code_directory_hash',
      'signing_identifier',
      'signing_team_identifier',
      'expected_script_identity_digest',
      'expected_script_digest',
      'reviewed_dependency_set_digest',
      'canonical_argv_shape_digest',
      'daemon_generation',
      'created_at_monotonic_nanoseconds',
      'expires_at_monotonic_nanoseconds',
    ])
    || !same(dispatchBinding.finalization_required_fields, [
      'spawn_record_id',
      'one_time_binding_token_digest',
      'child_audit_token',
      'child_effective_uid',
      'child_pid',
      'child_pid_generation',
      'parent_pid',
      'parent_pid_generation',
      'same_observation_parent_edge_receipt',
      'operation_id',
      'operation_generation',
      'adapter_id',
      'adapter_registration_revision',
      'resolved_executable_path_digest',
      'executable_identity_digest',
      'executable_device',
      'executable_inode',
      'executable_code_identity',
      'executable_file_digest',
      'platform_code_directory_hash',
      'platform_code_directory_hash_algorithm',
      'signing_identifier',
      'signing_team_identifier',
      'script_identity_digest',
      'script_digest',
      'reviewed_dependency_set_digest',
      'canonical_argv_shape_digest',
    ])
    || !same(dispatchBinding.receipt_contract, {
      content_class: 'content_free',
      required_fields: [
        'spawn_record_id', 'operation_id', 'operation_generation', 'adapter_id',
        'adapter_registration_revision', 'resolved_executable_path_digest',
        'executable_identity_digest', 'executable_file_digest',
        'platform_code_directory_hash', 'platform_code_directory_hash_algorithm',
        'expected_script_identity_digest', 'script_identity_digest', 'script_digest',
        'reviewed_dependency_set_digest',
        'canonical_argv_shape_digest', 'outcome',
      ],
      forbidden_fields: [
        'expected_script_identity', 'script_identity', 'script_path',
        'script_basename', 'resolved_script_path', 'argv', 'one_time_binding_token',
        'reviewed_dependency_identities', 'module_bytes',
      ],
    })
    || dispatchBinding.success_result !== 'generation_bound_spawn_record_finalized'
    || dispatchBinding.failure_result !== 'typed_spawn_binding_rejection_without_authority') {
    errors.push(semanticError('EXTERNAL_DISPATCH_SPAWN_BINDING_INVALID', JSON.stringify(dispatchBinding)));
  }
  const expectedOwnerNegativeCases = [
    'basename_only',
    'argv_only',
    'environment_only',
    'same_basename_different_image',
    'stale_or_reused_pid',
    'unregistered_exact_image',
    'parent_edge_race',
    'nested_adapter_chain',
    'action_time_generation_change',
    'node_resolution_substituted_after_intent',
    'same_script_different_resolved_node',
    'observed_executable_code_identity_mismatch',
    'durable_raw_script_identity',
    'durable_raw_script_path',
    'durable_script_basename',
  ];
  if (!same(ordinary.required_negative_cases, expectedOwnerNegativeCases)) {
    errors.push(semanticError('OWNER_SKIP_NEGATIVE_CASES_MISSING', JSON.stringify(ordinary.required_negative_cases)));
  }
  if (identity.owner_filter.controllable_set_source !== 'mechanically_authenticated_peer_owner_root'
    || identity.owner_filter.asserted_filter_effect !== 'intersection_only'
    || identity.owner_filter.mechanically_bound_scope_effect !== 'may_narrow'
    || identity.owner_filter.asserted_authority !== 'none') {
    errors.push(semanticError('OWNER_FILTER_AUTHORITY_INVALID', JSON.stringify(identity.owner_filter)));
  }

  const machines = new Map(machinesFromLedger(ledger)
    .filter(({ id }) => id !== ledger.flagship_workflow.id)
    .map((machine) => [machine.id, machine]));
  const expectedMachineIds = [
    'operation',
    'stream',
    'tap',
    'artifact',
    'claim_set_transaction',
    'resource_claim',
    'multiplex_broker',
    'host_barrier',
    'recovery',
  ];
  if (!same([...machines.keys()], expectedMachineIds)) {
    errors.push(semanticError('M2_MACHINE_SET_INVALID', JSON.stringify([...machines.keys()])));
  }
  for (const machineId of expectedMachineIds) {
    const machine = machines.get(machineId);
    const requiredSources = machine.states.filter((state) => !machine.terminal_states.includes(state));
    const catalog = machine.prior_generation_sources || [];
    if (!same(catalog.map(({ source_state: state }) => state), requiredSources)) {
      errors.push(semanticError('PRIOR_GENERATION_CATALOG_INVALID', machineId));
      continue;
    }
    for (const source of catalog) {
      const matches = machine.transitions.filter((transition) => (
        transition.from === source.source_state
        && transition.event === source.expected_transition.event
        && transition.to === source.expected_transition.to
        && transition.transition_kind === source.expected_transition.transition_kind
        && transition.guard_id === source.expected_transition.guard_id
        && transition.trigger === source.expected_transition.trigger
        && transition.outcome_on_terminal === source.expected_transition.outcome_on_terminal
      ));
      if (matches.length !== 1) {
        errors.push(semanticError('PRIOR_GENERATION_TRANSITION_MISSING', machineId + ':' + source.source_state));
      }
      const expectedTo = source.expected_transition.to;
      if ((source.source_state === 'cleanup_required' && expectedTo !== 'cleanup_required')
        || (source.source_state === 'blocked_unresolved' && expectedTo !== 'blocked_unresolved')
        || (!['cleanup_required', 'blocked_unresolved'].includes(source.source_state)
          && machine.terminal_states.includes(expectedTo))) {
        errors.push(semanticError('PRIOR_GENERATION_POLARITY_INVALID', machineId + ':' + source.source_state));
      }
    }
  }

  const expectedArtifactRecovery = {
    required_states: ['cleanup_required', 'recovering'],
    required_record_fields: ['recovery_origin_state', 'recovery_disposition'],
    write_phase: 'before_entering_cleanup_required_or_recovering',
    values: ['release_pending_verification', 'retain_pending_verification', 'removal_pending_verification'],
    entry_bindings: [
      { source_state: 'transient', event: 'validation_failed', write_action: 'set', disposition: 'removal_pending_verification' },
      { source_state: 'transient', event: 'remove_failed', write_action: 'set', disposition: 'removal_pending_verification' },
      { source_state: 'transient', event: 'prior_generation_orphan', write_action: 'set', disposition: 'removal_pending_verification' },
      { source_state: 'offered', event: 'remove_failed', write_action: 'set', disposition: 'removal_pending_verification' },
      { source_state: 'offered', event: 'prior_generation_orphan', write_action: 'set', disposition: 'removal_pending_verification' },
      { source_state: 'retained', event: 'remove_failed', write_action: 'set', disposition: 'removal_pending_verification' },
      { source_state: 'retained', event: 'prior_generation_orphan', write_action: 'set', disposition: 'retain_pending_verification' },
      { source_state: 'released', event: 'prior_generation_orphan', write_action: 'set', disposition: 'release_pending_verification' },
      { source_state: 'removed', event: 'prior_generation_orphan', write_action: 'set', disposition: 'removal_pending_verification' },
      { source_state: 'cleanup_required', event: 'prior_generation_orphan', write_action: 'preserve', disposition: null },
      { source_state: 'cleanup_required', event: 'recover', write_action: 'preserve', disposition: null },
      { source_state: 'recovering', event: 'prior_generation_orphan', write_action: 'preserve', disposition: null },
      { source_state: 'recovering', event: 'retry', write_action: 'preserve', disposition: null },
    ],
    resolution_bindings: [
      { disposition: 'release_pending_verification', event: 'released_custody_verified', guard_id: 'released_custody_receipt_reverified', to: 'released' },
      { disposition: 'retain_pending_verification', event: 'retained_custody_verified', guard_id: 'retained_custody_reverified', to: 'retained' },
      { disposition: 'removal_pending_verification', event: 'absence_verified', guard_id: 'artifact_absence_proven', to: 'removed' },
    ],
    selection_rule: 'only_the_persisted_disposition_matching_transition_may_resolve_recovery',
    collapse_rule: 'released_or_retained_custody_must_never_be_inferred_as_removed',
  };
  const expectedClaimSetRecovery = {
    required_states: ['cleanup_required', 'recovering'],
    required_record_fields: ['recovery_origin_state', 'recovery_disposition', 'claim_set_digest'],
    write_phase: 'before_entering_cleanup_required_or_recovering',
    values: ['rollback_pending', 'commit_pending_handoff'],
    entry_bindings: [
      { source_state: 'prepared', event: 'prior_generation_orphan', write_action: 'set', disposition: 'rollback_pending', commit_marker_rule: 'no_commit_marker' },
      { source_state: 'reserving', event: 'prior_generation_orphan', write_action: 'derive_from_commit_marker', disposition: null, commit_marker_rule: 'complete_atomic_commit_marker_selects_commit_pending_handoff_otherwise_rollback_pending' },
      { source_state: 'committed', event: 'prior_generation_orphan', write_action: 'set', disposition: 'commit_pending_handoff', commit_marker_rule: 'complete_atomic_commit_marker_required' },
      { source_state: 'rolling_back', event: 'prior_generation_orphan', write_action: 'set', disposition: 'rollback_pending', commit_marker_rule: 'rollback_record' },
      { source_state: 'rolling_back', event: 'rollback_failed', write_action: 'set', disposition: 'rollback_pending', commit_marker_rule: 'rollback_record' },
      { source_state: 'cleanup_required', event: 'prior_generation_orphan', write_action: 'preserve', disposition: null, commit_marker_rule: 'preserve_existing' },
      { source_state: 'cleanup_required', event: 'recover', write_action: 'preserve', disposition: null, commit_marker_rule: 'preserve_existing' },
      { source_state: 'recovering', event: 'prior_generation_orphan', write_action: 'preserve', disposition: null, commit_marker_rule: 'preserve_existing' },
      { source_state: 'recovering', event: 'retry', write_action: 'preserve', disposition: null, commit_marker_rule: 'preserve_existing' },
    ],
    resolution_bindings: [
      { disposition: 'rollback_pending', event: 'rollback_absence_verified', guard_id: 'failed_admission_absence_proven', outcome: 'rejected' },
      { disposition: 'commit_pending_handoff', event: 'committed_handoff_verified', guard_id: 'committed_claim_set_handoff_proven', outcome: 'succeeded' },
    ],
    selection_rule: 'only_the_persisted_disposition_matching_transition_may_resolve_recovery',
  };
  const validateDispositionContract = (machine, expected, code) => {
    if (!same(machine?.recovery_disposition_contract, expected)) {
      errors.push(semanticError(code, JSON.stringify(machine?.recovery_disposition_contract)));
      return;
    }
    for (const entry of expected.entry_bindings) {
      const expectedTo = entry.source_state === 'cleanup_required' && entry.event === 'recover'
        ? 'recovering' : 'cleanup_required';
      if (!machine.transitions.some(({ from, event, to }) => (
        from === entry.source_state && event === entry.event && to === expectedTo
      ))) errors.push(semanticError(code, 'entry:' + entry.source_state + ':' + entry.event));
    }
    for (const binding of expected.resolution_bindings) {
      if (!machine.transitions.some((transition) => (
        transition.from === 'recovering'
        && transition.event === binding.event
        && transition.guard_id === binding.guard_id
        && (binding.to === undefined || transition.to === binding.to)
        && (binding.outcome === undefined || transition.outcome_on_terminal === binding.outcome)
      ))) errors.push(semanticError(code, 'resolution:' + binding.event));
    }
  };
  validateDispositionContract(machines.get('artifact'), expectedArtifactRecovery, 'ARTIFACT_RECOVERY_DISPOSITION_INVALID');
  validateDispositionContract(machines.get('claim_set_transaction'), expectedClaimSetRecovery, 'CLAIM_SET_RECOVERY_DISPOSITION_INVALID');

  const prepared = ledger.target_design.prepared_before_authority_contract;
  const expectedPreparedStates = {
    operation: 'prepared',
    stream: 'prepared',
    tap: 'prepared',
    artifact: 'transient',
    claim_set_transaction: 'prepared',
    resource_claim: 'prepared',
    multiplex_broker: 'prepared',
    host_barrier: 'boot_reconciling',
    recovery: 'idle',
  };
  if (prepared.durability_point !== 'before_authority_or_custody'
    || !same(prepared.records.map(({ machine_id: id }) => id), expectedMachineIds)) {
    errors.push(semanticError('PREPARED_AUTHORITY_COVERAGE_INVALID', 'record-domain'));
  }
  const coveredTransitions = new Set();
  for (const record of prepared.records) {
    const machine = machines.get(record.machine_id);
    if (!machine || record.durable_state !== expectedPreparedStates[record.machine_id]
      || !machine.states.includes(record.durable_state) || record.required_durable_facts.length < 5) {
      errors.push(semanticError('PREPARED_AUTHORITY_COVERAGE_INVALID', record.machine_id));
      continue;
    }
    for (const key of record.covered_transition_keys) {
      coveredTransitions.add(record.machine_id + ':' + key);
      const [from, event, to] = key.split('|');
      if (!machine.transitions.some((transition) => (
        transition.from === from && transition.event === event && transition.to === to
      ))) errors.push(semanticError('PREPARED_TRANSITION_UNKNOWN', record.machine_id + ':' + key));
    }
  }
  for (const machine of machines.values()) {
    for (const transition of machine.transitions) {
      if (!['authority_acquisition', 'custody'].includes(transition.transition_kind)) continue;
      const key = machine.id + ':' + [transition.from, transition.event, transition.to].join('|');
      if (!coveredTransitions.has(key)) errors.push(semanticError('PREPARED_AUTHORITY_TRANSITION_UNBOUND', key));
    }
  }

  const claimSet = machines.get('claim_set_transaction');
  const claim = machines.get('resource_claim');
  const broker = machines.get('multiplex_broker');
  const expectedResourceStates = {
    claim_set_transaction: ['prepared', 'reserving', 'committed', 'rolling_back', 'cleanup_required', 'recovering', 'terminal'],
    resource_claim: ['prepared', 'active', 'releasing', 'cleanup_required', 'recovering', 'terminal'],
    multiplex_broker: ['prepared', 'starting', 'active', 'stopping', 'cleanup_required', 'recovering', 'terminal'],
  };
  for (const machine of [claimSet, claim, broker]) {
    if (!machine || !same(machine.states, expectedResourceStates[machine.id])) {
      errors.push(semanticError('RESOURCE_CLAIM_TOPOLOGY_INVALID', machine?.id || 'missing'));
    }
  }
  const requiredResourceTransitions = [
    [claimSet, 'reserving', 'commit_all', 'committed'],
    [claimSet, 'reserving', 'conflict', 'rolling_back'],
    [claimSet, 'rolling_back', 'rollback_complete', 'terminal'],
    [claim, 'active', 'release_nonlast_subscriber', 'terminal'],
    [claim, 'active', 'release_last_subscriber', 'releasing'],
    [broker, 'active', 'subscriber_attached', 'active'],
    [broker, 'active', 'subscriber_detached_nonlast', 'active'],
    [broker, 'active', 'last_subscriber_released', 'stopping'],
  ];
  for (const [machine, from, event, to] of requiredResourceTransitions) {
    if (!machine?.transitions.some((transition) => (
      transition.from === from && transition.event === event && transition.to === to
    ))) errors.push(semanticError('RESOURCE_CLAIM_TOPOLOGY_INVALID', machine?.id + ':' + event));
  }
  const expectedCanonicalDigestContract = {
    algorithm: 'sha256',
    input_encoding: 'utf8',
    canonicalization: 'rfc8785_json_canonicalization_scheme',
    output_encoding: 'lowercase_hex_64',
    domain_separator_format: 'aos:<digest-domain>:v1\\n',
    snapshots: [
      {
        digest_field: 'resource_declaration_set_digest',
        count_field: 'resource_declaration_set_count',
        domain: 'resource-declaration-set',
        member_required_fields: [
          'adapter_registration_id', 'adapter_registration_revision', 'resource_key',
          'admission_mode', 'declaration_digest',
        ],
        member_optional_fields: ['fanout_bound'],
        sort_fields: ['resource_key', 'adapter_registration_id', 'adapter_registration_revision'],
      },
      {
        digest_field: 'registered_operation_set_digest',
        count_field: 'registered_operation_set_count',
        domain: 'registered-operation-set',
        member_required_fields: [
          'adapter_registration_id', 'adapter_registration_revision', 'capability_id',
          'operation_class', 'resource_declaration_set_digest',
        ],
        member_optional_fields: [],
        sort_fields: ['adapter_registration_id', 'adapter_registration_revision'],
      },
      {
        digest_field: 'selected_operation_digest',
        count_field: 'selected_operation_count',
        domain: 'selected-operation-set',
        member_required_fields: [
          'operation_id', 'operation_generation', 'adapter_registration_id',
          'adapter_registration_revision', 'capability_id',
        ],
        member_optional_fields: [],
        sort_fields: ['operation_id', 'operation_generation'],
      },
      {
        digest_field: 'subscriber_set_digest',
        count_field: 'subscriber_set_count',
        domain: 'subscriber-set',
        member_required_fields: [
          'claim_id', 'subscriber_id', 'operation_id', 'operation_generation',
          'resource_key', 'resource_generation',
        ],
        member_optional_fields: [],
        sort_fields: ['subscriber_id', 'claim_id'],
      },
    ],
    validation_rule: 'count_equals_canonical_member_array_length_and_digest_equals_domain_separated_canonical_bytes',
  };
  if (!same(ledger.target_design.canonical_digest_contract, expectedCanonicalDigestContract)) {
    errors.push(semanticError('CANONICAL_DIGEST_CONTRACT_INVALID',
      JSON.stringify(ledger.target_design.canonical_digest_contract)));
  }
  const resource = ledger.target_design.resource_claim_contract;
  const expectedDeclarationContract = {
    owner: 'adapter_registry',
    snapshot_required_fields: [
      'adapter_registry_revision', 'resource_declaration_set_count', 'resource_declaration_set_digest',
    ],
    canonical_order: 'resource_key_ascending',
    unique_key: 'resource_key_per_adapter_registry_revision',
    common_required_fields: [
      'adapter_registration_id', 'adapter_registration_revision', 'resource_key', 'admission_mode', 'declaration_digest',
    ],
    variants: [
      { admission_mode: 'exclusive', required_fields: [], forbidden_fields: ['fanout_bound'] },
      {
        admission_mode: 'multiplexable', required_fields: ['fanout_bound'], forbidden_fields: [],
        fanout_bound_rule: 'positive_finite_integer',
      },
    ],
    change_rule: 'resource_key_mode_adapter_or_fanout_change_requires_new_adapter_registry_revision_and_declaration_digest',
  };
  if (!same(resource.declaration_contract, expectedDeclarationContract)) {
    errors.push(semanticError('RESOURCE_DECLARATION_INVALID', JSON.stringify(resource.declaration_contract)));
  }
  const expectedRequestItemContract = {
    common_required_fields: [
      'adapter_registration_id', 'adapter_registration_revision', 'resource_key',
      'admission_mode', 'resource_declaration_digest', 'expected_resource_generation',
    ],
    variants: [
      {
        admission_mode: 'exclusive', required_fields: [],
        forbidden_fields: [
          'expected_broker_generation', 'expected_subscriber_set_revision',
          'expected_subscriber_set_count', 'expected_subscriber_set_digest',
        ],
      },
      {
        admission_mode: 'multiplexable',
        required_fields: [
          'expected_broker_generation', 'expected_subscriber_set_revision',
          'expected_subscriber_set_count', 'expected_subscriber_set_digest',
        ],
        forbidden_fields: [],
      },
    ],
  };
  if (!same(resource.admission_modes, ['exclusive', 'multiplexable'])
    || resource.claim_set.linearization !== 'single_atomic_transaction'
    || resource.claim_set.failure_result !== 'rollback_all_retain_none'
    || resource.claim_set.publication_visibility !== 'all_active_claims_together_or_none'
    || resource.claim_set.provisional_records !== 'durable_inert_non_authoritative'
    || !same(resource.claim_set.canonical_request_item_contract, expectedRequestItemContract)
    || !same(resource.claim_set.compare_and_swap_inputs, [
      'expected_barrier_generation',
      'expected_adapter_registry_revision',
      'expected_resource_declaration_set_count',
      'expected_resource_declaration_set_digest',
      'every_requested_resource_generation',
      'every_requested_resource_declaration_digest',
      'every_multiplex_resource_expected_broker_generation',
      'every_multiplex_resource_expected_subscriber_set_revision',
      'every_multiplex_resource_expected_subscriber_set_count',
      'every_multiplex_resource_expected_subscriber_set_digest',
      'claim_set_digest',
    ])
    || !same(resource.claim_set.resulting_multiplex_broker_publication_fields, [
      'resulting_broker_generation',
      'resulting_subscriber_set_revision',
      'resulting_subscriber_set_count',
      'resulting_subscriber_set_digest',
    ])
    || !same(resource.claim_set.resulting_claim_publication_fields, [
      'committed_claim_set_transaction_id',
      'committed_claim_set_digest',
      'adapter_registry_revision',
      'resource_declaration_set_count',
      'resource_declaration_set_digest',
    ])
    || resource.claim_set.fanout_guard !== 'every_resulting_subscriber_set_count_less_than_or_equal_to_bound_declaration_fanout') {
    errors.push(semanticError('RESOURCE_CLAIM_ATOMICITY_INVALID', JSON.stringify(resource.claim_set)));
  }
  if (!same(resource.broker_subscriber_cas, {
    common_required_inputs: [
      'broker_id', 'expected_broker_generation', 'resource_key', 'expected_resource_generation',
      'adapter_registration_id', 'expected_adapter_registration_revision', 'expected_resource_declaration_digest',
      'expected_subscriber_set_revision', 'expected_subscriber_set_count', 'expected_subscriber_set_digest',
      'committed_claim_set_transaction_id', 'committed_claim_set_digest', 'claim_id', 'subscriber_id',
    ],
    attach_required_inputs: [
      'current_adapter_registry_revision', 'current_resource_declaration_set_count',
      'current_resource_declaration_set_digest',
    ],
    detach_required_inputs: [
      'pinned_adapter_registry_revision', 'pinned_resource_declaration_set_count',
      'pinned_resource_declaration_set_digest',
    ],
    events: [
      {
        event: 'subscriber_attached',
        snapshot_guard: 'current_registry_and_declaration_snapshot_matches_committed_claim_set',
        count_guard: 'resulting_count_at_most_declared_fanout_bound',
        claim_result: 'active', broker_result: 'active',
      },
      {
        event: 'subscriber_detached_nonlast',
        snapshot_guard: 'exact_pinned_registry_and_declaration_snapshot_matches_claim',
        count_guard: 'expected_count_greater_than_one',
        claim_result: 'terminal', broker_result: 'active',
      },
      {
        event: 'last_subscriber_released',
        snapshot_guard: 'exact_pinned_registry_and_declaration_snapshot_matches_claim',
        count_guard: 'expected_count_equals_one_and_resulting_count_equals_zero',
        claim_result: 'terminal', broker_result: 'stopping',
      },
    ],
    atomic_publication_fields: [
      'resulting_claim_state', 'adapter_registry_revision', 'resource_declaration_set_count',
      'resource_declaration_set_digest', 'committed_claim_set_transaction_id',
      'committed_claim_set_digest', 'resulting_subscriber_set_revision', 'resulting_subscriber_set_count',
      'resulting_subscriber_set_digest', 'resulting_broker_state',
    ],
    partial_mutation: 'forbidden',
  })) errors.push(semanticError('BROKER_SUBSCRIBER_CAS_INVALID', JSON.stringify(resource.broker_subscriber_cas)));
  const claimRecord = resource.record_contracts.claim;
  if (!same(resource.record_contracts.transaction.required_fields, [
    'transaction_id', 'attempt_sequence', 'operation_id', 'operation_generation', 'daemon_generation',
    'expected_barrier_generation', 'expected_adapter_registry_revision', 'expected_resource_declaration_set_count',
    'expected_resource_declaration_set_digest', 'adapter_registry_revision',
    'resource_declaration_set_count', 'resource_declaration_set_digest',
    'canonical_request_array', 'claim_set_digest', 'state', 'receipt',
  ]) || !same(claimRecord.common_required_fields, [
    'claim_id', 'transaction_id', 'operation_id', 'operation_generation', 'resource_key', 'resource_generation',
    'admission_mode', 'adapter_registration_id', 'adapter_registration_revision',
    'resource_declaration_digest', 'adapter_registry_revision', 'resource_declaration_set_count',
    'resource_declaration_set_digest', 'committed_claim_set_transaction_id',
    'committed_claim_set_digest', 'state', 'reattach_binding',
  ]) || !same(resource.record_contracts.broker.required_fields, [
    'broker_id', 'broker_generation', 'resource_key', 'resource_generation', 'adapter_registration_id',
    'adapter_registration_revision', 'resource_declaration_digest', 'adapter_registry_revision',
    'resource_declaration_set_count', 'resource_declaration_set_digest',
    'committed_claim_set_transaction_id', 'committed_claim_set_digest', 'fanout_bound', 'subscriber_set_count',
    'subscriber_set_revision', 'subscriber_set_digest', 'state',
  ])) errors.push(semanticError('RESOURCE_RECORD_BINDING_INVALID', JSON.stringify(resource.record_contracts)));
  if (!same(claimRecord.variants, [
    {
      admission_mode: 'exclusive',
      required_fields: [],
      forbidden_fields: ['broker_id', 'broker_generation', 'subscriber_id'],
    },
    {
      admission_mode: 'multiplexable',
      required_fields: ['broker_id', 'broker_generation', 'subscriber_id'],
      forbidden_fields: [],
    },
  ])) errors.push(semanticError('RESOURCE_CLAIM_VARIANT_INVALID', JSON.stringify(claimRecord.variants)));
  if (resource.exclusive.same_owner_bypass !== false || resource.exclusive.steal !== false
    || resource.caller_policy.implicit_queue !== false || resource.caller_policy.priority !== false
    || resource.caller_policy.preemption !== false || resource.caller_policy.retry_owner !== 'caller'
    || resource.cleanup.successor_mutation !== 'forbidden') {
    errors.push(semanticError('RESOURCE_CLAIM_POLICY_INVALID', JSON.stringify(resource)));
  }
  if (!same(resource.voice_transport_resource_policy, {
    resource_key: 'voice_io_native_session',
    admission_mode: 'exclusive',
    m2_registered_claim_owner: 'microphone-capture-adapter',
    legacy_conflict_sentinels: ['speech_output', 'audio_output'],
    legacy_sentinel_admission_effect: 'atomically_reject_microphone_claim_while_output_active',
    legacy_output_stop_all_coverage: 'outside_registered_operation_plane_until_later_adapter_migration',
    capture_while_output_active: 'typed_busy_conflict',
    output_while_capture_active: 'typed_busy_conflict',
    implicit_barge_in_preemption: 'forbidden',
    caller_retry_cancel_or_kill: 'explicit',
  })) errors.push(semanticError('VOICE_RESOURCE_POLICY_INVALID', JSON.stringify(resource.voice_transport_resource_policy)));
  const brokerHostStopSources = broker.states.filter((state) => !broker.terminal_states.includes(state));
  const actualBrokerHostStopSources = broker.transitions
    .filter(({ event, trigger }) => event === 'host_stop' && trigger === 'host_stop_all')
    .map(({ from }) => from);
  if (!same(actualBrokerHostStopSources, brokerHostStopSources)) {
    errors.push(semanticError('BROKER_HOST_STOP_COVERAGE_INVALID', JSON.stringify(actualBrokerHostStopSources)));
  }
  for (const [machine, expected] of [
    [claimSet, {
      from: 'prepared', event: 'reserve', to: 'reserving',
      guard_id: 'complete_set_registry_declaration_snapshot_prepared',
      guard_markers: ['adapter-registry revision', 'resource-declaration-set count and digest', 'every requested declaration digest'],
    }],
    [claimSet, {
      from: 'reserving', event: 'commit_all', to: 'committed',
      guard_id: 'single_linearization_exact_claim_and_broker_cas',
      guard_markers: [
        'expected barrier generation', 'declaration-set count/digest', 'subscriber-set revision/count/digest',
        'committed transaction id/digest', 'atomically publish every claim',
        'resulting broker generation/revision/count/digest', 'declared fanout',
      ],
    }],
    [claimSet, {
      from: 'reserving', event: 'conflict', to: 'rolling_back',
      guard_id: 'typed_conflict_or_declaration_drift_requires_full_rollback',
      guard_markers: ['declaration revision/digest drift', 'stale broker/subscriber CAS input', 'deterministic content-free receipt'],
    }],
    [claim, {
      from: 'active', event: 'release_nonlast_subscriber', to: 'terminal',
      guard_id: 'nonlast_claim_and_broker_cas_published',
      guard_markers: [
        'pinned adapter-registry revision', 'declaration-set count/digest',
        'committed claim-set transaction id/digest', 'expected subscriber revision/count/digest',
        'atomically terminals this exact claim', 'broker remains active',
      ],
    }],
    [claim, {
      from: 'active', event: 'release_last_subscriber', to: 'releasing',
      guard_id: 'last_claim_and_broker_stopping_cas_published',
      guard_markers: [
        'pinned adapter-registry revision', 'declaration-set count/digest',
        'committed claim-set transaction id/digest', 'expected subscriber count one',
        'atomically publishes this claim release', 'broker stopping',
      ],
    }],
    [broker, {
      from: 'active', event: 'subscriber_attached', to: 'active',
      guard_id: 'subscriber_attach_exact_broker_cas_published',
      guard_markers: [
        'current adapter-registry revision', 'complete declaration-set count/digest',
        'committed claim-set transaction id/digest', 'expected subscriber-set revision/count/digest',
        'stale standalone attach', 'declared fanout', 'atomically publish the active claim',
      ],
    }],
    [broker, {
      from: 'active', event: 'subscriber_detached_nonlast', to: 'active',
      guard_id: 'nonlast_detach_exact_broker_cas_published',
      guard_markers: [
        'pinned adapter-registry revision', 'declaration-set count/digest',
        'committed claim-set transaction id/digest', 'expected subscriber-set revision/count/digest',
        'expected count greater than one', 'atomically terminal the claim',
      ],
    }],
    [broker, {
      from: 'active', event: 'last_subscriber_released', to: 'stopping',
      guard_id: 'last_detach_exact_broker_cas_published',
      guard_markers: [
        'pinned adapter-registry revision', 'declaration-set count/digest',
        'committed claim-set transaction id/digest', 'expected subscriber-set revision/count/digest',
        'expected count one', 'atomically terminal the claim',
      ],
    }],
  ]) requireTransitionBinding(machine, expected, 'RESOURCE_MACHINE_BINDING_INVALID');

  const host = ledger.target_design.host_control_contract;
  if (!same(host.registered_operation_plane_scope, {
    selection: 'complete_registered_set_at_exact_adapter_registry_revision',
    required_snapshot_fields: [
      'adapter_registry_revision',
      'registered_operation_set_count',
      'registered_operation_set_digest',
    ],
    m2_registered_adapters: ['microphone-capture-adapter'],
    unadapted_legacy_capability_control: 'not_claimed',
    later_milestone_rule: 'each later adapter milestone atomically advances the registry revision and converges the registered set toward complete privileged and managed capability coverage',
  })) errors.push(semanticError('REGISTERED_OPERATION_SCOPE_INVALID', JSON.stringify(host.registered_operation_plane_scope)));
  const expectedBarrierSnapshot = {
    capture_transition_key: 'host_barrier:open|host_stop_all|closing',
    immutable_required_fields: [
      'barrier_generation', 'stop_operation_id', 'stop_operation_generation', 'adapter_registry_revision',
      'registered_operation_set_count', 'registered_operation_set_digest', 'selected_operation_count',
      'selected_operation_digest', 'barrier_snapshot_digest',
    ],
    preserved_states: ['closing', 'closed', 'cleanup_required', 'recovering'],
    preservation_rule: 'exact_snapshot_bytes_survive_drain_cleanup_recovery_restart_status_and_state_idempotent_repeat',
    mutable_progress_fields: ['residual_count', 'residual_digest', 'cleanup_result', 'reconciliation_state'],
    registry_revision_rule: 'active_registry_snapshot_is_fixed_for_one_open_and_barrier_generation_new_revision_is_candidate_only_until_successor_open_generation',
    new_request_order: [
      'mechanical_same_effective_uid_authentication', 'retained_request_id_lookup',
      'current_daemon_and_expected_barrier_generation_cas', 'state_action_or_state_idempotent_receipt',
    ],
    state_idempotent_repeat_rule: 'new_request_while_closing_or_closed_references_original_stop_operation_and_immutable_snapshot_without_new_stop_generation',
    reopen_binding: {
      prior_snapshot: 'immutable_closed_barrier_snapshot',
      candidate_snapshot: 'current_reconciled_adapter_registry_snapshot',
      required_residual_scopes: ['prior_selected_operation_set', 'candidate_registered_operation_set'],
      publication: 'atomically_preserve_prior_snapshot_and_publish_separate_resulting_open_snapshot_and_generation',
    },
  };
  if (!same(host.barrier_snapshot_contract, expectedBarrierSnapshot)) {
    errors.push(semanticError('BARRIER_SNAPSHOT_BINDING_INVALID', JSON.stringify(host.barrier_snapshot_contract)));
  }
  const expectedBootStopAllContract = {
    transition_key: 'host_barrier:boot_reconciling|host_stop_all|boot_reconciling',
    availability: 'always_handle_through_public_stop_all_entrypoint',
    request_guard_order: [
      'mechanical_same_effective_uid_authentication', 'retained_request_id_lookup',
      'current_daemon_and_expected_barrier_generation_cas', 'exact_durable_snapshot_lookup',
      'typed_result',
    ],
    expected_generation_binding: 'exact_durable_boot_barrier_generation',
    snapshot_binding: 'exact_last_durable_immutable_barrier_snapshot_no_synthetic_zero_residuals',
    outcomes: [
      {
        outcome: 'recorded', guard: 'durable_store_writable_and_snapshot_valid',
        receipt: 'new_content_free_stop_operation_generation_bound_to_snapshot',
        cleanup_claim: 'deferred_until_reconciliation_owns_exact_residuals',
      },
      {
        outcome: 'reconciliation_in_progress', guard: 'boot_reconciliation_or_existing_stop_record_active',
        receipt: 'content_free_in_progress_snapshot_receipt', cleanup_claim: 'none',
      },
      {
        outcome: 'store_blocked', guard: 'store_unavailable_corrupt_or_lock_blocked',
        receipt: 'content_free_store_blocked_result_without_durable_success_claim', cleanup_claim: 'none',
      },
    ],
    barrier_state_result: 'boot_reconciling',
    admission_state: 'closed',
    status_item_action: 'enabled',
    false_cleanup_claim: 'forbidden',
  };
  if (!same(host.boot_stop_all_contract, expectedBootStopAllContract)) {
    errors.push(semanticError('BOOT_STOP_ALL_CONTRACT_INVALID', JSON.stringify(host.boot_stop_all_contract)));
  }
  const expectedSurfaces = [
    {
      surface: 'daemon_ipc', m2_state: 'executable', peer_context: 'live_transport_peer',
      control_scope: 'ordinary_and_host', fallback: 'typed_host_control_rejection',
    },
    {
      surface: 'cli', m2_state: 'executable', peer_context: 'live_transport_peer',
      control_scope: 'ordinary_and_host', fallback: 'typed_host_control_rejection',
    },
    {
      surface: 'status_item', m2_state: 'executable', peer_context: 'status_item_host',
      control_scope: 'host_stop_and_reopen', fallback: 'typed_host_control_rejection',
    },
    {
      surface: 'canvas', m2_state: 'internal_projection',
      peer_context: 'ordinary_canvas_captured_peer_or_status_opened_canvas_host',
      control_scope: 'ordinary_only_with_live_capture_stop_all_only_with_status_opened_host', fallback: 'display_only',
    },
    {
      surface: 'typescript_sdk', m2_state: 'later_m6', peer_context: 'future_live_transport_peer',
      control_scope: 'future_projection', fallback: 'not_shipped_m2',
    },
    {
      surface: 'python_sdk', m2_state: 'later_m6', peer_context: 'future_live_transport_peer',
      control_scope: 'future_projection', fallback: 'not_shipped_m2',
    },
  ];
  if (!same(host.surfaces, expectedSurfaces)) {
    errors.push(semanticError('HOST_CONTROL_SURFACE_INVALID', JSON.stringify(host.surfaces)));
  }
  const expectedCallerOrigins = [
    {
      origin: 'live_transport_peer', server_attached: true,
      required_evidence_fields: ['audit_token', 'effective_uid', 'pid', 'pid_generation'],
      allowed_action_scopes: ['ordinary_control', 'host_control'],
      allowed_actions: ['ordinary_operation_controls', 'stop_all', 'barrier_status', 'reopen'],
      liveness_rule: 'current_socket_transport_peer_reauthenticated_per_request',
    },
    {
      origin: 'ordinary_canvas_captured_peer', server_attached: true,
      required_evidence_fields: [
        'canvas_instance_id', 'canvas_generation', 'capture_id', 'captured_connection_epoch',
        'audit_token', 'effective_uid', 'pid', 'pid_generation',
      ],
      allowed_action_scopes: ['ordinary_control'],
      allowed_actions: ['ordinary_operation_controls'],
      liveness_rule: 'captured_connection_must_remain_current_and_live_no_status_context_fallback',
    },
    {
      origin: 'status_item_host', server_attached: true,
      required_evidence_fields: ['status_host_id', 'status_host_generation', 'daemon_generation', 'effective_uid'],
      allowed_action_scopes: ['host_control'],
      allowed_actions: ['stop_all', 'reopen'],
      liveness_rule: 'daemon_status_host_generation_reauthenticated_per_request',
    },
    {
      origin: 'status_opened_canvas_host', server_attached: true,
      required_evidence_fields: [
        'canvas_instance_id', 'canvas_generation', 'parent_status_host_id',
        'parent_status_host_generation', 'daemon_generation', 'effective_uid',
      ],
      allowed_action_scopes: ['host_control'],
      allowed_actions: ['stop_all'],
      liveness_rule: 'canvas_and_parent_status_host_generations_reauthenticated_per_request_stop_all_only',
    },
  ];
  if (!same(host.caller_origins, expectedCallerOrigins)
    || !same(host.request_contract.required_payload_fields, ['request_id', 'action', 'canonical_parameter_digest'])
    || !same(host.request_contract.server_attached_fields, [
      'expected_daemon_generation', 'connection_epoch', 'caller_origin', 'caller_origin_evidence',
    ])
    || host.request_contract.daemon_generation_binding !== 'attached_after_same_socket_bootstrap_for_the_current_connection_epoch'
    || host.request_contract.caller_evidence_source !== 'server_attached_only'
    || host.request_contract.payload_caller_evidence !== 'forbidden') {
    errors.push(semanticError('HOST_CALLER_ORIGIN_INVALID', JSON.stringify(host.caller_origins)));
  }
  const requiredStopReceiptFields = [
    'request_id',
    'canonical_parameter_digest',
    'expected_barrier_generation',
    'daemon_generation',
    'stop_operation_id',
    'stop_operation_generation',
    'caller_origin',
    'caller_origin_evidence',
    'scope',
    'prior_barrier_state',
    'prior_barrier_generation',
    'resulting_barrier_state',
    'resulting_barrier_generation',
    'adapter_registry_revision',
    'registered_operation_set_count',
    'registered_operation_set_digest',
    'selected_operation_count',
    'selected_operation_digest',
    'barrier_snapshot_digest',
    'outcome',
    'residual_count',
    'residual_digest',
    'cleanup_result',
  ];
  if (!same(host.stop_all_receipt.required_fields, requiredStopReceiptFields)
    || !same(host.stop_all_receipt.outcomes, [
      'recorded', 'reconciliation_in_progress', 'store_blocked', 'closing_started',
      'already_closing', 'already_closed', 'cleanup_required', 'recovery_in_progress',
    ])
    || host.stop_all_receipt.required_fields.includes('caller_peer_generation')
    || !same(host.request_contract.mutation_action_cas_fields, [
      { action: 'stop_all', field: 'expected_barrier_generation' },
      { action: 'reopen', field: 'expected_barrier_generation' },
    ])
    || host.request_contract.durable_dedupe !== true
    || !same(host.request_contract.dedupe_retention, {
      scope: 'generation_independent_retained_receipt_index',
      maximum_records: 4096,
      maximum_age_seconds: 86400,
      prune_order: 'oldest_terminal_receipt_first',
      retained_replay_order: 'lookup_before_current_generation_and_cas_validation',
      replay_after_prune: 'treat_as_new_request_after_exact_current_generation_and_cas_validation',
      pruned_request_identifiability: 'not_claimed_without_tombstone',
      bounded_guarantee: 'canonical replay ends when a receipt is pruned; an evicted id is a new request, while an old expected barrier generation fails CAS and cannot repeat its prior side effect',
    })
    || host.request_contract.same_id_same_digest !== 'return_canonical_receipt'
    || host.request_contract.same_id_different_digest !== 'idempotency_conflict'
    || host.idempotency.retained_lookup_scope !== 'generation_independent'
    || host.idempotency.bounded_retention !== '4096_records_or_86400_seconds'
    || host.idempotency.retained_same_request_id_same_digest !== 'same_canonical_receipt_before_generation_validation'
    || host.idempotency.retained_same_request_id_different_digest !== 'idempotency_conflict_before_generation_validation'
    || host.idempotency.after_prune !== 'evicted_id_is_new_request_subject_to_exact_current_generation_and_barrier_cas_before_state_idempotent_handling'
    || host.idempotency.pruned_request_identifiability !== 'not_claimed_without_tombstone'
    || host.idempotency.repeat_while_closing_or_closed !== 'preserve_original_stop_operation_generation_and_immutable_barrier_snapshot') {
    errors.push(semanticError('HOST_REQUEST_RECEIPT_INVALID', JSON.stringify(host.stop_all_receipt)));
  }
  const barrier = machines.get('host_barrier');
  for (const expected of [
    {
      from: 'boot_reconciling', event: 'host_stop_all', to: 'boot_reconciling',
      guard_id: 'boot_stop_all_expected_generation_snapshot_handled_closed',
      guard_markers: [
        'Always handle', 'expected durable barrier generation', 'last durable immutable barrier snapshot',
        'recorded', 'reconciliation_in_progress', 'store_blocked', 'remaining boot_reconciling',
      ],
    },
    {
      from: 'open', event: 'host_stop_all', to: 'closing',
      guard_id: 'live_same_uid_expected_generation_and_snapshot_cas',
      guard_markers: [
        'same-effective-UID reauthentication', 'expected barrier generation',
        'stop operation id/generation', 'registered-operation-set count/digest',
        'selected-operation count/digest', 'immutable barrier-snapshot digest',
      ],
    },
    {
      from: 'closing', event: 'drained', to: 'closed',
      guard_id: 'immutable_selected_set_snapshot_drained_zero_residuals',
      guard_markers: ['byte-identical stop snapshot', 'residual count/digest prove zero', 'newer registry revision'],
    },
    {
      from: 'closing', event: 'residual', to: 'cleanup_required',
      guard_id: 'immutable_snapshot_with_separate_residual_progress',
      guard_markers: ['exact immutable stop snapshot', 'residual count/digest', 'reconciliation progress'],
    },
    {
      from: 'cleanup_required', event: 'recover', to: 'recovering',
      guard_id: 'exclusive_host_recovery_claim_preserves_snapshot',
      guard_markers: ['immutable stop snapshot', 'original stop operation/generation', 'selected set'],
    },
    {
      from: 'recovering', event: 'recovered', to: 'closed',
      guard_id: 'immutable_snapshot_recovered_zero_residuals',
      guard_markers: ['immutable selected set', 'exact prior stop snapshot', 'zero residual count/digest'],
    },
    {
      from: 'recovering', event: 'retry', to: 'cleanup_required',
      guard_id: 'host_residual_persists_snapshot_unchanged',
      guard_markers: ['residual/reconciliation progress', 'immutable stop snapshot remains byte-identical'],
    },
    {
      from: 'closed', event: 'reopen', to: 'open',
      guard_id: 'same_uid_expected_generation_prior_and_candidate_scope_cas',
      guard_markers: [
        'expected closed barrier generation', 'immutable prior snapshot',
        'candidate current registered set', 'preserves the prior snapshot', 'separate successor open generation',
      ],
    },
  ]) requireTransitionBinding(barrier, expected, 'BARRIER_MACHINE_BINDING_INVALID');
  const repeatBindings = [
    ['closing', 'closing', 'retained_replay_or_current_generation_cas_preserves_closing_snapshot'],
    ['closed', 'closed', 'retained_replay_or_current_generation_cas_preserves_closed_snapshot'],
    ['cleanup_required', 'cleanup_required', 'retained_replay_or_current_generation_cas_preserves_cleanup_snapshot'],
    ['recovering', 'recovering', 'retained_replay_or_current_generation_cas_preserves_recovery_snapshot'],
  ];
  for (const [from, to, guard_id] of repeatBindings) requireTransitionBinding(barrier, {
    from, event: 'host_stop_all_repeat', to, guard_id,
    guard_markers: ['new or pruned request', 'current barrier generation', 'original stop operation/generation', 'byte-identical immutable snapshot'],
  }, 'BARRIER_MACHINE_BINDING_INVALID');
  for (const state of barrier.states) requireTransitionBinding(barrier, {
    from: state, event: 'barrier_status', to: state,
    guard_id: 'passive_content_free_snapshot_with_caller_origin',
    guard_markers: ['caller origin/evidence', 'immutable registered/selected set snapshot', 'residual digest'],
  }, 'BARRIER_MACHINE_BINDING_INVALID');
  for (const expected of [
    ['boot_reconciling', 'prior_generation_orphan', 'cleanup_required', 'barrier_reconciliation_interrupted_snapshot_preserved', 'immutable prior barrier snapshot'],
    ['open', 'prior_generation_restart', 'boot_reconciling', 'open_generation_snapshot_requires_boot_reconciliation', 'registered-set count/digest'],
    ['closing', 'prior_generation_orphan', 'cleanup_required', 'barrier_close_interrupted_snapshot_preserved', 'byte-identical immutable registered/selected-set snapshot'],
    ['closed', 'prior_generation_restart', 'boot_reconciling', 'closed_generation_snapshot_requires_boot_reconciliation', 'byte-identical immutable stop snapshot'],
    ['cleanup_required', 'prior_generation_orphan', 'cleanup_required', 'barrier_cleanup_interrupted_snapshot_preserved', 'byte-identical immutable registered/selected-set snapshot'],
    ['recovering', 'prior_generation_orphan', 'cleanup_required', 'barrier_recovery_interrupted_snapshot_preserved', 'byte-identical immutable stop snapshot'],
  ]) requireTransitionBinding(barrier, {
    from: expected[0], event: expected[1], to: expected[2], guard_id: expected[3], guard_markers: [expected[4]],
  }, 'BARRIER_MACHINE_BINDING_INVALID');
  const requiredReopenResponseFields = [
    'request_id',
    'canonical_parameter_digest',
    'expected_barrier_generation',
    'caller_origin',
    'caller_origin_evidence',
    'prior_barrier_state',
    'prior_barrier_generation',
    'prior_stop_operation_id',
    'prior_stop_operation_generation',
    'prior_adapter_registry_revision',
    'prior_registered_operation_set_count',
    'prior_registered_operation_set_digest',
    'prior_selected_operation_count',
    'prior_selected_operation_digest',
    'prior_barrier_snapshot_digest',
    'prior_residual_count',
    'prior_residual_digest',
    'resulting_barrier_state',
    'resulting_barrier_generation',
    'daemon_generation',
    'resulting_adapter_registry_revision',
    'resulting_registered_operation_set_count',
    'resulting_registered_operation_set_digest',
    'resulting_open_snapshot_digest',
    'outcome',
    'cleanup_result',
    'reconciliation_state',
  ];
  const requiredBarrierStatusFields = [
    'request_id', 'canonical_parameter_digest', 'daemon_generation', 'caller_origin', 'caller_origin_evidence',
    'barrier_generation', 'barrier_state', 'admission_open', 'stop_operation_id', 'stop_operation_generation',
    'adapter_registry_revision', 'registered_operation_set_count', 'registered_operation_set_digest',
    'selected_operation_count', 'selected_operation_digest', 'barrier_snapshot_digest',
    'residual_count', 'residual_digest', 'reconciliation_state',
  ];
  if (barrier.initial_state !== 'boot_reconciling'
    || !barrier.transitions.some(({ from, event, to }) => from === 'boot_reconciling' && event === 'open_verified' && to === 'open')
    || !barrier.transitions.some(({ from, event, to }) => from === 'closed' && event === 'reopen' && to === 'open')
    || host.reopen_receipt.required_request_fields.at(-1) !== 'expected_barrier_generation'
    || !same(host.reopen_receipt.server_attached_fields, ['expected_daemon_generation', 'connection_epoch'])
    || !same(host.reopen_receipt.required_response_fields, requiredReopenResponseFields)
    || !same(host.reopen_receipt.success_guards, [
      'generation_matches', 'barrier_closed', 'immutable_prior_snapshot_matches',
      'zero_prior_snapshot_residuals', 'candidate_current_registry_reconciled',
      'zero_candidate_registered_set_residuals', 'reconciliation_complete',
    ])
    || !same(host.barrier_status_receipt.required_fields, requiredBarrierStatusFields)
    || host.barrier_status_receipt.passive !== true) {
    errors.push(semanticError('HOST_CONTROL_AUTHORITY_INVALID', barrier.initial_state));
  }

  const cli = ledger.target_design.operation_cli_contract;
  const ownerFilterArgs = [
    '[--capability-id <id>]', '[--client-id <id>]', '[--agent-id <id>]',
    '[--project-id <id>]', '[--task-id <id>]', '[--run-id <id>]',
    '[--skill-id <id>]', '[--target-id <id>]', '[--capability-label <label>]',
  ];
  const expectedOwnerFilterFlags = [
    ['--capability-id', 'capability_id', 'mechanical_adapter_binding'],
    ['--client-id', 'client_id', 'caller_asserted_intersection'],
    ['--agent-id', 'agent_id', 'caller_asserted_intersection'],
    ['--project-id', 'project_id', 'caller_asserted_intersection'],
    ['--task-id', 'task_id', 'caller_asserted_intersection'],
    ['--run-id', 'run_id', 'caller_asserted_intersection'],
    ['--skill-id', 'skill_id', 'caller_asserted_intersection'],
    ['--target-id', 'target_id', 'caller_asserted_intersection'],
    ['--capability-label', 'capability_label', 'caller_asserted_intersection'],
  ];
  const expectedCliForms = [
    ['operation-list', 'ordinary_intersection', ['operation', 'list', ...ownerFilterArgs, '--json']],
    ['operation-inspect', 'ordinary', ['operation', 'inspect', '<operation-id>', '--generation', '<generation>', '--json']],
    ['operation-status', 'ordinary', ['operation', 'status', '<operation-id>', '--generation', '<generation>', '--json']],
    ['operation-recent', 'ordinary_intersection', ['operation', 'recent', ...ownerFilterArgs, '--json']],
    ['operation-cancel', 'ordinary', ['operation', 'cancel', '<operation-id>', '--generation', '<generation>', '--json']],
    ['operation-kill', 'ordinary', ['operation', 'kill', '<operation-id>', '--generation', '<generation>', '--json']],
    ['operation-kill-owner', 'ordinary_intersection', ['operation', 'kill-owner', ...ownerFilterArgs, '--json']],
    ['operation-tap', 'ordinary', ['operation', 'tap', '<operation-id>', '--generation', '<generation>', '--channel', '<metadata|data>', '--rate', '<items-per-second>', '--sample-every', '<count>', '--max-queue-items', '<count>', '--max-items', '<count>', '--max-bytes', '<bytes>', '--timeout', '<milliseconds>', '--duration-ms', '<milliseconds>', '[--follow]', '--json']],
    ['operation-artifact-reveal', 'ordinary', ['operation', 'artifact', 'reveal', '<artifact-id>', '--generation', '<generation>', '--json']],
    ['operation-artifact-remove', 'ordinary', ['operation', 'artifact', 'remove', '<artifact-id>', '--generation', '<generation>', '--json']],
    ['operation-artifact-release', 'ordinary', ['operation', 'artifact', 'release', '<artifact-id>', '--generation', '<generation>', '--json']],
    ['operation-artifact-retain', 'ordinary', ['operation', 'artifact', 'retain', '<artifact-id>', '--generation', '<generation>', '--json']],
    ['operation-stop-all', 'host', ['operation', 'stop-all', '--barrier-generation', '<generation>', '--json']],
    ['operation-barrier-status', 'host_passive', ['operation', 'barrier-status', '--json']],
    ['operation-reopen', 'host', ['operation', 'reopen', '--barrier-generation', '<generation>', '--json']],
  ];
  const actualCliForms = cli.forms.map(({ id, scope, argv }) => [id, scope, argv]);
  if (!same(cli.owner_filter_flags.map(({ flag, field, provenance }) => [flag, field, provenance]), expectedOwnerFilterFlags)
    || !same(actualCliForms, expectedCliForms)
    || !same(cli.tap_contract, {
      observation_only: true,
      channel_values: ['metadata', 'data'],
      flag_bindings: [
        { flag: '--rate', field: 'rate_items_per_second' },
        { flag: '--max-items', field: 'max_items' },
        { flag: '--max-bytes', field: 'max_bytes' },
        { flag: '--max-queue-items', field: 'max_queue_items' },
        { flag: '--sample-every', field: 'sample_every' },
        { flag: '--timeout', field: 'idle_timeout_milliseconds' },
        { flag: '--duration-ms', field: 'duration_milliseconds' },
      ],
      caller_owned_bounds: {
        rate_items_per_second: { minimum: 1, maximum: 60 },
        max_items: { minimum: 1, maximum: 10000 },
        max_bytes: { minimum: 1, maximum: 10485760 },
        max_queue_items: { minimum: 1, maximum: 1024 },
        sample_every: { minimum: 1, maximum: 10000 },
        idle_timeout_milliseconds: { minimum: 1, maximum: 300000 },
        duration_milliseconds: { minimum: 1, maximum: 300000 },
      },
      activation_contract: {
        validation: 'all_seven_numeric_bounds_present_finite_integer_and_within_schema_range',
        authority_point: 'after_owner_reauthentication_and_exact_source_generation_before_observation_channel_open',
        clock: 'monotonic',
        duration_origin: 'tap_activation',
        idle_origin: 'tap_activation_then_successful_enqueue_only',
        follow_rule: 'follow_never_removes_duration_or_any_other_bound',
      },
      sampling_contract: {
        sample_stride: 'deterministic_one_based_source_seen_modulo_sample_every',
        rate_limit: 'minimum_monotonic_emit_interval_from_rate_items_per_second',
        ordering: 'sample_stride_then_rate_limit_then_item_byte_and_queue_admission',
        suppression_accounting: 'sample_and_rate_skips_are_distinct_caller_selected_counters',
      },
      queue_contract: {
        ordering: 'fifo',
        source_backpressure: false,
        overflow_trigger: 'first_eligible_item_when_queue_count_equals_max_queue_items',
        overflow_action: 'stop_intake_before_enqueue_reject_only_triggering_newest_item_preserve_and_drain_existing_queue',
        silent_drop: 'forbidden',
        continued_drop_after_overflow: 'forbidden',
        terminal_reason: 'queue_full',
      },
      expiry_contract: {
        terminal_bound_reasons: [
          'max_items_reached', 'max_bytes_reached_or_would_exceed', 'queue_full', 'idle_timeout', 'duration_elapsed',
        ],
        max_items_rule: 'successful_enqueues_never_exceed_requested_max_items',
        max_bytes_rule: 'successful_enqueue_bytes_never_exceed_requested_max_bytes',
        idle_timeout_rule: 'only_successful_enqueue_resets_idle_deadline',
        duration_rule: 'absolute_monotonic_deadline_from_activation',
        terminalization: 'stop_intake_then_drain_bounded_fifo_then_terminal',
        cleanup_failure: 'cleanup_required_then_recovery',
        state_transition_binding: {
          transition_key: 'tap:active|expire|expired',
          required_persisted_terminal_reason: 'one_of_terminal_bound_reasons_before_transition',
        },
      },
      receipt_contract: {
        content_class: 'content_free',
        required_fields: [
          'tap_id', 'tap_generation', 'operation_id', 'operation_generation', 'source_generation',
          'channel', 'follow', 'requested_bounds', 'source_seen', 'sample_skipped', 'rate_skipped',
          'enqueued_items', 'enqueued_bytes', 'delivered_items', 'delivered_bytes', 'queue_high_water',
          'overflow_rejected_count', 'terminal_bound_reason',
        ],
        queue_high_water_guard: 'at_most_requested_max_queue_items',
        overflow_counter_rule: 'queue_full_requires_exactly_one_rejected_trigger_item',
      },
      follow_default: false,
      default_raw_accumulation: 'none_beyond_explicit_bounds',
    })
    || !same(cli.execution_route, {
      help_source: 'manifests/commands/source/aos/41-operation.json',
      route_source: 'manifests/commands/source/external/49-operation.json',
      executable: '$AOS_PATH',
      argv_prefix: ['__operation'],
      command_owner: 'src/commands/operation.swift',
      main_dispatch: 'src/main.swift',
    })) errors.push(semanticError('OPERATION_CLI_CONTRACT_INVALID', JSON.stringify(cli)));
  const tapMachine = machines.get('tap');
  requireTransitionBinding(tapMachine, {
    from: 'prepared', event: 'open', to: 'active',
    guard_id: 'authenticated_bounded_observer', trigger: 'tap_opened',
    guard_markers: [
      'parent and source generations', 'channel', 'rate', 'max-items', 'max-bytes',
      'max-queue-items', 'one-based sampling stride', 'idle timeout', 'duration',
    ],
  }, 'TAP_MACHINE_BINDING_INVALID');
  requireTransitionBinding(tapMachine, {
    from: 'active', event: 'expire', to: 'expired',
    guard_id: 'tap_terminal_bound_reason_persisted', trigger: 'tap_bound_reached',
    guard_markers: [
      'max_items_reached', 'max_bytes_reached_or_would_exceed', 'queue_full',
      'idle_timeout', 'duration_elapsed', 'drain the bounded FIFO',
    ],
  }, 'TAP_MACHINE_BINDING_INVALID');

  const migration = ledger.target_design.external_command_manifest_migration_contract;
  const expectedRegistrationFields = [
    'route_source_id', 'route_source_revision', 'adapter_registration_id', 'adapter_registration_revision',
    'activation_predicate',
    'executable_resolution_policy', 'expected_script_identity', 'expected_script_digest',
    'reviewed_dependencies', 'reviewed_dependency_set_digest',
    'canonical_argv_shape_digest',
  ];
  const expectedCutoverPaths = [
    'shared/schemas/aos-external-command-manifest-v1.schema.json',
    'manifests/commands/source/external/15-listen.json',
    'scripts/generate-command-manifests.mjs',
    'manifests/commands/aos-external-commands.json',
    'src/shared/external-command-dispatch.swift',
    'scripts/aos-help-proxy.mjs',
    'tests/schemas/aos-external-command-manifest-v0.test.mjs',
    'tests/schemas/aos-external-command-manifest-v1.test.mjs',
    'tests/command-manifest-generation.sh',
    'tests/external-command-dispatch.sh',
    'docs/dev/test-proof-registry.d/command-surface.json',
    'docs/dev/test-proof-registry.json',
    'docs/dev/workflow-rules.json',
    'scripts/stage-browser-companion-runtime.mjs',
    'scripts/stage-work-record-runtime.mjs',
  ];
  const expectedStagingProjectionContract = {
    owners: [
      'scripts/stage-browser-companion-runtime.mjs',
      'scripts/stage-work-record-runtime.mjs',
    ],
    source_aggregate_wire_version: 2,
    staged_aggregate_wire_version: 2,
    browser_projection: {
      selected_commands: 'exact_current_v2_source_commands_for_selected_path_keys',
      retained_existing_state: 'path_keys_only',
      retained_rehydration: 'rehydrate_each_retained_path_key_from_current_v2_source_aggregate',
      stale_retained_command_rewrap: 'forbidden',
      missing_or_duplicate_current_path: 'fail_closed',
    },
    work_record_projection: {
      source_version_requirement: 'exact_v2',
      selected_commands: 'exact_current_v2_source_work_record_commands',
      output_version_requirement: 'exact_v2',
      stale_or_v0_input: 'fail_closed',
    },
  };
  if (migration.publication_boundary !== 'current_executable_v1_only_m2_cutover'
    || !same(migration.frozen_predecessor, {
      schema_path: 'shared/schemas/aos-external-command-manifest-v0.schema.json',
      schema_version: 1,
      baseline_revision: '7aada1cb4d7a046a2b99b1b24470115eefc82224',
      sha256: '246025ae1019fcf188a257da3da5f138773861475ddb904b8337fc4cce22320e',
      mutation: 'forbidden',
      proof_state: 'bounded_freeze_and_active_v1_reader_rejection',
    })
    || migration.successor.schema_path !== 'shared/schemas/aos-external-command-manifest-v1.schema.json'
    || migration.successor.aggregate_path !== 'manifests/commands/aos-external-commands.json'
    || migration.successor.aggregate_schema_version !== 2
    || migration.successor.source_fragment_schema_version !== 1
    || migration.successor.registration_property !== 'spawn_registration'
    || !same(migration.successor.registration_required_fields, expectedRegistrationFields)
    || migration.successor.registration_digest_format !== 'lowercase_sha256_hex_64'
    || migration.successor.script_identity_rule !== 'normalized_repo_relative_no_absolute_or_parent_segments'
    || !same(migration.successor.executable_resolution_policy, {
      launcher: '/usr/bin/env', argv_zero: 'node', search_source: 'sanitized_path',
      resolution_owner: 'native_external_dispatch', resolution_phase: 'immediately_before_spawn',
      designated_requirement: 'anchor apple generic and identifier "node" and certificate leaf[subject.OU] = "HX7739G8FX"',
      signing_identifier: 'node', signing_team_identifier: 'HX7739G8FX',
      requires_hardened_runtime: true,
      platform_code_directory_hash_algorithm: 'sha256_truncated_cdhash_20_bytes',
      reviewed_source_max_bytes: 131072, reviewed_bundle_max_bytes: 524288,
      authored_static_executable_digest: 'forbidden_host_variable',
    })
    || !same(migration.registered_routes, [{
      source_path: 'manifests/commands/source/external/15-listen.json',
      command_path: ['listen'], adapter_registration_id: 'microphone-capture-adapter',
      activation_predicate: 'listen_microphone_v1', registration_count: 1,
    }])
    || migration.unregistered_route_rule !== 'all_other_external_routes_and_nonmatching_listen_invocations_remain_without_active_spawn_registration'
    || migration.generator_contract.owner !== 'scripts/generate-command-manifests.mjs'
    || !same(migration.generator_contract.cross_checks, [
      'registered_script_equals_argv_prefix_index_one',
      'script_raw_byte_digest',
      'reviewed_dependency_raw_byte_digests',
      'reviewed_dependency_set_digest',
      'activation_predicate_exact_grammar',
      'trusted_node_designated_requirement',
      'hardened_runtime_required',
      'platform_code_directory_hash_algorithm',
      'reviewed_source_and_bundle_bounds',
      'semantic_source_revision',
      'argv_prefix_plus_forwarded_suffix_shape_digest',
      'route_source_id',
      'registration_uniqueness',
      'registered_route_forbids_help_passthrough',
      'registered_route_requires_node_launcher',
    ])
    || migration.reader_contract.swift_decoder !== 'src/shared/external-command-dispatch.swift'
    || migration.reader_contract.help_decoder !== 'scripts/aos-help-proxy.mjs'
    || !same(migration.reader_contract.accepted_aggregate_versions_after_cutover, [2])
    || migration.reader_contract.dual_reader !== false
    || migration.reader_contract.translation_layer !== false
    || migration.reader_contract.parallel_aggregate !== false
    || !same(migration.atomic_cutover_paths, expectedCutoverPaths)
    || !same(migration.staging_projection_contract, expectedStagingProjectionContract)
    || migration.partial_cutover_result !== 'fail_closed_invalid_manifest'
    || migration.proof_ownership.command_surface_fragment !== 'docs/dev/test-proof-registry.d/command-surface.json'
    || migration.proof_ownership.operation_control_fragment !== 'docs/dev/test-proof-registry.d/operation-control.json'
    || migration.proof_ownership.canonical_index !== 'docs/dev/test-proof-registry.json'
    || migration.proof_ownership.workflow_rules !== 'docs/dev/workflow-rules.json') {
    errors.push(semanticError('EXTERNAL_MANIFEST_V1_CUTOVER_INVALID', JSON.stringify(migration)));
  }
  const m2 = ledger.program_milestones.find(({ id }) => id === 'M2');
  const cutover = m2?.deliverables.find(({ id }) => id === 'external_command_manifest_v1_cutover');
  const daemonSurface = m2?.deliverables.find(({ id }) => id === 'daemon_ipc_cli_surface');
  const requiredRoutingOwners = [
    'M2.path.docs_dev_test_proof_registry_json',
    'M2.path.docs_dev_test_proof_registry_d_command_surface_json',
    'M2.path.docs_dev_workflow_rules_json',
    'M2.path.scripts_stage_browser_companion_runtime_mjs',
    'M2.path.scripts_stage_work_record_runtime_mjs',
  ];
  const requiredRoutingProofs = [
    'M2.proof.tests_schemas_dev_test_proof_registry_test_mjs',
    'M2.proof.tests_schemas_dev_workflow_rules_test_mjs',
    'M2.proof.tests_dev_workflow_router_sh',
  ];
  if (!cutover || !requiredRoutingOwners.every((id) => cutover.owner_ref_ids.includes(id))
    || !requiredRoutingProofs.every((id) => cutover.proof_ref_ids.includes(id))
    || !daemonSurface?.owner_ref_ids.includes('M2.path.docs_dev_test_proof_registry_d_operation_control_json')) {
    errors.push(semanticError('PROOF_ROUTING_REACHABILITY_INVALID', m2?.id || 'missing'));
  }

  return errors;
}
export function validateOutcomeCoverage(ledger) {
  const errors = [];
  const workflow = ledger.flagship_workflow;
  const catalog = transitionCatalog(ledger);
  const paths = new Map();
  const referencedPaths = new Set();
  for (const executionPath of workflow.execution_paths) {
    if (paths.has(executionPath.id)) errors.push(semanticError('EXECUTION_PATH_DUPLICATE', executionPath.id));
    paths.set(executionPath.id, executionPath);
    for (const step of executionPath.steps) {
      resolveTransition(catalog, step.transition_ref, 'EXECUTION_PATH_TRANSITION', errors);
    }
    const entryKeys = Object.keys(executionPath.entry_states).sort();
    const finalKeys = Object.keys(executionPath.final_state_vector).sort();
    if (JSON.stringify(entryKeys) !== JSON.stringify(finalKeys)) {
      errors.push(semanticError('EXECUTION_PATH_VECTOR_DOMAIN_MISMATCH', executionPath.id));
    }
    const destinationState = executionPath.final_state_vector[executionPath.destination.machine];
    const destinationTerminal = catalog.terminal.get(executionPath.destination.machine)?.has(destinationState) ?? false;
    if (destinationState !== executionPath.destination.state
      || destinationTerminal !== executionPath.destination.terminal) {
      errors.push(semanticError('EXECUTION_PATH_DESTINATION_INVALID', executionPath.id));
    }
  }

  const bound = new Map();
  const covered = new Set();
  for (const binding of workflow.outcome_bindings) {
    if (bound.has(binding.id)) errors.push(semanticError('OUTCOME_DUPLICATE', binding.id));
    bound.set(binding.id, binding);
    for (const emission of binding.emissions) {
      const ref = emission.transition_ref;
      if (resolveTransition(catalog, ref, 'OUTCOME_TRANSITION', errors)) covered.add(transitionKey(ref));
      const executionPath = paths.get(emission.execution_path_id);
      if (!executionPath) {
        errors.push(semanticError('OUTCOME_EXECUTION_PATH_UNKNOWN', binding.id + ':' + emission.execution_path_id));
        continue;
      }
      referencedPaths.add(executionPath.id);
      const state = { ...executionPath.entry_states };
      if (state[workflow.id] !== emission.workflow_source_state
        || (ref.machine === workflow.id && emission.workflow_source_state !== ref.from)) {
        errors.push(semanticError('OUTCOME_WORKFLOW_SOURCE_STATE_MISMATCH', binding.id + ':' + emission.execution_path_id));
      }
      if (state[ref.machine] !== ref.from) {
        errors.push(semanticError('OUTCOME_EXECUTION_PATH_INCOMPATIBLE', binding.id + ':' + emission.execution_path_id));
      } else {
        state[ref.machine] = ref.to;
      }
      const actualTerminal = catalog.terminal.get(ref.machine)?.has(ref.to) ?? false;
      if (emission.destination.machine !== ref.machine || emission.destination.state !== ref.to
        || emission.destination.terminal !== actualTerminal) {
        errors.push(semanticError('OUTCOME_DESTINATION_INVALID', binding.id));
      }
      if (!expectedTerminalTaxonomy.triggers.includes(emission.trigger)) {
        errors.push(semanticError('OUTCOME_TRIGGER_UNKNOWN', binding.id + ':' + emission.trigger));
      }
      if (!expectedTerminalTaxonomy.blame_domains.includes(emission.blame)) {
        errors.push(semanticError('OUTCOME_BLAME_UNKNOWN', binding.id + ':' + emission.blame));
      }
      if (emission.authority_phase === 'pre_authority') {
        if (ref.machine !== workflow.id || ref.to !== 'terminal'
          || !executionPath.id.startsWith('pre_') || executionPath.destination.terminal !== true) {
          errors.push(semanticError('OUTCOME_AUTHORITY_PHASE_INVALID', binding.id + ':pre'));
        }
      } else if (!['stopping', 'cleanup_required'].includes(ref.to)) {
        errors.push(semanticError('OUTCOME_AUTHORITY_PHASE_INVALID', binding.id + ':post'));
      }

      const applied = [];
      for (const step of executionPath.steps) {
        const stepRef = step.transition_ref;
        covered.add(transitionKey(stepRef));
        if (state[stepRef.machine] !== stepRef.from) {
          errors.push(semanticError('EXECUTION_PATH_STATE_MISMATCH', executionPath.id + ':' + transitionKey(stepRef)));
          continue;
        }
        state[stepRef.machine] = stepRef.to;
        applied.push(stepRef);
      }
      const involved = new Set([
        workflow.id,
        ref.machine,
        executionPath.destination.machine,
        ...executionPath.steps.map(({ transition_ref: stepRef }) => stepRef.machine),
      ]);
      if ([...involved].some((machine) => !(machine in executionPath.entry_states))) {
        errors.push(semanticError('EXECUTION_PATH_MACHINE_VECTOR_INCOMPLETE', executionPath.id));
      }
      if (JSON.stringify(state) !== JSON.stringify(executionPath.final_state_vector)) {
        errors.push(semanticError('EXECUTION_PATH_FINAL_VECTOR_MISMATCH', executionPath.id));
      }
      const closureFacts = (vector) => ({
        openChildren: ['stream', 'tap', 'recovery'].filter((machine) => (
          machine in vector && !(catalog.terminal.get(machine)?.has(vector[machine]) ?? false)
        )),
        artifactClosed: !('artifact' in vector)
          || ['terminal', 'released', 'retained'].includes(vector.artifact),
      });
      const simulatedClosure = closureFacts(state);
      const declaredClosure = closureFacts(executionPath.final_state_vector);
      const openTerminalChildren = [...new Set([
        ...simulatedClosure.openChildren,
        ...declaredClosure.openChildren,
        ...(!simulatedClosure.artifactClosed || !declaredClosure.artifactClosed ? ['artifact'] : []),
      ])];
      const operationIsTerminal = catalog.terminal.get('operation')?.has(state.operation) ?? false;
      const declaredOperationIsTerminal = catalog.terminal.get('operation')
        ?.has(executionPath.final_state_vector.operation) ?? false;
      if ((operationIsTerminal || declaredOperationIsTerminal) && openTerminalChildren.length > 0) {
        errors.push(semanticError(
          'TERMINAL_OPERATION_CHILD_OPEN',
          executionPath.id + ':' + openTerminalChildren.join(','),
        ));
      }
      const postAuthorityWorkflowTerminal = emission.authority_phase === 'post_authority'
        && executionPath.destination.machine === workflow.id
        && executionPath.destination.terminal;
      if (postAuthorityWorkflowTerminal) {
        if (!operationIsTerminal || !declaredOperationIsTerminal) {
          errors.push(semanticError('POST_AUTHORITY_TERMINAL_OPERATION_OPEN', executionPath.id));
        }
        if (openTerminalChildren.length > 0) {
          errors.push(semanticError(
            'POST_AUTHORITY_TERMINAL_CHILD_OPEN',
            executionPath.id + ':' + openTerminalChildren.join(','),
          ));
        }
      }
      const operationTerminalIndex = applied.findIndex((stepRef) => (
        stepRef.machine === 'operation' && stepRef.to === 'terminal'
      ));
      if (operationTerminalIndex >= 0 && applied.slice(operationTerminalIndex + 1).some((stepRef) => (
        ['stream', 'tap', 'artifact', 'recovery'].includes(stepRef.machine)
      ))) {
        errors.push(semanticError('EXECUTION_PATH_OPERATION_TERMINATED_EARLY', executionPath.id));
      }
      const workflowTerminalIndex = applied.findIndex((stepRef) => (
        stepRef.machine === workflow.id && stepRef.to === 'terminal'
      ));
      if (workflowTerminalIndex >= 0 && operationTerminalIndex >= 0 && workflowTerminalIndex < operationTerminalIndex) {
        errors.push(semanticError('EXECUTION_PATH_WORKFLOW_TERMINATED_EARLY', executionPath.id));
      }
    }
  }

  for (const outcome of workflow.outcomes) if (!bound.has(outcome)) errors.push(semanticError('OUTCOME_UNBOUND', outcome));
  for (const id of bound.keys()) if (!workflow.outcomes.includes(id)) errors.push(semanticError('OUTCOME_UNDECLARED', id));
  for (const executionPath of workflow.execution_paths) {
    if (!referencedPaths.has(executionPath.id)) errors.push(semanticError('EXECUTION_PATH_UNREFERENCED', executionPath.id));
  }
  const failureEvents = new Set([
    'stop', 'selection_failed', 'selection_stale', 'center_failed', 'reobservation_failed',
    'geometry_failed', 'preparation_rejected', 'failure', 'cancel', 'kill', 'host_stop',
    'cleanup_resolved_without_offer',
  ]);
  for (const transition of workflow.transitions) {
    const ref = { machine: workflow.id, from: transition.from, event: transition.event, to: transition.to };
    if (failureEvents.has(transition.event) && !covered.has(transitionKey(ref))) {
      errors.push(semanticError('OUTCOME_FAILURE_TRANSITION_UNBOUND', transitionKey(ref)));
    }
  }

  const validation = bound.get('ARTIFACT_VALIDATION_FAILED');
  const validationEmission = validation?.emissions[0];
  const validationPath = validationEmission && paths.get(validationEmission.execution_path_id);
  const validationRefs = validationPath?.steps.map(({ transition_ref: ref }) => transitionKey(ref)) || [];
  const requiredValidationRefs = [
    transitionKey({ machine: 'artifact', from: 'transient', event: 'validation_failed', to: 'cleanup_required' }),
    transitionKey({ machine: 'artifact', from: 'recovering', event: 'absence_verified', to: 'removed' }),
    transitionKey({ machine: 'recovery', from: 'recovering', event: 'recovered', to: 'terminal' }),
    transitionKey({ machine: 'operation', from: 'stopping', event: 'clean', to: 'terminal' }),
    transitionKey({ machine: workflow.id, from: 'stopping', event: 'cleanup_resolved_without_offer', to: 'terminal' }),
  ];
  if (!validation || validation.emissions.length !== 1
    || transitionKey(validationEmission.transition_ref) !== requiredValidationRefs[0]
    || validationPath?.entry_states.stream !== 'terminal'
    || !requiredValidationRefs.slice(1).every((key) => validationRefs.includes(key))) {
    errors.push(semanticError('ARTIFACT_VALIDATION_PATH_INVALID', 'ARTIFACT_VALIDATION_FAILED'));
  }

  const cleanup = bound.get('ARTIFACT_CLEANUP_FAILED');
  const cleanupExpectations = new Map([
    ['transient', ['stopping', 'artifact_cleanup_unresolved_transient']],
    ['offered', ['artifact_offered', 'artifact_cleanup_unresolved_offered']],
    ['retained', ['artifact_retained', 'artifact_cleanup_unresolved_retained']],
  ]);
  const residualRecoverySequence = [
    transitionKey({ machine: 'recovery', from: 'idle', event: 'boot', to: 'scanning' }),
    transitionKey({ machine: 'recovery', from: 'scanning', event: 'orphan_found', to: 'recovering' }),
    transitionKey({ machine: 'recovery', from: 'recovering', event: 'retry', to: 'cleanup_required' }),
    transitionKey({ machine: 'recovery', from: 'cleanup_required', event: 'operator_acknowledge', to: 'blocked_unresolved' }),
  ];
  const cleanupExplicitlyDeclaresCorruption = cleanup && (
    /CORRUPTION/u.test(cleanup.id)
    || cleanup.emissions.some((emission) => {
      const transition = catalog.exact.get(transitionKey(emission.transition_ref));
      return /corrupt/iu.test([transition?.guard_id, transition?.guard].filter(Boolean).join(' '));
    })
  );
  if (!cleanupExplicitlyDeclaresCorruption && cleanup?.emissions.some((emission) => {
    const executionPath = paths.get(emission.execution_path_id);
    return executionPath?.steps.some(({ transition_ref: ref }) => (
      ref.machine === 'recovery' && ref.event === 'corruption_found'
    ));
  })) errors.push(semanticError('ARTIFACT_CLEANUP_CORRUPTION_UNJUSTIFIED', 'ARTIFACT_CLEANUP_FAILED'));
  if (!cleanup || cleanup.emissions.length !== 3 || cleanup.emissions.some((emission) => {
    const expected = cleanupExpectations.get(emission.transition_ref.from);
    const executionPath = paths.get(emission.execution_path_id);
    return !expected || emission.workflow_source_state !== expected[0]
      || emission.execution_path_id !== expected[1]
      || emission.destination.terminal || emission.destination.state !== 'cleanup_required'
      || executionPath?.entry_states.operation !== 'stopping'
      || executionPath?.final_state_vector.operation !== 'stopping'
      || JSON.stringify(executionPath?.steps.map(({ transition_ref: stepRef }) => transitionKey(stepRef)))
        !== JSON.stringify(residualRecoverySequence)
      || executionPath?.destination.state !== 'blocked_unresolved'
      || executionPath?.destination.terminal !== false;
  })) errors.push(semanticError('ARTIFACT_CLEANUP_PATH_INVALID', 'ARTIFACT_CLEANUP_FAILED'));

  const follow = workflow.transitions.find(({ from, event, to }) => from === 'active' && event === 'follow_update_accepted' && to === 'active');
  const exactSteps = [
    'obtain a fresh caller observation',
    'verify the immutable target identity is unchanged',
    'bind new observation, state, navigation, frame, topology, scale, window, and source identities',
    'validate the new source rectangle within current topology and source bounds',
    'increment geometry_generation atomically',
    'update the crop only after every validation succeeds',
  ];
  if (!follow || JSON.stringify(follow.atomic_rebind_steps) !== JSON.stringify(exactSteps)) {
    errors.push(semanticError('FOLLOW_REBIND_INVALID', 'follow_update_accepted'));
  }
  return errors;
}


export function validateMilestoneClosure(milestones) {
  const errors = [];
  const allGates = new Map();
  for (const milestone of milestones) for (const gate of milestone.exit_gates) {
    allGates.set(milestone.id + '.' + gate.id, { milestone, gate });
  }
  for (let index = 0; index < milestones.length; index += 1) {
    const milestone = milestones[index];
    const expectedId = 'M' + (index + 1);
    const expectedDependency = index === 0 ? [] : ['M' + index];
    if (milestone.id !== expectedId || milestone.ordinal !== index + 1
      || JSON.stringify(milestone.depends_on) !== JSON.stringify(expectedDependency)) {
      errors.push(semanticError('MILESTONE_ORDER_INVALID', milestone.id));
    }
    const idsUnique = (items) => new Set(items.map(({ id }) => id)).size === items.length;
    if (!idsUnique(milestone.path_refs) || !idsUnique(milestone.proof_paths)
      || !idsUnique(milestone.deliverables) || !idsUnique(milestone.exit_gates)) {
      errors.push(semanticError('MILESTONE_ID_DUPLICATE', milestone.id));
    }
    const ownerSet = new Set(milestone.path_refs.map(({ id }) => id));
    const proofSet = new Set(milestone.proof_paths.map(({ id }) => id));
    const gateSet = new Set(milestone.exit_gates.map(({ id }) => id));
    for (const deliverable of milestone.deliverables) {
      if (deliverable.owner_ref_ids.length === 0 || deliverable.owner_ref_ids.some((id) => !ownerSet.has(id))) {
        errors.push(semanticError('MILESTONE_OWNER_MISSING', milestone.id + ':' + deliverable.id));
      }
      if (deliverable.proof_ref_ids.length === 0 || deliverable.proof_ref_ids.some((id) => !proofSet.has(id))) {
        errors.push(semanticError('MILESTONE_PROOF_MISSING', milestone.id + ':' + deliverable.id));
      }
      if (deliverable.exit_gate_ids.some((id) => !gateSet.has(id))) {
        errors.push(semanticError('MILESTONE_GATE_MISSING', milestone.id + ':' + deliverable.id));
      }
    }
    const claimedOwners = new Set(milestone.deliverables.flatMap(({ owner_ref_ids: ids }) => ids));
    const claimedProofs = new Set(milestone.deliverables.flatMap(({ proof_ref_ids: ids }) => ids));
    const claimedGates = new Set(milestone.deliverables.flatMap(({ exit_gate_ids: ids }) => ids));
    if ([...ownerSet].some((id) => !claimedOwners.has(id)) || [...claimedOwners].some((id) => !ownerSet.has(id))) {
      errors.push(semanticError('MILESTONE_OWNER_UNCLAIMED', milestone.id));
    }
    if ([...proofSet].some((id) => !claimedProofs.has(id)) || [...claimedProofs].some((id) => !proofSet.has(id))) {
      errors.push(semanticError('MILESTONE_PROOF_UNCLAIMED', milestone.id));
    }
    if ([...gateSet].some((id) => !claimedGates.has(id))) {
      errors.push(semanticError('MILESTONE_GATE_UNUSED', milestone.id));
    }
    for (const gate of milestone.exit_gates) {
      if (gate.proof_ref_ids.length === 0 || gate.proof_ref_ids.some((id) => !proofSet.has(id))) {
        errors.push(semanticError('EXIT_GATE_PROOF_MISSING', milestone.id + ':' + gate.id));
      }
      if (gate.criterion.includes('must be mechanically or statically proven at the named milestone boundary')) {
        errors.push(semanticError('EXIT_GATE_CRITERION_GENERIC', milestone.id + ':' + gate.id));
      }
      for (const prerequisite of gate.prerequisite_gate_refs) {
        const target = allGates.get(prerequisite);
        if (!target || target.milestone.ordinal >= milestone.ordinal) {
          errors.push(semanticError('MILESTONE_PREREQUISITE_INVALID', milestone.id + ':' + prerequisite));
        }
      }
    }
    if (commandProducingMilestones.has(milestone.id)) {
      const generated = milestone.path_refs.filter(({ kind }) => kind === 'generated').map(({ id }) => id);
      const expectedMaintainedApiPaths = milestone.id === 'M2'
        ? ['docs/api/aos.md', 'docs/api/aos-capabilities.md']
        : ['docs/api/aos.md'];
      const maintainedApiRefs = milestone.path_refs.filter(({ path: ownerPath, kind }) => (
        kind === 'current' && expectedMaintainedApiPaths.includes(ownerPath)
      ));
      const maintainedApi = maintainedApiRefs.map(({ id }) => id);
      const commandSourceKind = ['M2', 'M3'].includes(milestone.id) ? 'current' : 'proposed';
      const commandSources = milestone.path_refs.filter(({ path: ownerPath, kind }) => (
        kind === commandSourceKind && ownerPath.startsWith('manifests/commands/source/')
      ));
      const classes = new Set(commandSources.map(({ path: ownerPath }) => (
        ownerPath.startsWith('manifests/commands/source/aos/') ? 'aos'
          : ownerPath.startsWith('manifests/commands/source/external/') ? 'external' : 'invalid'
      )));
      const generatedAndMaintained = [...generated, ...maintainedApi];
      if (!classes.has('aos') || !classes.has('external')
        || classes.has('invalid') || generated.length !== 2
        || JSON.stringify(maintainedApiRefs.map(({ path: ownerPath }) => ownerPath)) !== JSON.stringify(expectedMaintainedApiPaths)) {
        errors.push(semanticError('MILESTONE_COMMAND_SURFACE_INCOMPLETE', milestone.id));
      }
      for (const { path: sourcePath } of commandSources) {
        if (!/^manifests\/commands\/source\/(?:aos|external)\/\d{2}-[a-z0-9-]+\.json$/u.test(sourcePath)
          || sourcePath.includes('.proposed.')) {
          errors.push(semanticError('MILESTONE_COMMAND_SOURCE_FILENAME_INVALID', milestone.id + ':' + sourcePath));
        }
      }
      for (const source of commandSources) {
        const owner = milestone.deliverables.find((deliverable) => (
          deliverable.owner_ref_ids.includes(source.id)
          && generatedAndMaintained.every((id) => deliverable.owner_ref_ids.includes(id))
        ));
        if (!owner) errors.push(semanticError('MILESTONE_GENERATED_ATOMICITY_INVALID', milestone.id + ':' + source.id));
      }
    }
  }
  return errors;
}

export function validateExposureReachability(ledger) {
  const errors = [];
  for (const row of ledger.capabilities) {
    for (const surfaceName of ['typescript_sdk', 'toolkit']) {
      const surface = row.current.exposure[surfaceName];
      const label = row.id + ':' + surfaceName;
      if (surfaceName === 'typescript_sdk' && surface.reachability === 'internal_only') {
        errors.push(semanticError('TS_INTERNAL_ONLY_FORBIDDEN', label));
      }
      if (surface.reachability === 'none'
        && (surface.state !== 'absent' || surface.owners.length > 0
          || surface.internal_support_paths.length > 0 || surface.export_bindings.length > 0
          || surface.forms.length > 0 || surface.schemas.length > 0)) {
        errors.push(semanticError('REACHABILITY_NONE_NOT_EMPTY', label));
      }
      if (surface.reachability === 'internal_only'
        && (surface.state === 'absent' || surface.owners.length === 0
          || surface.internal_support_paths.length === 0 || surface.export_bindings.length > 0)) {
        errors.push(semanticError('INTERNAL_REACHABILITY_INVALID', label));
      }
      if (surface.reachability === 'package_export'
        && (surface.state === 'absent' || surface.owners.length === 0
          || surface.export_bindings.length === 0 || surface.forms.length === 0)) {
        errors.push(semanticError('PACKAGE_EXPORT_UNREACHABLE', label));
      }
    }
  }
  return errors;
}

export function validatePackageSurfaceSnapshot(ledger) {
  return JSON.stringify(packageSurfaceSnapshot(ledger)) === JSON.stringify(expectedPackageSurfaceSnapshot)
    ? []
    : [semanticError('PACKAGE_SURFACE_SNAPSHOT_MISMATCH', 'typescript_sdk+toolkit')];
}

export function validatePlatformEvidenceSourceIdentity(ledger) {
  const errors = [];
  if (JSON.stringify(ledger.platform_evidence_sources) !== JSON.stringify(expectedPlatformEvidenceSources)) {
    errors.push(semanticError('PLATFORM_EVIDENCE_SOURCE_IDENTITY_MISMATCH', 'reviewed-sdk-snapshot'));
  }
  const evidenceSources = new Map(ledger.platform_evidence_sources.map((source) => [source.id, source]));
  for (const row of ledger.capabilities) for (const item of row.current.platform.api_symbols) {
    const availability = item.availability;
    if (availability.evidence_kind !== 'sdk_header') continue;
    const source = evidenceSources.get(availability.evidence_source_id);
    if (!source) {
      errors.push(semanticError('PLATFORM_EVIDENCE_SOURCE_UNKNOWN', row.id + ':' + item.name));
    } else if (source.platform !== availability.platform) {
      errors.push(semanticError('PLATFORM_EVIDENCE_PLATFORM_MISMATCH', row.id + ':' + item.name));
    }
  }
  return errors;
}

export function validateProofAttribution(ledger) {
  const errors = [];
  for (const row of ledger.capabilities) {
    const implementation = row.current.implementation.state;
    const basis = row.current.proof.basis;
    const expectedBasis = {
      implemented: 'capability_proof',
      partial: 'mixed_capability_and_absence',
      absent: 'absence_proof',
      unsupported: 'unsupported_platform_fact',
      unverified: 'unverified_platform_fact',
    }[implementation];
    if (basis !== expectedBasis) errors.push(semanticError('PROOF_BASIS_MISMATCH', row.id));
    for (const [lane, items] of Object.entries({
      static: row.current.proof.static, fake: row.current.proof.fake, native: row.current.proof.native,
    })) for (const item of items) {
      if ((lane === 'static' && item.execution_class !== 'static')
        || (lane === 'fake' && item.execution_class !== 'fake')
        || (lane === 'native' && !['native_compile', 'native_live', 'managed_live'].includes(item.execution_class))) {
        errors.push(semanticError('PROOF_LANE_MISMATCH', row.id + ':' + item.path));
      }
      if (['static', 'fake', 'native_compile'].includes(item.execution_class)
        && (item.requires_owner_authority || item.tcc_services.length > 0 || item.mutates_runtime)) {
        errors.push(semanticError('PROOF_LANE_MISMATCH', row.id + ':' + item.path));
      }
      if (['native_live', 'managed_live'].includes(item.execution_class)
        && (!item.requires_owner_authority || !item.mutates_runtime)) {
        errors.push(semanticError('PROOF_LANE_MISMATCH', row.id + ':' + item.path));
      }
    }
    if (['absence_proof', 'unsupported_platform_fact', 'unverified_platform_fact'].includes(basis)
      && (row.current.proof.fake.length > 0 || row.current.proof.native.length > 0)) {
      errors.push(semanticError('ABSENCE_PROOF_OVERCLAIM', row.id));
    }
  }
  return errors;
}

function findHelpForm(manifest, formId) {
  return manifest.commands.flatMap((command) => command.forms || []).filter(({ id }) => id === formId);
}
function usageContainsRoute(usage, routePath) {
  const escaped = ('aos ' + routePath).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp('(?:^|[|;&]\\s*)' + escaped + '(?:\\s|$)', 'u').test(usage);
}
function exactRouteTuple(command) {
  return { path: command.path, when: command.when ?? null, executable: command.executable, argv_prefix: command.argv_prefix ?? [] };
}
function selectorTupleKey(routeSource, selector) {
  return routeSource + '\0' + JSON.stringify(selector);
}
function tokenizeExample(example) {
  const source = typeof example === 'string' ? example : (example.command || example.usage || JSON.stringify(example));
  return source.match(/(?:[^\s"]+|"[^"]*")+/gu)?.map((token) => token.replace(/^"|"$/gu, '')) || [];
}
function selectorSatisfiable(form, selector) {
  if (selector.when === null) return true;
  const haystack = [form.usage, ...(form.examples || []).map((example) => (
    typeof example === 'string' ? example : (example.command || example.usage || '')
  ))].join('\n');
  const positionalArgs = form.args.filter(({ kind }) => kind === 'positional');
  const argIndex = selector.when.child_arg_index ?? 0;
  const routeOffset = 1 + selector.path.length + argIndex;
  const values = (form.examples || []).map(tokenizeExample).map((tokens) => tokens[routeOffset]).filter(Boolean);
  if (selector.when.child_arg_missing === true) return positionalArgs[argIndex]?.required !== true;
  if (selector.when.prefix) return haystack.includes(selector.when.prefix);
  if (selector.when.excluded_prefixes) {
    return values.some((value) => !selector.when.excluded_prefixes.some((prefix) => value.startsWith(prefix)));
  }
  if (selector.when.excluded_values) return values.some((value) => !selector.when.excluded_values.includes(value));
  return values.length > 0;
}

function collectCurrentLocalPaths(ledger) {
  const result = new Set([
    ledger.authority.target_adr, ledger.authority.authority_map, ledger.authority.ledger_schema,
    ledger.authority.ledger, ledger.authority.design_contract, ledger.authority.schema_test,
    ledger.authority.proof_registry, ledger.authority.workflow_rules,
    ...ledger.coverage.command_source_roots, ...ledger.coverage.generated_contracts,
    ledger.coverage.command_source_generator, ...ledger.coverage.skill_sources,
    ledger.coverage.skill_registry, ...ledger.m1_bootstrap_paths,
  ]);
  for (const route of ledger.coverage.fail_closed_cli_routes) {
    if (route.help_source) result.add(route.help_source);
    result.add(route.route_source);
    result.add(route.source_owner);
  }
  for (const capability of ledger.capabilities) {
    for (const relativePath of [...capability.current.implementation.primitive_paths, ...capability.current.implementation.evidence_paths]) result.add(relativePath);
    for (const surface of Object.values(capability.current.exposure)) {
      for (const relativePath of [...surface.owners, ...(surface.internal_support_paths || []), ...surface.schemas]) result.add(relativePath);
      for (const binding of surface.export_bindings || []) {
        result.add(binding.package_manifest); result.add(binding.runtime_entry); result.add(binding.types_entry);
      }
      for (const binding of surface.bindings || []) {
        if (binding.help_source) result.add(binding.help_source);
        result.add(binding.route_source);
      }
    }
    for (const lane of ['static', 'fake', 'native']) for (const proof of capability.current.proof[lane]) result.add(proof.path);
  }
  for (const ownerLedger of ledger.target_design.owner_path_ledgers) for (const entry of ownerLedger.entries) {
    if (['current', 'generated'].includes(entry.path_ref.kind)) result.add(entry.path_ref.path);
  }
  for (const ladder of ledger.target_design.proof_ladders) for (const lane of ['static', 'fake', 'native']) {
    for (const proof of ladder[lane]) if (['current', 'generated'].includes(proof.path_ref.kind)) result.add(proof.path_ref.path);
  }
  for (const milestone of ledger.program_milestones) for (const ref of [...milestone.path_refs, ...milestone.proof_paths]) {
    if (['current', 'generated'].includes(ref.kind)) result.add(ref.path);
  }
  return result;
}
function exportDeclares(body, symbolName) {
  const escaped = symbolName.replace(/[-/\\^$*+?.()|[\]{}]/gu, '\\$&');
  return new RegExp(
    '(?:export\\s+(?:declare\\s+)?(?:async\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+' + escaped + '\\b)'
    + '|(?:export\\s*\\{[^}]*\\b' + escaped + '\\b[^}]*\\})',
    'su',
  ).test(body);
}

export async function validateCurrentPathTruth(ledger) {
  const errors = [];
  const tracked = gitPaths();
  for (const relativePath of collectCurrentLocalPaths(ledger)) {
    if (/^https?:\/\//u.test(relativePath)) continue;
    if (!bootstrapPaths.has(relativePath) && !pathCovered(tracked, relativePath)) {
      errors.push(semanticError('CURRENT_PATH_UNTRACKED', relativePath));
    }
  }
  const packageCache = new Map();
  for (const row of ledger.capabilities) {
    for (const surfaceName of ['typescript_sdk', 'toolkit']) {
      const surface = row.current.exposure[surfaceName];
      const bindingsByManifest = new Map();
      for (const binding of surface.export_bindings) {
        let packageManifest = packageCache.get(binding.package_manifest);
        if (!packageManifest) {
          packageManifest = await json(binding.package_manifest);
          packageCache.set(binding.package_manifest, packageManifest);
        }
        const exportEntry = packageManifest.exports?.[binding.subpath];
        const packageDir = path.posix.dirname(binding.package_manifest);
        if (!exportEntry
          || path.posix.join(packageDir, exportEntry.import.replace(/^\.\//u, '')) !== binding.runtime_entry
          || path.posix.join(packageDir, exportEntry.types.replace(/^\.\//u, '')) !== binding.types_entry) {
          errors.push(semanticError('PACKAGE_EXPORT_BINDING_INVALID', row.id + ':' + binding.subpath));
          continue;
        }
        if (!bindingsByManifest.has(binding.package_manifest)) bindingsByManifest.set(binding.package_manifest, []);
        bindingsByManifest.get(binding.package_manifest).push(binding);
        const [runtimeBody, typesBody] = await Promise.all([read(binding.runtime_entry), read(binding.types_entry)]);
        if (binding.binding_scope === 'selected_symbols') {
          for (const symbolName of binding.symbols) {
            if (!exportDeclares(runtimeBody, symbolName) || !exportDeclares(typesBody, symbolName)) {
              errors.push(semanticError('PACKAGE_EXPORT_SYMBOL_MISSING', row.id + ':' + symbolName));
            }
          }
          for (const symbolName of binding.type_only_symbols) {
            if (!exportDeclares(typesBody, symbolName)) errors.push(semanticError('PACKAGE_EXPORT_TYPE_MISSING', row.id + ':' + symbolName));
          }
        } else if (binding.symbols.length !== 0 || binding.type_only_symbols.length !== 0) {
          errors.push(semanticError('COMPLETE_ENTRYPOINT_ENUMERATES_SYMBOLS', row.id + ':' + binding.subpath));
        }
      }
      if (surface.state === 'complete' && surface.reachability === 'package_export') {
        for (const [manifestPath, bindings] of bindingsByManifest) {
          const manifest = packageCache.get(manifestPath);
          const roots = new Set(bindings.map(({ subpath }) => {
            const segments = subpath.split('/');
            return segments.length > 2 ? segments.slice(0, 2).join('/') : subpath;
          }));
          const expectedSubpaths = Object.keys(manifest.exports || {}).filter((subpath) => (
            [...roots].some((root) => subpath === root || subpath.startsWith(root + '/'))
          )).sort();
          const actualSubpaths = bindings.map(({ subpath }) => subpath).sort();
          if (JSON.stringify(actualSubpaths) !== JSON.stringify(expectedSubpaths)
            || bindings.some(({ binding_scope: scope }) => scope !== 'complete_entrypoint')) {
            errors.push(semanticError('COMPLETE_PACKAGE_SURFACE_NOT_CLOSED', row.id + ':' + surfaceName));
          }
        }
      }
    }
  }
  return errors;
}

export async function validateCliReverseClosure(ledger) {
  const errors = [];
  const functional = new Set();
  const failClosed = new Set();
  const authoredGroups = new Map();
  let bindingOccurrences = 0;
  let selectorOccurrences = 0;
  for (const row of ledger.capabilities) {
    const cli = row.current.exposure.cli;
    bindingOccurrences += cli.bindings.length;
    if (JSON.stringify(cli.bindings.map(({ form_id: id }) => id)) !== JSON.stringify(expectedCliFormIds[row.id] || [])) {
      errors.push(semanticError('CLI_FORM_ID_DRIFT', row.id));
    }
    for (const binding of cli.bindings) {
      selectorOccurrences += binding.route_selectors.length;
      const [help, route] = await Promise.all([json(binding.help_source), json(binding.route_source)]);
      const forms = findHelpForm(help, binding.form_id);
      if (forms.length !== 1 || !usageContainsRoute(forms[0].usage, binding.route_path)) {
        errors.push(semanticError('HELP_FORM_UNRESOLVED', row.id + ':' + binding.form_id));
        continue;
      }
      if (!cli.forms.some((form) => form.startsWith('aos ' + binding.route_path))) {
        errors.push(semanticError('CLI_FORMS_NOT_DERIVED', row.id + ':' + binding.form_id));
      }
      const groupKey = binding.route_source + '\0' + binding.route_path;
      if (!authoredGroups.has(groupKey)) authoredGroups.set(groupKey, { source: binding.route_source, path: binding.route_path, route });
      const authoredForPath = route.commands.filter(({ path: routePath }) => routePath.join(' ') === binding.route_path);
      if (authoredForPath.length > 1 && binding.route_selectors.some(({ when }) => when === null)) {
        errors.push(semanticError('AMBIGUOUS_ROUTE_SELECTOR_EMPTY', row.id + ':' + binding.form_id));
      }
      for (const selector of binding.route_selectors) {
        functional.add(selectorTupleKey(binding.route_source, selector));
        if (!selectorSatisfiable(forms[0], selector)) errors.push(semanticError('ROUTE_SELECTOR_UNSATISFIABLE', row.id + ':' + binding.form_id));
      }
      if (!cli.owners.includes(binding.help_source) || !cli.owners.includes(binding.route_source)) {
        errors.push(semanticError('CLI_OWNER_MISSING', row.id + ':' + binding.form_id));
      }
    }
  }
  for (const route of ledger.coverage.fail_closed_cli_routes) {
    failClosed.add(selectorTupleKey(route.route_source, route.route_selector));
    const groupKey = route.route_source + '\0' + route.route_selector.path.join(' ');
    if (!authoredGroups.has(groupKey)) authoredGroups.set(groupKey, {
      source: route.route_source,
      path: route.route_selector.path.join(' '),
      route: await json(route.route_source),
    });
    if (route.form_id !== null) {
      const help = await json(route.help_source);
      const forms = findHelpForm(help, route.form_id);
      if (forms.length !== 1 || !selectorSatisfiable(forms[0], route.route_selector)) {
        errors.push(semanticError('FAIL_CLOSED_FORM_UNRESOLVED', route.id));
      }
    }
  }
  for (const key of functional) if (failClosed.has(key)) errors.push(semanticError('CLI_FUNCTIONAL_FAIL_CLOSED_OVERLAP', key));
  const authored = new Set();
  for (const group of authoredGroups.values()) {
    for (const command of group.route.commands.filter(({ path: routePath }) => routePath.join(' ') === group.path)) {
      authored.add(selectorTupleKey(group.source, exactRouteTuple(command)));
    }
  }
  const union = new Set([...functional, ...failClosed]);
  if ([...union].some((key) => !authored.has(key)) || [...authored].some((key) => !union.has(key))) {
    errors.push(semanticError('CLI_REVERSE_CLOSURE_MISMATCH', 'authored-bound-paths'));
  }
  if (bindingOccurrences !== 103 || selectorOccurrences !== 109 || failClosed.size !== 6) {
    errors.push(semanticError('CLI_OCCURRENCE_COUNT_INVALID', [bindingOccurrences, selectorOccurrences, failClosed.size].join(':')));
  }
  return errors;
}


function hasExcludedSegment(relativePath) {
  return relativePath.split('/').some((segment) => excludedSourceSegments.has(segment));
}
function classifyTrackedPath(relativePath, meta) {
  const parts = relativePath.split('/');
  const extension = path.extname(relativePath).toLowerCase();
  if (parts[0] === 'tests') return { classification: hasExcludedSegment(relativePath) ? 'fixture' : 'test' };
  if (hasExcludedSegment(relativePath)) return { classification: parts.includes('node_modules') || parts.includes('vendor') ? 'vendor' : 'generated' };
  if (parts[0] === 'docs' || extension === '.md' || extension === '.txt' || extension === '.license') return { classification: 'docs' };
  if (relativePath.startsWith('shared/schemas/') || relativePath.endsWith('.schema.json')) return { classification: 'schema' };
  if (privilegedMetadataPaths.has(relativePath)) return { classification: 'privilege_metadata' };
  if (managedDescriptorPattern.test(relativePath)) return { classification: 'managed_descriptor' };
  if (relativePath === 'manifests/commands/aos-commands.json'
    || relativePath === 'manifests/commands/aos-external-commands.json') return { classification: 'generated' };
  if (generatedSourceFilenamePattern.test(relativePath)) return { classification: 'generated' };
  if (binaryExtensions.has(extension)) return { classification: 'binary' };
  if (sourceExtensions.has(extension)) {
    if (meta.binary) return { error: semanticError('SOURCE_BINARY', relativePath) };
    if (meta.symlink && !meta.resolved_regular) return { error: semanticError('SOURCE_SYMLINK_UNRESOLVED', relativePath) };
    return { classification: 'production_source' };
  }
  if (extension === '' && meta.executable) {
    if (meta.binary || !meta.readable_shebang) return { error: semanticError('EXECUTABLE_SHEBANG_UNREADABLE', relativePath) };
    return { classification: 'production_source' };
  }
  if (extension === '.json' || extension === '.jsonc' || extension === '.ndjson'
    || extension === '.plist' || extension === '.toml' || extension === '.entitlements'
    || extension === '.css') return { classification: 'data' };
  return { classification: 'other' };
}
async function readTextStreaming(relativePath) {
  const handle = await fs.open(path.join(repoRoot, relativePath), 'r');
  const chunks = [];
  const buffer = Buffer.alloc(64 * 1024);
  try {
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      if (chunk.includes(0)) return { binary: true, text: null };
      chunks.push(chunk);
    }
  } finally {
    await handle.close();
  }
  return { binary: false, text: Buffer.concat(chunks).toString('utf8') };
}
async function productionSources() {
  const sources = new Map();
  const searchable = new Map();
  const classifications = new Map();
  const errors = [];
  for (const entry of gitInventory()) {
    const absolute = path.join(repoRoot, entry.path);
    let meta = {
      executable: entry.mode === '100755',
      symlink: entry.mode === '120000',
      resolved_regular: false,
      binary: false,
      readable_shebang: false,
    };
    if (entry.mode === '120000' && !entry.path.startsWith('tests/')) {
      try {
        const target = await fs.realpath(absolute);
        const stat = await fs.stat(target);
        meta.resolved_regular = stat.isFile();
      } catch {
        meta.resolved_regular = false;
      }
    }
    const initial = classifyTrackedPath(entry.path, meta);
    const shouldRead = ['production_source', 'privilege_metadata', 'managed_descriptor'].includes(initial.classification)
      || initial.error?.code === 'EXECUTABLE_SHEBANG_UNREADABLE';
    if (shouldRead) {
      if (meta.symlink && !meta.resolved_regular) {
        if (initial.error) errors.push(initial.error);
      } else {
        const content = await readTextStreaming(entry.path);
        meta = { ...meta, binary: content.binary, readable_shebang: content.text?.startsWith('#!') || false };
        const final = classifyTrackedPath(entry.path, meta);
        if (final.error) errors.push(final.error);
        else if (['production_source', 'privilege_metadata', 'managed_descriptor'].includes(final.classification)) {
          if (content.binary) errors.push(semanticError('SEARCHABLE_TEXT_BINARY', entry.path));
          else {
            searchable.set(entry.path, content.text);
            if (final.classification === 'production_source') sources.set(entry.path, content.text);
          }
        }
        classifications.set(entry.path, final.classification || 'error');
        continue;
      }
    }
    if (initial.error) errors.push(initial.error);
    classifications.set(entry.path, initial.classification || 'error');
  }
  return { sources, searchable, classifications, errors };
}
function rowSourcePaths(row) {
  const result = new Set(row.current.implementation.primitive_paths);
  for (const key of ['typescript_sdk', 'toolkit']) {
    for (const relativePath of row.current.exposure[key].internal_support_paths) result.add(relativePath);
  }
  return result;
}
function assertProbeOwnership(row, probe) {
  if (probe.classification === 'production_source') {
    assert.ok(rowSourcePaths(row).has(probe.path), row.id + ':' + probe.path);
    return;
  }
  if (probe.classification === 'managed_descriptor') {
    assert.ok(row.current.implementation.evidence_paths.includes(probe.path), row.id + ':' + probe.path);
    return;
  }
  assert.fail('unsupported probe classification: ' + probe.classification);
}
function absentPattern(symbolName) {
  const escaped = symbolName.replace(/[-/\\^$*+?.()|[\]{}]/gu, '\\$&');
  if (symbolName === 'capturesAudio = true') return /capturesAudio\s*=\s*true/u;
  if (symbolName === 'addStreamOutput(type: .audio)') return /addStreamOutput\([^)]*type:\s*\.audio/su;
  return new RegExp(escaped, 'u');
}
function symbol(row, name) {
  return row.current.platform.api_symbols.find(({ name: symbolName }) => symbolName === name);
}
function assertKnown(row, name, introduced, platform = 'macos') {
  const item = symbol(row, name);
  assert.ok(item, row.id + ':' + name);
  assert.equal(item.availability.state, 'known');
  assert.equal(item.availability.platform, platform);
  assert.equal(item.availability.introduced, introduced);
  assert.equal(item.availability.evidence_kind, 'sdk_header');
  assert.equal(item.availability.evidence_source_id, platform === 'driverkit' ? 'apple-driverkit-25.5' : 'apple-macosx-26.5');
  assert.match(item.availability.evidence_locator, /^(?:System\/Library|System\/DriverKit\/System\/Library)\//u);
}

test('closed schema validates canonical data and rejects cross-field lies', async () => {
  const ledger = await json(ledgerRelativePath);
  assert.equal(schemaValidation(ledger).status, 0);
  const mutations = [];
  {
    const value = clone(ledger);
    value.capabilities[0].current.exposure.typescript_sdk.state = 'absent';
    value.capabilities[0].current.exposure.typescript_sdk.reachability = 'none';
    value.capabilities[0].current.exposure.typescript_sdk.owners = ['packages/toolkit/package.json'];
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    value.capabilities[0].current.platform.api_symbols[0].availability.evidence_source_id = null;
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    value.coverage.source_disposition_by_capability['ax-element-observation'].source_probes = [];
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    value.coverage.source_disposition_by_capability['ax-element-observation'].private_family_pattern_ids = [
      'private_windowserver_cgs_calls',
    ];
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    delete value.coverage.source_disposition_by_capability['undocumented-windowserver-routes'].private_family_pattern_ids;
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    const binding = value.capabilities.find(({ id }) => id === 'display-topology-observation').current.exposure.typescript_sdk.export_bindings[0];
    binding.symbols = [];
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    const binding = value.capabilities.find(({ id }) => id === 'desktopworld-scene').current.exposure.typescript_sdk.export_bindings[0];
    binding.symbols = ['DesktopWorldSurfaceThree'];
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    delete value.program_milestones[0].path_refs[0].id;
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    value.accepted_m2_owner_bindings[0].status = 'unresolved';
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    value.target_design.host_control_contract.surfaces
      .find(({ surface }) => surface === 'status_item').fallback = 'display_only';
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    value.program_milestones[1].exit_gates.pop();
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    value.target_design.identity_contract.ordinary_owner_root.skip_proofs[1]
      .evidence_variants[0].additional_required_fields = [];
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    value.target_design.resource_claim_contract.claim_set.compare_and_swap_inputs.pop();
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    value.target_design.host_control_contract.request_contract
      .dedupe_retention.replay_after_prune = 'replay_expired';
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    value.target_design.operation_cli_contract.tap_contract
      .caller_owned_bounds.sample_every.minimum = 0;
    mutations.push(value);
  }
  {
    const value = clone(ledger);
    value.program_milestones[1].path_refs.pop();
    mutations.push(value);
  }
  for (const mutation of mutations) assert.notEqual(schemaValidation(mutation).status, 0);
});
test('canonical row identity, milestone assignment, and exact functional CLI inventory are closed', async () => {
  const ledger = await json(ledgerRelativePath);
  assert.deepEqual(ledger.capabilities.map(({ id }) => id), expectedCapabilityIds);
  assert.equal(ledger.coverage.row_count, 32);
  assert.deepEqual(Object.fromEntries(ledger.capabilities.map((row) => [row.id, row.target.milestone])), expectedMilestoneByCapability);
  assert.deepEqual(Object.keys(ledger.coverage.source_disposition_by_capability), expectedCapabilityIds);
  for (const row of ledger.capabilities) {
    assert.deepEqual(row.current.exposure.cli.bindings.map(({ form_id: id }) => id), expectedCliFormIds[row.id] || [], row.id);
    assert.deepEqual(row.current.exposure.cli.bindings, expectedCliBindingsByCapability[row.id] || [], row.id);
  }
});

test('independent semantic validators reject graph, outcome, milestone, exposure, proof, and path lies', async () => {
  const ledger = await json(ledgerRelativePath);
  for (const machine of machinesFromLedger(ledger)) expectNoErrors(validateGraph(machine));
  expectNoErrors(validateM2AuthorityClosure(ledger));
  expectNoErrors(validateOutcomeCoverage(ledger));
  expectNoErrors(validateMilestoneClosure(ledger.program_milestones));
  expectNoErrors(validateExposureReachability(ledger));
  expectNoErrors(validatePackageSurfaceSnapshot(ledger));
  expectNoErrors(validatePlatformEvidenceSourceIdentity(ledger));
  expectNoErrors(validateProofAttribution(ledger));
  expectNoErrors(await validateCurrentPathTruth(ledger));
  expectNoErrors(await validateCliReverseClosure(ledger));

  const terminalOutgoing = clone(ledger.target_design.operation_state_machine);
  terminalOutgoing.transitions.push({ ...terminalOutgoing.transitions[0], from: 'terminal' });
  expectCode(validateGraph(terminalOutgoing), 'TERMINAL_HAS_OUTGOING');

  const missingPriorGeneration = clone(ledger);
  missingPriorGeneration.target_design.stream_state_machine.transitions = missingPriorGeneration.target_design.stream_state_machine.transitions
    .filter(({ from, event }) => !(from === 'active' && event === 'prior_generation_orphan'));
  expectCode(validateM2AuthorityClosure(missingPriorGeneration), 'PRIOR_GENERATION_TRANSITION_MISSING');

  const priorPolarity = clone(ledger);
  const priorCleanup = priorPolarity.target_design.recovery_state_machine.prior_generation_sources
    .find(({ source_state: state }) => state === 'blocked_unresolved');
  priorCleanup.expected_transition.to = 'terminal';
  priorPolarity.target_design.recovery_state_machine.transitions
    .find(({ from, event }) => from === 'blocked_unresolved' && event === 'prior_generation_orphan').to = 'terminal';
  expectCode(validateM2AuthorityClosure(priorPolarity), 'PRIOR_GENERATION_POLARITY_INVALID');

  const ownerSkipLie = clone(ledger);
  ownerSkipLie.target_design.identity_contract.ordinary_owner_root.skip_proofs[0].common_required_fields.pop();
  expectCode(validateM2AuthorityClosure(ownerSkipLie), 'OWNER_SKIP_PROOF_INVALID');

  const immediateSpawnTokenMissing = clone(ledger);
  immediateSpawnTokenMissing.target_design.identity_contract.ordinary_owner_root.skip_proofs[1]
    .evidence_variants[0].additional_required_fields = [];
  expectCode(validateM2AuthorityClosure(immediateSpawnTokenMissing), 'OWNER_SKIP_PROOF_INVALID');

  const ancestorSpawnTokenAdmitted = clone(ledger);
  ancestorSpawnTokenAdmitted.target_design.identity_contract.ordinary_owner_root.skip_proofs[1]
    .evidence_variants[1].forbidden_fields = [];
  expectCode(validateM2AuthorityClosure(ancestorSpawnTokenAdmitted), 'OWNER_SKIP_PROOF_INVALID');

  const dispatchSpawnLie = clone(ledger);
  dispatchSpawnLie.target_design.identity_contract.ordinary_owner_root
    .external_dispatch_spawn_binding.binding_token_contract.child_transport = 'child_environment';
  expectCode(validateM2AuthorityClosure(dispatchSpawnLie), 'EXTERNAL_DISPATCH_SPAWN_BINDING_INVALID');

  const activationPredicateWidened = clone(ledger);
  activationPredicateWidened.target_design.identity_contract.ordinary_owner_root
    .external_dispatch_spawn_binding.route_registration.activation_predicate.grammar = 'all_listen_v1';
  expectCode(validateM2AuthorityClosure(activationPredicateWidened), 'EXTERNAL_DISPATCH_SPAWN_BINDING_INVALID');

  const interpreterTrustWidened = clone(ledger);
  interpreterTrustWidened.target_design.identity_contract.ordinary_owner_root
    .external_dispatch_spawn_binding.child_admission_contract.child_evidence
    .splice(5, 1);
  expectCode(validateM2AuthorityClosure(interpreterTrustWidened), 'EXTERNAL_DISPATCH_SPAWN_BINDING_INVALID');

  const bundleBeforeAdmission = clone(ledger);
  bundleBeforeAdmission.target_design.identity_contract.ordinary_owner_root
    .external_dispatch_spawn_binding.in_memory_bundle_contract.transport = 'stdin_before_admission';
  expectCode(validateM2AuthorityClosure(bundleBeforeAdmission), 'EXTERNAL_DISPATCH_SPAWN_BINDING_INVALID');

  const strandedPreparedClaim = clone(ledger);
  strandedPreparedClaim.target_design.identity_contract.ordinary_owner_root
    .external_dispatch_spawn_binding.pending_intent_cleanup_contract.closure_paths
    .splice(1, 1);
  expectCode(validateM2AuthorityClosure(strandedPreparedClaim), 'EXTERNAL_DISPATCH_SPAWN_BINDING_INVALID');

  const executableSubstitution = clone(ledger);
  executableSubstitution.target_design.identity_contract.ordinary_owner_root.external_dispatch_spawn_binding
    .route_registration.executable_resolution_policy.durable_observation_fields.pop();
  expectCode(validateM2AuthorityClosure(executableSubstitution), 'EXTERNAL_DISPATCH_SPAWN_BINDING_INVALID');

  const dependencySetOmitted = clone(ledger);
  delete dependencySetOmitted.target_design.identity_contract.ordinary_owner_root
    .external_dispatch_spawn_binding.reviewed_dependency_contract;
  expectCode(validateM2AuthorityClosure(dependencySetOmitted), 'EXTERNAL_DISPATCH_SPAWN_BINDING_INVALID');

  const dependencySetDrift = clone(ledger);
  dependencySetDrift.target_design.identity_contract.ordinary_owner_root
    .external_dispatch_spawn_binding.reviewed_dependency_contract.exact_identities.pop();
  expectCode(validateM2AuthorityClosure(dependencySetDrift), 'EXTERNAL_DISPATCH_SPAWN_BINDING_INVALID');

  for (const [label, mutate] of [
    ['identity', (binding) => {
      binding.spawn_intent_required_fields[
        binding.spawn_intent_required_fields.indexOf('expected_script_identity_digest')
      ] = 'expected_script_identity';
    }],
    ['path', (binding) => {
      binding.finalization_required_fields.push('script_path');
    }],
    ['basename', (binding) => {
      binding.receipt_contract.required_fields.push('script_basename');
    }],
  ]) {
    const rawScriptValue = clone(ledger);
    mutate(rawScriptValue.target_design.identity_contract.ordinary_owner_root.external_dispatch_spawn_binding);
    expectCode(validateM2AuthorityClosure(rawScriptValue), 'EXTERNAL_DISPATCH_SPAWN_BINDING_INVALID');
  }

  const artifactCustodyCollapse = clone(ledger);
  artifactCustodyCollapse.target_design.artifact_state_machine.recovery_disposition_contract
    .resolution_bindings[0].to = 'removed';
  artifactCustodyCollapse.target_design.artifact_state_machine.transitions
    .find(({ from, event }) => from === 'recovering' && event === 'released_custody_verified').to = 'removed';
  expectCode(validateM2AuthorityClosure(artifactCustodyCollapse), 'ARTIFACT_RECOVERY_DISPOSITION_INVALID');

  const claimRollbackSuccess = clone(ledger);
  claimRollbackSuccess.target_design.claim_set_transaction_state_machine.recovery_disposition_contract
    .resolution_bindings[0].outcome = 'succeeded';
  claimRollbackSuccess.target_design.claim_set_transaction_state_machine.transitions
    .find(({ from, event }) => from === 'recovering' && event === 'rollback_absence_verified').outcome_on_terminal = 'succeeded';
  expectCode(validateM2AuthorityClosure(claimRollbackSuccess), 'CLAIM_SET_RECOVERY_DISPOSITION_INVALID');

  const preparedGap = clone(ledger);
  preparedGap.target_design.prepared_before_authority_contract.records
    .find(({ machine_id: id }) => id === 'multiplex_broker').covered_transition_keys
    .splice(2, 1);
  expectCode(validateM2AuthorityClosure(preparedGap), 'PREPARED_AUTHORITY_TRANSITION_UNBOUND');

  const partialClaim = clone(ledger);
  partialClaim.target_design.resource_claim_contract.claim_set.publication_visibility = 'partial_claims_visible';
  expectCode(validateM2AuthorityClosure(partialClaim), 'RESOURCE_CLAIM_ATOMICITY_INVALID');

  const multiplexCasGap = clone(ledger);
  multiplexCasGap.target_design.resource_claim_contract.claim_set.compare_and_swap_inputs.splice(4, 1);
  expectCode(validateM2AuthorityClosure(multiplexCasGap), 'RESOURCE_CLAIM_ATOMICITY_INVALID');

  const multiplexPublicationGap = clone(ledger);
  multiplexPublicationGap.target_design.resource_claim_contract.claim_set
    .resulting_multiplex_broker_publication_fields.pop();
  expectCode(validateM2AuthorityClosure(multiplexPublicationGap), 'RESOURCE_CLAIM_ATOMICITY_INVALID');

  const declarationDigestGap = clone(ledger);
  declarationDigestGap.target_design.resource_claim_contract.declaration_contract.common_required_fields
    .splice(declarationDigestGap.target_design.resource_claim_contract.declaration_contract.common_required_fields.indexOf('declaration_digest'), 1);
  expectCode(validateM2AuthorityClosure(declarationDigestGap), 'RESOURCE_DECLARATION_INVALID');

  const declarationFanoutLie = clone(ledger);
  declarationFanoutLie.target_design.resource_claim_contract.declaration_contract.variants[0]
    .forbidden_fields = [];
  expectCode(validateM2AuthorityClosure(declarationFanoutLie), 'RESOURCE_DECLARATION_INVALID');

  const declarationRevisionGap = clone(ledger);
  declarationRevisionGap.target_design.resource_claim_contract.record_contracts.transaction.required_fields
    .splice(declarationRevisionGap.target_design.resource_claim_contract.record_contracts.transaction.required_fields.indexOf('expected_adapter_registry_revision'), 1);
  expectCode(validateM2AuthorityClosure(declarationRevisionGap), 'RESOURCE_RECORD_BINDING_INVALID');

  const requestDeclarationGap = clone(ledger);
  requestDeclarationGap.target_design.resource_claim_contract.claim_set.canonical_request_item_contract
    .common_required_fields.pop();
  expectCode(validateM2AuthorityClosure(requestDeclarationGap), 'RESOURCE_CLAIM_ATOMICITY_INVALID');

  const brokerExpectedCountGap = clone(ledger);
  brokerExpectedCountGap.target_design.resource_claim_contract.broker_subscriber_cas.common_required_inputs
    .splice(brokerExpectedCountGap.target_design.resource_claim_contract.broker_subscriber_cas.common_required_inputs.indexOf('expected_subscriber_set_count'), 1);
  expectCode(validateM2AuthorityClosure(brokerExpectedCountGap), 'BROKER_SUBSCRIBER_CAS_INVALID');

  const staleStandaloneAttach = clone(ledger);
  staleStandaloneAttach.target_design.resource_claim_contract.broker_subscriber_cas.attach_required_inputs[0]
    = 'pinned_adapter_registry_revision';
  expectCode(validateM2AuthorityClosure(staleStandaloneAttach), 'BROKER_SUBSCRIBER_CAS_INVALID');

  const unpinnedDetach = clone(ledger);
  unpinnedDetach.target_design.resource_claim_contract.broker_subscriber_cas.detach_required_inputs[0]
    = 'current_adapter_registry_revision';
  expectCode(validateM2AuthorityClosure(unpinnedDetach), 'BROKER_SUBSCRIBER_CAS_INVALID');

  const brokerTransactionGap = clone(ledger);
  brokerTransactionGap.target_design.resource_claim_contract.broker_subscriber_cas.common_required_inputs
    .splice(brokerTransactionGap.target_design.resource_claim_contract.broker_subscriber_cas.common_required_inputs
      .indexOf('committed_claim_set_transaction_id'), 2);
  expectCode(validateM2AuthorityClosure(brokerTransactionGap), 'BROKER_SUBSCRIBER_CAS_INVALID');

  for (const recordKind of ['transaction', 'claim', 'broker']) {
    const snapshotRecordGap = clone(ledger);
    const fields = recordKind === 'claim'
      ? snapshotRecordGap.target_design.resource_claim_contract.record_contracts.claim.common_required_fields
      : snapshotRecordGap.target_design.resource_claim_contract.record_contracts[recordKind].required_fields;
    fields.splice(fields.indexOf('resource_declaration_set_digest'), 1);
    expectCode(validateM2AuthorityClosure(snapshotRecordGap), 'RESOURCE_RECORD_BINDING_INVALID');
  }

  for (const [field, replacement] of [
    ['output_encoding', 'base64url'],
    ['domain_separator_format', 'aos:v1:<digest-domain>'],
  ]) {
    const digestEncodingLie = clone(ledger);
    digestEncodingLie.target_design.canonical_digest_contract[field] = replacement;
    expectCode(validateM2AuthorityClosure(digestEncodingLie), 'CANONICAL_DIGEST_CONTRACT_INVALID');
  }
  const digestOrderingLie = clone(ledger);
  digestOrderingLie.target_design.canonical_digest_contract.snapshots[0].sort_fields.reverse();
  expectCode(validateM2AuthorityClosure(digestOrderingLie), 'CANONICAL_DIGEST_CONTRACT_INVALID');

  const brokerResultDigestGap = clone(ledger);
  brokerResultDigestGap.target_design.resource_claim_contract.broker_subscriber_cas.atomic_publication_fields
    .splice(brokerResultDigestGap.target_design.resource_claim_contract.broker_subscriber_cas.atomic_publication_fields.indexOf('resulting_subscriber_set_digest'), 1);
  expectCode(validateM2AuthorityClosure(brokerResultDigestGap), 'BROKER_SUBSCRIBER_CAS_INVALID');

  const brokerOversubscribe = clone(ledger);
  brokerOversubscribe.target_design.resource_claim_contract.broker_subscriber_cas.events[0]
    .count_guard = 'resulting_count_may_exceed_declared_fanout';
  expectCode(validateM2AuthorityClosure(brokerOversubscribe), 'BROKER_SUBSCRIBER_CAS_INVALID');

  const variantLie = clone(ledger);
  variantLie.target_design.resource_claim_contract.record_contracts.claim.variants[0]
    .required_fields.push('broker_id');
  expectCode(validateM2AuthorityClosure(variantLie), 'RESOURCE_CLAIM_VARIANT_INVALID');

  const claimTopologyLie = clone(ledger);
  claimTopologyLie.target_design.resource_claim_state_machine.transitions
    .find(({ from, event }) => from === 'active' && event === 'release_nonlast_subscriber').to = 'releasing';
  expectCode(validateM2AuthorityClosure(claimTopologyLie), 'RESOURCE_CLAIM_TOPOLOGY_INVALID');

  const voicePreemptionLie = clone(ledger);
  voicePreemptionLie.target_design.resource_claim_contract
    .voice_transport_resource_policy.implicit_barge_in_preemption = 'allowed';
  expectCode(validateM2AuthorityClosure(voicePreemptionLie), 'VOICE_RESOURCE_POLICY_INVALID');

  const brokerStopGap = clone(ledger);
  brokerStopGap.target_design.multiplex_broker_state_machine.transitions = brokerStopGap.target_design
    .multiplex_broker_state_machine.transitions.filter(({ from, event }) => !(from === 'stopping' && event === 'host_stop'));
  expectCode(validateM2AuthorityClosure(brokerStopGap), 'BROKER_HOST_STOP_COVERAGE_INVALID');

  const claimCommitGuardLie = clone(ledger);
  claimCommitGuardLie.target_design.claim_set_transaction_state_machine.transitions
    .find(({ from, event }) => from === 'reserving' && event === 'commit_all')
    .guard = 'Commit every claim at one linearization point.';
  expectCode(validateM2AuthorityClosure(claimCommitGuardLie), 'RESOURCE_MACHINE_BINDING_INVALID');

  const statusHostLie = clone(ledger);
  statusHostLie.target_design.host_control_contract.caller_origins
    .find(({ origin }) => origin === 'status_item_host').allowed_actions.push('barrier_status');
  expectCode(validateM2AuthorityClosure(statusHostLie), 'HOST_CALLER_ORIGIN_INVALID');

  const capturedPeerHostLie = clone(ledger);
  capturedPeerHostLie.target_design.host_control_contract.caller_origins
    .find(({ origin }) => origin === 'ordinary_canvas_captured_peer').allowed_actions.push('stop_all');
  expectCode(validateM2AuthorityClosure(capturedPeerHostLie), 'HOST_CALLER_ORIGIN_INVALID');

  const statusCanvasOrdinaryLie = clone(ledger);
  statusCanvasOrdinaryLie.target_design.host_control_contract.caller_origins
    .find(({ origin }) => origin === 'status_opened_canvas_host').allowed_actions.push('ordinary_operation_controls');
  expectCode(validateM2AuthorityClosure(statusCanvasOrdinaryLie), 'HOST_CALLER_ORIGIN_INVALID');

  const collapsedCanvasOrigin = clone(ledger);
  collapsedCanvasOrigin.target_design.host_control_contract.caller_origins.splice(1, 1);
  expectCode(validateM2AuthorityClosure(collapsedCanvasOrigin), 'HOST_CALLER_ORIGIN_INVALID');

  const registeredSetLie = clone(ledger);
  registeredSetLie.target_design.host_control_contract
    .registered_operation_plane_scope.unadapted_legacy_capability_control = 'implicitly_included';
  expectCode(validateM2AuthorityClosure(registeredSetLie), 'REGISTERED_OPERATION_SCOPE_INVALID');

  const fakePeerReceipt = clone(ledger);
  fakePeerReceipt.target_design.host_control_contract.stop_all_receipt.required_fields
    .splice(5, 2, 'caller_peer_generation');
  expectCode(validateM2AuthorityClosure(fakePeerReceipt), 'HOST_REQUEST_RECEIPT_INVALID');

  const unboundedDedupe = clone(ledger);
  unboundedDedupe.target_design.host_control_contract.request_contract.dedupe_retention.maximum_records = 0;
  expectCode(validateM2AuthorityClosure(unboundedDedupe), 'HOST_REQUEST_RECEIPT_INVALID');

  const impossibleReplayExpired = clone(ledger);
  impossibleReplayExpired.target_design.host_control_contract.request_contract
    .dedupe_retention.replay_after_prune = 'replay_expired';
  expectCode(validateM2AuthorityClosure(impossibleReplayExpired), 'HOST_REQUEST_RECEIPT_INVALID');

  const stopAllCasGap = clone(ledger);
  stopAllCasGap.target_design.host_control_contract.request_contract.mutation_action_cas_fields.shift();
  expectCode(validateM2AuthorityClosure(stopAllCasGap), 'HOST_REQUEST_RECEIPT_INVALID');

  const snapshotDigestGap = clone(ledger);
  snapshotDigestGap.target_design.host_control_contract.barrier_snapshot_contract.immutable_required_fields.pop();
  expectCode(validateM2AuthorityClosure(snapshotDigestGap), 'BARRIER_SNAPSHOT_BINDING_INVALID');

  const staleSnapshotOverwrite = clone(ledger);
  staleSnapshotOverwrite.target_design.host_control_contract.barrier_snapshot_contract
    .registry_revision_rule = 'current_registry_may_overwrite_closed_snapshot';
  expectCode(validateM2AuthorityClosure(staleSnapshotOverwrite), 'BARRIER_SNAPSHOT_BINDING_INVALID');

  const reopenPriorScopeGap = clone(ledger);
  reopenPriorScopeGap.target_design.host_control_contract.barrier_snapshot_contract
    .reopen_binding.required_residual_scopes.shift();
  expectCode(validateM2AuthorityClosure(reopenPriorScopeGap), 'BARRIER_SNAPSHOT_BINDING_INVALID');

  const prunedBeforeCasLie = clone(ledger);
  prunedBeforeCasLie.target_design.host_control_contract.barrier_snapshot_contract.new_request_order
    .splice(2, 2, 'state_idempotent_receipt_without_generation_cas');
  expectCode(validateM2AuthorityClosure(prunedBeforeCasLie), 'BARRIER_SNAPSHOT_BINDING_INVALID');

  const barrierTransitionSnapshotLie = clone(ledger);
  barrierTransitionSnapshotLie.target_design.host_barrier_state_machine.transitions
    .find(({ from, event }) => from === 'closing' && event === 'drained')
    .guard = 'All operations have stopped.';
  expectCode(validateM2AuthorityClosure(barrierTransitionSnapshotLie), 'BARRIER_MACHINE_BINDING_INVALID');

  const bootStopTransitionGap = clone(ledger);
  bootStopTransitionGap.target_design.host_barrier_state_machine.transitions = bootStopTransitionGap.target_design
    .host_barrier_state_machine.transitions.filter(({ from, event }) => !(
      from === 'boot_reconciling' && event === 'host_stop_all'
    ));
  expectCode(validateM2AuthorityClosure(bootStopTransitionGap), 'BARRIER_MACHINE_BINDING_INVALID');

  const bootStopCleanupLie = clone(ledger);
  bootStopCleanupLie.target_design.host_barrier_state_machine.transitions
    .find(({ from, event }) => from === 'boot_reconciling' && event === 'host_stop_all').to = 'cleanup_required';
  expectCode(validateM2AuthorityClosure(bootStopCleanupLie), 'BARRIER_MACHINE_BINDING_INVALID');

  const bootStopOutcomeGap = clone(ledger);
  bootStopOutcomeGap.target_design.host_control_contract.boot_stop_all_contract.outcomes.pop();
  expectCode(validateM2AuthorityClosure(bootStopOutcomeGap), 'BOOT_STOP_ALL_CONTRACT_INVALID');

  const bootStopFalseCleanup = clone(ledger);
  bootStopFalseCleanup.target_design.host_control_contract.boot_stop_all_contract.outcomes[1]
    .cleanup_claim = 'cleanup_complete';
  expectCode(validateM2AuthorityClosure(bootStopFalseCleanup), 'BOOT_STOP_ALL_CONTRACT_INVALID');

  const bootStatusDisabled = clone(ledger);
  bootStatusDisabled.target_design.host_control_contract.boot_stop_all_contract.status_item_action = 'disabled';
  expectCode(validateM2AuthorityClosure(bootStatusDisabled), 'BOOT_STOP_ALL_CONTRACT_INVALID');

  const reopenReceiptGap = clone(ledger);
  reopenReceiptGap.target_design.host_control_contract.reopen_receipt.required_response_fields.pop();
  expectCode(validateM2AuthorityClosure(reopenReceiptGap), 'HOST_CONTROL_AUTHORITY_INVALID');

  const cliGenerationLie = clone(ledger);
  cliGenerationLie.target_design.operation_cli_contract.forms
    .find(({ id }) => id === 'operation-kill').argv.splice(3, 2);
  expectCode(validateM2AuthorityClosure(cliGenerationLie), 'OPERATION_CLI_CONTRACT_INVALID');

  const tapQueueGap = clone(ledger);
  const tapQueueArgv = tapQueueGap.target_design.operation_cli_contract.forms
    .find(({ id }) => id === 'operation-tap').argv;
  tapQueueArgv.splice(tapQueueArgv.indexOf('--max-queue-items'), 2);
  expectCode(validateM2AuthorityClosure(tapQueueGap), 'OPERATION_CLI_CONTRACT_INVALID');

  for (const boundFlag of [
    '--rate', '--max-items', '--max-bytes', '--max-queue-items', '--sample-every', '--timeout', '--duration-ms',
  ]) {
    const missingTapBound = clone(ledger);
    const argv = missingTapBound.target_design.operation_cli_contract.forms
      .find(({ id }) => id === 'operation-tap').argv;
    argv.splice(argv.indexOf(boundFlag), 2);
    expectCode(validateM2AuthorityClosure(missingTapBound), 'OPERATION_CLI_CONTRACT_INVALID');
  }

  const tapBoundLimits = {
    rate_items_per_second: [1, 60],
    max_items: [1, 10000],
    max_bytes: [1, 10485760],
    max_queue_items: [1, 1024],
    sample_every: [1, 10000],
    idle_timeout_milliseconds: [1, 300000],
    duration_milliseconds: [1, 300000],
  };
  for (const [bound, [, maximum]] of Object.entries(tapBoundLimits)) {
    const missingRuntimeBound = clone(ledger);
    delete missingRuntimeBound.target_design.operation_cli_contract.tap_contract.caller_owned_bounds[bound];
    expectCode(validateM2AuthorityClosure(missingRuntimeBound), 'OPERATION_CLI_CONTRACT_INVALID');

    const zeroRuntimeBound = clone(ledger);
    zeroRuntimeBound.target_design.operation_cli_contract.tap_contract.caller_owned_bounds[bound].minimum = 0;
    expectCode(validateM2AuthorityClosure(zeroRuntimeBound), 'OPERATION_CLI_CONTRACT_INVALID');

    const widenedRuntimeBound = clone(ledger);
    widenedRuntimeBound.target_design.operation_cli_contract.tap_contract.caller_owned_bounds[bound].maximum = maximum + 1;
    expectCode(validateM2AuthorityClosure(widenedRuntimeBound), 'OPERATION_CLI_CONTRACT_INVALID');
  }

  const tapSamplingZero = clone(ledger);
  tapSamplingZero.target_design.operation_cli_contract.tap_contract
    .caller_owned_bounds.sample_every.minimum = 0;
  expectCode(validateM2AuthorityClosure(tapSamplingZero), 'OPERATION_CLI_CONTRACT_INVALID');

  const tapUnboundedDuration = clone(ledger);
  tapUnboundedDuration.target_design.operation_cli_contract.tap_contract
    .caller_owned_bounds.duration_milliseconds.maximum = null;
  expectCode(validateM2AuthorityClosure(tapUnboundedDuration), 'OPERATION_CLI_CONTRACT_INVALID');

  const tapFollowWithoutDuration = clone(ledger);
  const tapFollowArgv = tapFollowWithoutDuration.target_design.operation_cli_contract.forms
    .find(({ id }) => id === 'operation-tap').argv;
  tapFollowArgv.splice(tapFollowArgv.indexOf('--duration-ms'), 2);
  expectCode(validateM2AuthorityClosure(tapFollowWithoutDuration), 'OPERATION_CLI_CONTRACT_INVALID');

  const tapBackpressureLie = clone(ledger);
  tapBackpressureLie.target_design.operation_cli_contract.tap_contract.queue_contract.source_backpressure = true;
  expectCode(validateM2AuthorityClosure(tapBackpressureLie), 'OPERATION_CLI_CONTRACT_INVALID');

  const tapSilentDropLie = clone(ledger);
  tapSilentDropLie.target_design.operation_cli_contract.tap_contract.queue_contract.silent_drop = 'allowed';
  expectCode(validateM2AuthorityClosure(tapSilentDropLie), 'OPERATION_CLI_CONTRACT_INVALID');

  const tapSamplingOrderLie = clone(ledger);
  tapSamplingOrderLie.target_design.operation_cli_contract.tap_contract.sampling_contract
    .ordering = 'rate_limit_then_sample_stride';
  expectCode(validateM2AuthorityClosure(tapSamplingOrderLie), 'OPERATION_CLI_CONTRACT_INVALID');

  const tapExpiryBindingGap = clone(ledger);
  delete tapExpiryBindingGap.target_design.operation_cli_contract.tap_contract.expiry_contract.state_transition_binding;
  expectCode(validateM2AuthorityClosure(tapExpiryBindingGap), 'OPERATION_CLI_CONTRACT_INVALID');

  const tapMachineBoundLie = clone(ledger);
  const tapExpireTransition = tapMachineBoundLie.target_design.tap_state_machine.transitions
    .find(({ from, event }) => from === 'active' && event === 'expire');
  tapExpireTransition.guard_id = 'tap_deadline_reached';
  tapExpireTransition.guard = 'Duration elapsed.';
  tapExpireTransition.trigger = 'deadline';
  expectCode(validateM2AuthorityClosure(tapMachineBoundLie), 'TAP_MACHINE_BINDING_INVALID');

  const v0HashLie = clone(ledger);
  v0HashLie.target_design.external_command_manifest_migration_contract.frozen_predecessor.sha256 = '0'.repeat(64);
  expectCode(validateM2AuthorityClosure(v0HashLie), 'EXTERNAL_MANIFEST_V1_CUTOVER_INVALID');

  const v1WireVersionLie = clone(ledger);
  v1WireVersionLie.target_design.external_command_manifest_migration_contract.successor.aggregate_schema_version = 1;
  expectCode(validateM2AuthorityClosure(v1WireVersionLie), 'EXTERNAL_MANIFEST_V1_CUTOVER_INVALID');

  const dualReaderLie = clone(ledger);
  dualReaderLie.target_design.external_command_manifest_migration_contract.reader_contract.dual_reader = true;
  expectCode(validateM2AuthorityClosure(dualReaderLie), 'EXTERNAL_MANIFEST_V1_CUTOVER_INVALID');

  const registeredTellLie = clone(ledger);
  registeredTellLie.target_design.external_command_manifest_migration_contract.registered_routes[0]
    .source_path = 'manifests/commands/source/external/14-tell.json';
  expectCode(validateM2AuthorityClosure(registeredTellLie), 'EXTERNAL_MANIFEST_V1_CUTOVER_INVALID');

  const registrationFieldGap = clone(ledger);
  registrationFieldGap.target_design.external_command_manifest_migration_contract.successor
    .registration_required_fields.pop();
  expectCode(validateM2AuthorityClosure(registrationFieldGap), 'EXTERNAL_MANIFEST_V1_CUTOVER_INVALID');

  const proofOwnershipLie = clone(ledger);
  proofOwnershipLie.target_design.external_command_manifest_migration_contract.proof_ownership
    .command_surface_fragment = 'docs/dev/test-proof-registry.d/operation-control.json';
  expectCode(validateM2AuthorityClosure(proofOwnershipLie), 'EXTERNAL_MANIFEST_V1_CUTOVER_INVALID');

  const staleBrowserRewrap = clone(ledger);
  staleBrowserRewrap.target_design.external_command_manifest_migration_contract.staging_projection_contract
    .browser_projection.stale_retained_command_rewrap = 'allowed';
  expectCode(validateM2AuthorityClosure(staleBrowserRewrap), 'EXTERNAL_MANIFEST_V1_CUTOVER_INVALID');

  const workRecordV0 = clone(ledger);
  workRecordV0.target_design.external_command_manifest_migration_contract.staging_projection_contract
    .work_record_projection.source_version_requirement = 'v1_or_v2';
  expectCode(validateM2AuthorityClosure(workRecordV0), 'EXTERNAL_MANIFEST_V1_CUTOVER_INVALID');

  const browserStageOwnerGap = clone(ledger);
  browserStageOwnerGap.program_milestones[1].deliverables
    .find(({ id }) => id === 'external_command_manifest_v1_cutover').owner_ref_ids
    .splice(browserStageOwnerGap.program_milestones[1].deliverables
      .find(({ id }) => id === 'external_command_manifest_v1_cutover').owner_ref_ids
      .indexOf('M2.path.scripts_stage_browser_companion_runtime_mjs'), 1);
  expectCode(validateM2AuthorityClosure(browserStageOwnerGap), 'PROOF_ROUTING_REACHABILITY_INVALID');

  const proofIndexReachabilityGap = clone(ledger);
  proofIndexReachabilityGap.program_milestones[1].deliverables
    .find(({ id }) => id === 'external_command_manifest_v1_cutover').owner_ref_ids
    .splice(proofIndexReachabilityGap.program_milestones[1].deliverables
      .find(({ id }) => id === 'external_command_manifest_v1_cutover').owner_ref_ids
      .indexOf('M2.path.docs_dev_test_proof_registry_json'), 1);
  expectCode(validateM2AuthorityClosure(proofIndexReachabilityGap), 'PROOF_ROUTING_REACHABILITY_INVALID');

  const operationFragmentReachabilityGap = clone(ledger);
  operationFragmentReachabilityGap.program_milestones[1].deliverables
    .find(({ id }) => id === 'daemon_ipc_cli_surface').owner_ref_ids
    .splice(operationFragmentReachabilityGap.program_milestones[1].deliverables
      .find(({ id }) => id === 'daemon_ipc_cli_surface').owner_ref_ids
      .indexOf('M2.path.docs_dev_test_proof_registry_d_operation_control_json'), 1);
  expectCode(validateM2AuthorityClosure(operationFragmentReachabilityGap), 'PROOF_ROUTING_REACHABILITY_INVALID');

  const missingCapabilitiesApi = clone(ledger.program_milestones);
  missingCapabilitiesApi[1].path_refs = missingCapabilitiesApi[1].path_refs
    .filter(({ path: ownerPath }) => ownerPath !== 'docs/api/aos-capabilities.md');
  expectCode(validateMilestoneClosure(missingCapabilitiesApi), 'MILESTONE_OWNER_MISSING');

  const missingProofIndex = clone(ledger.program_milestones);
  missingProofIndex[1].deliverables.find(({ id }) => id === 'external_command_manifest_v1_cutover')
    .owner_ref_ids = missingProofIndex[1].deliverables
      .find(({ id }) => id === 'external_command_manifest_v1_cutover').owner_ref_ids
      .filter((id) => id !== 'M2.path.docs_dev_test_proof_registry_json');
  expectCode(validateMilestoneClosure(missingProofIndex), 'MILESTONE_OWNER_UNCLAIMED');

  const missingWorkflowProof = clone(ledger.program_milestones);
  missingWorkflowProof[1].deliverables.find(({ id }) => id === 'external_command_manifest_v1_cutover')
    .proof_ref_ids = missingWorkflowProof[1].deliverables
      .find(({ id }) => id === 'external_command_manifest_v1_cutover').proof_ref_ids
      .filter((id) => id !== 'M2.proof.tests_dev_workflow_router_sh');
  expectCode(validateMilestoneClosure(missingWorkflowProof), 'MILESTONE_PROOF_UNCLAIMED');

  const duplicate = clone(ledger.target_design.operation_state_machine);
  duplicate.transitions.push({ ...duplicate.transitions[0], to: 'terminal' });
  expectCode(validateGraph(duplicate), 'TRANSITION_EVENT_DUPLICATE');

  const unbound = clone(ledger);
  unbound.flagship_workflow.outcome_bindings.pop();
  expectCode(validateOutcomeCoverage(unbound), 'OUTCOME_UNBOUND');

  const wrongTo = clone(ledger);
  wrongTo.flagship_workflow.outcome_bindings[0].emissions[0].transition_ref.to = 'active';
  expectCode(validateOutcomeCoverage(wrongTo), 'OUTCOME_TRANSITION_TO_MISMATCH');

  const wrongPhase = clone(ledger);
  wrongPhase.flagship_workflow.outcome_bindings[0].emissions[0].authority_phase = 'pre_authority';
  expectCode(validateOutcomeCoverage(wrongPhase), 'OUTCOME_AUTHORITY_PHASE_INVALID');

  const badCleanup = clone(ledger);
  const badPath = badCleanup.flagship_workflow.execution_paths.find(({ id }) => id === 'artifact_validation_recovery');
  badPath.steps = badPath.steps.filter(({ transition_ref: ref }) => !(ref.machine === 'artifact' && ref.event === 'absence_verified'));
  expectCode(validateOutcomeCoverage(badCleanup), 'ARTIFACT_VALIDATION_PATH_INVALID');

  const earlyParentTermination = clone(ledger);
  const earlyPath = earlyParentTermination.flagship_workflow.execution_paths
    .find(({ id }) => id === 'post_authority_active_validated_custody');
  const cleanIndex = earlyPath.steps.findIndex(({ transition_ref: ref }) => ref.machine === 'operation' && ref.event === 'clean');
  const [cleanStep] = earlyPath.steps.splice(cleanIndex, 1);
  earlyPath.steps.splice(2, 0, cleanStep);
  expectCode(validateOutcomeCoverage(earlyParentTermination), 'EXECUTION_PATH_OPERATION_TERMINATED_EARLY');

  const tapCleanupAfterParent = clone(ledger);
  const tapAfterParentPath = tapCleanupAfterParent.flagship_workflow.execution_paths
    .find(({ id }) => id === 'post_authority_active_validated_custody');
  tapAfterParentPath.entry_states.tap = 'cleanup_required';
  tapAfterParentPath.final_state_vector.tap = 'terminal';
  const parentCleanIndex = tapAfterParentPath.steps.findIndex(({ transition_ref: ref }) => (
    ref.machine === 'operation' && ref.event === 'clean'
  ));
  tapAfterParentPath.steps.splice(parentCleanIndex + 1, 0,
    {
      transition_ref: { machine: 'tap', from: 'cleanup_required', event: 'recover', to: 'recovering' },
      disposition: 'Synthetic mutation places tap cleanup after parent termination.',
    },
    {
      transition_ref: { machine: 'tap', from: 'recovering', event: 'recovered', to: 'terminal' },
      disposition: 'Synthetic mutation completes the tap too late to justify parent termination.',
    });
  expectCode(validateOutcomeCoverage(tapCleanupAfterParent), 'EXECUTION_PATH_OPERATION_TERMINATED_EARLY');

  const wrongWorkflowSource = clone(ledger);
  wrongWorkflowSource.flagship_workflow.outcome_bindings
    .find(({ id }) => id === 'ARTIFACT_CLEANUP_FAILED').emissions
    .find(({ transition_ref: ref }) => ref.from === 'offered').workflow_source_state = 'stopping';
  expectCode(validateOutcomeCoverage(wrongWorkflowSource), 'OUTCOME_WORKFLOW_SOURCE_STATE_MISMATCH');

  const reusedTransientPath = clone(ledger);
  reusedTransientPath.flagship_workflow.outcome_bindings
    .find(({ id }) => id === 'ARTIFACT_CLEANUP_FAILED').emissions
    .find(({ transition_ref: ref }) => ref.from === 'retained').execution_path_id = 'artifact_cleanup_unresolved_transient';
  expectCode(validateOutcomeCoverage(reusedTransientPath), 'OUTCOME_EXECUTION_PATH_INCOMPATIBLE');

  const unjustifiedCorruption = clone(ledger);
  const corruptionPath = unjustifiedCorruption.flagship_workflow.execution_paths
    .find(({ id }) => id === 'artifact_cleanup_unresolved_transient');
  corruptionPath.steps[1].transition_ref = {
    machine: 'recovery', from: 'scanning', event: 'corruption_found', to: 'cleanup_required',
  };
  corruptionPath.steps.splice(2, 1);
  expectCode(validateOutcomeCoverage(unjustifiedCorruption), 'ARTIFACT_CLEANUP_CORRUPTION_UNJUSTIFIED');

  const undrainedTerminalChild = clone(ledger);
  const undrainedPath = undrainedTerminalChild.flagship_workflow.execution_paths
    .find(({ id }) => id === 'post_authority_active_validated_custody');
  undrainedPath.steps = undrainedPath.steps.filter(({ transition_ref: ref }) => (
    !(ref.machine === 'stream' && ref.event === 'drained')
  ));
  undrainedPath.final_state_vector.stream = 'stopping';
  expectCode(validateOutcomeCoverage(undrainedTerminalChild), 'TERMINAL_OPERATION_CHILD_OPEN');

  const openOperationAtWorkflowTerminal = clone(ledger);
  const openOperationPath = openOperationAtWorkflowTerminal.flagship_workflow.execution_paths
    .find(({ id }) => id === 'post_authority_active_validated_custody');
  openOperationPath.steps = openOperationPath.steps.filter(({ transition_ref: ref }) => (
    !(ref.machine === 'operation' && ref.event === 'clean')
  ));
  openOperationPath.final_state_vector.operation = 'stopping';
  expectCode(validateOutcomeCoverage(openOperationAtWorkflowTerminal), 'POST_AUTHORITY_TERMINAL_OPERATION_OPEN');

  const ownerMissing = clone(ledger.program_milestones);
  ownerMissing[1].deliverables[0].owner_ref_ids[0] = 'M2.path.missing_owner';
  expectCode(validateMilestoneClosure(ownerMissing), 'MILESTONE_OWNER_MISSING');

  const reachabilityLie = clone(ledger);
  reachabilityLie.capabilities[0].current.exposure.typescript_sdk.reachability = 'internal_only';
  expectCode(validateExposureReachability(reachabilityLie), 'TS_INTERNAL_ONLY_FORBIDDEN');

  const missingToolkitDevtools = clone(ledger);
  missingToolkitDevtools.capabilities.find(({ id }) => id === 'desktopworld-scene')
    .current.exposure.toolkit.export_bindings.pop();
  expectCode(validatePackageSurfaceSnapshot(missingToolkitDevtools), 'PACKAGE_SURFACE_SNAPSHOT_MISMATCH');
  expectCode(await validateCurrentPathTruth(missingToolkitDevtools), 'COMPLETE_PACKAGE_SURFACE_NOT_CLOSED');

  const reboundStatus = clone(ledger);
  const statusBinding = reboundStatus.capabilities.find(({ id }) => id === 'native-status-item')
    .current.exposure.typescript_sdk.export_bindings[0];
  Object.assign(statusBinding, {
    subpath: './scene',
    runtime_entry: 'packages/toolkit/scene/index.js',
    types_entry: 'packages/toolkit/scene/index.d.ts',
  });
  expectCode(validatePackageSurfaceSnapshot(reboundStatus), 'PACKAGE_SURFACE_SNAPSHOT_MISMATCH');

  const coordinatedSdkIdentityLie = clone(ledger);
  const macosEvidence = coordinatedSdkIdentityLie.platform_evidence_sources
    .find(({ id }) => id === 'apple-macosx-26.5');
  macosEvidence.id = 'apple-macosx-26.5-coordinated-lie';
  macosEvidence.platform = 'ios';
  for (const row of coordinatedSdkIdentityLie.capabilities) for (const item of row.current.platform.api_symbols) {
    if (item.availability.evidence_source_id === 'apple-macosx-26.5') {
      item.availability.evidence_source_id = macosEvidence.id;
      item.availability.platform = 'ios';
    }
  }
  expectCode(validatePlatformEvidenceSourceIdentity(coordinatedSdkIdentityLie), 'PLATFORM_EVIDENCE_SOURCE_IDENTITY_MISMATCH');

  const proofLie = clone(ledger);
  proofLie.capabilities[0].current.proof.static[0].execution_class = 'native_live';
  expectCode(validateProofAttribution(proofLie), 'PROOF_LANE_MISMATCH');

  const ambiguousRoute = clone(ledger);
  ambiguousRoute.capabilities.find(({ id }) => id === 'canvas-wkwebview')
    .current.exposure.cli.bindings.find(({ form_id: id }) => id === 'do-click')
    .route_selectors[0].when = null;
  expectCode(await validateCliReverseClosure(ambiguousRoute), 'AMBIGUOUS_ROUTE_SELECTOR_EMPTY');
});

test('machine structure, deterministic transitions, taxonomy, and status classification are exact', async () => {
  const ledger = await json(ledgerRelativePath);
  const actual = Object.fromEntries(machinesFromLedger(ledger).filter(({ id }) => id !== ledger.flagship_workflow.id).map((machine) => [
    machine.id,
    {
      machine_kind: machine.machine_kind,
      state_count: machine.states.length,
      transition_count: machine.transitions.length,
      terminal_states: machine.terminal_states,
      quiescent_states: machine.quiescent_states,
    },
  ]));
  assert.deepEqual(actual, expectedMachineCounts);
  assert.deepEqual(ledger.target_design.terminal_taxonomy, expectedTerminalTaxonomy);
  const operation = ledger.target_design.operation_state_machine;
  assert.equal(operation.transitions.filter(({ from, event }) => from === 'starting' && event === 'peer_lost').length, 1);
  assert.equal(operation.transitions.filter(({ from, event }) => from === 'starting' && event === 'transport_lost').length, 1);
  expectNoErrors(validateM2AuthorityClosure(ledger));
  const transaction = ledger.target_design.claim_set_transaction_state_machine;
  const claim = ledger.target_design.resource_claim_state_machine;
  const broker = ledger.target_design.multiplex_broker_state_machine;
  assert.ok(transaction.transitions.some(({ from, event, to }) => from === 'reserving' && event === 'commit_all' && to === 'committed'));
  assert.ok(transaction.transitions.some(({ from, event, to }) => from === 'reserving' && event === 'conflict' && to === 'rolling_back'));
  assert.ok(claim.transitions.some(({ from, event, to }) => from === 'active' && event === 'release_nonlast_subscriber' && to === 'terminal'));
  assert.ok(broker.transitions.some(({ from, event, to }) => from === 'active' && event === 'subscriber_detached_nonlast' && to === 'active'));
  assert.deepEqual(broker.transitions.filter(({ event }) => event === 'host_stop').map(({ from }) => from),
    broker.states.filter((state) => !broker.terminal_states.includes(state)));
  assert.equal(ledger.target_design.resource_claim_contract.claim_set.failure_result, 'rollback_all_retain_none');
  assert.equal(ledger.target_design.resource_claim_contract.voice_transport_resource_policy.implicit_barge_in_preemption, 'forbidden');
  const host = ledger.target_design.host_control_contract;
  assert.equal(host.admission_model, 'live_per_request_predicate');
  assert.equal(host.surfaces.find(({ surface }) => surface === 'status_item').peer_context, 'status_item_host');
  assert.deepEqual(
    host.caller_origins.find(({ origin }) => origin === 'status_item_host').allowed_actions,
    ['stop_all', 'reopen'],
  );
  assert.equal(host.surfaces.find(({ surface }) => surface === 'status_item').fallback, 'typed_host_control_rejection');
  assert.equal(host.surfaces.find(({ surface }) => surface === 'canvas').fallback, 'display_only');
  assert.equal(host.registered_operation_plane_scope.unadapted_legacy_capability_control, 'not_claimed');
  assert.equal(host.request_contract.daemon_generation_binding, 'attached_after_same_socket_bootstrap_for_the_current_connection_epoch');
  const status = ledger.target_design.status_item_contract;
  assert.deepEqual(status.adapter_status_indicator_registry, expectedStatusIndicatorRegistry);
  assert.deepEqual(status.projection_fields.find(({ field }) => field === 'status_indicator_class'), {
    field: 'status_indicator_class', provenance: 'mechanical',
  });
  assert.deepEqual(status.recording_indicator.red_states, ['active']);
  assert.match(status.recording_indicator.immutable_rule, /adapter registry.+requests.+labels.+cannot set or change/iu);
  assert.match(status.recording_indicator.clear_guard, /no.+recording operation is active/iu);
  assert.equal(status.action_origin_authentication.grants_control, false);
  assert.match(status.control_routes.ordinary, /owner set/u);
  assert.match(status.control_routes.host_wide, /daemon-owned status host.+exact daemon\/status-host generation.+effective UID/isu);
});

test('M1 through M10 normalized subsets, gates, dependencies, and command atomicity are exact', async () => {
  const milestones = (await json(ledgerRelativePath)).program_milestones;
  assert.deepEqual(milestones.map((m) => ({
    id: m.id, ordinal: m.ordinal, depends_on: m.depends_on,
    deliverable_ids: m.deliverables.map(({ id }) => id),
    gate_ids: m.exit_gates.map(({ id }) => id),
    path_count: m.path_refs.length, proof_count: m.proof_paths.length,
  })), expectedMilestoneShape);
  for (const milestone of milestones.filter(({ id }) => ['M2', 'M3', 'M7', 'M8'].includes(id))) {
    const refs = new Map(milestone.path_refs.map(({ id, path: ownerPath }) => [id, ownerPath]));
    const actualOwners = Object.fromEntries(milestone.deliverables.map((deliverable) => [
      deliverable.id, deliverable.owner_ref_ids.map((id) => refs.get(id)),
    ]));
    assert.deepEqual(actualOwners, expectedCriticalMilestoneOwners[milestone.id]);
  }
  assert.equal(milestones.flatMap(({ deliverables }) => deliverables).length, 90);
  assert.equal(milestones.flatMap(({ exit_gates: gates }) => gates).length, 58);
  assert.deepEqual(milestones[6].proof_paths.map(({ case_id: id }) => id), [null, null, 'playwright', 'opencli', 'ffmpeg']);
  assert.deepEqual(milestones[7].proof_paths.map(({ case_id: id }) => id), [null, null, 'playwright', 'opencli', 'ffmpeg']);
});

test('M4 authority stays AX-only, production-owned, non-circular, and behaviorally provable', async () => {
  const ledger = await json(ledgerRelativePath);
  const m4 = ledger.program_milestones.find(({ id }) => id === 'M4');
  assert.ok(m4);
  assert.deepEqual(m4.path_refs.map(({ path: ownerPath, kind }) => [ownerPath, kind]), [
    ['docs/adr/0045-complete-ax-observation-notification-and-coordinate-contract.md', 'current'],
    ['src/perceive/', 'current'],
    ['src/act/', 'current'],
    ['manifests/commands/source/aos/43-ax-complete.json', 'proposed'],
    ['manifests/commands/source/external/51-ax-complete.json', 'proposed'],
    ['manifests/commands/aos-commands.json', 'generated'],
    ['manifests/commands/aos-external-commands.json', 'generated'],
    ['docs/api/aos.md', 'current'],
  ]);
  assert.deepEqual(m4.proof_paths.map(({ path: proofPath, kind, execution_class: executionClass }) => (
    [proofPath, kind, executionClass]
  )), [
    ['tests/m4-ax-contract-foundation.test.mjs', 'current', 'static'],
    ['tests/ax-complete-surface.test.mjs', 'proposed', 'fake'],
  ]);
  assert.ok(m4.exit_gates.every(({ proof_ref_ids: proofRefs }) => proofRefs.length > 0));
  assert.ok(m4.exit_gates.filter(({ id }) => id !== 'authority_contract_frozen')
    .every(({ proof_ref_ids: proofRefs }) => proofRefs.includes('M4.proof.tests_ax_complete_surface_test_mjs')));
  assert.deepEqual(
    m4.exit_gates.find(({ id }) => id === 'coordinate_identity_bound').prerequisite_gate_refs,
    ['M3.geometry_reobserved_and_bound'],
  );
  assert.match(
    m4.exit_gates.find(({ id }) => id === 'coordinate_identity_bound').criterion,
    /no fictional SCK generation or platform identity/u,
  );
  const targetMilestones = new Map(ledger.capabilities.map(({ id, target }) => [id, target.milestone]));
  assert.equal(targetMilestones.get('display-topology-observation'), 'M4');
  for (const id of ['app-lifecycle-control', 'window-menu-lifecycle-control', 'coregraphics-input-posting']) {
    assert.equal(targetMilestones.get(id), 'M6', id);
  }
  assert.match(m4.later_dependencies.join('\n'), /M5 may project.+does not own the AXObserver resource/isu);
  assert.match(m4.later_dependencies.join('\n'), /M6 owns maintained TypeScript\/Python SDK parity/iu);
  assert.match(m4.later_dependencies.join('\n'), /M10 owns live native, TCC, packaging, and release acceptance/iu);
});

test('flagship exact transition emissions cover failures, cleanup, and atomic follow rebind', async () => {
  const ledger = await json(ledgerRelativePath);
  const workflow = ledger.flagship_workflow;
  assert.equal(workflow.states.length, 14);
  assert.equal(workflow.transitions.length, 31);
  assert.equal(workflow.outcomes.length, 27);
  assert.equal(workflow.outcome_bindings.length, 27);
  assert.deepEqual(workflow.execution_paths.map(({ id }) => id), [
    'pre_surface_selection_clean',
    'pre_target_stale_clean',
    'pre_center_failure_clean',
    'pre_reobservation_failure_clean',
    'pre_geometry_failure_clean',
    'pre_preparation_rejected_clean',
    'post_authority_starting_validated_custody',
    'post_authority_active_validated_custody',
    'artifact_validation_recovery',
    'artifact_cleanup_unresolved_transient',
    'artifact_cleanup_unresolved_offered',
    'artifact_cleanup_unresolved_retained',
  ]);
  assert.equal(workflow.forbidden_primitive, 'record-video-element');
  assert.deepEqual(workflow.branches.map(({ id }) => id), ['native_ax', 'managed_dom']);
  assert.ok(workflow.transitions.some(({ from, event, to }) => from === 'active' && event === 'follow_update_accepted' && to === 'active'));
  assert.ok(workflow.transitions.some(({ from, event, to }) => from === 'stopping' && event === 'cleanup_resolved_without_offer' && to === 'terminal'));
  const validation = workflow.outcome_bindings.find(({ id }) => id === 'ARTIFACT_VALIDATION_FAILED');
  assert.deepEqual(validation.emissions[0].transition_ref, {
    machine: 'artifact', from: 'transient', event: 'validation_failed', to: 'cleanup_required',
  });
  const cleanup = workflow.outcome_bindings.find(({ id }) => id === 'ARTIFACT_CLEANUP_FAILED');
  assert.ok(cleanup.emissions.every(({ destination }) => destination.terminal === false));
  assert.deepEqual(cleanup.emissions.map(({ transition_ref: { from }, workflow_source_state, execution_path_id }) => ({
    from, workflow_source_state, execution_path_id,
  })), [
    { from: 'transient', workflow_source_state: 'stopping', execution_path_id: 'artifact_cleanup_unresolved_transient' },
    { from: 'offered', workflow_source_state: 'artifact_offered', execution_path_id: 'artifact_cleanup_unresolved_offered' },
    { from: 'retained', workflow_source_state: 'artifact_retained', execution_path_id: 'artifact_cleanup_unresolved_retained' },
  ]);
  assert.match(workflow.same_identity_movement_rule, /immutable target identity/u);
  assert.match(workflow.same_identity_movement_rule, /discontinuity stops/u);
});

test('authored CLI route tuples reverse-close functional and fail-closed selectors', async () => {
  const ledger = await json(ledgerRelativePath);
  expectNoErrors(await validateCliReverseClosure(ledger));
  assert.equal(ledger.capabilities.flatMap((row) => row.current.exposure.cli.bindings).length, 103);
  assert.equal(ledger.capabilities.flatMap((row) => row.current.exposure.cli.bindings.flatMap((binding) => binding.route_selectors)).length, 109);
  assert.equal(ledger.coverage.fail_closed_cli_routes.length, 6);
});


test('TypeScript and Toolkit reachability closes actual package exports', async () => {
  const ledger = await json(ledgerRelativePath);
  expectNoErrors(validateExposureReachability(ledger));
  expectNoErrors(validatePackageSurfaceSnapshot(ledger));
  expectNoErrors(await validateCurrentPathTruth(ledger));
  assert.deepEqual(packageSurfaceSnapshot(ledger), expectedPackageSurfaceSnapshot);
  const rows = byId(ledger);
  const expected = {
    'display-topology-observation': ['partial', 'package_export', 'partial', 'package_export'],
    'focus-window-display-events': ['absent', 'none', 'partial', 'internal_only'],
    'coregraphics-input-posting': ['absent', 'none', 'absent', 'none'],
    'global-input-event-observation': ['absent', 'none', 'partial', 'internal_only'],
    'desktop-pixel-still-capture': ['absent', 'none', 'partial', 'internal_only'],
    'clipboard-plain-text': ['absent', 'none', 'partial', 'internal_only'],
    'native-status-item': ['complete', 'package_export', 'complete', 'package_export'],
    'operator-annotation-selection': ['absent', 'none', 'partial', 'internal_only'],
    'canvas-wkwebview': ['partial', 'package_export', 'partial', 'package_export'],
    'canvas-host-action-bus': ['absent', 'none', 'partial', 'internal_only'],
    'desktopworld-scene': ['complete', 'package_export', 'complete', 'package_export'],
    'managed-playwright-runtime': ['absent', 'none', 'partial', 'internal_only'],
  };
  for (const [id, values] of Object.entries(expected)) {
    const row = rows.get(id);
    assert.deepEqual([
      row.current.exposure.typescript_sdk.state, row.current.exposure.typescript_sdk.reachability,
      row.current.exposure.toolkit.state, row.current.exposure.toolkit.reachability,
    ], values, id);
  }
  const scene = rows.get('desktopworld-scene').current.exposure.typescript_sdk;
  assert.deepEqual(scene.export_bindings.map(({ subpath }) => subpath), [
    './scene', './scene/authoring', './scene/runtime', './scene/extensions', './scene/devtools',
  ]);
  assert.ok(scene.export_bindings.every(({ binding_scope: scope, symbols }) => scope === 'complete_entrypoint' && symbols.length === 0));
  assert.equal(rows.get('native-status-item').current.exposure.toolkit.export_bindings[0].binding_scope, 'complete_entrypoint');
});

test('portable per-symbol availability catalog is exact and SDK-relative', async () => {
  const ledger = await json(ledgerRelativePath);
  const actual = ledger.capabilities.flatMap((row) => row.current.platform.api_symbols.map((item) => [
    row.id, item.name, item.framework, item.required,
    item.availability.state, item.availability.platform, item.availability.introduced,
    item.availability.evidence_kind, item.availability.evidence_source_id, item.availability.evidence_locator,
  ]));
  assert.deepEqual(actual, expectedAvailabilityCatalog);
  assert.equal(actual.length, 96);
  const totals = Object.fromEntries(Object.keys(expectedAvailabilityStateTotals).map((state) => [
    state, actual.filter((item) => item[4] === state).length,
  ]));
  assert.deepEqual(totals, expectedAvailabilityStateTotals);
  assert.deepEqual(ledger.platform_evidence_sources, expectedPlatformEvidenceSources);
  expectNoErrors(validatePlatformEvidenceSourceIdentity(ledger));
  const evidenceSources = new Map(ledger.platform_evidence_sources.map((source) => [source.id, source]));
  for (const row of ledger.capabilities) {
    const required = row.current.platform.api_symbols.filter(({ required: isRequired }) => isRequired);
    const canDerive = required.length > 0
      && required.every(({ availability }) => availability.state === 'known')
      && new Set(required.map(({ availability }) => availability.platform)).size === 1;
    assert.equal(row.current.platform.derived_floor !== null, canDerive, row.id);
    if (canDerive) {
      const compareVersions = (left, right) => {
        const leftParts = left.split('.').map(Number);
        const rightParts = right.split('.').map(Number);
        for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
          const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
          if (difference !== 0) return difference;
        }
        return 0;
      };
      const introduced = required.map(({ availability }) => availability.introduced).sort(compareVersions).at(-1);
      assert.deepEqual(row.current.platform.derived_floor, {
        platform: required[0].availability.platform,
        introduced,
        derivation: 'maximum introduced version across all required known symbols on one platform',
      }, row.id);
    }
    const names = new Set(row.current.platform.api_symbols.map(({ name }) => name));
    for (const check of row.current.platform.tcc.checks) assert.ok(names.has(check), row.id + ':' + check);
    for (const item of row.current.platform.api_symbols) {
      const availability = item.availability;
      if (availability.evidence_kind === 'sdk_header') {
        const source = evidenceSources.get(availability.evidence_source_id);
        assert.ok(source, row.id + ':' + item.name);
        assert.equal(source.platform, availability.platform, row.id + ':' + item.name);
        assert.ok(!path.posix.isAbsolute(availability.evidence_locator));
        assert.ok(!availability.evidence_locator.split('/').includes('..'));
      } else {
        assert.equal(availability.evidence_source_id, null);
      }
    }
  }
  const rows = byId(ledger);
  assertKnown(rows.get('coregraphics-input-posting'), 'CGEventCreate', '10.4');
  assertKnown(rows.get('coregraphics-input-posting'), 'CGEventPost', '10.4');
  assertKnown(rows.get('coregraphics-input-posting'), 'CGPreflightPostEventAccess', '10.15');
  assertKnown(rows.get('global-input-event-observation'), 'CGEventTapCreate', '10.4');
  assertKnown(rows.get('global-input-event-observation'), 'CGPreflightListenEventAccess', '10.15');
  assertKnown(rows.get('desktop-pixel-still-capture'), 'CGPreflightScreenCaptureAccess', '10.15');
  assertKnown(rows.get('screencapturekit-screen-video'), 'SCStream', '12.3');
  assertKnown(rows.get('screencapturekit-system-audio'), 'SCStreamOutputType.audio', '13.0');
  assertKnown(rows.get('screencapturekit-microphone-recording-output'), 'SCRecordingOutput', '15.0');
  assertKnown(rows.get('microphone-capture-adapter'), 'AVAudioEngine', '10.10');
  assertKnown(rows.get('microphone-capture-adapter'), 'AVCaptureDevice.authorizationStatus', '10.14');
  assertKnown(rows.get('canvas-wkwebview'), 'WKWebView', '10.10');
  assertKnown(rows.get('canvas-wkwebview'), 'WKURLSchemeHandler', '10.13');
  assertKnown(rows.get('iohid-device-apis'), 'IOHIDManagerCreate', '10.5');
  assertKnown(rows.get('driverkit-virtual-hid'), 'IOUserHIDDevice', '19.0', 'driverkit');
  assertKnown(rows.get('display-topology-observation'), 'ColorSyncDeviceCopyDeviceInfo', '10.4');
});

test('all tracked paths classify and named-family production/privilege scans are bounded', async () => {
  const ledger = await json(ledgerRelativePath);
  const inventory = await productionSources();
  expectNoErrors(inventory.errors);
  assert.equal(inventory.classifications.size, gitInventory().length);
  for (const requiredPath of [
    'src/platform/descriptor-relative-fs-addon.cc',
    'shared/swift/ipc/event-stream.swift',
    'scripts/aos-content-scope.sh',
    'scripts/aos-wiki-graph.py',
    'scripts/agent-handoff',
  ]) assert.ok(inventory.sources.has(requiredPath), requiredPath);
  const excludedRepresentatives = {
    'tests/schemas/aos-privileged-capability-ledger-v1.test.mjs': 'test',
    'tests/browser/fixtures/playwright-cli': 'fixture',
    'docs/AGENTS.md': 'docs',
    'shared/schemas/aos-privileged-capability-ledger-v1.schema.json': 'schema',
    'manifests/commands/aos-commands.json': 'generated',
    'packages/toolkit/runtime/input-event-validator.generated.js': 'generated',
    'packages/toolkit/package.json': 'data',
    'packages/toolkit/adapters/zag/vendor/menu-runtime-entry.js': 'vendor',
  };
  for (const [relativePath, classification] of Object.entries(excludedRepresentatives)) {
    assert.equal(inventory.classifications.get(relativePath), classification, relativePath);
    assert.ok(!inventory.searchable.has(relativePath), relativePath);
  }
  assert.equal(inventory.classifications.get('packaging/Info.plist'), 'privilege_metadata');
  assert.equal(inventory.classifications.get('packaging/aos.entitlements'), 'privilege_metadata');
  assert.equal(inventory.classifications.get('manifests/companions/playwright-cli-v1.json'), 'managed_descriptor');
  assert.ok(inventory.searchable.has('packaging/Info.plist'));
  assert.ok(inventory.searchable.has('packaging/aos.entitlements'));
  assert.ok(inventory.searchable.has('manifests/companions/playwright-cli-v1.json'));
  assert.deepEqual(Object.fromEntries(Object.entries(ledger.coverage.source_disposition_by_capability).map(([id, value]) => [
    id, {
      disposition: value.disposition,
      source_probes: value.source_probes,
      named_absent_symbols: value.named_absent_symbols,
      ...(value.private_family_pattern_ids ? { private_family_pattern_ids: value.private_family_pattern_ids } : {}),
    },
  ])), expectedSourceDisposition);
  const rows = byId(ledger);
  for (const [id, disposition] of Object.entries(ledger.coverage.source_disposition_by_capability)) {
    const row = rows.get(id);
    if (['implemented', 'partial'].includes(row.current.implementation.state)) assert.equal(disposition.disposition, 'positive', id);
    if (disposition.disposition === 'positive') {
      for (const probe of disposition.source_probes) {
        const body = inventory.searchable.get(probe.path);
        assert.ok(body, id + ':' + probe.path);
        for (const marker of probe.markers) assert.ok(body.includes(marker), id + ':' + marker);
        assertProbeOwnership(row, probe);
      }
    } else if (disposition.disposition === 'private_unverified') {
      for (const patternId of disposition.private_family_pattern_ids) {
        const pattern = privateFamilyPatterns.get(patternId);
        assert.ok(pattern, id + ':' + patternId);
        for (const [relativePath, body] of inventory.searchable) {
          assert.doesNotMatch(body, pattern, id + ':' + patternId + ':' + relativePath);
        }
      }
    } else {
      for (const symbolName of disposition.named_absent_symbols) {
        const pattern = absentPattern(symbolName);
        for (const [relativePath, body] of inventory.searchable) {
          assert.doesNotMatch(body, pattern, id + ':' + symbolName + ':' + relativePath);
        }
      }
    }
  }
  assert.throws(() => assertProbeOwnership(rows.get('managed-playwright-runtime'), {
    path: 'manifests/companions/playwright-cli-v1.json',
    classification: 'unsupported',
  }), /unsupported probe classification/u);
  assert.equal(classifyTrackedPath('brand-new/root/probe.swift', { binary: false, symlink: false, executable: false }).classification, 'production_source');
  assert.equal(classifyTrackedPath('brand-new/root/huge.swift', { binary: false, symlink: false, executable: false, size: 3 * 1024 * 1024 }).classification, 'production_source');
  assert.equal(classifyTrackedPath('brand-new/root/tool', { binary: false, symlink: false, executable: true, readable_shebang: true }).classification, 'production_source');
  assert.equal(classifyTrackedPath('brand-new/root/link.swift', { binary: false, symlink: true, resolved_regular: true }).classification, 'production_source');
  assert.equal(classifyTrackedPath('brand-new/root/binary.swift', { binary: true, symlink: false }).error.code, 'SOURCE_BINARY');
  assert.equal(classifyTrackedPath('brand-new/root/tool', { binary: false, symlink: false, executable: true, readable_shebang: false }).error.code, 'EXECUTABLE_SHEBANG_UNREADABLE');
  assert.equal(classifyTrackedPath('brand-new/root/link.swift', { binary: false, symlink: true, resolved_regular: false }).error.code, 'SOURCE_SYMLINK_UNRESOLVED');
  assert.equal(classifyTrackedPath('brand-new/root/image.svg', { binary: true, symlink: false }).classification, 'binary');
  assert.equal(classifyTrackedPath('brand-new/root/client.generated.js', { binary: false, symlink: false, executable: false }).classification, 'generated');
  const privateSyntheticSources = new Map([
    ['private_hid_event_system_client_calls', 'IOHIDEventSystemClientCreate(kCFAllocatorDefault);'],
    ['private_hid_service_client_calls', 'IOHIDServiceClientCopyProperty(service, key);'],
    ['private_windowserver_cgs_calls', 'CGSSetWorkspace(connection, workspace);'],
    ['private_windowserver_sls_calls', 'SLSCopyManagedDisplaySpaces(connection);'],
  ]);
  for (const [patternId, source] of privateSyntheticSources) {
    assert.match(source, privateFamilyPatterns.get(patternId), patternId);
  }
});

test('screen recording proof owns followed geometry, optional audio tracks, custody, and public reachability', async () => {
  const ledger = await json(ledgerRelativePath);
  const rows = byId(ledger);
  const row = rows.get('screencapturekit-screen-video');
  const [pixelSource, adapter, encoder, microphoneSession] = await Promise.all([
    read('src/daemon/desktop-pixel-native.swift'),
    read('src/daemon/screen-recording-operation-adapter.swift'),
    read('src/daemon/screen-recording-encoder.swift'),
    read('src/daemon/microphone-native-session.swift'),
  ]);
  assert.match(pixelSource, /configuration\.capturesAudio\s*=\s*false/u);
  assert.match(adapter, /configuration\.capturesAudio\s*=\s*request\.tracks\.systemAudio/u);
  assert.match(adapter, /addStreamOutput\(\s*output,\s*type:\s*\.screen,/su);
  assert.match(adapter, /addStreamOutput\(\s*output,\s*type:\s*\.audio,/su);
  assert.match(encoder, /AVVideoCodecKey:\s*AVVideoCodecType\.h264/u);
  assert.match(encoder, /AVFormatIDKey:\s*kAudioFormatMPEG4AAC/u);
  assert.match(encoder, /writer\.startSession\(atSourceTime:/u);
  assert.match(adapter, /AOSMicrophoneOperationResourceIdentity\.resourceKey/u);
  assert.match(adapter, /AOSMicrophoneNativeSessionControlling/u);
  assert.match(microphoneSession, /AVAudioEngine\(\)/u);
  assert.doesNotMatch(adapter, /SCRecordingOutput|captureMicrophone/u);
  assert.deepEqual(row.current.observation.roots, ['one canonical display-topology observation']);
  assert.deepEqual(row.current.observation.targets, [
    'one fixed display, exact window, fixed region, or caller-followed region wholly within one display and its bound source window',
  ]);
  assert.deepEqual(row.current.data_transport.transports, [
    'private in-process CMSampleBuffer delivery',
    'transient H.264 plus optional AAC-LC QuickTime artifact',
  ]);
  assert.equal(row.current.exposure.cli.state, 'complete');
  assert.equal(row.current.exposure.ipc.state, 'complete');
  assert.equal(row.current.control.artifacts.state, 'partial');
  const fakeProof = row.current.proof.fake.find(({ path: proofPath }) => proofPath === 'tests/screen-recording-fake.test.mjs');
  assert.match(fakeProof.claim, /production AOSOperationControlPlane cancel\/kill path/u);
  assert.match(fakeProof.claim, /twelve exact public stop cases/u);
  assert.match(fakeProof.claim, /immediately after first durable prepared publication but before provisional owner insertion/u);
  assert.match(fakeProof.claim, /prepared-call blocking until the owner exists/u);
  assert.match(fakeProof.claim, /zero runtime start handoffs, broker acquisitions, native starts, and native stops/u);
  assert.match(fakeProof.claim, /blocked durable stop-save case proves bounded startup return/u);
  assert.match(fakeProof.claim, /Consecutive preparation-and-cleanup save failure/u);
  assert.match(fakeProof.claim, /waiting-public-stop\/preparation-failure crossing/u);
  assert.match(fakeProof.claim, /post-admission stopped-geometry save failure/u);
  assert.match(fakeProof.claim, /Injected durable save failures across every later stream, artifact, claim-set, claim, and starting transition/u);
  assert.match(fakeProof.claim, /failed-admission no-effect/u);
  const publicStopTransitions = ledger.flagship_workflow.transitions.filter(({ event }) => ['cancel', 'kill'].includes(event));
  assert.equal(publicStopTransitions.length, 4);
  for (const transition of publicStopTransitions) {
    assert.match(transition.guard, /adapter lifecycle owner invokes one durable stop-admission transaction/u);
    assert.match(transition.guard, /failed admission has no stop effect/u);
  }
  assert.match(row.current.proof.limitations, /compiled production-owner seam harness/u);
  assert.match(row.current.proof.limitations, /AVAssetWriter and ScreenCaptureKit do not execute/u);
  assert.match(row.current.proof.limitations, /no live pixels, MOV acceptance, file custody effects, native permission\/TCC behavior, daemon restart, or crash acceptance/u);
});

test('canvas action bus proves exact seven source labels without executing app quit', async () => {
  const row = byId(await json(ledgerRelativePath)).get('canvas-host-action-bus');
  const unified = await read('src/daemon/unified.swift');
  const start = unified.indexOf('private func handleAosAction');
  const end = unified.indexOf('private func aosActionResponseExtra', start);
  assert.ok(start >= 0 && end > start);
  const handler = unified.slice(start, end);
  const actions = ['canvas.create', 'canvas.send', 'panel.open', 'panel.toggle', 'panel.close', 'macos.open_url', 'app.quit'];
  for (const action of actions) {
    assert.match(handler, new RegExp('case "' + action.replaceAll('.', '\\.') + '":', 'u'));
    assert.ok(row.current.observation.breadth.includes(action));
  }
  assert.match(unified, /NSWorkspace\.shared\.open\(url\)/u);
  assert.match(handler, /NSApp\.terminate\(nil\)/u);
  assert.deepEqual(row.current.proof.static.map(({ path: proofPath }) => proofPath), ['tests/schemas/aos-privileged-capability-ledger-v1.test.mjs']);
});

test('design and proof routing state the normalized static boundary', async () => {
  const [design, registry] = await Promise.all([
    read('docs/design/aos-sovereign-first-vertical-slice-contract.md'),
    json('docs/dev/test-proof-registry.d/privileged-capability-ledger.json'),
  ]);
  assert.match(
    design,
    /Milestone 2 executable control plane plus bounded M3A fixed video, M3B\s+optional system audio, M3C-V2 optional microphone, and M3D-V1 caller-followed\s+region geometry candidate.+unimplemented M3 remainder and M4-M10\s+sections remain target design merely because they are specified here/isu,
  );
  assert.match(design, /TRANSITION_EVENT_DUPLICATE/u);
  assert.match(design, /exact transition tuple/u);
  assert.match(design, /cleanup_resolved_without_offer/u);
  assert.match(design, /ARTIFACT_VALIDATION_FAILED/u);
  assert.match(design, /status_indicator_class/u);
  assert.match(design, /adapter_registry/u);
  assert.match(design, /apple-macosx-26\.5/u);
  assert.match(design, /optional\s+exact-SDK audit/iu);
  assert.match(design, /argv.+stdin.+stdout.+stderr.+artifact/isu);
  assert.match(design, /M1.+M2.+M3.+M4.+M5.+M6.+M7.+M8.+M9.+M10/su);
  assert.match(design, /M8.+skills only/isu);
  assert.match(design, /record-video-element.+does not exist/iu);
  const entry = registry.entries.find(({ id }) => id === 'privileged-capability-ledger-contract');
  assert.match(entry.contract, /structural JSON Schema/u);
  assert.match(entry.contract, /independent semantic/iu);
  assert.match(entry.contract, /two ADR 0044 owner bindings/u);
  assert.match(entry.contract, /immediate socket-peer audit-token\/PID-generation evidence/u);
  assert.match(entry.contract, /ancestor proc-generation, UID, stable-edge, and code-identity evidence/u);
  assert.match(
    entry.contract,
    /invocation-scoped external intent whose token remains parent-only.+tokenless exact-peer finalization/isu,
  );
  assert.match(entry.contract, /prior-generation transitions across operation, stream, tap, artifact, claim-set transaction, per-resource claim, multiplex broker, host barrier, and recovery/u);
  assert.match(entry.contract, /split all-or-nothing claim-set admission/u);
  assert.match(entry.contract, /registry-revision-bound resource declarations/u);
  assert.match(entry.contract, /immutable barrier snapshots across drain\/recovery\/reopen/u);
  assert.match(entry.contract, /four closed live transport, ordinary Canvas, status-item, and status-opened Canvas origins/u);
  assert.match(entry.contract, /seven mandatory tap bounds/u);
  assert.match(entry.contract, /deterministic sampling stride/u);
  assert.match(entry.contract, /artifact released\/retained\/removed and claim-set rollback\/committed-handoff recovery dispositions/u);
  assert.match(entry.contract, /multiplex broker\/subscriber CAS inputs.+resulting publication facts/isu);
  assert.match(entry.contract, /generation-independent retained receipt replay with bounded eviction and expected-barrier CAS/u);
  assert.match(entry.contract, /19 M2 deliverables, 15 exit gates, 70 path refs, and 23 proof refs/u);
  assert.match(entry.contract, /frozen-v0\/active-v1 external-command manifest cutover/u);
  assert.match(entry.contract, /exactly one invocation-scoped listen-microphone spawn registration/u);
  assert.match(entry.contract, /v1-only Swift\/help readers/u);
  assert.match(entry.contract, /canonical proof-index and workflow reachability/u);
  assert.match(entry.contract, /fifteen-form generation-bound operation\/tap\/artifact\/barrier grammar/u);
  assert.match(entry.contract, /41-operation\.json and 49-operation\.json/u);
  assert.match(entry.contract, /103 functional bindings and 109 functional selectors/u);
  assert.match(entry.contract, /mandatory-video plus optional-system-audio recording/u);
  assert.match(entry.contract, /six fail-closed selectors/u);
  assert.match(entry.contract, /tracked regular-file production sources/u);
  assert.match(entry.contract, /reviewed SDK snapshot/u);
  assert.match(entry.guard, /does not run native, managed-live, daemon, browser, or TCC acceptance/iu);
});

test('guarded operation-control native proof is current and claims only its executable live scope', async () => {
  const ledger = await json(ledgerRelativePath);
  const milestone = ledger.program_milestones.find(({ id }) => id === 'M2');
  const proofId = 'M2.proof.tests_manual_operation_control_native_proof_sh';
  const proof = milestone.proof_paths.find(({ id }) => id === proofId);
  assert.deepEqual(
    { path: proof.path, kind: proof.kind, execution_class: proof.execution_class },
    {
      path: 'tests/manual/operation-control-native-proof.sh',
      kind: 'current',
      execution_class: 'native_live',
    },
  );
  assert.deepEqual(
    milestone.deliverables
      .filter(({ proof_ref_ids }) => proof_ref_ids.includes(proofId))
      .map(({ id }) => id),
    ['microphone_adapter'],
  );
  assert.deepEqual(
    milestone.exit_gates
      .filter(({ proof_ref_ids }) => proof_ref_ids.includes(proofId))
      .map(({ id }) => id)
      .sort(),
    [
      'microphone_control_plane',
      'singleton_resource_claim_closure',
      'terminal_residual_invariant',
    ],
  );
  const targetProof = ledger.target_design.proof_ladders
    .find(({ milestone: id }) => id === 'M2')
    .native.find(({ path_ref }) => path_ref.path === proof.path);
  assert.equal(targetProof.path_ref.kind, 'current');
  assert.match(targetProof.claim, /exact typed tap unavailability with no created tap record/u);
  assert.match(targetProof.claim, /host barrier remains unchanged/u);
  assert.match(targetProof.claim, /does not claim live stop\/reopen/u);
  assert.match(targetProof.claim, /does not claim status\/Canvas UI provenance/u);
  assert.match(targetProof.claim, /peer-loss signaling/u);
  const microphone = ledger.capabilities.find(({ id }) => id === 'microphone-capture-adapter');
  const liveProof = microphone.current.proof.native.find(({ path }) => path === proof.path);
  assert.equal(liveProof.execution_class, 'native_live');
  assert.deepEqual(liveProof.tcc_services, ['Microphone']);
  assert.equal(liveProof.requires_owner_authority, true);
  assert.equal(liveProof.mutates_runtime, true);
});

test('paired authority, executable M2 bindings, and the remaining M6 decision are exact', async () => {
  const ledger = await json(ledgerRelativePath);
  assert.deepEqual(ledger.authority.paired_sigil_authority, {
    repository: 'https://github.com/Ch-osctrl/sigil',
    path: 'docs/adr/0021-sigil-sovereign-workflow-composition.md',
    publication_state: 'landed',
    revision: '227382c1bcbdab56f551a85a69b0609eebbdfa0c',
  });
  assert.deepEqual(ledger.accepted_m2_owner_bindings.map(({ id, status, authority }) => ({ id, status, authority })), [
    {
      id: 'ordinary-owner-root',
      status: 'accepted_by_adr_0044',
      authority: 'docs/adr/0044-operation-owner-roots-host-control-and-resource-claims.md',
    },
    {
      id: 'same-effective-uid-host-control',
      status: 'accepted_by_adr_0044',
      authority: 'docs/adr/0044-operation-owner-roots-host-control-and-resource-claims.md',
    },
  ]);
  assert.equal(ledger.later_open_decisions.length, 1);
  assert.equal(ledger.later_open_decisions[0].milestone, 'M6');
  assert.match(
    ledger.authority.publication_boundary,
    /Milestone 2 publishes the executable operation plane and microphone adapter.+bounded M3A\/M3B\/M3C-V2\/M3D-V3 slices add one fixed display\/window\/region or caller-followed-region mandatory-H\.264-video producer with independently optional AAC-LC system-audio and microphone tracks.+adapter-owned atomic public stop admission from the first durable prepared publication/isu,
  );
});

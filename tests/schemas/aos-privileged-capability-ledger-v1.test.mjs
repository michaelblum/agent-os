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
  "app-lifecycle-control": "M4",
  "window-menu-lifecycle-control": "M4",
  "display-topology-observation": "M4",
  "focus-window-display-events": "M5",
  "coregraphics-input-posting": "M4",
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
            "scripts/aos-tell-listen.mjs",
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
            "scripts/aos-tell-listen.mjs",
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
            "scripts/aos-tell-listen.mjs",
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
      "internal_red_status_projection"
    ],
    "gate_ids": [
      "owner_decisions_accepted",
      "prepared_before_authority",
      "owner_filter_intersection",
      "host_operator_separation",
      "terminal_residual_invariant",
      "microphone_control_plane"
    ],
    "path_count": 18,
    "proof_count": 5
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
      "full_ax_roots",
      "depth_breadth_paging",
      "raw_ax_attributes",
      "ax_actions",
      "ax_filters",
      "ax_notifications",
      "ax_display_sck_pixel_transforms"
    ],
    "gate_ids": [
      "complete_ax_surface",
      "frontier_and_completeness_truth",
      "target_state_staleness",
      "transform_identity"
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
      "manifests/commands/source/aos/operation-control.proposed.json",
      "manifests/commands/source/external/operation-control.proposed.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "internal_red_status_projection": [
      "shared/schemas/aos-operation-event-v1.schema.json",
      "src/daemon/operation-status-item-projection.swift",
      "manifests/commands/source/aos/operation-control.proposed.json",
      "manifests/commands/source/external/operation-control.proposed.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ]
  },
  "M3": {
    "screen_video": [
      "src/daemon/desktop-pixel-native.swift",
      "src/daemon/desktop-pixel-stream-lifecycle.swift",
      "shared/schemas/aos-screen-recording-v1.schema.json",
      "src/daemon/screen-recording-operation-adapter.swift",
      "manifests/commands/source/aos/screen-recording.proposed.json",
      "manifests/commands/source/external/screen-recording.proposed.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "system_audio": [
      "shared/schemas/aos-screen-recording-v1.schema.json",
      "src/daemon/screen-recording-operation-adapter.swift",
      "manifests/commands/source/aos/screen-recording.proposed.json",
      "manifests/commands/source/external/screen-recording.proposed.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "microphone_track": [
      "shared/schemas/aos-screen-recording-v1.schema.json",
      "src/daemon/screen-recording-operation-adapter.swift",
      "manifests/commands/source/aos/screen-recording.proposed.json",
      "manifests/commands/source/external/screen-recording.proposed.json",
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
      "src/daemon/desktop-pixel-stream-lifecycle.swift",
      "shared/schemas/aos-screen-recording-v1.schema.json",
      "src/daemon/screen-recording-geometry.swift"
    ],
    "caller_followed_geometry": [
      "src/daemon/desktop-pixel-native.swift",
      "src/daemon/desktop-pixel-stream-lifecycle.swift",
      "shared/schemas/aos-screen-recording-v1.schema.json",
      "src/daemon/screen-recording-geometry.swift"
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
      "manifests/commands/source/aos/external-tool-run.proposed.json",
      "manifests/commands/source/external/external-tool-run.proposed.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "raw_stdin": [
      "scripts/lib/external-tool/raw-runner.mjs",
      "manifests/commands/source/aos/external-tool-run.proposed.json",
      "manifests/commands/source/external/external-tool-run.proposed.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "raw_stdout": [
      "scripts/lib/external-tool/raw-runner.mjs",
      "manifests/commands/source/aos/external-tool-run.proposed.json",
      "manifests/commands/source/external/external-tool-run.proposed.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "raw_stderr": [
      "scripts/lib/external-tool/raw-runner.mjs",
      "manifests/commands/source/aos/external-tool-run.proposed.json",
      "manifests/commands/source/external/external-tool-run.proposed.json",
      "manifests/commands/aos-commands.json",
      "manifests/commands/aos-external-commands.json",
      "docs/api/aos.md"
    ],
    "raw_artifact_transport": [
      "scripts/lib/external-tool/raw-runner.mjs",
      "src/daemon/external-tool-artifact-adapter.swift",
      "manifests/commands/source/aos/external-tool-run.proposed.json",
      "manifests/commands/source/external/external-tool-run.proposed.json",
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
      "manifests/companions/opencli-v1.proposed.json"
    ],
    "ffmpeg_descriptor_executable": [
      "shared/schemas/aos-external-tool-descriptor-v1.schema.json",
      "scripts/lib/external-tool/raw-runner.mjs",
      "scripts/lib/external-tool/descriptor-loader.mjs",
      "manifests/companions/ffmpeg-v1.proposed.json"
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
      "manifests/companions/opencli-v1.proposed.json",
      "manifests/companions/ffmpeg-v1.proposed.json"
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
      "manifests/companions/opencli-v1.proposed.json"
    ],
    "ffmpeg_skill": [
      "skills/registry.json",
      "skills/aos-ffmpeg.proposed/SKILL.md",
      "manifests/companions/ffmpeg-v1.proposed.json"
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
    "disposition": "named_negative",
    "source_probes": [],
    "named_absent_symbols": [
      "capturesAudio = true",
      "SCStreamOutputType.audio",
      "addStreamOutput(type: .audio)"
    ]
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
    "disposition": "named_negative",
    "source_probes": [],
    "named_absent_symbols": [
      "AVAssetWriter",
      "AVAssetWriterInput"
    ]
  },
  "microphone-capture-adapter": {
    "disposition": "positive",
    "source_probes": [
      {
        "path": "src/daemon/segmented-microphone-capture.swift",
        "classification": "production_source",
        "markers": [
          "AVAudioEngine()"
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
    "transition_count": 31,
    "terminal_states": [
      "terminal"
    ],
    "quiescent_states": []
  },
  "stream": {
    "machine_kind": "finite_lifecycle",
    "state_count": 7,
    "transition_count": 31,
    "terminal_states": [
      "terminal"
    ],
    "quiescent_states": []
  },
  "tap": {
    "machine_kind": "finite_lifecycle",
    "state_count": 7,
    "transition_count": 16,
    "terminal_states": [
      "terminal"
    ],
    "quiescent_states": []
  },
  "artifact": {
    "machine_kind": "finite_lifecycle",
    "state_count": 8,
    "transition_count": 18,
    "terminal_states": [
      "terminal"
    ],
    "quiescent_states": []
  },
  "host_barrier": {
    "machine_kind": "cyclic_control",
    "state_count": 5,
    "transition_count": 7,
    "terminal_states": [],
    "quiescent_states": [
      "open",
      "closed"
    ]
  },
  "recovery": {
    "machine_kind": "finite_lifecycle",
    "state_count": 6,
    "transition_count": 11,
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
    transitionKey({ machine: 'artifact', from: 'recovering', event: 'recovered', to: 'removed' }),
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
      const commandSources = milestone.path_refs.filter(({ path: ownerPath, kind }) => (
        kind === 'proposed' && ownerPath.startsWith('manifests/commands/source/')
      ));
      const classes = new Set(commandSources.map(({ path: ownerPath }) => (
        ownerPath.startsWith('manifests/commands/source/aos/') ? 'aos' : 'external'
      )));
      if (!classes.has('aos') || !classes.has('external') || generated.length !== 3) {
        errors.push(semanticError('MILESTONE_COMMAND_SURFACE_INCOMPLETE', milestone.id));
      }
      for (const source of commandSources) {
        const owner = milestone.deliverables.find((deliverable) => (
          deliverable.owner_ref_ids.includes(source.id)
          && generated.every((id) => deliverable.owner_ref_ids.includes(id))
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
  if (bindingOccurrences !== 101 || selectorOccurrences !== 107 || failClosed.size !== 6) {
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
  badPath.steps = badPath.steps.filter(({ transition_ref: ref }) => !(ref.machine === 'artifact' && ref.event === 'recovered'));
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
  const status = ledger.target_design.status_item_contract;
  assert.deepEqual(status.adapter_status_indicator_registry, expectedStatusIndicatorRegistry);
  assert.deepEqual(status.projection_fields.find(({ field }) => field === 'status_indicator_class'), {
    field: 'status_indicator_class', provenance: 'mechanical',
  });
  assert.deepEqual(status.recording_indicator.red_states, ['starting', 'active', 'stopping', 'cleanup_required', 'recovering']);
  assert.match(status.recording_indicator.immutable_rule, /adapter registry.+requests.+labels.+cannot set or change/iu);
  assert.match(status.recording_indicator.clear_guard, /every.+terminal.+residual-free/iu);
  assert.equal(status.action_origin_authentication.grants_control, false);
  assert.match(status.control_routes.ordinary, /owner set/u);
  assert.match(status.control_routes.host_wide, /host operator/u);
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
  assert.equal(milestones.flatMap(({ deliverables }) => deliverables).length, 81);
  assert.equal(milestones.flatMap(({ exit_gates: gates }) => gates).length, 49);
  assert.deepEqual(milestones[6].proof_paths.map(({ case_id: id }) => id), [null, null, 'playwright', 'opencli', 'ffmpeg']);
  assert.deepEqual(milestones[7].proof_paths.map(({ case_id: id }) => id), [null, null, 'playwright', 'opencli', 'ffmpeg']);
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
  assert.equal(ledger.capabilities.flatMap((row) => row.current.exposure.cli.bindings).length, 101);
  assert.equal(ledger.capabilities.flatMap((row) => row.current.exposure.cli.bindings.flatMap((binding) => binding.route_selectors)).length, 107);
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

test('screen video proof owns output, audio-off, latest-frame, and public recording absence', async () => {
  const rows = byId(await json(ledgerRelativePath));
  const row = rows.get('screencapturekit-screen-video');
  const source = await read('src/daemon/desktop-pixel-native.swift');
  const start = source.indexOf('private final class AOSDesktopPixelStreamOutput');
  const end = source.indexOf('final class AOSNativeDesktopPixelAcquirer', start);
  assert.ok(start >= 0 && end > start);
  const owner = source.slice(start, end);
  assert.match(owner, /configuration\.capturesAudio\s*=\s*false/u);
  assert.match(owner, /addStreamOutput\(\s*output,\s*type:\s*\.screen,/su);
  assert.match(owner, /private var latestSample: AOSDesktopPixelLatestSample\?/u);
  assert.match(owner, /CMSampleBufferIsValid\(sampleBuffer\)/u);
  assert.doesNotMatch(owner, /configuration\.capturesAudio\s*=\s*true/u);
  assert.doesNotMatch(owner, /addStreamOutput\([^)]*type:\s*\.audio/su);
  assert.deepEqual(row.current.observation.roots, ['internally selected display set']);
  assert.deepEqual(row.current.observation.targets, ['latest valid ScreenCaptureKit screen sample per selected display']);
  assert.deepEqual(row.current.data_transport.transports, ['private in-process CMSampleBuffer latest-frame handoff']);
  assert.equal(row.current.exposure.cli.state, 'absent');
  assert.equal(row.current.exposure.ipc.state, 'absent');
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
  assert.match(design, /Nothing in this\s+document is implemented merely because it is specified here/u);
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
  assert.match(entry.contract, /independent semantic/u);
  assert.match(entry.contract, /101 functional bindings and 107 functional selectors/u);
  assert.match(entry.contract, /six fail-closed selectors/u);
  assert.match(entry.contract, /tracked regular-file production-source discovery/u);
  assert.match(entry.contract, /reviewed SDK snapshot/u);
  assert.match(entry.guard, /does not run native, managed-live, daemon, browser, or TCC acceptance/iu);
});

test('paired authority and open-decision counts remain exact while M1 is data only', async () => {
  const ledger = await json(ledgerRelativePath);
  assert.deepEqual(ledger.authority.paired_sigil_authority, {
    repository: 'https://github.com/Ch-osctrl/sigil',
    path: 'docs/adr/0021-sigil-sovereign-workflow-composition.md',
    publication_state: 'landed',
    revision: '227382c1bcbdab56f551a85a69b0609eebbdfa0c',
  });
  assert.equal(ledger.owner_decision_required_before_m2.length, 2);
  assert.equal(ledger.later_open_decisions.length, 1);
  assert.equal(ledger.later_open_decisions[0].milestone, 'M6');
  assert.match(ledger.authority.publication_boundary, /adds no runtime primitive/u);
});

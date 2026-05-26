#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_CONFIG = {
  voice: {
    enabled: false,
    announce_actions: true,
    voice: null,
    rate: null,
    policies: {
      final_response: {
        style: 'last_sentence',
        last_n_chars: 400,
      },
    },
    controls: {
      cancel: {
        key_code: 53,
      },
    },
    filter: {
      language: 'en',
      tiers: ['premium', 'enhanced'],
    },
  },
  perception: {
    default_depth: 1,
    settle_threshold_ms: 200,
  },
  feedback: {
    visual: true,
    sound: false,
  },
  content: null,
  status_item: null,
  hotkeys: null,
  see: {
    canvas_inspector_bundle: {
      hotkey: 'ctrl+opt+c',
      output: {
        mode: 'bundle_path',
      },
      include: {
        capture_image: true,
        capture_metadata: true,
        inspector_state: true,
        annotation_snapshot: true,
        display_geometry: true,
        canvas_list: true,
        xray: false,
      },
    },
  },
};

const KEY_CODE_MAP = new Set([
  'a', 's', 'd', 'f', 'h', 'g', 'z', 'x', 'c', 'v', 'b', 'q', 'w', 'e', 'r', 'y', 't',
  '1', '2', '3', '4', '6', '5', 'equal', '9', '7', 'minus', '8', '0', 'rightbracket',
  'o', 'u', 'leftbracket', 'i', 'p', 'l', 'j', 'quote', 'k', 'semicolon', 'backslash',
  'comma', 'slash', 'n', 'm', 'period', 'grave', 'keypaddecimal', 'keypadmultiply',
  'keypadplus', 'keypadclear', 'keypaddivide', 'keypadenter', 'keypadminus', 'keypadequals',
  'keypad0', 'keypad1', 'keypad2', 'keypad3', 'keypad4', 'keypad5', 'keypad6', 'keypad7',
  'keypad8', 'keypad9', 'return', 'tab', 'space', 'delete', 'escape', 'cmd', 'shift',
  'capslock', 'opt', 'ctrl', 'rightshift', 'rightopt', 'rightctrl', 'fn', 'f17', 'volumeup',
  'volumedown', 'mute', 'f18', 'f19', 'f20', 'f5', 'f6', 'f7', 'f3', 'f8', 'f9', 'f11',
  'f13', 'f16', 'f14', 'f10', 'f12', 'f15', 'help', 'home', 'pageup', 'forwarddelete',
  'f4', 'end', 'f2', 'pagedown', 'f1', 'left', 'right', 'down', 'up',
]);
const MODIFIER_ORDER = ['ctrl', 'opt', 'cmd', 'shift', 'fn'];

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: aos config get <key> [--json]');
  console.error('Usage: aos config set <key> <value>');
  process.exit(1);
}

function stateRoot() {
  return process.env.AOS_STATE_ROOT || join(homedir(), '.config', 'aos');
}

function runtimeMode() {
  return process.env.AOS_RUNTIME_MODE === 'installed' ? 'installed' : 'repo';
}

function configPath() {
  return join(stateRoot(), runtimeMode(), 'config.json');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function loadConfig() {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8'));
  } catch {
    return clone(DEFAULT_CONFIG);
  }
}

async function saveConfig(config) {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
}

function ensureVoicePolicies(config) {
  config.voice.policies ??= { final_response: null };
  config.voice.policies.final_response ??= { style: null, last_n_chars: null };
}

function ensureVoiceControls(config) {
  config.voice.controls ??= { cancel: null };
}

function ensureVoiceFilter(config) {
  config.voice.filter ??= { language: null, tiers: null };
}

function ensureContent(config) {
  config.content ??= { port: 0, roots: {} };
}

function ensureStatusItem(config) {
  config.status_item ??= {
    enabled: false,
    toggle_id: 'avatar',
    toggle_url: '',
    toggle_at: [200, 200, 300, 300],
    toggle_track: null,
    icon: 'hexagon',
  };
}

function canvasInspectorDefaults() {
  return clone(DEFAULT_CONFIG.see.canvas_inspector_bundle);
}

function ensureCanvasInspector(config) {
  config.see ??= { canvas_inspector_bundle: null };
  config.see.canvas_inspector_bundle ??= canvasInspectorDefaults();
  config.see.canvas_inspector_bundle.include ??= canvasInspectorDefaults().include;
  config.see.canvas_inspector_bundle.output ??= canvasInspectorDefaults().output;
}

function effectiveCanvasInspector(config) {
  const defaults = canvasInspectorDefaults();
  const configured = config.see?.canvas_inspector_bundle ?? {};
  const include = configured.include ?? {};
  return {
    hotkey: configured.hotkey ?? defaults.hotkey,
    output: {
      mode: configured.output?.mode ?? defaults.output.mode,
    },
    include: {
      capture_image: include.capture_image ?? defaults.include.capture_image,
      capture_metadata: include.capture_metadata ?? defaults.include.capture_metadata,
      inspector_state: include.inspector_state ?? defaults.include.inspector_state,
      annotation_snapshot: include.annotation_snapshot ?? defaults.include.annotation_snapshot,
      display_geometry: include.display_geometry ?? defaults.include.display_geometry,
      canvas_list: include.canvas_list ?? defaults.include.canvas_list,
      xray: include.xray ?? defaults.include.xray,
    },
  };
}

function boolValue(value) {
  return value === 'true' || value === '1';
}

function normalizeHotkeyCombo(value) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (['none', 'disabled', 'off'].includes(trimmed)) return null;
  const rawParts = trimmed.split('+').map((part) => part.trim()).filter(Boolean);
  if (!rawParts.length) return undefined;
  const modifiers = new Set();
  let keyName = null;
  for (const rawPart of rawParts) {
    const part = rawPart === 'control' ? 'ctrl' : (['alt', 'option'].includes(rawPart) ? 'opt' : (rawPart === 'command' ? 'cmd' : rawPart));
    if (MODIFIER_ORDER.includes(part)) {
      modifiers.add(part);
    } else {
      if (keyName !== null || !KEY_CODE_MAP.has(part)) return undefined;
      keyName = part;
    }
  }
  if (!keyName) return undefined;
  return [...MODIFIER_ORDER.filter((part) => modifiers.has(part)), keyName].join('+');
}

function lookupConfigValue(key, config) {
  if (key === 'voice.enabled') return config.voice.enabled;
  if (key === 'voice.announce_actions') return config.voice.announce_actions;
  if (key === 'voice.voice') return config.voice.voice ?? null;
  if (key === 'voice.rate') return config.voice.rate ?? null;
  if (key === 'voice.policies.final_response.style') return config.voice.policies?.final_response?.style ?? null;
  if (key === 'voice.policies.final_response.last_n_chars') return config.voice.policies?.final_response?.last_n_chars ?? null;
  if (key === 'voice.controls.cancel.key_code') return config.voice.controls?.cancel?.key_code ?? null;
  if (key === 'perception.default_depth') return config.perception.default_depth;
  if (key === 'perception.settle_threshold_ms') return config.perception.settle_threshold_ms;
  if (key === 'feedback.visual') return config.feedback.visual;
  if (key === 'feedback.sound') return config.feedback.sound;
  if (key === 'content.port') return config.content?.port ?? null;
  if (key.startsWith('content.roots.')) {
    const rootName = key.slice('content.roots.'.length);
    if (!rootName) return undefined;
    return config.content?.roots?.[rootName] ?? null;
  }
  if (key === 'status_item.enabled') return config.status_item?.enabled ?? null;
  if (key === 'status_item.toggle_id') return config.status_item?.toggle_id ?? null;
  if (key === 'status_item.toggle_url') return config.status_item?.toggle_url ?? null;
  if (key === 'status_item.toggle_track') return config.status_item?.toggle_track ?? null;
  if (key === 'status_item.icon') return config.status_item?.icon ?? null;
  if (key === 'hotkeys.cancel_speech') return config.hotkeys?.cancel_speech ?? null;
  if (key === 'see.canvas_inspector_bundle') return effectiveCanvasInspector(config);
  if (key === 'see.canvas_inspector_bundle.hotkey') return effectiveCanvasInspector(config).hotkey ?? null;
  if (key === 'see.canvas_inspector_bundle.output.mode') return effectiveCanvasInspector(config).output.mode;
  if (key.startsWith('see.canvas_inspector_bundle.include.')) {
    const name = key.slice('see.canvas_inspector_bundle.include.'.length);
    return Object.prototype.hasOwnProperty.call(effectiveCanvasInspector(config).include, name)
      ? effectiveCanvasInspector(config).include[name]
      : undefined;
  }
  return undefined;
}

function printValue(value, jsonMode) {
  if (jsonMode || typeof value === 'object') {
    console.log(formatJSON(value, typeof value === 'object' && value !== null));
  } else if (value === null || value === undefined) {
    console.log('null');
  } else {
    console.log(String(value));
  }
}

function formatJSON(value, pretty = true) {
  const spacing = pretty ? 2 : 0;
  return JSON.stringify(value, null, spacing).replace(/": /g, '" : ');
}

function positiveInt(value, message) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(message);
  return parsed;
}

function setConfigValue(config, key, value) {
  if (key === 'voice.enabled') config.voice.enabled = boolValue(value);
  else if (key === 'voice.announce_actions') config.voice.announce_actions = boolValue(value);
  else if (key === 'voice.voice') config.voice.voice = value === 'default' ? null : value;
  else if (key === 'voice.rate') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('rate must be a positive number');
    config.voice.rate = parsed;
  } else if (key === 'voice.policies.final_response.style') {
    ensureVoicePolicies(config);
    const normalized = value.trim();
    const allowed = ['full', 'last_sentence', 'last_n_chars'];
    if (!allowed.includes(normalized)) throw new Error(`voice.policies.final_response.style must be one of ${allowed.join(', ')}`);
    config.voice.policies.final_response.style = normalized;
  } else if (key === 'voice.policies.final_response.last_n_chars') {
    ensureVoicePolicies(config);
    config.voice.policies.final_response.last_n_chars = positiveInt(value, 'voice.policies.final_response.last_n_chars must be a positive integer');
  } else if (key === 'voice.filter.language') {
    ensureVoiceFilter(config);
    const normalized = value.trim().toLowerCase();
    if (!normalized) throw new Error('voice.filter.language must be a non-empty language code');
    config.voice.filter.language = normalized;
  } else if (key === 'voice.filter.tiers') {
    ensureVoiceFilter(config);
    const parts = value.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) throw new Error('voice.filter.tiers must be a non-empty comma-separated list (e.g. premium,enhanced)');
    config.voice.filter.tiers = parts;
  } else if (key === 'voice.controls.cancel.key_code') {
    ensureVoiceControls(config);
    if (['none', 'disabled'].includes(value)) config.voice.controls.cancel = { key_code: null };
    else if (/^\d+$/.test(value)) config.voice.controls.cancel = { key_code: Number(value) };
    else throw new Error("voice.controls.cancel.key_code must be a macOS keyCode (integer) or 'none'");
  } else if (key === 'perception.default_depth') {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) throw new Error('depth must be 0-3');
    config.perception.default_depth = parsed;
  } else if (key === 'perception.settle_threshold_ms') config.perception.settle_threshold_ms = positiveInt(value, 'settle_threshold_ms must be positive');
  else if (key === 'feedback.visual') config.feedback.visual = boolValue(value);
  else if (key === 'feedback.sound') config.feedback.sound = boolValue(value);
  else if (key === 'content.port') {
    ensureContent(config);
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error('content.port must be a non-negative integer');
    config.content.port = parsed;
  } else if (key.startsWith('content.roots.')) {
    ensureContent(config);
    const rootName = key.slice('content.roots.'.length);
    if (!rootName) throw new Error('content.roots requires a name');
    config.content.roots[rootName] = value;
  } else if (key === 'status_item.enabled') {
    ensureStatusItem(config);
    config.status_item.enabled = boolValue(value);
  } else if (key === 'status_item.toggle_id') {
    ensureStatusItem(config);
    config.status_item.toggle_id = value;
  } else if (key === 'status_item.toggle_url') {
    ensureStatusItem(config);
    config.status_item.toggle_url = value;
  } else if (key === 'status_item.toggle_track') {
    ensureStatusItem(config);
    config.status_item.toggle_track = value === 'none' ? null : value;
  } else if (key === 'status_item.icon') {
    ensureStatusItem(config);
    config.status_item.icon = value;
  } else if (key === 'hotkeys.cancel_speech') {
    config.hotkeys ??= { cancel_speech: null };
    ensureVoiceControls(config);
    if (['none', 'disabled'].includes(value)) {
      config.hotkeys.cancel_speech = null;
      config.voice.controls.cancel = { key_code: null };
    } else if (/^\d+$/.test(value)) {
      config.hotkeys.cancel_speech = Number(value);
      config.voice.controls.cancel = { key_code: Number(value) };
    } else {
      throw new Error("hotkeys.cancel_speech must be a macOS keyCode (integer) or 'none'");
    }
  } else if (key === 'see.canvas_inspector_bundle.hotkey') {
    ensureCanvasInspector(config);
    const normalized = normalizeHotkeyCombo(value);
    if (value.trim() === '' || normalized === undefined) throw new Error("see.canvas_inspector_bundle.hotkey must be a supported key combo like 'ctrl+opt+c' or 'none'");
    config.see.canvas_inspector_bundle.hotkey = normalized;
  } else if (key === 'see.canvas_inspector_bundle.output.mode') {
    ensureCanvasInspector(config);
    const normalized = value.trim().toLowerCase();
    const allowed = ['bundle_path', 'clipboard_payload'];
    if (!allowed.includes(normalized)) throw new Error(`see.canvas_inspector_bundle.output.mode must be one of ${allowed.join(', ')}`);
    config.see.canvas_inspector_bundle.output.mode = normalized;
  } else if (key.startsWith('see.canvas_inspector_bundle.include.')) {
    ensureCanvasInspector(config);
    const name = key.slice('see.canvas_inspector_bundle.include.'.length);
    if (!Object.prototype.hasOwnProperty.call(config.see.canvas_inspector_bundle.include, name)) throw new Error(`Unknown config key: ${key}`);
    config.see.canvas_inspector_bundle.include[name] = boolValue(value);
  } else {
    throw new Error(`Unknown config key: ${key}`);
  }
}

async function main(argv) {
  const command = argv[0];
  if (command === 'dump') {
    if (argv.length !== 1) usage('Usage: aos config');
    console.log(formatJSON(await loadConfig()));
    return;
  }
  if (command === 'get') {
    const jsonMode = argv.includes('--json');
    const args = argv.slice(1).filter((arg) => arg !== '--json');
    if (args.length !== 1) usage('Usage: aos config get <key>');
    const config = await loadConfig();
    const value = lookupConfigValue(args[0], config);
    if (value === undefined) throw new Error(`Unknown config key: ${args[0]}`);
    printValue(value, jsonMode);
    return;
  }
  if (command === 'set') {
    const args = argv.slice(1);
    if (args.length !== 2) usage('Usage: aos config set <key> <value>');
    const config = await loadConfig();
    setConfigValue(config, args[0], args[1]);
    await saveConfig(config);
    console.log(formatJSON(config));
    return;
  }
  if (command === 'set-shorthand') {
    const args = argv.slice(1);
    if (args.length === 0) {
      console.log(formatJSON(await loadConfig()));
      return;
    }
    if (args.length < 2) {
      console.log(formatJSON(await loadConfig()));
      return;
    }
    const config = await loadConfig();
    setConfigValue(config, args[0], args[1]);
    await saveConfig(config);
    console.log(formatJSON(config));
    return;
  }
  usage('Unknown config subcommand');
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});

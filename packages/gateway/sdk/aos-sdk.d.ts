// sdk/aos-sdk.d.ts — Type definitions for the AOS SDK
// These types are what agents see via discover_capabilities.
// Good types = good agent behavior. See docs/sdk-philosophy.md.

declare const aos: {
  // --- Perception ---
  /** List open windows, optionally filtered by app name or title. */
  getWindows(filter?: { app?: string; title?: string }): Promise<Array<{
    id: string; app: string; title: string;
    frame: { x: number; y: number; width: number; height: number };
    focused: boolean;
  }>>;

  /** Get current cursor position and what's under it. */
  getCursor(): Promise<{
    x: number; y: number; app?: string; title?: string;
  }>;

  /** Capture a screenshot, optionally with accessibility tree. */
  capture(opts?: {
    display?: string;
    canvas?: string;
    window?: boolean;
    xray?: boolean;
    base64?: boolean;
    format?: 'png' | 'jpg';
    out?: string;
  }): Promise<{
    status: string; base64?: string; elements?: Array<{
      role: string; label?: string; value?: string;
      frame: { x: number; y: number; width: number; height: number };
    }>; semantic_targets?: Array<{
      canvas_id?: string; id?: string; ref?: string;
      role: string; name?: string; action?: string;
      surface?: string; parent_canvas?: string; enabled: boolean;
      bounds: { x: number; y: number; width: number; height: number };
      center: { x: number; y: number };
      state?: {
        current?: string; pressed?: boolean; selected?: boolean;
        checked?: boolean; expanded?: boolean; disabled?: boolean;
        value?: string;
      };
    }>; path?: string;
  }>;

  /** List connected displays. */
  getDisplays(): Promise<Array<{
    id: string; width: number; height: number; primary?: boolean;
  }>>;

  // --- Action ---
  /** Click at screen coordinates. */
  click(target: { x: number; y: number }): Promise<void>;

  /** Type text with natural cadence. */
  type(text: string): Promise<void>;

  /** Speak text aloud via TTS. */
  say(text: string): Promise<void>;

  // --- Display ---
  /** Create a floating overlay canvas on the desktop. */
  createCanvas(opts: {
    id: string;
    html?: string;
    url?: string;
    at: [x: number, y: number, width: number, height: number];
    interactive?: boolean;
    ttl?: number;
  }): Promise<{ status: string; id: string }>;

  /** Remove a canvas by ID. */
  removeCanvas(id: string): Promise<{ status: string }>;

  /** Execute JavaScript inside a canvas and return the result. */
  evalCanvas(id: string, js: string): Promise<{ result: unknown }>;

  /** Update a canvas's HTML content or position. */
  updateCanvas(id: string, opts: {
    html?: string;
    at?: [x: number, y: number, width: number, height: number];
  }): Promise<{ status: string }>;

  /** List all active canvases. */
  listCanvases(): Promise<Array<{
    id: string; at: number[]; interactive: boolean; scope: string;
  }>>;

  // --- Layer 2: Smart Operations ---
  // These compose multiple primitives into single calls.
  // Use these first. Drop to primitives only when these don't cover your case.

  /** Full situational awareness in one call — windows, cursor, displays, focused app. */
  perceive(): Promise<{
    focused: { app: string; title: string; frame: { x: number; y: number; width: number; height: number } } | null;
    windows: Array<{ app: string; title: string; focused: boolean; frame: { x: number; y: number; width: number; height: number } }>;
    cursor: { x: number; y: number };
    displays: Array<{ id: string; width: number; height: number; primary?: boolean }>;
  }>;

  /** Find a window by app name or title. Returns the match and a list of candidates if not found. */
  findWindow(query: { app?: string; title?: string }): Promise<{
    found: boolean;
    window: { app: string; title: string; frame: { x: number; y: number; width: number; height: number } } | null;
    candidates: string[];
  }>;

  /** Find a UI element by its label and click it. Captures the screen, finds the element, clicks its center.
   *  Returns what was clicked, or candidates if the element wasn't found. */
  clickElement(label: string, opts?: {
    app?: string;
    role?: string;
  }): Promise<{
    clicked: boolean;
    element?: { label: string; role: string; frame: unknown };
    error?: string;
    candidates?: string[];
  }>;

  /** Poll until a window title or canvas ID appears. Returns the match or times out. */
  waitFor(pattern: {
    window?: string;
    canvas?: string;
  }, opts?: {
    timeout?: number;
    interval?: number;
  }): Promise<{
    found: boolean;
    match?: unknown;
    elapsed: number;
  }>;

  /** Show a styled overlay near a target window. Auto-positions and auto-styles.
   *  Use style: 'status' | 'success' | 'error' | 'warning' | 'info' */
  showOverlay(opts: {
    content: string;
    near?: { app?: string; title?: string };
    at?: [x: number, y: number, width: number, height: number];
    style?: 'status' | 'success' | 'error' | 'warning' | 'info';
    ttl?: number;
    id?: string;
  }): Promise<{ id: string; at: number[] }>;

  /** Update an existing overlay's content and/or style. Fast — reuses the existing canvas window. */
  updateOverlay(id: string, opts: {
    content?: string;
    style?: 'status' | 'success' | 'error' | 'warning' | 'info';
    ttl?: number;
  }): Promise<{ id: string }>;

  // --- Config & Health ---
  /** Full runtime health check (permissions, daemon, services). */
  doctor(): Promise<{
    status: string;
    identity: { mode: string; git_commit: string };
    permissions: { accessibility: boolean; screen_recording: boolean };
    runtime: { daemon_running: boolean; daemon_pid: number; socket_reachable: boolean };
  }>;

  /** Read current daemon configuration. */
  getConfig(): Promise<Record<string, unknown>>;

  /** Set a daemon configuration key (e.g., "voice.enabled", "true"). */
  setConfig(key: string, value: string): Promise<{ status: string }>;

  // --- Coordination ---
  coordination: {
    register(name: string, role: string, harness: string, capabilities?: string[]): Promise<{
      id: string; name: string; role: string; harness: string; status: string;
    }>;
    whoIsOnline(): Promise<Array<{
      id: string; name: string; role: string; harness: string; status: string;
    }>>;
    getState(key: string): Promise<Array<{
      key: string; value: unknown; version: number; owner?: string;
    }>>;
    setState(key: string, value: unknown, options?: {
      mode?: 'set' | 'cas' | 'acquire_lock' | 'release_lock';
      expectedVersion?: number; owner?: string; ttl?: number;
    }): Promise<{ ok: boolean; version?: number; reason?: string }>;
    postMessage(channel: string, payload: unknown, from?: string): Promise<{ id: string }>;
    readStream(channel: string, options?: { since?: string; limit?: number }): Promise<Array<{
      id: string; channel: string; from: string; payload: unknown; createdAt: string;
    }>>;
  };
};

declare const params: Record<string, unknown>;

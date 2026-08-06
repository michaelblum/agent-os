export declare class AOSCommandError extends Error {
    code: string;
    details: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
export type NormalizedWindow = {
    id: string;
    app: string;
    title: string;
    frame: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    focused: boolean;
};
type SemanticTargetRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type AOSSemanticTarget = {
    ref: string;
    surface?: string;
    role: string;
    name?: string;
    kind: string;
    handle: AOSTargetHandle;
    enabled: boolean;
    state?: {
        value?: string;
        current?: string;
        pressed?: boolean;
        selected?: boolean;
        checked?: boolean;
        expanded?: boolean;
    };
    actions: string[];
    extension: {
        dom_id?: string;
        source?: {
            path?: string | null;
            line_start?: number | null;
            line_end?: number | null;
        };
    };
    provenance: {
        canvas_id?: string;
        do_target?: string;
        parent_canvas_id?: string;
        source_payload_id?: string;
        bounds?: SemanticTargetRect;
        frame?: SemanticTargetRect;
        center?: {
            x: number;
            y: number;
        };
    };
};
export type AOSTargetHandle = {
    kind: 'observation_ref';
    backend: 'browser';
    state_id: string;
    scope: {
        session: string;
    };
    ref: string;
} | {
    kind: 'locator';
    backend: 'aos_canvas';
    query: {
        canvas_id: string;
        ref: string;
    };
} | {
    kind: 'locator';
    backend: 'native_ax';
    query: {
        pid: number;
        role: string;
        window_id?: number;
        title?: string;
        label?: string;
        identifier?: string;
        index?: number;
        near?: string;
        match?: 'exact' | 'contains' | 'regex';
        depth?: number;
        timeout_ms?: number;
    };
};
export type CaptureResult = {
    status: string;
    state_id?: string;
    base64?: string;
    elements?: Array<Record<string, unknown> & {
        handle?: AOSTargetHandle;
    }>;
    semantic_targets?: AOSSemanticTarget[];
    path?: string;
};
/** Normalize raw CLI window data to match the SDK type contract. */
export declare function normalizeWindow(raw: any, isFocused?: boolean): NormalizedWindow;
export declare function getWindows(filter?: {
    app?: string;
    title?: string;
}): Promise<NormalizedWindow[]>;
export declare function getCursor(): Promise<{
    x: number;
    y: number;
    app?: string;
    title?: string;
}>;
export declare function capture(opts?: {
    display?: string;
    canvas?: string;
    window?: boolean;
    xray?: boolean;
    base64?: boolean;
    format?: 'png' | 'jpg';
    out?: string;
}): Promise<CaptureResult>;
export declare function getDisplays(): Promise<Array<{
    id: string;
    width: number;
    height: number;
    primary?: boolean;
}>>;
export declare function click(target: {
    x: number;
    y: number;
}): Promise<void>;
export declare function type(text: string): Promise<void>;
export declare function say(text: string): Promise<void>;
export declare function createCanvas(opts: {
    id: string;
    html?: string;
    url?: string;
    at: [number, number, number, number];
    interactive?: boolean;
    ttl?: number;
}): Promise<{
    status: string;
    id: string;
}>;
export declare function removeCanvas(id: string): Promise<{
    status: string;
}>;
export declare function evalCanvas(id: string, js: string): Promise<{
    result: unknown;
}>;
export declare function updateCanvas(id: string, opts: {
    html?: string;
    at?: [number, number, number, number];
}): Promise<{
    status: string;
}>;
export declare function listCanvases(): Promise<Array<{
    id: string;
    at: number[];
    interactive: boolean;
    scope: string;
}>>;
export declare function doctor(): Promise<unknown>;
export declare function getConfig(): Promise<unknown>;
export declare function setConfig(key: string, value: string): Promise<{
    status: string;
}>;
/** Combined situational awareness — windows, cursor, displays in one call. */
export declare function perceive(): Promise<{
    focused: NormalizedWindow | null;
    windows: NormalizedWindow[];
    cursor: {
        x: number;
        y: number;
    };
    displays: Array<{
        id: string;
        width: number;
        height: number;
        primary?: boolean;
    }>;
}>;
/** Find a window by app name, title substring, or both. Returns the best match. */
export declare function findWindow(query: {
    app?: string;
    title?: string;
}): Promise<{
    found: boolean;
    window: NormalizedWindow | null;
    candidates: string[];
}>;
/** Poll until a condition is met, then return the match. */
export declare function waitFor(pattern: {
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
/** Show a positioned overlay near a target window. Auto-generates HTML from content string. */
export declare function showOverlay(opts: {
    content: string;
    near?: {
        app?: string;
        title?: string;
    };
    at?: [number, number, number, number];
    style?: 'status' | 'success' | 'error' | 'warning' | 'info';
    ttl?: number;
    id?: string;
}): Promise<{
    id: string;
    at: number[];
}>;
/** Update an existing overlay's content and/or style. Uses updateCanvas (fast) instead of recreating. */
export declare function updateOverlay(id: string, opts: {
    content?: string;
    style?: 'status' | 'success' | 'error' | 'warning' | 'info';
    ttl?: number;
}): Promise<{
    id: string;
}>;
export {};

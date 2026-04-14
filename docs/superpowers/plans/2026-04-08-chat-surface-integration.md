# Chat Surface Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat canvas a full bidirectional conversational surface — users can type anytime, not just when the agent asks a question.

**Architecture:** Three changes to `apps/sigil/chat/index.html`: unlock the input field, split emit into `response` vs `user_message`, add a stop button. Plus protocol docs in `apps/sigil/CLAUDE.md`.

**Tech Stack:** Vanilla JS/HTML/CSS (single-file canvas)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/sigil/chat/index.html` | Modify | All UI + logic changes (input unlock, emit split, stop button) |
| `apps/sigil/CLAUDE.md` | Modify | Add chat canvas protocol reference |

---

### Task 1: Unlock free-form input

**Files:**
- Modify: `apps/sigil/chat/index.html:479-481` (HTML), `:887-895` (setIdle), `:879-885` (setActive)

- [ ] **Step 1: Remove `disabled` from input HTML**

In the input bar HTML (~line 479-481), remove `disabled` from both the textarea and button:

```html
    <div class="input-bar">
      <textarea class="text-input" id="userInput" placeholder="Type a message..." rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendUserInput()}" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,80)+'px'"></textarea>
      <button class="btn-send" onclick="sendUserInput()">Send</button>
    </div>
```

- [ ] **Step 2: Remove disable logic from `setIdle()`**

Replace the `setIdle()` function (~line 887-895) to stop disabling input:

```javascript
function setIdle() {
  var dot = document.getElementById('dot');
  dot.classList.remove('active');
}
```

- [ ] **Step 3: Remove enable logic from `setActive()`**

Replace the `setActive()` function (~line 879-885) — input is always enabled now, so just manage the dot:

```javascript
function setActive() {
  var dot = document.getElementById('dot');
  dot.classList.add('active');
}
```

- [ ] **Step 4: Verify in browser**

Open `apps/sigil/chat/index.html` directly in a browser. Confirm:
- Input field is enabled on load (not grayed out)
- Send button is enabled on load
- Typing and pressing Enter calls `sendUserInput()` (check console for `emit` call — will fail without WKWebView but should not throw)

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/chat/index.html
git commit -m "feat(chat): unlock input field for free-form messaging"
```

---

### Task 2: Split response vs user_message emit

**Files:**
- Modify: `apps/sigil/chat/index.html:847-874` (respond/sendUserInput), `:554-555` (manifest)

- [ ] **Step 1: Replace `respond()` and `sendUserInput()` functions**

Replace the response handling block (~line 847-874) with:

```javascript
function respondOption(btn) {
  var value = btn.getAttribute('data-value');
  respondToToolUse(value);
}

function respondToToolUse(value) {
  if (!value || value.trim() === '') return;
  value = value.trim();

  addUserMessage(value);

  emit('response', { type: 'response', value: value, tool_use_id: pendingToolUseId });
  pendingToolUseId = null;

  // Disable option buttons in the last assistant message
  var btns = document.querySelectorAll('.opt-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].style.pointerEvents = 'none';
    btns[i].style.opacity = '0.5';
  }

  setIdle();
}

function sendUserInput() {
  var input = document.getElementById('userInput');
  var value = (input.value || '').trim();
  if (!value) return;

  addUserMessage(value);
  input.value = '';
  input.style.height = 'auto';

  if (pendingToolUseId) {
    respondToToolUse(value);
  } else {
    emit('user_message', { type: 'user_message', text: value });
  }
}
```

Key changes:
- `respondOption` now calls `respondToToolUse` (renamed for clarity)
- `sendUserInput` routes to `respondToToolUse` if there's a pending tool use, otherwise emits `user_message`
- Old `respond()` removed — was doing double duty

- [ ] **Step 2: Update manifest**

Update the manifest emits array (~line 555):

```javascript
manifest: { name: 'chat', accepts: ['assistant', 'user', 'status', 'clear'], emits: ['response', 'user_message', 'stop', 'tts', 'ready', 'avatar_toggle'] },
```

- [ ] **Step 3: Verify in browser**

Open in browser, type a message, press Enter. Check console:
- Without pending tool use: should attempt `emit('user_message', {type: 'user_message', text: '...'})` 
- Input field clears after send
- Textarea height resets after send

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/chat/index.html
git commit -m "feat(chat): split response/user_message emit types"
```

---

### Task 3: Add stop button

**Files:**
- Modify: `apps/sigil/chat/index.html` — CSS (~line 419-433), HTML (~line 479-482), JS setActive/setIdle

- [ ] **Step 1: Add stop button CSS**

After the `.btn-send:active` rule (~line 433), add:

```css
.btn-stop {
  padding: 8px 16px;
  border-radius: 8px;
  background: rgba(255,69,58,0.2);
  color: #ff453a;
  border: 1px solid rgba(255,69,58,0.3);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  transition: all 0.15s ease;
  display: none;
}
.btn-stop:hover { background: rgba(255,69,58,0.3); }
.btn-stop:active { transform: scale(0.96); }
```

- [ ] **Step 2: Add stop button HTML**

In the input bar (~line 479-482), add the stop button after the send button:

```html
    <div class="input-bar">
      <textarea class="text-input" id="userInput" placeholder="Type a message..." rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendUserInput()}" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,80)+'px'"></textarea>
      <button class="btn-send" onclick="sendUserInput()">Send</button>
      <button class="btn-stop" id="btnStop" onclick="emitStop()">Stop</button>
    </div>
```

- [ ] **Step 3: Add stop JS**

Add the `emitStop` function and update `setActive`/`setIdle` to toggle the stop button visibility. After the `setIdle()` function:

```javascript
function emitStop() {
  emit('stop', { type: 'stop' });
  setIdle();
}
```

Update `setActive()`:

```javascript
function setActive() {
  var dot = document.getElementById('dot');
  dot.classList.add('active');
  document.getElementById('btnStop').style.display = '';
}
```

Update `setIdle()`:

```javascript
function setIdle() {
  var dot = document.getElementById('dot');
  dot.classList.remove('active');
  document.getElementById('btnStop').style.display = 'none';
}
```

- [ ] **Step 4: Verify in browser**

Open in browser:
- Stop button is hidden by default (display: none)
- Call `setActive()` in console — stop button appears, red styling
- Click stop — calls `emitStop()`, button hides again

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/chat/index.html
git commit -m "feat(chat): add stop button for agent interruption"
```

---

### Task 4: Document chat canvas protocol

**Files:**
- Modify: `apps/sigil/CLAUDE.md`

- [ ] **Step 1: Add Chat Canvas Protocol section**

Append this section at the end of `apps/sigil/CLAUDE.md`:

```markdown
## Chat Canvas Protocol

The chat canvas (`chat/index.html`) is a bidirectional conversational surface. Agents project into it — the canvas does not run its own Claude API client.

### Sending to canvas

Push messages via `evalCanvas('chat', 'headsup.receive("' + btoa(json) + '")')` or the coordination channel. Payload must be base64-encoded JSON.

| Message | Payload | Effect |
|---------|---------|--------|
| Assistant message | `{type: 'assistant', content: [<Anthropic content blocks>]}` | Renders text, thinking, tool use, images |
| Echo user message | `{type: 'user', content: string}` | Shows user bubble |
| Status line | `{type: 'status', text: string}` | Replaces status indicator |
| Clear | `{type: 'clear'}` | Resets conversation display |

Supported content block types: `text`, `thinking`, `redacted_thinking`, `tool_use`, `tool_result`, `image`, `server_tool_use`, `web_search_tool_result`, `web_fetch_tool_result`, `code_execution_tool_result`, `bash_code_execution_tool_result`.

Special tool_use renderers: `AskUserQuestion` (option buttons), `TodoWrite` (checklist), `ExitPlanMode` (plan card).

### Receiving from canvas

Messages arrive via the canvas `onMessage` callback (Swift side). All messages have a `type` field:

| Type | Payload | When |
|------|---------|------|
| `response` | `{type, value: string, tool_use_id: string}` | User answered an AskUserQuestion |
| `user_message` | `{type, text: string}` | User sent a free-form message |
| `stop` | `{type}` | User requested interrupt |
| `ready` | `{type, ...manifest}` | Canvas loaded |
| `avatar_toggle` | `{type}` | User clicked the avatar dot |
| `drag_start` / `move_abs` / `drag_end` | position data | Window drag |

### Active state

Call `setActive()` (via eval) when the agent is generating. This pulses the status dot and shows the stop button. Call `setIdle()` when done. Input is always enabled regardless of state.
```

- [ ] **Step 2: Commit**

```bash
git add apps/sigil/CLAUDE.md
git commit -m "docs(chat): add chat canvas protocol reference"
```

---

### Task 5: Update task queue

**Files:**
- Modify: `memory/task-queue.md`

- [ ] **Step 1: Move chat surface integration to Done**

Move "Chat surface integration" from Queued to Done in `memory/task-queue.md`, adding a summary:

```markdown
### chat-integration (2026-04-08)
Chat canvas bidirectional messaging.

- Unlocked free-form input (always enabled, not gated on AskUserQuestion)
- Split emit into `response` (tool use answer) and `user_message` (unprompted input)
- Added stop button with `stop` emit for agent interruption
- Documented chat canvas protocol in `apps/sigil/CLAUDE.md`
```

- [ ] **Step 2: Commit**

```bash
git add memory/task-queue.md
git commit -m "chore: mark chat-integration done in task queue"
```

#!/usr/bin/env python3
"""test_chat_rendering.py — Verify chat.html renders all content block types correctly.

Requires heads-up daemon running with a chat overlay loaded.
Starts its own session, sends messages, queries the DOM via eval, tears down.
"""

import json
import subprocess
import sys
import time
import os

AGENT_OS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
HEADS_UP = os.path.join(AGENT_OS, "packages", "heads-up", "heads-up")
CHAT_HTML = os.path.join(AGENT_OS, "tools", "dogfood", "chat.html")

PASS = 0
FAIL = 0


def heads_up(*args):
    result = subprocess.run(
        [HEADS_UP] + list(args),
        capture_output=True, text=True, timeout=10
    )
    if result.stdout.strip():
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            return result.stdout.strip()
    return None


def send_msg(msg):
    """Send a message to the chat overlay via base64 transport."""
    import base64
    j = json.dumps(msg)
    b64 = base64.b64encode(j.encode("utf-8")).decode("ascii")
    return heads_up("eval", "--id", "test-chat", "--js", f"headsup.receive('{b64}')")


def query_dom(js):
    """Run JS in the chat overlay and return parsed result."""
    resp = heads_up("eval", "--id", "test-chat", "--js", js)
    if resp and "result" in resp:
        try:
            return json.loads(resp["result"])
        except (json.JSONDecodeError, TypeError):
            return resp["result"]
    return None


def msg_count():
    return int(query_dom("document.querySelectorAll('.msg').length") or 0)


def last_msg_has(selector):
    return query_dom(
        f"document.querySelector('.msg:last-child {selector}') !== null"
    )


def last_msg_class():
    return query_dom(
        "document.querySelector('.msg:last-child').className"
    )


def assert_test(label, condition):
    global PASS, FAIL
    if condition:
        PASS += 1
    else:
        FAIL += 1
        print(f"FAIL: {label}")


# --- Setup ---

print("Setting up test session...")
subprocess.run(["pkill", "-f", "heads-up serve"], capture_output=True)
time.sleep(0.3)
heads_up("create", "--id", "test-chat", "--at", "0,0,400,500", "--file", CHAT_HTML, "--interactive")
time.sleep(0.5)

initial = msg_count()
assert_test("starts empty", initial == 0)

# --- Text block ---
send_msg({"type": "assistant", "content": [{"type": "text", "text": "Hello **world**"}]})
time.sleep(0.2)
assert_test("text: adds message", msg_count() == initial + 1)
assert_test("text: is assistant", "assistant" in (last_msg_class() or ""))
assert_test("text: renders bold", last_msg_has("strong"))

# --- Thinking block ---
send_msg({"type": "assistant", "content": [{"type": "thinking", "thinking": "Let me think...", "signature": "sig"}]})
time.sleep(0.2)
assert_test("thinking: renders", last_msg_has(".thinking-block"))
assert_test("thinking: starts collapsed", not query_dom(
    "document.querySelector('.msg:last-child .thinking-block').classList.contains('open')"
))

# --- Redacted thinking ---
send_msg({"type": "assistant", "content": [{"type": "redacted_thinking", "data": "x"}]})
time.sleep(0.2)
assert_test("redacted: renders", last_msg_has(".redacted-block"))

# --- Tool use (generic) ---
send_msg({"type": "assistant", "content": [{"type": "tool_use", "name": "Bash", "id": "t1", "input": {"command": "ls"}}]})
time.sleep(0.2)
assert_test("tool_use: renders card", last_msg_has(".tool-card"))
assert_test("tool_use: shows name", query_dom(
    "document.querySelector('.msg:last-child .tool-card-name').textContent"
) == "Bash")

# --- Tool result (success) ---
send_msg({"type": "assistant", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "file1.txt\nfile2.txt", "is_error": False}]})
time.sleep(0.2)
assert_test("tool_result: renders", last_msg_has(".tool-result"))
assert_test("tool_result: not error", not last_msg_has(".tool-result.error"))

# --- Tool result (error) ---
send_msg({"type": "assistant", "content": [{"type": "tool_result", "tool_use_id": "t2", "content": "Permission denied", "is_error": True}]})
time.sleep(0.2)
assert_test("tool_result_error: renders", last_msg_has(".tool-result.error"))

# --- Code execution result ---
send_msg({"type": "assistant", "content": [{"type": "code_execution_tool_result", "tool_use_id": "c1", "content": {"stdout": "42\n", "stderr": "", "return_code": 0}}]})
time.sleep(0.2)
assert_test("code_exec: renders", last_msg_has(".tool-result"))
assert_test("code_exec: has pre", last_msg_has("pre"))

# --- Image (URL) ---
send_msg({"type": "assistant", "content": [{"type": "image", "source": {"type": "url", "url": "https://example.com/img.png"}}]})
time.sleep(0.2)
assert_test("image: renders", last_msg_has(".msg-image"))

# --- TodoWrite ---
send_msg({"type": "assistant", "content": [{"type": "tool_use", "name": "TodoWrite", "id": "td1", "input": {"todos": [
    {"content": "Task A", "status": "completed", "activeForm": "Doing A"},
    {"content": "Task B", "status": "in_progress", "activeForm": "Doing B"},
    {"content": "Task C", "status": "pending", "activeForm": "Doing C"},
]}}]})
time.sleep(0.2)
assert_test("todo: renders list", last_msg_has(".todo-list"))
assert_test("todo: correct count", query_dom(
    "document.querySelectorAll('.msg:last-child .todo-item').length"
) == 3)

# --- ExitPlanMode ---
send_msg({"type": "assistant", "content": [{"type": "tool_use", "name": "ExitPlanMode", "id": "p1", "input": {"plan": "## Step 1\nDo the thing"}}]})
time.sleep(0.2)
assert_test("plan: renders", last_msg_has(".plan-block"))

# --- AskUserQuestion ---
count_before = msg_count()
send_msg({"type": "assistant", "content": [{"type": "tool_use", "name": "AskUserQuestion", "id": "aq1", "input": {"questions": [{"question": "Pick one", "options": [{"label": "A"}, {"label": "B"}]}]}}]})
time.sleep(0.2)
assert_test("ask: renders options", last_msg_has(".options"))
assert_test("ask: correct option count", query_dom(
    "document.querySelectorAll('.msg:last-child .opt-btn').length"
) == 2)
assert_test("ask: sets pending id", query_dom("pendingToolUseId") == "aq1")
assert_test("ask: input enabled", not query_dom("document.getElementById('userInput').disabled"))

# --- User message ---
send_msg({"type": "user", "content": "User says hi"})
time.sleep(0.2)
assert_test("user: is user class", "user" in (last_msg_class() or ""))

# --- Status ---
send_msg({"type": "status", "text": "Working..."})
time.sleep(0.2)
assert_test("status: renders", last_msg_has("") and "status" in (last_msg_class() or ""))

# --- Status replacement ---
count_before = msg_count()
send_msg({"type": "status", "text": "Still working..."})
time.sleep(0.2)
assert_test("status: replaces previous", msg_count() == count_before)

# --- Clear ---
send_msg({"type": "clear"})
time.sleep(0.2)
assert_test("clear: empties messages", msg_count() == 0)

# --- Link sanitization ---
send_msg({"type": "assistant", "content": [{"type": "text", "text": "[safe](https://example.com) and [evil](javascript:alert(1))"}]})
time.sleep(0.2)
has_safe = query_dom("document.querySelector('.msg:last-child a[href=\"https://example.com\"]') !== null")
has_evil = query_dom("document.querySelector('.msg:last-child a[href*=\"javascript\"]') !== null")
assert_test("links: safe href rendered", has_safe)
assert_test("links: javascript href stripped", not has_evil)

# --- UTF-8 / emoji ---
send_msg({"type": "assistant", "content": [{"type": "text", "text": "Hello \U0001f44d caf\u00e9"}]})
time.sleep(0.2)
text = query_dom("document.querySelector('.msg:last-child').textContent")
assert_test("utf8: emoji survives", "\U0001f44d" in (text or ""))
assert_test("utf8: accents survive", "caf\u00e9" in (text or ""))

# --- Teardown ---
heads_up("remove", "--id", "test-chat")
time.sleep(0.3)

print(f"\nchat rendering: {PASS} passed, {FAIL} failed")
sys.exit(0 if FAIL == 0 else 1)

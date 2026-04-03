#!/bin/bash
# test_base64_pipeline.sh — Verify JSON survives the python3→base64 pipeline
# These are the escaping bugs that broke the old sed-based approach.

PASS=0
FAIL=0

assert_roundtrip() {
  local label="$1"
  local input="$2"
  local json
  json=$(python3 -c "
import json, sys
msg = {'type': 'assistant', 'content': [{'type': 'text', 'text': sys.argv[1]}]}
print(json.dumps(msg))
" "$input")

  local b64
  b64=$(python3 -c "
import sys, base64
b = base64.b64encode(sys.argv[1].encode('utf-8')).decode('ascii')
print(b, end='')
" "$json")

  # Decode and verify
  local decoded
  decoded=$(python3 -c "
import sys, base64, json
b64 = sys.argv[1]
raw = base64.b64decode(b64).decode('utf-8')
msg = json.loads(raw)
print(msg['content'][0]['text'])
" "$b64")

  if [[ "$decoded" == "$input" ]]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $label"
    echo "  input:   $(echo "$input" | head -1)"
    echo "  decoded: $(echo "$decoded" | head -1)"
  fi
}

# --- Tests ---

assert_roundtrip "plain text" "Hello world"
assert_roundtrip "single quotes" "it's got 'quotes' inside"
assert_roundtrip "double quotes" 'she said "hello" to him'
assert_roundtrip "backticks" 'use `code` here'
assert_roundtrip "backslashes" 'path\\to\\file'
assert_roundtrip "newlines" "line one
line two
line three"
assert_roundtrip "fenced code block" '```python
def hello():
    print("world")
```'
assert_roundtrip "markdown mix" '**bold** and *italic* and `code` and [link](https://example.com)'
assert_roundtrip "emoji" "Hello 👍 world 🎉 done ✅"
assert_roundtrip "unicode accents" "cafe\u0301 re\u0301sume\u0301 nai\u0308ve"
assert_roundtrip "smart quotes" "He said \u2018hello\u2019 and she said \u201cgoodbye\u201d"
assert_roundtrip "angle brackets" "if x < 10 && y > 20 then <done>"
assert_roundtrip "dollar signs" 'costs $100 or $(command) or ${var}'
assert_roundtrip "empty string" ""
assert_roundtrip "very long" "$(python3 -c "print('a' * 10000)")"

# --- Summary ---
echo ""
echo "base64 pipeline: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1

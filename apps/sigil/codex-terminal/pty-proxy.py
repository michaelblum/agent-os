#!/usr/bin/env python3
"""Small stdio-to-PTY proxy for the Sigil Agent Terminal bridge."""

import os
import pty
import json
import select
import signal
import subprocess
import sys
import time
import fcntl
import struct
import termios


DEFAULT_COLS = 80
DEFAULT_ROWS = 24
MAX_CONTROL_FRAME_BYTES = 8 * 1024


def bounded_int(value: str | None, default: int, lower: int, upper: int) -> int:
    try:
        parsed = int(value or "")
    except ValueError:
        return default
    return min(upper, max(lower, parsed))


def set_window_size(fd: int, rows: int, cols: int) -> None:
    packed = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, packed)


def json_object_end(data: bytes) -> int | None:
    depth = 0
    in_string = False
    escaped = False
    started = False
    for index, byte in enumerate(data):
        char = chr(byte)
        if not started:
            if char.isspace():
                continue
            if char != "{":
                return None
            started = True
            depth = 1
            continue
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index + 1
    return None


def apply_control_frame(master_fd: int, frame: bytes) -> None:
    try:
        message = json.loads(frame.decode("utf8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return
    if message.get("type") != "resize":
        return
    cols = bounded_int(str(message.get("cols", "")), DEFAULT_COLS, 20, 300)
    rows = bounded_int(str(message.get("rows", "")), DEFAULT_ROWS, 8, 120)
    set_window_size(master_fd, rows, cols)


def forward_stdin(master_fd: int, data: bytes, pending_control: bytearray) -> None:
    if pending_control:
        pending_control.extend(data)
        frame_end = json_object_end(bytes(pending_control[1:]))
        if frame_end is None:
            if len(pending_control) > MAX_CONTROL_FRAME_BYTES:
                pending_control.clear()
            return
        apply_control_frame(master_fd, bytes(pending_control[1 : frame_end + 1]))
        trailing = bytes(pending_control[frame_end + 1 :])
        pending_control.clear()
        if trailing:
            os.write(master_fd, trailing)
        return

    if not data.startswith(b"\0"):
        os.write(master_fd, data)
        return

    frame_end = json_object_end(data[1:])
    if frame_end is None:
        if len(data) > MAX_CONTROL_FRAME_BYTES:
            return
        pending_control.extend(data)
        return
    apply_control_frame(master_fd, data[1 : frame_end + 1])
    trailing = data[frame_end + 1 :]
    if trailing:
        os.write(master_fd, trailing)


def child_preexec(slave_fd: int):
    def prepare_child() -> None:
        os.setsid()
        try:
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        except OSError:
            pass

    return prepare_child


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: pty-proxy.py <command>", file=sys.stderr)
        return 2

    command = sys.argv[1]
    master_fd, slave_fd = pty.openpty()
    cols = bounded_int(os.environ.get("SIGIL_AGENT_TERMINAL_COLS"), DEFAULT_COLS, 20, 300)
    rows = bounded_int(os.environ.get("SIGIL_AGENT_TERMINAL_ROWS"), DEFAULT_ROWS, 8, 120)
    set_window_size(slave_fd, rows, cols)
    process = subprocess.Popen(
        command,
        shell=True,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        preexec_fn=child_preexec(slave_fd),
    )
    print(f"SIGIL_AGENT_PTY_CHILD_PID={process.pid}", file=sys.stderr, flush=True)

    def terminate_child(signum, _frame):
        try:
            os.killpg(process.pid, signum)
        except OSError:
            pass

    signal.signal(signal.SIGTERM, terminate_child)
    signal.signal(signal.SIGHUP, terminate_child)
    os.close(slave_fd)
    os.set_blocking(master_fd, False)
    stdin_fd = sys.stdin.fileno()
    os.set_blocking(stdin_fd, False)
    pending_control = bytearray()

    try:
        while True:
            readers, _, _ = select.select([master_fd, stdin_fd], [], [], 0.05)
            if master_fd in readers:
                try:
                    data = os.read(master_fd, 4096)
                except OSError:
                    data = b""
                if data:
                    os.write(sys.stdout.fileno(), data)
                elif process.poll() is not None:
                    break

            if stdin_fd in readers:
                try:
                    data = os.read(stdin_fd, 4096)
                except BlockingIOError:
                    data = b""
                if data:
                    forward_stdin(master_fd, data, pending_control)

            if process.poll() is not None:
                time.sleep(0.05)
                try:
                    while True:
                        data = os.read(master_fd, 4096)
                        if not data:
                            break
                        os.write(sys.stdout.fileno(), data)
                except OSError:
                    pass
                break
    except KeyboardInterrupt:
        try:
            os.killpg(process.pid, signal.SIGINT)
        except OSError:
            pass
    finally:
        try:
            os.close(master_fd)
        except OSError:
            pass

    return process.wait()


if __name__ == "__main__":
    raise SystemExit(main())

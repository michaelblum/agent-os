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


def bounded_int(value: str | None, default: int, lower: int, upper: int) -> int:
    try:
        parsed = int(value or "")
    except ValueError:
        return default
    return min(upper, max(lower, parsed))


def set_window_size(fd: int, rows: int, cols: int) -> None:
    packed = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, packed)


def handle_control_frame(master_fd: int, data: bytes) -> bool:
    if not data.startswith(b"\0"):
        return False
    try:
        message = json.loads(data[1:].decode("utf8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return True
    if message.get("type") != "resize":
        return True
    cols = bounded_int(str(message.get("cols", "")), DEFAULT_COLS, 20, 300)
    rows = bounded_int(str(message.get("rows", "")), DEFAULT_ROWS, 8, 120)
    set_window_size(master_fd, rows, cols)
    return True


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
    os.close(slave_fd)
    os.set_blocking(master_fd, False)
    stdin_fd = sys.stdin.fileno()
    os.set_blocking(stdin_fd, False)

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
                    if handle_control_frame(master_fd, data):
                        continue
                    os.write(master_fd, data)

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

#!/usr/bin/env python3
"""Small stdio-to-PTY proxy for the Sigil Codex terminal bridge."""

import os
import pty
import select
import signal
import subprocess
import sys
import time


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: pty-proxy.py <command>", file=sys.stderr)
        return 2

    command = sys.argv[1]
    master_fd, slave_fd = pty.openpty()
    process = subprocess.Popen(
        command,
        shell=True,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        preexec_fn=os.setsid,
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

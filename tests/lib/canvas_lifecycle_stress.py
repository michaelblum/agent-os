#!/usr/bin/env python3

import argparse
import json
import os
import pathlib
import socket
import subprocess
import threading
import time


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-root", required=True)
    parser.add_argument("--daemon-pid", required=True, type=int)
    parser.add_argument("--cycles", type=int, default=25)
    parser.add_argument("--concurrent-input", action="store_true")
    return parser.parse_args()


class LifecycleStress:
    def __init__(self, options):
        self.options = options
        self.root = pathlib.Path(options.state_root)
        self.lock_path = self.root / "repo" / "daemon.lock"
        self.socket_path = self.root / "repo" / "sock"
        self.env = os.environ.copy()
        self.env["AOS_STATE_ROOT"] = str(self.root)
        self.env["AOS_DISABLE_DAEMON_AUTOSTART"] = "1"
        self.stop = threading.Event()
        self.input_errors = []
        self.input_commands = 0

    def lock_pid(self):
        try:
            return int(json.loads(self.lock_path.read_text())["pid"])
        except Exception:
            return None

    def run(self, *args, timeout=10, check=True):
        completed = subprocess.run(
            ["./aos", *args],
            env=self.env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
        if check and completed.returncode != 0:
            raise RuntimeError(
                f"command failed ({completed.returncode}): ./aos {' '.join(args)}\n"
                f"stdout={completed.stdout[-1000:]}\nstderr={completed.stderr[-1000:]}"
            )
        actual_pid = self.lock_pid()
        if actual_pid != self.options.daemon_pid:
            raise RuntimeError(
                f"daemon identity changed: expected={self.options.daemon_pid} actual={actual_pid}"
            )
        if not self.socket_path.exists():
            raise RuntimeError("daemon socket disappeared during lifecycle stress")
        return completed

    def system_ping(self):
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.settimeout(3)
        connection.connect(str(self.socket_path))
        request = {
            "v": 1,
            "service": "system",
            "action": "ping",
            "data": {},
        }
        connection.sendall((json.dumps(request) + "\n").encode())
        buffer = b""
        while b"\n" not in buffer:
            chunk = connection.recv(65536)
            if not chunk:
                break
            buffer += chunk
        connection.close()
        if b"\n" not in buffer:
            raise RuntimeError("system.ping returned no complete response")
        response = json.loads(buffer.split(b"\n", 1)[0])
        if response.get("status") not in {"ok", "success"}:
            raise RuntimeError(f"system.ping failed: {response}")
        return response.get("data") or response

    def perturb_input(self):
        points = ("820,490", "1030,490", "900,525")
        index = 0
        while not self.stop.is_set():
            try:
                self.run("do", "hover", points[index % len(points)], timeout=5)
                self.run("do", "key", "x", timeout=5)
                self.input_commands += 2
                index += 1
            except Exception as error:
                self.input_errors.append(str(error))
                self.stop.set()

    def assert_coherent(self):
        listing = json.loads(self.run("show", "list", "--json").stdout)
        canvases = listing.get("canvases") or []
        expected = {"lifecycle-input-sink"} if self.options.concurrent_input else set()
        actual = {canvas.get("id") for canvas in canvases}
        if actual != expected:
            raise RuntimeError(f"unexpected canvas registry after stress: {sorted(actual)}")

        audit = json.loads(self.run("show", "audit", "--json").stdout)
        if audit.get("orphan_native_windows"):
            raise RuntimeError(f"orphan native windows after stress: {audit['orphan_native_windows']}")
        if audit.get("registered_without_native_window"):
            raise RuntimeError(
                "registered canvases without native windows after stress: "
                f"{audit['registered_without_native_window']}"
            )

        resources = self.system_ping().get("runtime_resources") or {}
        lifecycle = (resources.get("canvases") or {}).get("by_lifecycle_state") or {}
        if lifecycle.get("creating") or lifecycle.get("retiring"):
            raise RuntimeError(f"transient lifecycle state remained after stress: {lifecycle}")

    def execute(self):
        input_thread = None
        if self.options.concurrent_input:
            sink_html = (
                '<!doctype html><input autofocus value="input sink">'
                '<script>document.querySelector("input").focus();'
                'document.addEventListener("keydown",event=>event.preventDefault())</script>'
            )
            self.run(
                "show", "create", "--id", "lifecycle-input-sink",
                "--at", "760,420,360,160", "--html", sink_html,
                "--interactive", "--focus",
            )
            input_thread = threading.Thread(target=self.perturb_input, daemon=True)
            input_thread.start()

        started = time.time()
        try:
            for index in range(self.options.cycles):
                interactive_id = f"lifecycle-interactive-{index}"
                passive_id = f"lifecycle-passive-{index}"
                self.run(
                    "show", "create", "--id", interactive_id,
                    "--at", "240,240,150,90", "--html", "<button>interactive</button>",
                    "--interactive",
                )
                self.run("show", "list", "--json")
                self.run(
                    "show", "create", "--id", passive_id,
                    "--at", "420,240,150,90", "--html", "<div>passive</div>",
                )
                listing = json.loads(self.run("show", "list", "--json").stdout)
                ids = {canvas.get("id") for canvas in listing.get("canvases") or []}
                if interactive_id not in ids or passive_id not in ids:
                    raise RuntimeError(
                        f"created canvases absent from registry: {interactive_id}, {passive_id}"
                    )
                self.run("show", "remove", "--id", interactive_id)
                self.run("show", "remove", "--id", passive_id)
                if self.input_errors:
                    raise RuntimeError(f"concurrent input failed: {self.input_errors[-1]}")
            self.assert_coherent()
        finally:
            self.stop.set()
            if input_thread is not None:
                input_thread.join(timeout=10)

        return {
            "status": "passed",
            "daemon_pid": self.lock_pid(),
            "interactive_cycles": self.options.cycles,
            "passive_cycles": self.options.cycles,
            "concurrent_input": self.options.concurrent_input,
            "input_commands": self.input_commands,
            "elapsed_s": round(time.time() - started, 2),
        }


def main():
    options = parse_args()
    stress = LifecycleStress(options)
    result = stress.execute()
    if options.concurrent_input:
        stress.run("show", "remove", "--id", "lifecycle-input-sink")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()

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
    parser.add_argument("--targeted-key-helper")
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
        self.targeted_key_events = 0
        self.input_focus_lock = threading.Lock()
        self.hidden_window_baseline = 0
        self.unregistered_app_window_baseline = 0
        if options.concurrent_input and not options.targeted_key_helper:
            raise ValueError("--targeted-key-helper is required with --concurrent-input")

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

    def canvas_audit(self):
        return json.loads(self.run("show", "audit", "--json").stdout)

    def wait_for_canvas(self, canvas_id, predicate, timeout=5):
        deadline = time.time() + timeout
        while time.time() < deadline:
            listing = json.loads(self.run("show", "list", "--json").stdout)
            canvas = next(
                (item for item in listing.get("canvases") or [] if item.get("id") == canvas_id),
                None,
            )
            if canvas is not None and predicate(canvas):
                return canvas
            time.sleep(0.05)
        raise RuntimeError(f"canvas {canvas_id} did not reach the expected state")

    def bridge(self, canvas_id, message):
        script = (
            "window.webkit.messageHandlers.headsup.postMessage("
            + json.dumps(message, separators=(",", ":"))
            + ");'posted'"
        )
        self.run("show", "eval", "--id", canvas_id, "--js", script, timeout=12)

    def wait_for_document(self, canvas_id, timeout=20):
        deadline = time.time() + timeout
        observations = []
        while time.time() < deadline:
            try:
                result = json.loads(
                    self.run(
                        "show", "eval", "--id", canvas_id,
                        "--js", "document.readyState", timeout=7,
                    ).stdout
                )
            except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
                observations.append(f"{type(error).__name__}: {error}")
                time.sleep(0.1)
                continue
            observations.append(result)
            if result.get("result") in {"interactive", "complete"}:
                return
            time.sleep(0.05)
        raise RuntimeError(
            f"canvas {canvas_id} document did not become ready: {observations[-5:]}"
        )

    def assert_removed_ttl_metadata(self):
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.settimeout(3)
        connection.connect(str(self.socket_path))
        request = {
            "v": 1,
            "service": "see",
            "action": "observe",
            "data": {"events": ["canvas_lifecycle"], "snapshot": False},
        }
        connection.sendall((json.dumps(request) + "\n").encode())

        buffer = b""
        while b"\n" not in buffer:
            buffer += connection.recv(65536)
        _, buffer = buffer.split(b"\n", 1)

        canvas_id = "lifecycle-ttl-metadata"
        self.run(
            "show", "create", "--id", canvas_id,
            "--at", "240,240,150,90", "--html", "<div>ttl</div>", "--ttl", "30s",
        )
        self.run("show", "remove", "--id", canvas_id)

        deadline = time.time() + 3
        while time.time() < deadline:
            while b"\n" not in buffer:
                buffer += connection.recv(65536)
            line, buffer = buffer.split(b"\n", 1)
            if not line:
                continue
            message = json.loads(line)
            data = message.get("data") or {}
            if (
                message.get("event") == "canvas_lifecycle"
                and data.get("canvas_id") == canvas_id
                and data.get("action") == "removed"
            ):
                ttl = data.get("ttl")
                if not isinstance(ttl, (int, float)) or ttl <= 0:
                    raise RuntimeError(f"removed lifecycle event lost TTL metadata: {data}")
                connection.close()
                return
        connection.close()
        raise RuntimeError("removed lifecycle event was not observed")

    def assert_same_id_generation_isolation(self):
        parent_id = "lifecycle-lease-parent"
        child_id = "lifecycle-lease-child"
        child_url = "data:text/html,%3Chtml%3E%3Cbody%3Echild%3C/body%3E%3C/html%3E"
        self.run(
            "show", "create", "--id", parent_id,
            "--at", "240,240,150,90", "--html", "<div>parent</div>",
        )
        self.wait_for_document(parent_id)
        self.bridge(parent_id, {
            "type": "canvas.create",
            "payload": {
                "id": child_id,
                "frame": [420, 240, 150, 90],
                "url": child_url,
                "suspended": True,
            },
        })
        self.wait_for_canvas(child_id, lambda canvas: canvas.get("suspended") is True)

        self.bridge(parent_id, {
            "type": "canvas.suspend",
            "payload": {"id": parent_id},
        })
        self.wait_for_canvas(parent_id, lambda canvas: canvas.get("suspended") is True)
        self.bridge(parent_id, {
            "type": "canvas.resume",
            "payload": {"id": parent_id},
        })

        self.run("show", "remove", "--id", child_id)
        self.bridge(parent_id, {
            "type": "canvas.create",
            "payload": {
                "id": child_id,
                "frame": [420, 240, 150, 90],
                "url": child_url,
                "suspended": True,
            },
        })
        replacement = self.wait_for_canvas(
            child_id,
            lambda canvas: canvas.get("suspended") is True,
        )
        time.sleep(1.2)
        replacement = self.wait_for_canvas(child_id, lambda canvas: True)
        if replacement.get("suspended") is not True:
            raise RuntimeError(
                "stale resume completion activated a replacement canvas generation: "
                f"{replacement}"
            )
        self.run("show", "remove", "--id", parent_id)

    def warm_canvas_runtime(self):
        canvas_id = "lifecycle-runtime-warmup"
        self.run(
            "show", "create", "--id", canvas_id,
            "--at", "240,240,150,90", "--html", "<div>warmup</div>",
            "--interactive",
        )
        self.wait_for_document(canvas_id)
        self.run("show", "remove", "--id", canvas_id)
        self.wait_for_retirement_quiescence()

    def post_targeted_key(self):
        completed = subprocess.run(
            [
                self.options.targeted_key_helper,
                str(self.options.daemon_pid),
                "79",  # F18: non-text key posted only to the daemon process.
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
        )
        if completed.returncode != 0:
            raise RuntimeError(
                f"targeted key injection failed ({completed.returncode}): {completed.stderr}"
            )
        self.targeted_key_events += 1

    def wait_for_retirement_quiescence(self, timeout=5):
        deadline = time.time() + timeout
        while True:
            resources = self.system_ping().get("runtime_resources") or {}
            canvas_resources = resources.get("canvases") or {}
            if (
                canvas_resources.get("pending_retirements") == 0
                and canvas_resources.get("pending_retirement_ids") == []
                and canvas_resources.get("unregistered_canvas_window_count") == 0
            ):
                return resources
            if time.time() >= deadline:
                return resources
            time.sleep(0.05)

    def perturb_input(self):
        points = ("820,490", "1030,490", "900,525")
        index = 0
        while not self.stop.is_set():
            try:
                self.run("do", "hover", points[index % len(points)], timeout=5)
                with self.input_focus_lock:
                    self.run("show", "update", "--id", "lifecycle-input-sink", "--focus")
                    self.post_targeted_key()
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

        audit = self.canvas_audit()
        if audit.get("orphan_native_windows"):
            raise RuntimeError(f"orphan native windows after stress: {audit['orphan_native_windows']}")
        if audit.get("registered_without_native_window"):
            raise RuntimeError(
                "registered canvases without native windows after stress: "
                f"{audit['registered_without_native_window']}"
            )
        deadline = time.time() + 5
        while True:
            resources = self.system_ping().get("runtime_resources") or {}
            canvas_resources = resources.get("canvases") or {}
            if (
                canvas_resources.get("pending_retirements") == 0
                and canvas_resources.get("pending_retirement_ids") == []
                and canvas_resources.get("unregistered_canvas_window_count")
                == self.unregistered_app_window_baseline
            ):
                break
            if time.time() >= deadline:
                break
            time.sleep(0.05)

        lifecycle = (resources.get("canvases") or {}).get("by_lifecycle_state") or {}
        if lifecycle.get("creating") or lifecycle.get("retiring"):
            raise RuntimeError(f"transient lifecycle state remained after stress: {lifecycle}")
        canvas_resources = resources.get("canvases") or {}
        if canvas_resources.get("pending_retirements") != 0:
            raise RuntimeError(f"canvas finalization remained pending: {canvas_resources}")
        if canvas_resources.get("pending_retirement_ids") != []:
            raise RuntimeError(f"pending retirement IDs remained: {canvas_resources}")
        unregistered_count = canvas_resources.get("unregistered_canvas_window_count")
        if unregistered_count != self.unregistered_app_window_baseline:
            hidden = self.canvas_audit().get("non_visible_unmatched_native_windows") or []
            raise RuntimeError(
                "unregistered AppKit canvas windows grew above baseline: "
                f"baseline={self.unregistered_app_window_baseline} resources={canvas_resources} "
                f"window_server_hidden={hidden}"
            )
        hidden = self.canvas_audit().get("non_visible_unmatched_native_windows") or []
        if len(hidden) != self.hidden_window_baseline:
            raise RuntimeError(
                "hidden native windows grew above the warmed baseline: "
                f"baseline={self.hidden_window_baseline} windows={hidden}"
            )

    def execute(self):
        input_thread = None
        self.assert_removed_ttl_metadata()
        self.warm_canvas_runtime()
        baseline_resources = self.wait_for_retirement_quiescence()
        baseline_canvases = baseline_resources.get("canvases") or {}
        if (
            baseline_canvases.get("pending_retirements") != 0
            or baseline_canvases.get("pending_retirement_ids") != []
            or baseline_canvases.get("unregistered_canvas_window_count") != 0
        ):
            raise RuntimeError(f"canvas runtime did not reach a clean baseline: {baseline_canvases}")
        self.hidden_window_baseline = len(
            self.canvas_audit().get("non_visible_unmatched_native_windows") or []
        )
        self.unregistered_app_window_baseline = 0
        self.assert_same_id_generation_isolation()
        if self.options.concurrent_input:
            sink_html = (
                '<!doctype html><input autofocus value="input sink">'
                '<script>document.querySelector("input").focus();'
                'window.__testKeyCount=0;'
                'document.addEventListener("keydown",event=>{'
                'window.__testKeyCount+=1;event.preventDefault()})</script>'
            )
            self.run(
                "show", "create", "--id", "lifecycle-input-sink",
                "--at", "760,420,360,160", "--html", sink_html,
                "--interactive", "--focus",
            )
            self.wait_for_document("lifecycle-input-sink")
            input_thread = threading.Thread(target=self.perturb_input, daemon=True)
            input_thread.start()

        started = time.time()
        try:
            for index in range(self.options.cycles):
                interactive_id = f"lifecycle-interactive-{index}"
                passive_id = f"lifecycle-passive-{index}"
                with self.input_focus_lock:
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
        finally:
            self.stop.set()
            if input_thread is not None:
                input_thread.join(timeout=10)

        if self.input_errors:
            raise RuntimeError(f"concurrent input failed: {self.input_errors[-1]}")
        if self.options.concurrent_input:
            deadline = time.time() + 3
            delivered_keys = 0
            while True:
                key_result = json.loads(
                    self.run(
                        "show", "eval", "--id", "lifecycle-input-sink",
                        "--js", "window.__testKeyCount",
                    ).stdout
                )
                delivered_keys = int(float(key_result.get("result") or 0))
                if delivered_keys >= self.targeted_key_events or time.time() >= deadline:
                    break
                time.sleep(0.05)
            if delivered_keys < self.targeted_key_events:
                raise RuntimeError(
                    "targeted key events did not remain owned by the input sink: "
                    f"posted={self.targeted_key_events} delivered={delivered_keys}"
                )
        self.assert_coherent()

        return {
            "status": "passed",
            "daemon_pid": self.lock_pid(),
            "interactive_cycles": self.options.cycles,
            "passive_cycles": self.options.cycles,
            "concurrent_input": self.options.concurrent_input,
            "input_commands": self.input_commands,
            "targeted_key_events": self.targeted_key_events,
            "window_server_hidden_delta": max(
                0,
                len(self.canvas_audit().get("non_visible_unmatched_native_windows") or [])
                - self.hidden_window_baseline,
            ),
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

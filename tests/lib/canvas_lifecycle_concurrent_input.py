#!/usr/bin/env python3

import argparse
import json
import pathlib
import subprocess
import threading
import time

from canvas_lifecycle_support import LifecycleHarness


class NDJSONProcess:
    def __init__(self, command, env=None):
        self.command = command
        self.process = subprocess.Popen(
            command,
            env=env,
            text=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=1,
        )

    def request(self, payload):
        if self.process.poll() is not None:
            raise RuntimeError(self.failure("persistent input process exited"))
        self.process.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError(self.failure("persistent input process returned no response"))
        response = json.loads(line)
        if response.get("status") not in {"ok", "success"}:
            raise RuntimeError(f"persistent input request failed: {response}")
        return response

    def failure(self, message):
        stderr = self.process.stderr.read() if self.process.poll() is not None else ""
        return f"{message}: command={' '.join(self.command)} stderr={stderr[-1000:]}"

    def close(self):
        if self.process.poll() is not None:
            return
        try:
            self.request({"action": "end"})
        except Exception:
            self.process.terminate()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=3)


class PersistentTargetedKeyPoster:
    def __init__(self, helper, daemon_pid):
        self.process = subprocess.Popen(
            [helper, str(daemon_pid), "79"],
            text=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=1,
        )

    def post(self):
        if self.process.poll() is not None:
            raise RuntimeError(self.failure("targeted key poster exited"))
        self.process.stdin.write("post\n")
        self.process.stdin.flush()
        if self.process.stdout.readline().strip() != "ok":
            raise RuntimeError(self.failure("targeted key poster failed"))

    def failure(self, message):
        stderr = self.process.stderr.read() if self.process.poll() is not None else ""
        return f"{message}: {stderr[-1000:]}"

    def close(self):
        if self.process.poll() is not None:
            return
        self.process.stdin.write("quit\n")
        self.process.stdin.flush()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=3)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-root", required=True)
    parser.add_argument("--daemon-pid", required=True, type=int)
    parser.add_argument("--cycles", type=int, default=25)
    parser.add_argument("--targeted-key-helper", required=True)
    parser.add_argument("--observer-log", required=True)
    return parser.parse_args()


class ConcurrentInputScenario:
    sink_id = "lifecycle-input-sink"

    def __init__(self, options):
        self.options = options
        self.harness = LifecycleHarness(options.state_root, options.daemon_pid)
        self.stop = threading.Event()
        self.input_errors = []
        self.input_commands = 0
        self.click_commands = 0
        self.acknowledged_click_receipts = []
        self.targeted_key_events = 0
        self.input_focus_lock = threading.Lock()
        self.action_session = None
        self.key_poster = None

    def start_input_owners(self):
        self.action_session = NDJSONProcess(
            ["./aos", "do", "session"],
            env=self.harness.env,
        )
        self.key_poster = PersistentTargetedKeyPoster(
            self.options.targeted_key_helper,
            self.options.daemon_pid,
        )

    def close_input_owners(self):
        if self.action_session is not None:
            self.action_session.close()
        if self.key_poster is not None:
            self.key_poster.close()

    def post_targeted_key(self):
        self.key_poster.post()
        self.targeted_key_events += 1

    def record_click_receipt(self, response, owner):
        receipt = (response.get("execution") or {}).get("terminal_event_receipt")
        if not isinstance(receipt, str) or not receipt.startswith("aos-input-"):
            raise RuntimeError(f"{owner} omitted terminal input receipt: {response}")
        if receipt in self.acknowledged_click_receipts:
            raise RuntimeError(f"{owner} reused terminal input receipt: {receipt}")
        self.acknowledged_click_receipts.append(receipt)

    def perturb_input(self):
        points = ((820, 490), (1030, 490), (900, 525))
        index = 0
        while not self.stop.is_set():
            try:
                x, y = points[index % len(points)]
                self.action_session.request({"action": "move", "x": x, "y": y})
                response = self.action_session.request({
                    "action": "click",
                    "x": 900,
                    "y": 500,
                    "button": "left",
                    "count": 1,
                    "state_id": f"lifecycle-session-click-{index}",
                })
                self.record_click_receipt(response, "public action session")
                self.click_commands += 1
                with self.input_focus_lock:
                    self.harness.run("show", "update", "--id", self.sink_id, "--focus")
                    self.post_targeted_key()
                self.input_commands += 3
                index += 1
            except Exception as error:
                self.input_errors.append(str(error))
                self.stop.set()

    def create_input_sink(self):
        boot_epoch_offset_ms = time.time() * 1000 - time.monotonic() * 1000
        sink_html = (
            '<!doctype html><input autofocus value="input sink">'
            '<script>window.__fanoutProof={deliveries:0,moves:0,boundaries:[],invalid:[]};'
            f'window.__bootEpochOffsetMs={boot_epoch_offset_ms!r};'
            'window.headsup=window.headsup||{};'
            'window.headsup.receive=function(encoded){let event;try{event=JSON.parse(atob(encoded))}'
            'catch(error){window.__fanoutProof.invalid.push(String(error));return}'
            'if(event.input_schema_version!==2)return;'
            'window.__fanoutProof.deliveries+=1;'
            'if(event.event_kind!=="pointer")return;'
            'if(event.phase==="move"||event.phase==="drag")window.__fanoutProof.moves+=1;'
            'if((event.phase!=="down"&&event.phase!=="up")||'
            'typeof event.gesture_id!=="string"||!event.gesture_id.startsWith("aos-input-"))return;'
            'const receivedMonotonicMs=Date.now()-window.__bootEpochOffsetMs;'
            'window.__fanoutProof.boundaries.push({phase:event.phase,'
            'sequence:event.sequence&&event.sequence.value,'
            'receipt:event.gesture_id,'
            'latencyMs:receivedMonotonicMs-Number(event.timestamp_monotonic_ms)});};'
            'document.querySelector("input").focus();'
            'window.__testKeyCount=0;'
            'document.addEventListener("keydown",event=>{'
            'window.__testKeyCount+=1;event.preventDefault()})</script>'
        )
        self.harness.run(
            "show", "create", "--id", self.sink_id,
            "--at", "760,420,360,160", "--html", sink_html,
            "--interactive", "--focus",
        )
        self.harness.wait_for_document(self.sink_id)
        self.harness.bridge(self.sink_id, {
            "type": "subscribe",
            "payload": {"events": ["input_event"], "snapshot": False},
        })
        self.harness.wait_for_input_subscription(self.sink_id)

    def raw_target_boundaries(self):
        expected = set(self.acknowledged_click_receipts)
        deadline = time.time() + 3
        while True:
            records = []
            for line in pathlib.Path(self.options.observer_log).read_text().splitlines():
                if not line:
                    continue
                record = json.loads(line)
                event = record.get("event") if record.get("observer") == "input_event" else None
                phase = (event or {}).get("phase")
                receipt = (event or {}).get("gesture_id")
                if phase in {"down", "up"} and receipt in expected:
                    records.append({
                        "phase": phase,
                        "receipt": receipt,
                        "sequence": (event.get("sequence") or {}).get("value"),
                    })
            observed = {item["receipt"] for item in records if item["phase"] == "up"}
            if observed == expected or time.time() >= deadline:
                return records
            time.sleep(0.05)

    @staticmethod
    def paired_boundaries(boundaries, owner, expected_receipts):
        phases_by_receipt = {receipt: [] for receipt in expected_receipts}
        seen_sequences = set()
        for boundary in boundaries:
            phase = boundary.get("phase")
            receipt = boundary.get("receipt")
            sequence = str(boundary.get("sequence"))
            if sequence in seen_sequences:
                raise RuntimeError(f"{owner} duplicated sequence {sequence}")
            seen_sequences.add(sequence)
            if receipt not in phases_by_receipt:
                raise RuntimeError(f"{owner} delivered unexpected receipt {receipt}")
            phases_by_receipt[receipt].append(phase)
        incomplete = {
            receipt: phases
            for receipt, phases in phases_by_receipt.items()
            if phases != ["down", "up"]
        }
        if incomplete:
            raise RuntimeError(
                f"{owner} did not deliver exactly one ordered pair per acknowledged receipt: "
                f"{incomplete}"
            )
        return len(phases_by_receipt), seen_sequences

    def post_one_shot_click(self):
        completed = self.harness.run(
            "do", "click", "900,500", "--dwell", "10",
            "--state-id", "lifecycle-one-shot-click",
        )
        response = json.loads(completed.stdout)
        self.record_click_receipt(response, "public one-shot action")
        self.click_commands += 1
        self.input_commands += 1

    def validate_fanout(self):
        deadline = time.time() + 3
        delivered_keys = 0
        while True:
            key_result = json.loads(
                self.harness.run(
                    "show", "eval", "--id", self.sink_id,
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

        expected_receipts = set(self.acknowledged_click_receipts)
        if len(expected_receipts) != self.click_commands:
            raise RuntimeError(
                "acknowledged click receipts do not match successful commands: "
                f"commands={self.click_commands} receipts={len(expected_receipts)}"
            )
        deadline = time.time() + 3
        while True:
            fanout_result = json.loads(
                self.harness.run(
                    "show", "eval", "--id", self.sink_id,
                    "--js", "JSON.stringify(window.__fanoutProof)",
                ).stdout
            )
            fanout = json.loads(fanout_result.get("result") or "{}")
            observed = {
                item.get("receipt")
                for item in fanout.get("boundaries") or []
                if item.get("phase") == "up"
            }
            if observed >= expected_receipts or time.time() >= deadline:
                break
            time.sleep(0.05)
        if fanout.get("invalid"):
            raise RuntimeError(f"canvas input fanout decode failed: {fanout['invalid']}")
        if int(fanout.get("moves") or 0) < 1:
            raise RuntimeError(f"canvas input fanout did not deliver pointer motion: {fanout}")

        boundaries = fanout.get("boundaries") or []
        raw_boundaries = self.raw_target_boundaries()
        raw_matched_clicks, raw_sequences = self.paired_boundaries(
            raw_boundaries,
            "raw input observation",
            expected_receipts,
        )
        matched_clicks, canvas_sequences = self.paired_boundaries(
            boundaries,
            "canvas input fanout",
            expected_receipts,
        )
        missing = sorted(raw_sequences - canvas_sequences)
        unexpected = sorted(canvas_sequences - raw_sequences)
        if missing or unexpected:
            raise RuntimeError(
                "canvas input fanout diverged from raw-observed boundaries: "
                f"missing_sequences={missing} unexpected_sequences={unexpected} "
                f"raw_boundaries={raw_boundaries} canvas_boundaries={boundaries}"
            )

        latencies = []
        for boundary in boundaries:
            latency = float(boundary.get("latencyMs"))
            if latency < -50 or latency > 500:
                raise RuntimeError(
                    "canvas input fanout exceeded event-to-JS latency bound: "
                    f"latency_ms={latency} boundary={boundary}"
                )
            latencies.append(latency)
        if matched_clicks != raw_matched_clicks:
            raise RuntimeError(
                "canvas input fanout did not preserve complete raw click pairs: "
                f"raw={raw_matched_clicks} canvas={matched_clicks} boundaries={boundaries}"
            )
        return {
            "deliveries": int(fanout.get("deliveries") or 0),
            "moves": int(fanout.get("moves") or 0),
            "injected_clicks": self.click_commands,
            "raw_clicks": raw_matched_clicks,
            "canvas_clicks": matched_clicks,
            "unobserved_injections": 0,
            "max_latency_ms": round(max(latencies), 2),
        }

    def execute(self):
        self.harness.prepare_baseline()
        self.create_input_sink()
        self.start_input_owners()
        input_thread = threading.Thread(target=self.perturb_input, daemon=True)
        input_thread.start()
        started = time.time()
        try:
            for index in range(self.options.cycles):
                self.harness.run_cycle(index, interactive_lock=self.input_focus_lock)
                if self.input_errors:
                    raise RuntimeError(f"concurrent input failed: {self.input_errors[-1]}")
        finally:
            self.stop.set()
            input_thread.join(timeout=10)

        if input_thread.is_alive():
            raise RuntimeError("concurrent input worker did not stop")
        if self.input_errors:
            raise RuntimeError(f"concurrent input failed: {self.input_errors[-1]}")
        self.post_one_shot_click()
        fanout = self.validate_fanout()
        self.harness.assert_coherent({self.sink_id})
        return self.harness.result(
            self.options.cycles,
            started,
            concurrent_input=True,
            input_commands=self.input_commands,
            targeted_key_events=self.targeted_key_events,
            canvas_input_fanout=fanout,
        )


def main():
    options = parse_args()
    scenario = ConcurrentInputScenario(options)
    try:
        result = scenario.execute()
        scenario.harness.run("show", "remove", "--id", scenario.sink_id)
        print(json.dumps(result, sort_keys=True))
    finally:
        scenario.close_input_owners()


if __name__ == "__main__":
    main()

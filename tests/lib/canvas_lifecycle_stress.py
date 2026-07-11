#!/usr/bin/env python3

import argparse
import json
import time

from canvas_lifecycle_support import LifecycleHarness


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-root", required=True)
    parser.add_argument("--daemon-pid", required=True, type=int)
    parser.add_argument("--cycles", type=int, default=25)
    return parser.parse_args()


def main():
    options = parse_args()
    harness = LifecycleHarness(options.state_root, options.daemon_pid)
    harness.prepare_baseline()
    started = time.time()
    for index in range(options.cycles):
        harness.run_cycle(index)
    harness.assert_coherent()
    print(json.dumps(harness.result(options.cycles, started), sort_keys=True))


if __name__ == "__main__":
    main()

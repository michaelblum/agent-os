#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "Compiling avatar-sub..."
swiftc -parse-as-library -O -o avatar-sub \
    avatar-easing.swift \
    avatar-ipc.swift \
    avatar-animate.swift \
    avatar-spatial.swift \
    avatar-behaviors.swift \
    avatar-sub.swift
echo "Done: ./avatar-sub ($(du -h avatar-sub | cut -f1))"

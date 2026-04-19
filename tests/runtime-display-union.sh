#!/usr/bin/env bash
set -e
# Default output is DesktopWorld: origin (0,0) by construction, non-negative
# width/height. Format: x,y,w,h (comma-separated integers).
DEFAULT=$(./aos runtime display-union)
echo "$DEFAULT" | grep -qE '^0,0,[0-9]+,[0-9]+$' || { echo "FAIL default: $DEFAULT"; exit 1; }

# --native output preserves the legacy native-compat global_bounds shape,
# which may have negative x/y on multi-display setups.
NATIVE=$(./aos runtime display-union --native)
echo "$NATIVE" | grep -qE '^-?[0-9]+,-?[0-9]+,[0-9]+,[0-9]+$' || { echo "FAIL native: $NATIVE"; exit 1; }

echo "PASS"

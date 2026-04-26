---
type: agent
id: default
name: Default
tags: [sigil, orchestrator]
---

The default Sigil agent. Purple polyhedron, parked in the bottom-right
of the main display at boot.

```json
{
  "version": 1,
  "appearance": {
    "shape": 6,
    "stellation": 0,
    "opacity": 0.25,
    "edgeOpacity": 1.0,
    "maskEnabled": true,
    "interiorEdges": true,
    "specular": true,
    "aura": { "enabled": true, "reach": 0.75, "intensity": 1.0, "pulseRate": 0.0025 },
    "colors": {
      "face": ["#bc13fe", "#4a2b6e"],
      "edge": ["#bc13fe", "#4a2b6e"],
      "aura": ["#bc13fe", "#2a1b3d"]
    },
    "phenomena": {
      "pulsar":    { "enabled": false, "count": 1 },
      "gamma":     { "enabled": false, "count": 1 },
      "accretion": { "enabled": false, "count": 1 },
      "neutrino":  { "enabled": false, "count": 1 }
    },
    "transitions": {
      "enter": "scale",
      "exit": "scale",
      "fastTravel": "line",
      "scaleDuration": 0.18,
      "wormhole": {
        "captureRadius": 96,
        "implosionDuration": 0.22,
        "reboundDuration": 0.34,
        "distortionStrength": 0.82,
        "whitePointIntensity": 1.0,
        "starburstIntensity": 0.95,
        "lensFlareIntensity": 0.8
      }
    },
    "trails": { "enabled": true, "count": 6, "opacity": 0.5, "fadeMs": 400, "style": "omega" }
  },
  "minds": { "skills": [], "tools": [], "workflows": [] },
  "instance": {
    "birthplace": { "anchor": "nonant", "nonant": "bottom-right", "display": "main" },
    "size": 180
  }
}
```

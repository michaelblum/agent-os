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
    "tesseron": { "enabled": true, "proportion": 0.5, "matchMother": true },
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
      "lineInterDimensional": true,
      "line": {
        "duration": 0.22,
        "delay": 0,
        "repeatCount": 10,
        "repeatDuration": 2.0,
        "trailMode": "fade",
        "lagFactor": 0.05,
        "scale": 1.5
      },
      "scaleDuration": 0.18,
      "wormhole": {
        "captureRadius": 96,
        "implosionDuration": 1.5,
        "travelDuration": 0.5,
        "reboundDuration": 1.2,
        "distortionStrength": 1.2,
        "twist": 3.14,
        "zoom": 3.5,
        "shadingEnabled": true,
        "tunnelShadow": 0.8,
        "specularIntensity": 0.4,
        "lightAngle": 2.35,
        "objectEnabled": true,
        "objectHeight": 0.8,
        "objectSpin": 4.5,
        "particlesEnabled": true,
        "particleDensity": 0.05,
        "flashIntensity": 1.5,
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

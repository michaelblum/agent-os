# Brain Hologram Radial Asset

Sigil's wiki radial item is configured to load a native Three.js glTF asset from
this directory:

```text
apps/sigil/renderer/assets/models/brain-hologram/scene.gltf
```

Source model:

- Title: Brain hologram
- Author: oxterium
- URL: https://sketchfab.com/3d-models/brain-hologram-09d686a1a1f745cba6b2385d0c831214
- License: Sketchfab Free Standard

This checked-in copy is optimized for the radial menu's small on-screen render:
geometry has been simplified, unused texture coordinates have been removed, and
positions/normals are quantized with `KHR_mesh_quantization`, which is supported
by the vendored Three.js `GLTFLoader`.

Runtime files:

```text
scene.gltf
scene.bin
```

The asset has no texture files. The hologram look comes from the source
emissive material colors and the radial menu's source-emissive material pass.

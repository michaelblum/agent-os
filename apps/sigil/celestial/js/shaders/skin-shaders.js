// Uber skin shader — combines planet + solar surface generation
// Ported from v2-rebuild: planet.frag, planet.vert, star.frag

import { simplex3D, fbm } from './noise.js';
import { fresnel } from './fresnel.js';

export const skinVertexShader = /* glsl */ `
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec2 vUv;

void main() {
  vPosition = position;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;

  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const skinFragmentShader = /* glsl */ `
${simplex3D}
${fbm}
${fresnel}

uniform float time;
uniform float noiseScale;
uniform int noiseOctaves;
uniform float roughness;
uniform sampler2D colorRamp;
uniform int skinType;        // 0=rocky, 1=gas-giant, 2=ice, 3=volcanic, 4=solar
uniform vec3 lightPosition;
uniform float uOpacity;
uniform float uSpecular;

varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec2 vUv;

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);

  // ── Solar (type 4): self-luminous, no external lighting ──
  if (skinType == 4) {
    vec3 noisePos = vPosition * noiseScale + vec3(time * 0.03, time * 0.021, 0.0);
    float noise = fbm(noisePos, 4);
    float largeCells = snoise(vPosition * noiseScale * 0.3 + vec3(time * 0.006));
    float surfaceBrightness = 0.7 + noise * 0.25 + largeCells * 0.15;
    float hotSpots = smoothstep(0.3, 0.6, noise) * 0.4;
    surfaceBrightness += hotSpots;

    // Base color from center of ramp
    vec3 baseColor = texture2D(colorRamp, vec2(0.5, 0.5)).rgb;
    vec3 hotColor = mix(baseColor, vec3(1.0), 0.5);
    vec3 coolColor = baseColor * 0.6;
    vec3 surfaceColor = mix(coolColor, hotColor, surfaceBrightness);

    // Limb darkening
    float limb = limbDarkening(vNormal, viewDir, 0.6);
    surfaceColor *= (0.4 + 0.6 * limb);

    // Chromosphere edge glow
    float edgeGlow = fresnelEdge(vNormal, viewDir, 3.0);
    surfaceColor += baseColor * edgeGlow * 0.3;

    gl_FragColor = vec4(surfaceColor, uOpacity);
    return;
  }

  // ── Planet types (0-3): externally lit ──
  float noise = 0.0;

  if (skinType == 1) {
    // Gas giant: horizontal bands + storm spots
    float latitude = vPosition.y * 3.0;
    float bands = sin(latitude * 8.0 + snoise(vPosition * 2.0) * 0.5) * 0.5 + 0.5;
    float storms = smoothstep(0.4, 0.6, snoise(vPosition * noiseScale * 0.5 + vec3(time * 0.02, 0.0, 0.0)));
    noise = bands * 0.7 + storms * 0.3;
  } else if (skinType == 3) {
    // Volcanic: cracked surface with lava
    float terrain = fbm(vPosition * noiseScale, 4);
    float cracks = 1.0 - smoothstep(0.0, 0.1, abs(terrain));
    noise = terrain * 0.5 + 0.5;
    if (cracks > 0.3) {
      noise = 0.95;
    }
  } else {
    // Rocky (0) / Ice (2): continental terrain
    noise = fbm(vPosition * noiseScale, noiseOctaves);
    noise = noise * 0.5 + 0.5;
    noise += snoise(vPosition * noiseScale * 8.0) * roughness * 0.1;
  }

  // Ice: polar caps
  if (skinType == 2) {
    float polar = abs(vPosition.y) / max(length(vPosition), 0.001);
    float iceCap = smoothstep(0.5, 0.8, polar);
    noise = mix(noise, 1.0, iceCap);
  }

  // Sample color ramp
  noise = clamp(noise, 0.0, 1.0);
  vec3 surfaceColor = texture2D(colorRamp, vec2(noise, 0.5)).rgb;

  // Lighting from light source
  vec3 lightDir = normalize(lightPosition - vWorldPosition);
  float diffuse = max(dot(vNormal, lightDir), 0.0);

  // Blinn-Phong specular
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(dot(vNormal, halfDir), 0.0), 32.0) * 0.4 * uSpecular;

  float lighting = diffuse * 1.4 + spec;

  // Volcanic: emissive lava glow in cracks
  if (skinType == 3) {
    float terrain = fbm(vPosition * noiseScale, 4);
    float cracks = 1.0 - smoothstep(0.0, 0.08, abs(terrain));
    surfaceColor += vec3(1.0, 0.3, 0.0) * cracks * 2.0;
  }

  gl_FragColor = vec4(surfaceColor * lighting, uOpacity);
}
`;

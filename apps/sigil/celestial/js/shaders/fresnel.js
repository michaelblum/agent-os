// Fresnel edge effects — ported from v2-rebuild: src/lib/shaders/includes/fresnel.glsl

export const fresnel = /* glsl */ `
float fresnelEdge(vec3 normal, vec3 viewDir, float power) {
  float f = abs(dot(normalize(normal), normalize(viewDir)));
  return pow(1.0 - clamp(f, 0.0, 1.0), power);
}

float limbDarkening(vec3 normal, vec3 viewDir, float power) {
  float cosAngle = max(dot(normalize(normal), normalize(viewDir)), 0.0);
  return pow(cosAngle, power);
}
`;

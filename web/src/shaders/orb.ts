// Ink is accumulated from persistent, moving material particles. This pass has
// no symbol, signed-distance field, or shape-dependent visibility operation.
export const INK_VERTEX = /* glsl */ `
attribute float aTone;
attribute float aSize;
attribute float aWeight;
attribute float aDepth;
attribute vec3 aVelocity;
uniform float uPointScale;
varying float vTone;
varying float vSize;
varying float vWeight;
varying vec2 vDirection;
varying float vStretch;
void main() {
  vTone = aTone;
  vSize = aSize;
  // Depth is only non-zero on the thinking knot: the near side reads bigger
  // and denser, the far side smaller and fainter, so the loops stack in 3D.
  float near = clamp(aDepth * 3.0 + 0.5, 0.0, 1.0);
  vWeight = aWeight * (0.3 + 0.8 * near);
  // Resting ink still streaks along its current; moving ink streaks along
  // its velocity, so strands read as flow rather than a field of dots.
  float speed = length(aVelocity.xy);
  vec2 tangent = normalize(vec2(-position.y, position.x) + vec2(0.0001, 0.0));
  vec2 moving = aVelocity.xy / max(speed, 0.0001);
  vDirection = normalize(mix(tangent, moving, smoothstep(0.02, 0.18, speed)));
  vStretch = max(0.2, smoothstep(0.0, 0.5, speed));
  gl_Position = vec4(position.xy, 0.0, 1.0);
  // Point size follows the density texture resolution so strands stay crisp
  // on large orbs; each particle carries its own tier (body, strand, filament).
  gl_PointSize = uPointScale * aSize * (0.85 + 0.3 * near);
}
`;

export const INK_FRAGMENT = /* glsl */ `
varying float vTone;
varying float vSize;
varying float vWeight;
varying vec2 vDirection;
varying float vStretch;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float along = dot(p, vDirection);
  float across = dot(p, vec2(-vDirection.y, vDirection.x));
  float kernel = mix(dot(p, p) * 16.0, along * along * 8.0 + across * across * 32.0, vStretch);
  // Large bodies are diffuse and translucent; fine filaments are dense.
  float mass = exp(-kernel) * 0.012 * (0.55 / vSize) * vWeight;
  // R: mass, G: pigment-weighted mass, B: motion-weighted mass.
  gl_FragColor = vec4(mass, mass * vTone, mass * smoothstep(0.45, 1.0, vStretch), 0.0);
}
`;

export const ORB_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const ORB_FRAGMENT = /* glsl */ `
uniform sampler2D uInk;
uniform float uTime;
uniform float uLevel;
uniform float uEnergy;
uniform float uThinking;
uniform vec2 uTexel;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
varying vec2 vUv;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

vec3 inkAt(vec2 uv) { return texture2D(uInk, uv).rgb; }

// Sobel gradient of ink mass: the field's surface normal for lighting.
vec2 inkGradient(vec2 uv) {
  float tl = inkAt(uv + vec2(-uTexel.x,  uTexel.y)).r, t = inkAt(uv + vec2(0.0,  uTexel.y)).r, tr = inkAt(uv + uTexel).r;
  float l  = inkAt(uv + vec2(-uTexel.x, 0.0)).r,                                          rr = inkAt(uv + vec2(uTexel.x, 0.0)).r;
  float bl = inkAt(uv - uTexel).r,                     b = inkAt(uv + vec2(0.0, -uTexel.y)).r, br = inkAt(uv + vec2(uTexel.x, -uTexel.y)).r;
  return vec2((tr + 2.0 * rr + br) - (tl + 2.0 * l + bl), (tl + 2.0 * t + tr) - (bl + 2.0 * b + br)) * 0.25;
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  // Slow breathing: the vessel and its light both drift, never sit still.
  float breath = sin(uTime * 0.45) * 0.006 + sin(uTime * 0.11) * 0.003;
  // Thinking breathes on a slow four-second cycle: radius and inner glow together.
  float think = uThinking * (0.5 + 0.5 * sin(uTime * 1.57));
  float radius = 0.74 + uLevel * 0.10 + breath + think * 0.02;
  float r = length(p) / radius;
  float aa = max(fwidth(r), 0.002) * 1.25;
  if (r > 1.16) { gl_FragColor = vec4(0.0); return; }

  // Sphere geometry: depth gives a lens, fresnel, and an interior shading gradient.
  float rc = min(r, 1.0);
  float depth = sqrt(max(0.0, 1.0 - rc * rc));
  vec3 n = vec3(p / radius, depth);
  float fresnel = pow(1.0 - depth, 3.0);

  // Look through the glass: samples bend toward the centre near the rim, with
  // a faint chromatic split so the ink reads as suspended inside the vessel.
  vec2 lens = -n.xy * (1.0 - depth) * 0.055;
  vec2 uvG = vUv + lens;
  vec2 uvR = vUv + lens * 1.07;
  vec2 uvB = vUv + lens * 0.93;
  vec3 ink = inkAt(uvG);
  float mass = ink.r;
  float massR = inkAt(uvR).r;
  float massB = inkAt(uvB).r;
  float pigment = clamp(ink.g / max(mass, 0.001), 0.0, 1.0);
  float motion = clamp(ink.b / max(mass, 0.001), 0.0, 1.0);

  vec3 thickness = 1.0 - exp(-vec3(massR, mass, massB) * 4.5);
  float thick = thickness.g;
  vec2 gradient = inkGradient(uvG);
  vec3 surface = normalize(vec3(-gradient * 4.5, 1.0));
  float relief = clamp(length(gradient) * 6.0, 0.0, 1.0);

  // A key light orbits slowly; the fill stays put so the orb keeps its volume.
  vec3 light = normalize(vec3(cos(uTime * 0.07) * 0.6, 0.72 + sin(uTime * 0.05) * 0.12, 0.55));
  vec3 view = vec3(0.0, 0.0, 1.0);
  vec3 halfway = normalize(light + view);
  float diffuse = 0.58 + 0.42 * dot(surface, light);
  float sheen = pow(max(dot(surface, halfway), 0.0), 18.0) * 0.30;
  float glint = min(pow(max(dot(surface, halfway), 0.0), 140.0) * 0.55 * relief, 0.16);

  // Pigment: thin ink is cool and pale, thick ink deepens; interior pools darken.
  vec3 thin = mix(uColorC, uColorB, 0.25 + pigment * 0.55);
  vec3 deep = mix(uColorB, uColorA, 0.35 + pigment * 0.65);
  vec3 body = mix(thin, deep, smoothstep(0.08, 0.85, thick));
  float pooling = 1.0 - 0.32 * smoothstep(0.45, 1.0, thick) * (1.0 - relief);
  vec3 inkColor = body * diffuse * pooling * thickness;
  inkColor += uColorC * (sheen + glint) * thick;
  inkColor += uColorC * motion * thick * 0.12;
  // Speech glows from inside the material rather than washing the whole orb.
  inkColor += mix(uColorB, uColorC, 0.5) * thick * (uLevel * 0.45 + uEnergy * 0.08 + think * 0.22);

  // The vessel: dark interior with a soft volumetric gradient, fresnel rim,
  // and a whisper of the fill light rolling across the glass.
  float interior = 0.55 + 0.45 * dot(n, light);
  vec3 color = vec3(0.004, 0.007, 0.016) * interior;
  color += uColorA * (0.035 + think * 0.05) * depth * (1.0 - thick);
  color += inkColor;
  color += uColorB * fresnel * 0.16 + uColorC * fresnel * fresnel * 0.12;
  float glassSpec = pow(max(dot(n, halfway), 0.0), 60.0) * 0.06;
  color += uColorC * glassSpec;

  float boundary = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  float halo = exp(-abs(r - 1.0) * 42.0) * 0.028 * (1.0 + uLevel * 0.6);
  // Contact glow settles below the orb, hinting at a surface it rests on.
  halo += exp(-abs(r - 1.0) * 14.0) * max(0.0, -p.y) * 0.012;
  color += uColorC * halo;

  // Blue-ish noise dither removes banding on the dark halo and interior.
  color += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  gl_FragColor = vec4(color, max(boundary * 0.96, halo));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

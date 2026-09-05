// Ink is accumulated from persistent, moving material particles. This pass has
// no symbol, signed-distance field, or shape-dependent visibility operation.
export const INK_VERTEX = /* glsl */ `
attribute float aTone;
attribute vec3 aVelocity;
varying float vTone;
varying vec2 vVelocity;
void main() {
  vTone = aTone;
  vVelocity = aVelocity.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
  gl_PointSize = 14.0;
}
`;

export const INK_FRAGMENT = /* glsl */ `
varying float vTone;
varying vec2 vVelocity;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  vec2 direction = normalize(vVelocity + vec2(0.0001, 0.0));
  float along = dot(p, direction);
  float across = dot(p, vec2(-direction.y, direction.x));
  float stretch = smoothstep(0.0, 0.5, length(vVelocity));
  float kernel = mix(dot(p, p) * 16.0, along * along * 8.0 + across * across * 32.0, stretch);
  float mass = exp(-kernel) * 0.012;
  gl_FragColor = vec4(mass, mass * vTone, 0.0, 0.0);
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
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float radius = 0.74 + uLevel * 0.10 + sin(uTime * 0.5) * 0.006;
  float r = length(p) / radius;
  if (r > 1.1) { gl_FragColor = vec4(0.0); return; }

  vec2 ink = texture2D(uInk, vUv).rg;
  float mass = ink.r;
  float pigment = clamp(ink.g / max(mass, 0.001), 0.0, 1.0);
  vec2 texel = vec2(1.0 / 256.0, 0.0);
  vec2 gradient = vec2(
    texture2D(uInk, vUv + texel.xy).r - texture2D(uInk, vUv - texel.xy).r,
    texture2D(uInk, vUv + texel.yx).r - texture2D(uInk, vUv - texel.yx).r
  );
  float thickness = 1.0 - exp(-mass * 4.5);
  float edgeLight = clamp(length(gradient) * 0.7, 0.0, 0.18);
  float lighting = clamp(0.62 + dot(gradient, vec2(-0.6, 0.9)), 0.4, 0.85);
  vec3 color = vec3(0.003, 0.006, 0.015);
  color += mix(uColorA, uColorB, pigment) * thickness * lighting;
  color += uColorC * edgeLight * thickness * 0.25;
  color *= 1.0 + uLevel * 0.4;

  // The surrounding vessel stays quiet; only deposited ink creates the content.
  float depth = sqrt(max(0.0, 1.0 - r * r));
  float rim = pow(1.0 - depth, 4.0);
  float boundary = 1.0 - smoothstep(0.99, 1.025, r);
  color += uColorB * rim * 0.10 * boundary;
  float halo = exp(-abs(r - 1.0) * 48.0) * 0.025;
  color += uColorC * halo;
  gl_FragColor = vec4(color, max(boundary * 0.96, halo));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

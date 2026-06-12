// Ashima/Gustavson 3D simplex noise (public domain), used by the vertex shader.
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x - floor(x * (1.0/289.0)) * 289.0;}
vec4 mod289(vec4 x){return x - floor(x * (1.0/289.0)) * 289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

// Two octaves of domain-warped simplex noise: the first octave carves the
// broad swell, the second (warped by the first) adds fine shimmer that the
// live mic/playback level pushes harder, so loud moments read as "boiling".
export const ORB_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
uniform float uSpeed;
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vView;
varying float vDisp;
${NOISE}
void main() {
  float t = uTime * uSpeed;
  float n1 = snoise(normal * uFreq + t);
  float n2 = snoise(normal * uFreq * 2.6 - t * 1.7 + n1 * 0.65);
  float n = n1 * 0.72 + n2 * (0.28 + uLevel * 0.35);
  float disp = n * (uAmp + uLevel * 0.4);
  vDisp = n;
  vec3 pos = position + normal * disp;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

// Three-stop palette swept by displacement, a view-dependent fresnel rim
// tinted toward the third color (cheap iridescence), and a level-driven
// inner glow so the surface brightens with the audio it is visualising.
export const ORB_FRAGMENT = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vView;
varying float vDisp;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  float facing = clamp(dot(n, v), 0.0, 1.0);
  float fresnel = pow(1.0 - facing, 2.4);

  float band = smoothstep(-0.9, 0.9, vDisp);
  vec3 color = mix(uColorA, uColorB, band);
  color = mix(color, uColorC, fresnel * 0.85);
  color += uColorC * fresnel * 0.5;
  color += color * uLevel * 0.45;

  // faint core shadow keeps the centre from flattening out
  color *= 0.82 + 0.18 * pow(facing, 0.5);

  float alpha = 0.9 + fresnel * 0.1;
  gl_FragColor = vec4(color, alpha);
}
`;

// Halo: an enlarged back-face shell with an additive fresnel falloff —
// a fake bloom that costs one extra draw call instead of a post pass.
export const HALO_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const HALO_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.0);
  gl_FragColor = vec4(uColor, rim * uIntensity);
}
`;

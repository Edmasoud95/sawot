// Ashima/Gustavson 3D simplex noise (public domain), shared by both shaders.
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

// The silhouette stays a clean circle: displacement is a whisper (uAmp ≤ ~0.03)
// plus a slow breathing pulse. All the visible motion lives in the fragment
// shader as flowing colour, not in the geometry.
export const ORB_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uSpeed;
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;
${NOISE}
void main() {
  float t = uTime * uSpeed;
  float n = snoise(normal * 2.0 + t * 0.6);
  float breathe = 1.0 + 0.012 * sin(uTime * 0.9);
  vec3 pos = position * breathe + normal * n * (uAmp + uLevel * 0.04);
  vPos = normalize(position);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

// Internal currents: two counter-drifting noise fields blend a bright two-stop
// palette over very wide smoothstep ranges (no hard bands, no dark patches).
// A pale luminous core, soft top light, and a fresnel rim keep it dimensional.
export const ORB_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uFreq;
uniform float uSpeed;
uniform float uLevel;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;
${NOISE}
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  float facing = clamp(dot(n, v), 0.0, 1.0);
  float fresnel = pow(1.0 - facing, 2.5);

  float t = uTime * uSpeed;
  float f1 = snoise(vPos * uFreq + vec3(0.0, t * 0.5, t * 0.3));
  float f2 = snoise(vPos * uFreq * 1.9 + vec3(-t * 0.4, 0.0, t * 0.25) + f1 * 0.5);
  float flow = f1 * 0.65 + f2 * (0.35 + uLevel * 0.3);
  float blend = smoothstep(-1.1, 1.1, flow);

  vec3 color = mix(uColorA, uColorB, blend);
  color = mix(color, uColorC, pow(facing, 2.2) * 0.45);

  float topLight = 0.5 + 0.5 * clamp(n.y * 0.6 + 0.55, 0.0, 1.0);
  color *= 0.78 + 0.3 * topLight;

  color += uColorC * fresnel * 0.55;
  color += color * uLevel * 0.4;

  float alpha = 0.96 + fresnel * 0.04;
  gl_FragColor = vec4(color, alpha);
}
`;

// Halo: enlarged back-face shell with an additive fresnel falloff — fake bloom
// for one extra draw call. Kept small enough (≤1.12×) to fade out well inside
// the camera frustum, so it never clips into a visible rectangle.
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
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 4.0);
  gl_FragColor = vec4(uColor, rim * uIntensity);
}
`;

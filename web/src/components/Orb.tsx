import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";
import { useVoiceStore, levelBus } from "../store";
import {
  ORB_VERTEX,
  ORB_FRAGMENT,
  HALO_VERTEX,
  HALO_FRAGMENT,
} from "../shaders/orb";

// Each state owns a bright two-stop palette + pale accent (no dark stops —
// dark colours read as blotches inside the sphere) and a temperament:
// uAmp (silhouette wobble, kept tiny), uFreq (current scale), uSpeed (drift).
const STATE_PARAMS = {
  connecting: { uAmp: 0.004, uFreq: 1.2, uSpeed: 0.20, glow: 0.25,
                colorA: "#353b54", colorB: "#4c547a", colorC: "#9aa3c9" },
  idle:       { uAmp: 0.008, uFreq: 1.4, uSpeed: 0.30, glow: 0.45,
                colorA: "#0ea5b7", colorB: "#4f7df9", colorC: "#d8fff6" },
  recording:  { uAmp: 0.020, uFreq: 2.0, uSpeed: 0.85, glow: 0.70,
                colorA: "#ff8a5c", colorB: "#ffb84d", colorC: "#ffe9d1" },
  thinking:   { uAmp: 0.025, uFreq: 3.0, uSpeed: 1.60, glow: 0.60,
                colorA: "#7c5bf2", colorB: "#e879d9", colorC: "#f4e3ff" },
  speaking:   { uAmp: 0.015, uFreq: 1.8, uSpeed: 0.65, glow: 0.65,
                colorA: "#3f8cff", colorB: "#2dd4e8", colorC: "#e3f5ff" },
};

const REDUCED_MOTION =
  typeof matchMedia !== "undefined" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function OrbMesh() {
  const group = useRef<THREE.Group>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: STATE_PARAMS.connecting.uAmp },
      uFreq: { value: STATE_PARAMS.connecting.uFreq },
      uSpeed: { value: STATE_PARAMS.connecting.uSpeed },
      uLevel: { value: 0 },
      uColorA: { value: new THREE.Color(STATE_PARAMS.connecting.colorA) },
      uColorB: { value: new THREE.Color(STATE_PARAMS.connecting.colorB) },
      uColorC: { value: new THREE.Color(STATE_PARAMS.connecting.colorC) },
    }),
    []
  );
  const haloUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(STATE_PARAMS.connecting.colorC) },
      uIntensity: { value: STATE_PARAMS.connecting.glow },
    }),
    []
  );

  const status = useVoiceStore((s) => s.status);

  useEffect(() => {
    const p = STATE_PARAMS[status];
    const ease = "power3.out";
    const motionScale = REDUCED_MOTION ? 0.25 : 1;
    const duration = REDUCED_MOTION ? 0 : 0.9;
    gsap.to(uniforms.uAmp, { value: p.uAmp * (REDUCED_MOTION ? 0.6 : 1), duration, ease });
    gsap.to(uniforms.uFreq, { value: p.uFreq, duration, ease });
    gsap.to(uniforms.uSpeed, { value: p.uSpeed * motionScale, duration, ease });
    gsap.to(haloUniforms.uIntensity, { value: p.glow, duration: duration * 1.3, ease });
    const a = new THREE.Color(p.colorA);
    const b = new THREE.Color(p.colorB);
    const c = new THREE.Color(p.colorC);
    const colorDur = REDUCED_MOTION ? 0 : 1.2;
    gsap.to(uniforms.uColorA.value, { r: a.r, g: a.g, b: a.b, duration: colorDur, ease });
    gsap.to(uniforms.uColorB.value, { r: b.r, g: b.g, b: b.b, duration: colorDur, ease });
    gsap.to(uniforms.uColorC.value, { r: c.r, g: c.g, b: c.b, duration: colorDur, ease });
    gsap.to(haloUniforms.uColor.value, { r: c.r, g: c.g, b: c.b, duration: colorDur, ease });
  }, [status, uniforms, haloUniforms]);

  useFrame((_, delta) => {
    uniforms.uTime.value += delta;
    uniforms.uLevel.value += (levelBus.value - uniforms.uLevel.value) * 0.35;
    if (group.current) {
      group.current.scale.setScalar(1 + uniforms.uLevel.value * 0.06);
    }
  });

  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[1, 64]} />
        <shaderMaterial
          vertexShader={ORB_VERTEX}
          fragmentShader={ORB_FRAGMENT}
          uniforms={uniforms}
          transparent
        />
      </mesh>
      <mesh scale={1.12}>
        <icosahedronGeometry args={[1, 16]} />
        <shaderMaterial
          vertexShader={HALO_VERTEX}
          fragmentShader={HALO_FRAGMENT}
          uniforms={haloUniforms}
          transparent
          depthWrite={false}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

export default function Orb() {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.4], fov: 40 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
    >
      <OrbMesh />
    </Canvas>
  );
}

import { useEffect, useMemo } from "react";
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

// Each state owns a palette and a "temperament" (amplitude / busyness / speed).
// idle: calm teal aurora. recording: warm ember — the mic is live.
// thinking: fast violet shimmer. speaking: glacial blue, measured.
const STATE_PARAMS = {
  connecting: { uAmp: 0.03, uFreq: 1.2, uSpeed: 0.15, glow: 0.30,
                colorA: "#1c2230", colorB: "#39415c", colorC: "#566180" },
  idle:       { uAmp: 0.07, uFreq: 1.6, uSpeed: 0.25, glow: 0.55,
                colorA: "#0c4f63", colorB: "#2ec4a9", colorC: "#9ff0dc" },
  recording:  { uAmp: 0.17, uFreq: 2.4, uSpeed: 0.70, glow: 0.85,
                colorA: "#8a3a24", colorB: "#ff9d6b", colorC: "#ffd9a8" },
  thinking:   { uAmp: 0.23, uFreq: 4.4, uSpeed: 1.45, glow: 0.75,
                colorA: "#3b2a7a", colorB: "#a06bff", colorC: "#f2b8ff" },
  speaking:   { uAmp: 0.15, uFreq: 2.1, uSpeed: 0.55, glow: 0.80,
                colorA: "#1d4a8f", colorB: "#6aa8ff", colorC: "#d3ecff" },
};

const REDUCED_MOTION =
  typeof matchMedia !== "undefined" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function OrbMesh() {
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
    uniforms.uLevel.value += (levelBus.value - uniforms.uLevel.value) * 0.18;
  });

  return (
    <group>
      <mesh>
        <icosahedronGeometry args={[1, 96]} />
        <shaderMaterial
          vertexShader={ORB_VERTEX}
          fragmentShader={ORB_FRAGMENT}
          uniforms={uniforms}
          transparent
        />
      </mesh>
      <mesh scale={1.45}>
        <icosahedronGeometry args={[1, 24]} />
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
      camera={{ position: [0, 0, 2.6], fov: 45 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
    >
      <OrbMesh />
    </Canvas>
  );
}

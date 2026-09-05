import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useVoiceStore, levelBus } from "../store";
import { ORB_VERTEX, ORB_FRAGMENT, INK_VERTEX, INK_FRAGMENT } from "../shaders/orb";
import { EXPRESSION_SHAPES } from "../lib/orbExpression";
import { InkSimulation } from "../lib/inkSimulation";

const STATES = {
  connecting: { speed: 0.22, energy: 0.1, colors: ["#52678f", "#7d87ac", "#c7d5ed"] },
  idle: { speed: 0.34, energy: 0.2, colors: ["#245b9c", "#708dd6", "#c6e8ff"] },
  recording: { speed: 0.42, energy: 0.3, colors: ["#216d91", "#68b6c5", "#d3f5f3"] },
  thinking: { speed: 0.9, energy: 0.8, colors: ["#514b99", "#9580cc", "#e2dafa"] },
  speaking: { speed: 0.8, energy: 0.6, colors: ["#2f64a4", "#84abdf", "#dceeff"] },
};

const motionQuery = typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)");
const subscribeMotion = (callback: () => void) => {
  motionQuery?.addEventListener("change", callback);
  return () => motionQuery?.removeEventListener("change", callback);
};

function Ink({ reducedMotion }: { reducedMotion: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const invalidate = useThree((s) => s.invalidate);
  const status = useVoiceStore((s) => s.status);
  const expression = useVoiceStore((s) => s.expression);
  const symbol = expression ? EXPRESSION_SHAPES[expression.shape] ?? 0 : 0;
  const target = useMemo(() => {
    const state = STATES[status] ?? STATES.idle;
    return { ...state, colors: state.colors.map((color) => new THREE.Color(color)) };
  }, [status]);
  const fluid = useMemo(() => {
    const simulation = new InkSimulation();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(simulation.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aVelocity", new THREE.BufferAttribute(simulation.velocities, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aTone", new THREE.BufferAttribute(simulation.tones, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: INK_VERTEX, fragmentShader: INK_FRAGMENT,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(points);
    const texture = new THREE.WebGLRenderTarget(256, 256, {
      type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
    });
    return { simulation, geometry, material, scene, texture, camera: new THREE.Camera(), clearColor: new THREE.Color() };
  }, []);
  useEffect(() => () => {
    fluid.geometry.dispose();
    fluid.material.dispose();
    fluid.texture.dispose();
  }, [fluid]);
  const speed = useRef(STATES.connecting.speed);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uEnergy: { value: 0.1 },
    uLevel: { value: 0 },
    uInk: { value: fluid.texture.texture },
    uColorA: { value: new THREE.Color(STATES.connecting.colors[0]) },
    uColorB: { value: new THREE.Color(STATES.connecting.colors[1]) },
    uColorC: { value: new THREE.Color(STATES.connecting.colors[2]) },
  }), [fluid]);

  // A static canvas still needs one frame when state or motion preference changes.
  useEffect(() => { invalidate(); }, [target, reducedMotion, symbol, expression?.text, invalidate]);
  useEffect(() => {
    if (!expression) return;
    const timer = window.setTimeout(() => {
      useVoiceStore.getState().clearExpression(expression);
    }, Math.max(0, expression.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expression]);

  useFrame(({ gl }, delta) => {
    // R3F copies uniform wrappers into the material; update the live values.
    const live = material.current?.uniforms;
    if (!live) return;
    const dt = Math.min(delta, 0.05);
    const blend = reducedMotion ? 1 : 1 - Math.exp(-dt * 3);
    const rawLevel = THREE.MathUtils.clamp(levelBus.value, 0, 1);
    // Bring out quiet syllables in playback; microphone feedback stays subtle.
    const audioTarget = status === "speaking"
      ? Math.min(1, Math.pow(rawLevel, 0.65) * 1.65)
      : status === "recording" ? rawLevel * 0.12 : 0;
    const response = 1 - Math.exp(-dt * (audioTarget > live.uLevel.value ? 28 : 8));
    live.uLevel.value = reducedMotion ? 0 : THREE.MathUtils.lerp(live.uLevel.value, audioTarget, response);
    speed.current = THREE.MathUtils.lerp(speed.current, target.speed + live.uLevel.value * 1.7, blend);
    // Integrating speed avoids a phase jump when listening/thinking changes.
    if (!reducedMotion) live.uTime.value += dt * speed.current;
    live.uEnergy.value = THREE.MathUtils.lerp(live.uEnergy.value, target.energy, blend);
    live.uColorA.value.lerp(target.colors[0], blend);
    live.uColorB.value.lerp(target.colors[1], blend);
    live.uColorC.value.lerp(target.colors[2], blend);

    fluid.simulation.setReadout(expression?.text ?? "");
    fluid.simulation.setShape(symbol);
    fluid.simulation.step(dt, live.uTime.value, live.uLevel.value, reducedMotion);
    fluid.geometry.attributes.position.needsUpdate = true;
    fluid.geometry.attributes.aVelocity.needsUpdate = true;
    const previousTarget = gl.getRenderTarget();
    const previousAlpha = gl.getClearAlpha();
    gl.getClearColor(fluid.clearColor);
    gl.setRenderTarget(fluid.texture);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(fluid.scene, fluid.camera);
    gl.setRenderTarget(previousTarget);
    gl.setClearColor(fluid.clearColor, previousAlpha);
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={material} vertexShader={ORB_VERTEX} fragmentShader={ORB_FRAGMENT} uniforms={uniforms} transparent depthWrite={false} />
    </mesh>
  );
}

export default function Orb() {
  const reducedMotion = useSyncExternalStore(subscribeMotion, () => motionQuery?.matches ?? false, () => false);
  return (
    <Canvas
      gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
      dpr={[1, 1.5]}
      frameloop={reducedMotion ? "demand" : "always"}
      fallback={<div className="orb-fallback" />}
    >
      <Ink reducedMotion={reducedMotion} />
    </Canvas>
  );
}

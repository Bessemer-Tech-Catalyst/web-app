"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * The hero header band: a drifting field of activations with an inference sweep
 * running left to right through it.
 *
 * ~14k points in one draw call. There's no simulation state — each point's
 * position is a closed-form function of its seed and the clock (layered sine
 * flow, so it curls and never diverges), which keeps the whole thing to a
 * single vertex shader. Decorative: no pointer events, no layout, and a single
 * still frame under reduced motion.
 */

const COUNT = 14000;
const HOT_SHARE = 0.07; // fraction of points that carry the accent colour
const LAYERS = 7; // strata the points settle into before the flow smears them

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSweep;
  uniform float uAspect;

  attribute float aSize;
  attribute float aHot;
  attribute float aPhase;

  varying float vGlow;
  varying float vHot;
  varying float vAlpha;

  void main() {
    vec2 base = position.xy;

    // Slow rightward transport, wrapped — the band never empties or piles up.
    float x = fract((base.x + 1.0) * 0.5 + uTime * 0.012) * 2.0 - 1.0;

    // Layered sine flow: cheap curl, organic drift, loops forever.
    vec2 flow;
    flow.x = sin(base.y * 2.3 + uTime * 0.30 + aPhase) * 0.045
           + sin(base.y * 5.7 - uTime * 0.19) * 0.020;
    flow.y = cos(x * 1.7 + uTime * 0.23 + aPhase) * 0.075
           + cos(x * 4.3 - uTime * 0.15) * 0.030;

    vec2 pos = vec2(x + flow.x, base.y + flow.y);

    // The sweep: a bright front crossing the band, with a decaying wake behind
    // it — activation propagating, not a light bar passing over.
    float front = exp(-pow((pos.x - uSweep) * 6.0, 2.0));
    float wake = exp(-max(uSweep - pos.x, 0.0) * 2.6) * 0.45;
    float sweep = clamp(front + wake, 0.0, 1.0);

    // Fade at the band's edges so points arrive and leave, never pop.
    float edge = smoothstep(1.0, 0.74, abs(pos.x)) * smoothstep(1.02, 0.5, abs(pos.y));

    gl_Position = vec4(pos, 0.0, 1.0);
    gl_PointSize = (aSize + front * 2.6) * uPixelRatio;

    vGlow = sweep;
    vHot = aHot;
    vAlpha = edge * (0.30 + sweep * 0.80);
  }
`;

const FRAGMENT = /* glsl */ `
  precision mediump float;

  uniform vec3 uCool;
  uniform vec3 uHot;
  varying float vGlow;
  varying float vHot;
  varying float vAlpha;

  void main() {
    // Round the square GL point off into a soft dot.
    float d = length(gl_PointCoord - 0.5);
    float dot_ = smoothstep(0.5, 0.1, d);
    if (dot_ < 0.01) discard;

    vec3 color = mix(uCool, uHot, clamp(vHot + vGlow * 0.55, 0.0, 1.0));
    gl_FragColor = vec4(color, dot_ * vAlpha);
  }
`;

export function HeroCanvas({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    } catch {
      return; // no WebGL — the hero keeps its CSS backdrop and nothing breaks
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pixelRatio = Math.min(window.devicePixelRatio, 2);

    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.Camera(); // the vertex shader writes clip space directly

    const positions = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);
    const hot = new Float32Array(COUNT);
    const phase = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = Math.random() * 2 - 1;
      // Points settle into layers — strata, so the field reads as structure
      // rather than dust — then the flow in the shader smears them apart again.
      const layer = Math.floor(Math.random() * LAYERS);
      const spread = 0.10 + 0.06 * Math.abs(layer - (LAYERS - 1) / 2);
      positions[i * 3 + 1] =
        ((layer / (LAYERS - 1)) * 2 - 1) * 0.72 +
        (Math.random() + Math.random() - 1) * spread;
      sizes[i] = 0.9 + Math.random() * 1.9;
      hot[i] = Math.random() < HOT_SHARE ? 0.85 + Math.random() * 0.15 : 0;
      phase[i] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aHot", new THREE.BufferAttribute(hot, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));

    const uniforms = {
      uTime: { value: reduced ? 8 : 0 },
      uPixelRatio: { value: pixelRatio },
      uSweep: { value: reduced ? -0.2 : -1.4 },
      uAspect: { value: 1 },
      uCool: { value: new THREE.Color("#8b93a8") },
      uHot: { value: new THREE.Color("#ff8a3d") },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    scene.add(new THREE.Points(geometry, material));

    function resize() {
      const { clientWidth: w, clientHeight: h } = host!;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      uniforms.uAspect.value = w / h;
    }
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    let frame = 0;
    let last = performance.now();
    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      uniforms.uTime.value += dt;
      // A pass every ~6s, with a short pause off-screen between runs.
      uniforms.uSweep.value = ((uniforms.uTime.value * 0.46) % 2.8) - 1.4;
      renderer.render(scene, camera);
    }

    function start() {
      if (reduced || frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
    function stop() {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    }

    // A hidden tab or a scrolled-past hero costs nothing.
    const io = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting && !document.hidden ? start() : stop()),
      { threshold: 0 },
    );
    io.observe(host);
    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }
    document.addEventListener("visibilitychange", onVisibility);

    renderer.render(scene, camera);
    if (!reduced) start();

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      geometry.dispose();
      material.dispose();
      renderer.domElement.remove();
      renderer.dispose();
    };
  }, []);

  return <div ref={hostRef} aria-hidden className={className} />;
}

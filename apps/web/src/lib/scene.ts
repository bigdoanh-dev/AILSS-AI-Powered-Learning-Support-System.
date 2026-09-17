import * as THREE from "three";

export type ScenePreset = "galaxy" | "orbit" | "core";

export interface SceneController {
  setPreset: (preset: ScenePreset) => void;
  triggerPulse: () => void;
  resetView: () => void;
}

export function mountScene(host: HTMLElement, onReady?: (controller: SceneController) => void): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  } catch {
    return () => {};
  }

  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(46, 1, 0.1, 50);
  camera.position.set(0, 0, 6.6);

  const isMobile = typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches;
  const count = isMobile ? 4200 : 8600;

  const positions = new Float32Array(count * 3),
    colors = new Float32Array(count * 3),
    scatter = new Float32Array(count * 3),
    sizes = new Float32Array(count);

  let seed = 42;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  // Color palette matching OpenAI Astra: radiant white core, ice cyan, stellar amber and deep violet
  const whiteHot = new THREE.Color(0xffffff);
  const iceCyan = new THREE.Color(0x7dd3fc);
  const electricCyan = new THREE.Color(0x00f0ff);
  const stellarAmber = new THREE.Color(0xfde68a);
  const cosmicViolet = new THREE.Color(0xc084fc);

  for (let i = 0; i < count; i++) {
    const t = random();
    // 2 dominant logarithmic spiral arms like OpenAI Astra (arm 0 and arm 1, 180 deg apart)
    const arm = i % 2;
    const armOffset = arm * Math.PI;
    // Logarithmic spiral angle
    const angle = Math.pow(t, 0.72) * Math.PI * 4.6 + armOffset + (random() - 0.5) * 0.12;
    const radius = 0.08 + Math.pow(t, 0.9) * 2.95;
    // Tighter spread near core, more expansive dispersion at galaxy rim
    const spread = (random() - 0.5) * (0.04 + t * 0.32);

    // Positions with organic spiral curves
    positions[i * 3] = Math.cos(angle) * (radius + spread);
    positions[i * 3 + 1] = Math.sin(angle) * (radius + spread);
    positions[i * 3 + 2] = (random() - 0.5) * (0.12 + t * 0.55);

    // Dense incandescent white-hot core
    if (i % 6 === 0) {
      const coreRadius = Math.pow(random(), 2.5) * 0.45;
      const coreAngle = random() * Math.PI * 2;
      positions[i * 3] = Math.cos(coreAngle) * coreRadius;
      positions[i * 3 + 1] = Math.sin(coreAngle) * coreRadius;
      positions[i * 3 + 2] = (random() - 0.5) * coreRadius * 0.8;
    }

    scatter[i * 3] = (random() - 0.5) * 16;
    scatter[i * 3 + 1] = (random() - 0.5) * 12;
    scatter[i * 3 + 2] = (random() - 0.5) * 6;

    // Point sizes with bright key stars and delicate background mist
    sizes[i] = i % 31 === 0 ? 36 + random() * 30 : i % 7 === 0 ? 16 + random() * 14 : 2.5 + random() * 7;

    // Color gradient along the spiral arms
    let shade: THREE.Color;
    if (i % 6 === 0) {
      shade = whiteHot;
    } else if (i % 7 === 0) {
      shade = stellarAmber;
    } else if (arm === 0) {
      shade = iceCyan
        .clone()
        .lerp(electricCyan, t)
        .lerp(whiteHot, (1 - t) * 0.5);
    } else {
      shade = cosmicViolet
        .clone()
        .lerp(iceCyan, t)
        .lerp(whiteHot, (1 - t) * 0.5);
    }
    colors.set([shade.r, shade.g, shade.b], i * 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("scatter", new THREE.BufferAttribute(scatter, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      gather: { value: 0 },
      pixelRatio: { value: renderer.getPixelRatio() },
      cursor: { value: new THREE.Vector2() },
      interaction: { value: 0 },
      pulse: { value: 0 },
      aspect: { value: 1 },
    },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 scatter;
      attribute float size;
      uniform float time;
      uniform float gather;
      uniform float pixelRatio;
      uniform vec2 cursor;
      uniform float interaction;
      uniform float pulse;
      uniform float aspect;
      varying vec3 tint;
      varying float sparkle;

      void main() {
        vec3 p = mix(scatter, position, gather);
        float a = sin(time * .52 + length(position.xy) * 1.7) * .14;
        p.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xy;
        p.z += sin(time * .75 + position.x * 2.2) * .24;

        // Dynamic shockwave pulse
        float distCenter = length(p.xy);
        float shock = sin(distCenter * 4.0 - pulse * 6.28) * exp(-abs(distCenter - pulse * 2.5) * 3.0) * .22;
        p.xy += normalize(p.xy + 0.001) * shock;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);

        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * pixelRatio * 3.0 / -mv.z * (1.0 + shock * .3), 1.0, 24.0);

        tint = mix(color, vec3(.95, .98, 1.0), shock * .4);
        sparkle = .85 + .22 * sin(time * 1.4 + position.y * 38.0);
      }
    `,
    fragmentShader: `
      varying vec3 tint;
      varying float sparkle;

      void main() {
        vec2 p = gl_PointCoord - .5;
        float r = length(p);
        float core = exp(-r * r * 210.0);
        float halo = exp(-r * r * 24.0) * .28;
        float rays = exp(-abs(p.x) * 110.0) * exp(-abs(p.y) * 14.0)
                   + exp(-abs(p.y) * 110.0) * exp(-abs(p.x) * 14.0);
        gl_FragColor = vec4(mix(tint, vec3(1.0), core * .65), (core + halo + rays * .12) * sparkle);
      }
    `,
  });

  const galaxy = new THREE.Points(geo, material);
  galaxy.rotation.x = 0.16;
  scene.add(galaxy);

  // --- 3D Orbital Knowledge Rings ---
  const ringGroup = new THREE.Group();
  scene.add(ringGroup);

  const createOrbitRing = (
    radius: number,
    particleCount: number,
    colorHex: number,
    tiltX: number,
    tiltY: number,
  ) => {
    const ringGeo = new THREE.BufferGeometry();
    const ringPos = new Float32Array(particleCount * 3);
    const ringCol = new Float32Array(particleCount * 3);
    const baseCol = new THREE.Color(colorHex);

    for (let j = 0; j < particleCount; j++) {
      const theta = (j / particleCount) * Math.PI * 2;
      const rad = radius + (random() - 0.5) * 0.08;
      ringPos[j * 3] = Math.cos(theta) * rad;
      ringPos[j * 3 + 1] = Math.sin(theta) * rad;
      ringPos[j * 3 + 2] = (random() - 0.5) * 0.06;

      const c = baseCol.clone().offsetHSL(0, 0, (random() - 0.5) * 0.2);
      ringCol.set([c.r, c.g, c.b], j * 3);
    }

    ringGeo.setAttribute("position", new THREE.BufferAttribute(ringPos, 3));
    ringGeo.setAttribute("color", new THREE.BufferAttribute(ringCol, 3));

    const ringMat = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.032,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const ringPoints = new THREE.Points(ringGeo, ringMat);
    ringPoints.rotation.x = tiltX;
    ringPoints.rotation.y = tiltY;
    return { points: ringPoints, geo: ringGeo, mat: ringMat };
  };

  const ring1 = createOrbitRing(2.1, 750, 0x00f0ff, 0.58, 0.32);
  const ring2 = createOrbitRing(2.9, 850, 0xa855f7, -0.46, 0.48);
  ringGroup.add(ring1.points);
  ringGroup.add(ring2.points);

  // --- 3D Holographic Knowledge Nodes (Wireframe Crystals) ---
  const nodeGroup = new THREE.Group();
  scene.add(nodeGroup);

  const nodes: {
    mesh: THREE.Group;
    orbitRadius: number;
    speed: number;
    angle: number;
    tiltX: number;
    tiltY: number;
  }[] = [];
  const nodeColors = [0x00f0ff, 0xa855f7, 0x38bdf8, 0xfbbf24, 0x10b981];

  for (let k = 0; k < 5; k++) {
    const nodeContainer = new THREE.Group();

    // Outer wireframe icosahedron
    const icoGeo = new THREE.IcosahedronGeometry(0.095, 0);
    const icoMat = new THREE.MeshBasicMaterial({
      color: nodeColors[k],
      wireframe: true,
      transparent: true,
      opacity: 0.82,
    });
    const icoMesh = new THREE.Mesh(icoGeo, icoMat);
    nodeContainer.add(icoMesh);

    // Inner glowing crystal core
    const corePointGeo = new THREE.SphereGeometry(0.038, 8, 8);
    const corePointMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
    });
    const corePoint = new THREE.Mesh(corePointGeo, corePointMat);
    nodeContainer.add(corePoint);

    nodeGroup.add(nodeContainer);
    nodes.push({
      mesh: nodeContainer,
      orbitRadius: 1.95 + (k % 2) * 0.9,
      speed: 0.28 + k * 0.08,
      angle: (k * Math.PI * 2) / 5,
      tiltX: k % 2 === 0 ? 0.58 : -0.46,
      tiltY: k % 2 === 0 ? 0.32 : 0.48,
    });
  }

  // --- Cosmic Star Field ---
  const starGeo = new THREE.BufferGeometry(),
    starCount = isMobile ? 400 : 900,
    stars = new Float32Array(starCount * 3);
  for (let i = 0; i < stars.length; i++) stars[i] = (random() - 0.5) * 22;
  starGeo.setAttribute("position", new THREE.BufferAttribute(stars, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xbae6fd,
    size: 0.032,
    transparent: true,
    opacity: 0.65,
  });
  const starField = new THREE.Points(starGeo, starMat);
  scene.add(starField);

  const surface = host.parentElement ?? host;
  let frame = 0,
    visible = true,
    stopped = false,
    x = 0,
    y = 0,
    px = 0,
    py = 0,
    hovered = false,
    interaction = 0,
    movement = 0,
    dragId: number | null = null,
    previousX = 0,
    previousY = 0,
    yaw = 0,
    pitch = 0,
    targetYaw = 0,
    targetPitch = 0,
    yawVelocity = 0,
    pitchVelocity = 0,
    baseDistance = 6.6,
    last = 0,
    elapsed = 0,
    pulseValue = 0;

  // Preset configuration
  let targetPresetDistance = 6.6;
  let targetPresetPitch = 0;

  const setPreset = (preset: ScenePreset) => {
    if (preset === "core") {
      targetPresetDistance = 3.8;
      targetPresetPitch = 0.08;
      yawVelocity = 0.25;
      pitchVelocity = 0;
    } else if (preset === "orbit") {
      targetPresetDistance = 5.2;
      targetPresetPitch = 0.35;
      yawVelocity = 0.45;
      pitchVelocity = 0;
    } else {
      targetPresetDistance = 6.6;
      targetPresetPitch = 0;
      yawVelocity = 0.12;
      pitchVelocity = 0;
    }
  };

  const resetView = () => {
    targetYaw = 0;
    targetPitch = 0;
    yawVelocity = 0;
    pitchVelocity = 0;
    px = 0;
    py = 0;
    setPreset("galaxy");
    triggerPulse();
  };

  const triggerPulse = () => {
    pulseValue = 0.01;
  };

  // Expose controller to caller and host
  const controller: SceneController = { setPreset, triggerPulse, resetView };
  (host as unknown as { __sceneController?: SceneController }).__sceneController = controller;
  onReady?.(controller);
  host.dispatchEvent(new CustomEvent("ailss-scene-ready", { detail: controller }));

  const reduced =
    typeof matchMedia === "function"
      ? matchMedia("(prefers-reduced-motion: reduce)")
      : { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const render = (t: number) => {
    frame = 0;
    if (stopped || !visible || document.hidden) return;
    const dt = Math.min(t - last, 64) / 1000;
    if (!reduced.matches) elapsed += dt * 1000;
    last = t;

    const ease = 1 - Math.exp(-dt * 7);
    px += (x - px) * ease;
    py += (y - py) * ease;
    interaction += ((hovered ? 1 + movement : 0) - interaction) * ease;
    movement *= Math.exp(-dt * 3);

    if (dragId === null) {
      targetYaw += yawVelocity * dt;
      targetPitch = clamp(targetPitch + pitchVelocity * dt, -0.65, 0.65);
      yawVelocity *= Math.exp(-dt * 2.6);
      pitchVelocity *= Math.exp(-dt * 3.2);
    }
    yaw += (targetYaw - yaw) * ease;
    pitch += (targetPitch + targetPresetPitch - pitch) * ease;

    if (pulseValue > 0) {
      pulseValue += dt * 1.8;
      if (pulseValue > 1.2) pulseValue = 0;
    }

    const seconds = elapsed / 1000;
    const cycle = seconds % 28;
    const smooth = (v: number) => {
      const n = Math.max(0, Math.min(1, v));
      return n * n * (3 - 2 * n);
    };

    const rect = host.getBoundingClientRect();
    const scroll = Math.max(0, Math.min(1, -rect.top / Math.max(rect.height, 1)));

    material.uniforms.time.value = seconds;
    material.uniforms.gather.value = reduced.matches ? 1 : smooth(cycle / 4) * (1 - smooth((cycle - 23) / 5));
    material.uniforms.cursor.value.set(px, py);
    material.uniforms.interaction.value = reduced.matches ? 0 : interaction;
    material.uniforms.pulse.value = pulseValue;

    galaxy.rotation.y = yaw + px * 0.35 + Math.sin(seconds * 0.16) * 0.08 + scroll * 0.4;
    galaxy.rotation.x = 0.06 + pitch - py * 0.22 + Math.sin(seconds * 0.18) * 0.05;
    galaxy.rotation.z = -seconds * 0.09;
    galaxy.scale.setScalar(1 + Math.sin(seconds * 0.65) * 0.035);

    // Orbit rings motion
    ring1.points.rotation.z = seconds * 0.22;
    ring2.points.rotation.z = -seconds * 0.18;
    ringGroup.rotation.y = galaxy.rotation.y * 0.6;
    ringGroup.rotation.x = galaxy.rotation.x * 0.5;

    // Holographic Knowledge Nodes motion
    nodes.forEach((node, idx) => {
      const curAngle = node.angle + seconds * node.speed;
      const nx = Math.cos(curAngle) * node.orbitRadius;
      const ny = Math.sin(curAngle) * node.orbitRadius;
      const nz = Math.sin(seconds * 1.2 + idx) * 0.15;

      // Rotate point by ring tilt
      const cosX = Math.cos(node.tiltX),
        sinX = Math.sin(node.tiltX);
      const rotY = ny * cosX - nz * sinX;
      const rotZ = ny * sinX + nz * cosX;

      node.mesh.position.set(nx, rotY, rotZ);
      node.mesh.rotation.x += dt * 1.2;
      node.mesh.rotation.y += dt * 1.5;
      const pulseScale = 1 + Math.sin(seconds * 3.0 + idx) * 0.12;
      node.mesh.scale.setScalar(pulseScale);
    });

    starField.rotation.y = px * 0.08 + seconds * 0.015;
    starField.rotation.x = -py * 0.06;

    const currentTargetDist = targetPresetDistance - scroll * 0.8;
    baseDistance += (currentTargetDist - baseDistance) * ease;
    camera.position.set(px * 0.16, py * 0.12, baseDistance);

    renderer.render(scene, camera);
    host.dataset.frame = String(Math.round(elapsed));
    if (!reduced.matches) frame = requestAnimationFrame(render);
  };

  const sync = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = performance.now();
    if (!stopped && visible && !document.hidden) frame = requestAnimationFrame(render);
  };

  const resize = new ResizeObserver(() => {
    const r = host.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(r.height, 1);
    material.uniforms.aspect.value = camera.aspect;
    camera.updateProjectionMatrix();
    sync();
  });
  resize.observe(host);

  const observer = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    sync();
  });
  observer.observe(host);

  const pointer = (e: PointerEvent) => {
    if (reduced.matches) return;
    const r = host.getBoundingClientRect();
    const nextX = clamp(((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1, -1, 1);
    const nextY = clamp(1 - ((e.clientY - r.top) / Math.max(r.height, 1)) * 2, -1, 1);
    movement = Math.min(1, movement + Math.hypot(nextX - x, nextY - y) * 2);
    x = nextX;
    y = nextY;
    hovered = true;
    if (dragId === e.pointerId) {
      const dx = e.clientX - previousX;
      const dy = e.clientY - previousY;
      targetYaw += dx * 0.008;
      targetPitch = clamp(targetPitch + dy * 0.005, -0.65, 0.65);
      yawVelocity = clamp(dx * 0.16, -2.5, 2.5);
      pitchVelocity = clamp(dy * 0.12, -1.8, 1.8);
      previousX = e.clientX;
      previousY = e.clientY;
    }
  };

  const leave = () => {
    if (dragId !== null) return;
    hovered = false;
    x = y = 0;
  };

  const down = (e: PointerEvent) => {
    if (reduced.matches || e.button !== 0 || dragId !== null) return;
    pointer(e);
    dragId = e.pointerId;
    previousX = e.clientX;
    previousY = e.clientY;
    yawVelocity = 0;
    pitchVelocity = 0;
    triggerPulse();
    surface.setPointerCapture(e.pointerId);
    surface.dataset.dragging = "true";
  };

  const up = (e: PointerEvent) => {
    if (dragId !== e.pointerId) return;
    dragId = null;
    delete surface.dataset.dragging;
    if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
    if (e.pointerType === "touch" || e.type === "pointercancel") leave();
  };

  const wheel = (e: WheelEvent) => {
    if (reduced.matches) return;
    if (Math.abs(e.deltaY) > 2) {
      targetPresetDistance = clamp(targetPresetDistance + e.deltaY * 0.002, 4.2, 8.5);
    }
  };

  const key = (e: KeyboardEvent) => {
    if (
      reduced.matches ||
      e.target !== surface ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    )
      return;
    e.preventDefault();
    if (e.key === "ArrowLeft") targetYaw -= 0.3;
    if (e.key === "ArrowRight") targetYaw += 0.3;
    if (e.key === "ArrowUp") targetPitch = clamp(targetPitch - 0.2, -0.65, 0.65);
    if (e.key === "ArrowDown") targetPitch = clamp(targetPitch + 0.2, -0.65, 0.65);
  };

  surface.addEventListener("pointermove", pointer);
  surface.addEventListener("pointerleave", leave);
  surface.addEventListener("pointerdown", down);
  surface.addEventListener("pointerup", up);
  surface.addEventListener("pointercancel", up);
  surface.addEventListener("wheel", wheel, { passive: true });
  surface.addEventListener("lostpointercapture", up);
  surface.addEventListener("keydown", key);
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener("change", sync);
  sync();

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    observer.disconnect();
    surface.removeEventListener("pointermove", pointer);
    surface.removeEventListener("pointerleave", leave);
    surface.removeEventListener("pointerdown", down);
    surface.removeEventListener("pointerup", up);
    surface.removeEventListener("pointercancel", up);
    surface.removeEventListener("wheel", wheel);
    surface.removeEventListener("lostpointercapture", up);
    surface.removeEventListener("keydown", key);
    delete surface.dataset.dragging;
    delete (host as unknown as { __sceneController?: SceneController }).__sceneController;
    document.removeEventListener("visibilitychange", sync);
    reduced.removeEventListener("change", sync);

    // Dispose all resources cleanly
    geo.dispose();
    material.dispose();
    ring1.geo.dispose();
    ring1.mat.dispose();
    ring2.geo.dispose();
    ring2.mat.dispose();
    nodes.forEach((n) => {
      n.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
    });
    starGeo.dispose();
    starMat.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

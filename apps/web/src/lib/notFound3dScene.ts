import * as THREE from "three";

export type NotFoundPreset = "portal" | "orbit" | "singularity";

export interface NotFoundSceneController {
  setPreset: (preset: NotFoundPreset) => void;
  triggerPulse: () => void;
  resetView: () => void;
}

export function mountNotFoundScene(
  host: HTMLElement,
  onReady?: (controller: NotFoundSceneController) => void,
): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch {
    return () => {};
  }

  renderer.setPixelRatio(Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 1.5));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 60);
  camera.position.set(0, 0, 7.2);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambientLight);

  const cyanLight = new THREE.PointLight(0x00f0ff, 3.2, 20);
  cyanLight.position.set(-4.0, 3.0, 4.0);
  scene.add(cyanLight);

  const violetLight = new THREE.PointLight(0xa855f7, 3.2, 20);
  violetLight.position.set(4.0, -3.0, 4.0);
  scene.add(violetLight);

  const coreLight = new THREE.PointLight(0xffffff, 4.0, 14);
  coreLight.position.set(0, 0, 2.2);
  scene.add(coreLight);

  // Group for the 3D 404 Sculptures
  const sculptureGroup = new THREE.Group();
  scene.add(sculptureGroup);

  // Helper to construct 3D Digit '4'
  const createDigit4 = (mainColor: number, wireColor: number) => {
    const digitGroup = new THREE.Group();
    const thick = 0.34;
    const depth = 0.34;

    const barMaterial = new THREE.MeshStandardMaterial({
      color: mainColor,
      roughness: 0.18,
      metalness: 0.88,
      emissive: mainColor,
      emissiveIntensity: 0.4,
    });

    const wireMaterial = new THREE.MeshBasicMaterial({
      color: wireColor,
      wireframe: true,
      transparent: true,
      opacity: 0.8,
    });

    const addSegment = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, barMaterial);
      mesh.position.set(px, py, pz);

      const wire = new THREE.Mesh(geo, wireMaterial);
      wire.scale.set(1.04, 1.04, 1.04);
      mesh.add(wire);

      digitGroup.add(mesh);
      return { geo };
    };

    // Right long vertical bar
    const b1 = addSegment(thick, 2.6, depth, 0.5, 0, 0);
    // Horizontal cross bar
    const b2 = addSegment(1.7, thick, depth, -0.18, -0.32, 0);
    // Left upper vertical bar
    const b3 = addSegment(thick, 1.5, depth, -0.82, 0.5, 0);

    return {
      group: digitGroup,
      geometries: [b1.geo, b2.geo, b3.geo],
      materials: [barMaterial, wireMaterial],
    };
  };

  // Helper to construct 3D Center Digit '0' (Singularity Portal)
  const createDigit0 = (coreColor: number, wireColor: number) => {
    const portalGroup = new THREE.Group();

    // Outer primary torus
    const torusGeo = new THREE.TorusGeometry(1.2, 0.26, 24, 64);
    const torusMat = new THREE.MeshStandardMaterial({
      color: coreColor,
      roughness: 0.15,
      metalness: 0.92,
      emissive: coreColor,
      emissiveIntensity: 0.5,
    });
    const torusMesh = new THREE.Mesh(torusGeo, torusMat);

    const wireMat = new THREE.MeshBasicMaterial({
      color: wireColor,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });
    const torusWire = new THREE.Mesh(torusGeo, wireMat);
    torusWire.scale.set(1.04, 1.04, 1.04);
    torusMesh.add(torusWire);
    portalGroup.add(torusMesh);

    // Inner Gyroscope Ring 1 (Electric Cyan)
    const gyroGeo1 = new THREE.TorusGeometry(0.8, 0.055, 16, 48);
    const gyroMat1 = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.9,
    });
    const gyroMesh1 = new THREE.Mesh(gyroGeo1, gyroMat1);
    gyroMesh1.rotation.x = Math.PI / 3;
    portalGroup.add(gyroMesh1);

    // Inner Gyroscope Ring 2 (Stellar Amber)
    const gyroGeo2 = new THREE.TorusGeometry(0.58, 0.045, 16, 40);
    const gyroMat2 = new THREE.MeshBasicMaterial({
      color: 0xfde68a,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });
    const gyroMesh2 = new THREE.Mesh(gyroGeo2, gyroMat2);
    gyroMesh2.rotation.y = Math.PI / 4;
    portalGroup.add(gyroMesh2);

    // Event Horizon Core (Obsidian Sphere)
    const sphereGeo = new THREE.SphereGeometry(0.42, 32, 32);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0x050814,
      roughness: 0.8,
      metalness: 0.2,
      emissive: 0x1e1b4b,
      emissiveIntensity: 0.6,
    });
    const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    portalGroup.add(sphereMesh);

    return {
      group: portalGroup,
      geometries: [torusGeo, gyroGeo1, gyroGeo2, sphereGeo],
      materials: [torusMat, wireMat, gyroMat1, gyroMat2, sphereMat],
      meshes: { torusMesh, gyroMesh1, gyroMesh2, sphereMesh },
    };
  };

  // Instantiate 4 - 0 - 4
  const digit4Left = createDigit4(0x00f0ff, 0x7dd3fc);
  digit4Left.group.position.set(-2.55, 0, 0);
  sculptureGroup.add(digit4Left.group);

  const digit0Center = createDigit0(0xa855f7, 0xf0abfc);
  digit0Center.group.position.set(0, 0, 0);
  sculptureGroup.add(digit0Center.group);

  const digit4Right = createDigit4(0x38bdf8, 0xc084fc);
  digit4Right.group.position.set(2.55, 0, 0);
  sculptureGroup.add(digit4Right.group);

  // Swirling Accretion Disk / Vortex Particles
  const isMobile = typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches;
  const particleCount = isMobile ? 1800 : 3200;

  const particlePos = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);
  const particleOriginal = new Float32Array(particleCount * 3);

  let seed = 1337;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const white = new THREE.Color(0xffffff);
  const cyan = new THREE.Color(0x00f0ff);
  const violet = new THREE.Color(0xa855f7);
  const amber = new THREE.Color(0xfbbf24);

  for (let i = 0; i < particleCount; i++) {
    const t = rnd();
    const arm = i % 3;
    const armAngle = (arm * Math.PI * 2) / 3;
    const angle = armAngle + Math.pow(t, 0.8) * Math.PI * 5.2 + (rnd() - 0.5) * 0.22;
    const radius = 0.5 + Math.pow(t, 0.85) * 3.8;

    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * (radius * 0.55);
    const pz = (rnd() - 0.5) * (0.3 + t * 0.6);

    particlePos[i * 3] = px;
    particlePos[i * 3 + 1] = py;
    particlePos[i * 3 + 2] = pz;

    particleOriginal[i * 3] = px;
    particleOriginal[i * 3 + 1] = py;
    particleOriginal[i * 3 + 2] = pz;

    let col: THREE.Color;
    if (t < 0.2) {
      col = white.clone().lerp(amber, t * 5);
    } else if (t < 0.6) {
      col = cyan.clone().lerp(white, (t - 0.2) * 2.5);
    } else {
      col = violet.clone().lerp(cyan, (1 - t) * 2.5);
    }
    particleColors.set([col.r, col.g, col.b], i * 3);
  }

  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePos, 3));
  particleGeo.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));

  const particleMat = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.045,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const particleSystem = new THREE.Points(particleGeo, particleMat);
  particleSystem.rotation.x = 0.45;
  scene.add(particleSystem);

  // Orbiting Knowledge Crystals (Lost shards in the void)
  const shardGroup = new THREE.Group();
  scene.add(shardGroup);

  const shards: {
    group: THREE.Group;
    radius: number;
    speed: number;
    angle: number;
    tiltX: number;
    tiltY: number;
  }[] = [];
  const shardColors = [0x00f0ff, 0xa855f7, 0x38bdf8, 0xfbbf24, 0xec4899, 0x34d399];

  for (let k = 0; k < 6; k++) {
    const sGroup = new THREE.Group();
    const geo = k % 2 === 0 ? new THREE.IcosahedronGeometry(0.12, 0) : new THREE.OctahedronGeometry(0.13, 0);

    const mat = new THREE.MeshBasicMaterial({
      color: shardColors[k],
      wireframe: true,
      transparent: true,
      opacity: 0.88,
    });
    const mesh = new THREE.Mesh(geo, mat);
    sGroup.add(mesh);

    const innerGeo = new THREE.SphereGeometry(0.045, 8, 8);
    const innerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    sGroup.add(innerMesh);

    shardGroup.add(sGroup);
    shards.push({
      group: sGroup,
      radius: 2.8 + (k % 3) * 0.9,
      speed: 0.35 + k * 0.08,
      angle: (k * Math.PI * 2) / 6,
      tiltX: 0.4 - (k % 2) * 0.8,
      tiltY: (k * Math.PI) / 4,
    });
  }

  // Distant Cosmic Starfield
  const starCount = isMobile ? 350 : 750;
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starPos.length; i += 3) {
    starPos[i] = (rnd() - 0.5) * 26;
    starPos[i + 1] = (rnd() - 0.5) * 18;
    starPos[i + 2] = (rnd() - 0.5) * 12 - 5;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0x93c5fd,
    size: 0.035,
    transparent: true,
    opacity: 0.65,
  });
  const starField = new THREE.Points(starGeo, starMat);
  scene.add(starField);

  // Shockwave Pulse Ring (Expanding energy wave)
  const pulseRingGeo = new THREE.RingGeometry(0.2, 0.28, 64);
  const pulseRingMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
  });
  const pulseRingMesh = new THREE.Mesh(pulseRingGeo, pulseRingMat);
  scene.add(pulseRingMesh);

  // State & Interactivity variables
  const surface = host.parentElement ?? host;
  let frame = 0;
  let visible = true;
  let stopped = false;
  let last = 0;
  let elapsed = 0;
  let pulseTimer = 0;

  let x = 0;
  let y = 0;
  let px = 0;
  let py = 0;
  let dragId: number | null = null;
  let previousX = 0;
  let previousY = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let currentYaw = 0;
  let currentPitch = 0;
  let yawVelocity = 0;
  let pitchVelocity = 0;
  let targetDistance = 7.2;
  let currentDistance = 7.2;

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const setPreset = (preset: NotFoundPreset) => {
    if (preset === "singularity") {
      targetDistance = 4.8;
      targetPitch = 0.25;
      yawVelocity = 0.35;
    } else if (preset === "orbit") {
      targetDistance = 6.8;
      targetPitch = 0.42;
      yawVelocity = 0.22;
    } else {
      // portal
      targetDistance = 7.2;
      targetPitch = 0;
      targetYaw = 0;
      yawVelocity = 0.08;
    }
  };

  const triggerPulse = () => {
    pulseTimer = 0.01;
  };

  const resetView = () => {
    targetYaw = 0;
    targetPitch = 0;
    yawVelocity = 0;
    pitchVelocity = 0;
    px = 0;
    py = 0;
    setPreset("portal");
    triggerPulse();
  };

  const controller: NotFoundSceneController = { setPreset, triggerPulse, resetView };
  (host as unknown as { __sceneController?: NotFoundSceneController }).__sceneController = controller;
  onReady?.(controller);

  const reduced =
    typeof matchMedia === "function"
      ? matchMedia("(prefers-reduced-motion: reduce)")
      : { matches: false, addEventListener: () => {}, removeEventListener: () => {} };

  // Render loop
  const render = (t: number) => {
    frame = 0;
    if (stopped || !visible || document.hidden) return;
    const dt = Math.min(t - last, 64) / 1000;
    if (!reduced.matches) elapsed += dt * 1000;
    last = t;

    const ease = 1 - Math.exp(-dt * 6.5);
    px += (x - px) * ease;
    py += (y - py) * ease;

    if (dragId === null) {
      targetYaw += yawVelocity * dt;
      targetPitch = clamp(targetPitch + pitchVelocity * dt, -0.6, 0.6);
      yawVelocity *= Math.exp(-dt * 2.2);
      pitchVelocity *= Math.exp(-dt * 2.8);
    }
    currentYaw += (targetYaw - currentYaw) * ease;
    currentPitch += (targetPitch - currentPitch) * ease;
    currentDistance += (targetDistance - currentDistance) * ease;

    const seconds = elapsed / 1000;

    // Levitation & oscillation for the 4 - 0 - 4 sculptures
    if (!reduced.matches) {
      // Left 4
      digit4Left.group.position.y = Math.sin(seconds * 1.5) * 0.18;
      digit4Left.group.rotation.x = Math.sin(seconds * 0.9) * 0.08;
      digit4Left.group.rotation.y = Math.cos(seconds * 0.7) * 0.12;

      // Center 0 (Singularity)
      digit0Center.group.position.y = Math.sin(seconds * 1.8 + 1.0) * 0.14;
      digit0Center.meshes.torusMesh.rotation.z += dt * 0.45;
      digit0Center.meshes.torusMesh.rotation.x = Math.sin(seconds * 0.8) * 0.15;
      digit0Center.meshes.gyroMesh1.rotation.y += dt * 1.2;
      digit0Center.meshes.gyroMesh1.rotation.z += dt * 0.8;
      digit0Center.meshes.gyroMesh2.rotation.x += dt * 1.5;
      digit0Center.meshes.gyroMesh2.rotation.y -= dt * 0.9;
      const spherePulse = 1 + Math.sin(seconds * 3.5) * 0.06;
      digit0Center.meshes.sphereMesh.scale.setScalar(spherePulse);

      // Right 4
      digit4Right.group.position.y = Math.sin(seconds * 1.5 + 2.1) * 0.18;
      digit4Right.group.rotation.x = -Math.sin(seconds * 0.9 + 1.0) * 0.08;
      digit4Right.group.rotation.y = -Math.cos(seconds * 0.7 + 1.0) * 0.12;

      // Sculpture Group overall rotation via user orbit & mouse
      sculptureGroup.rotation.y = currentYaw + px * 0.35;
      sculptureGroup.rotation.x = currentPitch - py * 0.22;

      // Swirling particles
      particleSystem.rotation.z = -seconds * 0.18;
      particleSystem.rotation.y = Math.sin(seconds * 0.2) * 0.1;

      // Shards orbit
      shards.forEach((s, idx) => {
        const angle = s.angle + seconds * s.speed;
        const sx = Math.cos(angle) * s.radius;
        const sy = Math.sin(angle) * s.radius * 0.7;
        const sz = Math.sin(seconds * 1.2 + idx) * 0.4;

        const cosX = Math.cos(s.tiltX);
        const sinX = Math.sin(s.tiltX);
        const ry = sy * cosX - sz * sinX;
        const rz = sy * sinX + sz * cosX;

        s.group.position.set(sx, ry, rz);
        s.group.rotation.x += dt * 1.4;
        s.group.rotation.y += dt * 1.8;
      });

      // Distant stars drift
      starField.rotation.y = seconds * 0.015 + px * 0.05;
      starField.rotation.x = -py * 0.04;
    }

    // Shockwave pulse expansion
    if (pulseTimer > 0) {
      pulseTimer += dt * 1.8;
      const pScale = pulseTimer * 5.5;
      pulseRingMesh.scale.set(pScale, pScale, pScale);
      pulseRingMat.opacity = Math.max(0, 1 - pulseTimer);
      if (pulseTimer >= 1) {
        pulseTimer = 0;
        pulseRingMat.opacity = 0;
      }
    }

    camera.position.set(px * 0.25, py * 0.18, currentDistance);
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
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
    camera.updateProjectionMatrix();
    sync();
  });
  resize.observe(host);

  const observer = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    sync();
  });
  observer.observe(host);

  // Pointer & Touch Interaction
  const pointer = (e: PointerEvent) => {
    if (reduced.matches) return;
    const r = host.getBoundingClientRect();
    const nextX = clamp(((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1, -1, 1);
    const nextY = clamp(1 - ((e.clientY - r.top) / Math.max(r.height, 1)) * 2, -1, 1);
    x = nextX;
    y = nextY;

    if (dragId === e.pointerId) {
      const dx = e.clientX - previousX;
      const dy = e.clientY - previousY;
      targetYaw += dx * 0.007;
      targetPitch = clamp(targetPitch + dy * 0.005, -0.6, 0.6);
      yawVelocity = clamp(dx * 0.15, -2.5, 2.5);
      pitchVelocity = clamp(dy * 0.12, -1.8, 1.8);
      previousX = e.clientX;
      previousY = e.clientY;
    }
  };

  const leave = () => {
    if (dragId !== null) return;
    x = 0;
    y = 0;
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
      targetDistance = clamp(targetDistance + e.deltaY * 0.003, 4.5, 12);
    }
  };

  surface.addEventListener("pointermove", pointer);
  surface.addEventListener("pointerleave", leave);
  surface.addEventListener("pointerdown", down);
  surface.addEventListener("pointerup", up);
  surface.addEventListener("pointercancel", up);
  surface.addEventListener("wheel", wheel, { passive: true });
  surface.addEventListener("lostpointercapture", up);
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
    delete surface.dataset.dragging;
    delete (host as unknown as { __sceneController?: NotFoundSceneController }).__sceneController;
    document.removeEventListener("visibilitychange", sync);
    reduced.removeEventListener("change", sync);

    // Clean up Three.js objects
    digit4Left.geometries.forEach((g) => g.dispose());
    digit4Left.materials.forEach((m) => m.dispose());
    digit0Center.geometries.forEach((g) => g.dispose());
    digit0Center.materials.forEach((m) => m.dispose());
    digit4Right.geometries.forEach((g) => g.dispose());
    digit4Right.materials.forEach((m) => m.dispose());

    particleGeo.dispose();
    particleMat.dispose();

    shards.forEach((s) => {
      s.group.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
          else c.material.dispose();
        }
      });
    });

    starGeo.dispose();
    starMat.dispose();
    pulseRingGeo.dispose();
    pulseRingMat.dispose();

    renderer.dispose();
    renderer.domElement.remove();
  };
}

import * as THREE from "three";
export function mountScene(host: HTMLElement): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  } catch {
    return () => {};
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(48, 1, 0.1, 50);
  camera.position.set(0, 0, 6.8);
  const count = matchMedia("(max-width:600px)").matches ? 3000 : 6500;
  const positions = new Float32Array(count * 3),
    colors = new Float32Array(count * 3);
  let seed = 37;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const scatter = new Float32Array(count * 3),
    sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = random(),
      angle = t * Math.PI * 5.4;
    const radius = 0.08 + t * 2.65;
    const spread = (random() - 0.5) * (0.045 + t * 0.22);
    positions[i * 3] = Math.cos(angle) * (radius + spread);
    positions[i * 3 + 1] = Math.sin(angle) * (radius + spread) * 1.12;
    positions[i * 3 + 2] = (random() - 0.5) * (0.12 + t * 0.65);
    if (i % 10 === 0) {
      const coreRadius = Math.pow(random(), 2) * 0.35;
      const coreAngle = random() * Math.PI * 2;
      positions[i * 3] = Math.cos(coreAngle) * coreRadius;
      positions[i * 3 + 1] = Math.sin(coreAngle) * coreRadius;
      positions[i * 3 + 2] = (random() - 0.5) * coreRadius;
    }
    scatter[i * 3] = (random() - 0.5) * 15;
    scatter[i * 3 + 1] = (random() - 0.5) * 10;
    scatter[i * 3 + 2] = (random() - 0.5) * 5;
    sizes[i] = i % 37 === 0 ? 28 + random() * 22 : 2 + random() * 8;
    const color = new THREE.Color(i % 9 === 0 ? 0xffc199 : i % 3 === 0 ? 0xffffff : 0x80c8ff);
    colors.set([color.r, color.g, color.b], i * 3);
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
      aspect: { value: 1 },
    },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 scatter; attribute float size;
      uniform float time; uniform float gather; uniform float pixelRatio;
      uniform vec2 cursor; uniform float interaction; uniform float aspect;
      varying vec3 tint; varying float sparkle;
      void main() {
        vec3 p = mix(scatter, position, gather);
        float a = sin(time * .55 + length(position.xy) * 1.8) * .13;
        p.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xy;
        p.z += sin(time * .8 + position.x * 2.0) * .22;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Use projected coordinates so the local swirl stays underneath the pointer at any angle.
        vec4 projected = projectionMatrix * mv;
        vec2 delta = projected.xy / projected.w - cursor;
        delta.x *= aspect;
        float influence = exp(-dot(delta, delta) * 7.0) * interaction;
        vec2 outward = delta / max(length(delta), .08);
        mv.xy += (outward * .32 + vec2(-outward.y, outward.x) * .52) * influence;
        mv.z += influence * .6;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * pixelRatio * 5.5 / -mv.z * (1.0 + influence * .32), 1.0, 80.0);
        tint = mix(color, vec3(.65, .92, 1.0), min(influence * .4, .7));
        sparkle = .8 + .2 * sin(time * 1.3 + position.y * 37.0) + influence * .25;
      }`,
    fragmentShader: `
      varying vec3 tint; varying float sparkle;
      void main() {
        vec2 p = gl_PointCoord - .5;
        float r = length(p);
        float core = exp(-r * r * 190.0);
        float halo = exp(-r * r * 22.0) * .24;
        float rays = exp(-abs(p.x) * 100.0) * exp(-abs(p.y) * 12.0)
                   + exp(-abs(p.y) * 100.0) * exp(-abs(p.x) * 12.0);
        gl_FragColor = vec4(mix(tint, vec3(1.0), core * .6), (core + halo + rays * .1) * sparkle);
      }`,
  });
  const galaxy = new THREE.Points(geo, material);
  galaxy.rotation.x = 0.15;
  scene.add(galaxy);
  const starGeo = new THREE.BufferGeometry(),
    stars = new Float32Array(350 * 3);
  for (let i = 0; i < stars.length; i++) stars[i] = (random() - 0.5) * 15;
  starGeo.setAttribute("position", new THREE.BufferAttribute(stars, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0x82bded,
    size: 0.025,
    transparent: true,
    opacity: 0.55,
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
    baseDistance = 6.8,
    last = 0,
    elapsed = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
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
      yawVelocity *= Math.exp(-dt * 3.5);
    }
    yaw += (targetYaw - yaw) * ease;
    pitch += (targetPitch - pitch) * ease;
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
    galaxy.rotation.y = yaw + px * 0.48 + Math.sin(seconds * 0.24) * 0.2 + scroll * 0.6;
    galaxy.rotation.x = 0.22 + pitch - py * 0.3 + Math.sin(seconds * 0.32) * 0.14;
    galaxy.rotation.z = -0.25 - seconds * 0.12;
    galaxy.scale.setScalar(1 + Math.sin(seconds * 0.65) * 0.045);
    starField.rotation.y = px * 0.08 + seconds * 0.015;
    starField.rotation.x = -py * 0.06;
    camera.position.set(px * 0.14, py * 0.1, baseDistance - scroll * 0.8);
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
    baseDistance = Math.max(6.8, 2.7 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
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
      targetYaw += dx * 0.008;
      targetPitch = clamp(targetPitch + (e.clientY - previousY) * 0.005, -0.8, 0.8);
      yawVelocity = clamp(dx * 0.12, -1.6, 1.6);
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
    if (e.key === "ArrowUp") targetPitch = clamp(targetPitch - 0.2, -0.8, 0.8);
    if (e.key === "ArrowDown") targetPitch = clamp(targetPitch + 0.2, -0.8, 0.8);
  };
  surface.addEventListener("pointermove", pointer);
  surface.addEventListener("pointerleave", leave);
  surface.addEventListener("pointerdown", down);
  surface.addEventListener("pointerup", up);
  surface.addEventListener("pointercancel", up);
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
    surface.removeEventListener("lostpointercapture", up);
    surface.removeEventListener("keydown", key);
    delete surface.dataset.dragging;
    document.removeEventListener("visibilitychange", sync);
    reduced.removeEventListener("change", sync);
    geo.dispose();
    starGeo.dispose();
    material.dispose();
    starMat.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

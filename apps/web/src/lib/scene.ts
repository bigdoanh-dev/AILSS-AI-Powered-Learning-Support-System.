import * as THREE from "three";
export function mountScene(host: HTMLElement): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
  } catch {
    return () => {};
  }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
  camera.position.z = 5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  host.appendChild(renderer.domElement);
  const geometry = new THREE.IcosahedronGeometry(1.3, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0x65dfff,
    wireframe: true,
    transparent: true,
    opacity: 0.035,
  });
  const sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);
  const ringGeometry = new THREE.TorusGeometry(1.75, 0.009, 4, 64);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x39baff, transparent: true, opacity: 0.16 });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = 1.25;
  scene.add(ring);
  let visible = true;
  let frame = 0;
  let running = false;
  let x = 0,
    y = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let smoothX = 0,
    smoothY = 0,
    depth = 0;
  function render(t: number) {
    frame = 0;
    if (!running) return;
    smoothX += (x - smoothX) * 0.045;
    smoothY += (y - smoothY) * 0.045;
    const bounds = host.getBoundingClientRect();
    const targetDepth = Math.max(
      -0.35,
      Math.min(0.35, (innerHeight / 2 - bounds.top - bounds.height / 2) / innerHeight),
    );
    depth += (targetDepth - depth) * 0.045;
    sphere.rotation.y = smoothX * 0.18 + depth * 0.3;
    sphere.rotation.x = smoothY * 0.12;
    camera.position.z = 5 + depth * 0.6;
    ring.rotation.z = depth * 0.3 + smoothX * 0.08;
    sphere.position.y = Math.sin(t * 0.0006) * 0.025;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  }
  function sync() {
    const should = visible && !document.hidden && !reduced.matches;
    if (should && !running) {
      running = true;
      frame = requestAnimationFrame(render);
    } else if (!should) {
      running = false;
      cancelAnimationFrame(frame);
      frame = 0;
      renderer.render(scene, camera);
    }
  }
  const resize = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  });
  resize.observe(host);
  const observer = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    sync();
  });
  observer.observe(host);
  const pointer = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    x = (e.clientX - r.left) / r.width - 0.5;
    y = (e.clientY - r.top) / r.height - 0.5;
  };
  const parent = host.parentElement;
  parent?.addEventListener("pointermove", pointer);
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener("change", sync);
  const lost = (e: Event) => {
    e.preventDefault();
    running = false;
    cancelAnimationFrame(frame);
  };
  renderer.domElement.addEventListener("webglcontextlost", lost);
  sync();
  return () => {
    running = false;
    cancelAnimationFrame(frame);
    resize.disconnect();
    observer.disconnect();
    parent?.removeEventListener("pointermove", pointer);
    document.removeEventListener("visibilitychange", sync);
    reduced.removeEventListener("change", sync);
    geometry.dispose();
    material.dispose();
    ringGeometry.dispose();
    ringMaterial.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

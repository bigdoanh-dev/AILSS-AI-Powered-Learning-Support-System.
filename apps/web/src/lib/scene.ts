import * as THREE from "three";
export function mountScene(host: HTMLElement): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
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
    opacity: 0.45,
  });
  const sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);
  const ringGeometry = new THREE.TorusGeometry(1.75, 0.009, 4, 64);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x80eee1, transparent: true, opacity: 0.7 });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = 1.25;
  scene.add(ring);
  const coreGeometry = new THREE.IcosahedronGeometry(0.78, 2);
  const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x28bfb7, metalness: 0.45, roughness: 0.24 });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  scene.add(core, new THREE.HemisphereLight(0xc4fff4, 0x064158, 2.8));
  const light = new THREE.DirectionalLight(0xffffff, 4);
  light.position.set(3, 4, 5);
  scene.add(light);
  const bookGeometry = new THREE.BoxGeometry(0.35, 0.46, 0.1);
  const bookMaterials = [0xf39270, 0x8ee7d9, 0xf2cf74].map(
    (color) => new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.35 }),
  );
  const books = bookMaterials.map((mat, index) => {
    const book = new THREE.Mesh(bookGeometry, mat);
    book.rotation.set(0.15, 0.4, index * 0.5);
    scene.add(book);
    return book;
  });
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
    sphere.rotation.y = t * 0.00018 + smoothX * 0.6 + depth * 0.3;
    sphere.rotation.x = t * 0.00008 + smoothY * 0.3;
    core.rotation.y = -t * 0.0003 + smoothX * 0.3;
    core.rotation.x = 0.2 + smoothY * 0.2;
    books.forEach((book, index) => {
      const a = t * 0.00025 + (index * Math.PI * 2) / 3;
      book.position.set(Math.cos(a) * 1.55, Math.sin(a) * 1.2, Math.sin(a + 0.5) * 0.7);
      book.rotation.y = -a;
    });
    camera.position.z = 5 + depth * 0.6;
    ring.rotation.z = t * 0.00013 + depth * 0.3 + smoothX * 0.3;
    sphere.position.y = Math.sin(t * 0.0006) * 0.07;
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
    coreGeometry.dispose();
    coreMaterial.dispose();
    bookGeometry.dispose();
    bookMaterials.forEach((m) => m.dispose());
    renderer.dispose();
    renderer.domElement.remove();
  };
}

// Vitrin — 3B model görüntüleyici (three.js). Otomatik döner; sürükleyerek çevrilir, tekerlek/kıstırma ile yakınlaşır.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
  camera.position.set(0.55, 0.38, 0.85);

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(0.6, 1.2, 0.8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 4;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0005;
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x1a1418, 0.5));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: 0.28 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 1.6;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.49;

  // Kullanıcı modeli çevirince otomatik dönmeyi durdur, 4 sn sonra devam ettir.
  let autoRotate = controls.autoRotate;
  let resumeTimer = null;
  controls.addEventListener('start', () => {
    clearTimeout(resumeTimer);
    controls.autoRotate = false;
  });
  controls.addEventListener('end', () => {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => { controls.autoRotate = autoRotate; }, 4000);
  });

  let model = null;
  let home = null;

  function frame(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = size.length() / 2;
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(0.55, 0.32, 0.78).normalize().multiplyScalar(dist));
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.minDistance = radius * 1.2;
    controls.maxDistance = dist * 2.5;
    key.position.copy(center).add(new THREE.Vector3(0.6, 1.4, 0.9).multiplyScalar(radius * 4));
    key.target.position.copy(center);
    key.target.updateMatrixWorld();
    const s = radius * 2.5;
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    key.shadow.camera.far = radius * 12;
    key.shadow.camera.updateProjectionMatrix();
    ground.position.y = box.min.y;
    home = { position: camera.position.clone(), target: controls.target.clone() };
    controls.update();
  }

  async function load(url, onProgress) {
    const gltf = await new GLTFLoader().loadAsync(url, (e) => {
      if (onProgress && e.total) onProgress(e.loaded / e.total);
    });
    if (model) scene.remove(model);
    model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    scene.add(model);
    frame(model);
    // Kısa bir giriş animasyonu: model hafifçe büyüyerek belirir.
    if (!reduceMotion) {
      model.scale.setScalar(0.85);
      const t0 = performance.now();
      const grow = () => {
        const p = Math.min(1, (performance.now() - t0) / 700);
        model.scale.setScalar(0.85 + 0.15 * (1 - (1 - p) ** 3));
        if (p < 1) requestAnimationFrame(grow);
      };
      grow();
    }
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let running = true;
  renderer.setAnimationLoop(() => {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    load,
    reset() {
      if (!home) return;
      camera.position.copy(home.position);
      controls.target.copy(home.target);
      controls.update();
    },
    setAutoRotate(on) {
      autoRotate = on;
      controls.autoRotate = on;
    },
    get autoRotate() { return autoRotate; },
    zoom(factor) {
      const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
      const len = THREE.MathUtils.clamp(dir.length() * factor, controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(dir.setLength(len));
      controls.update();
    },
    pause(p) { running = !p; },
    dispose() {
      running = false;
      ro.disconnect();
      clearTimeout(resumeTimer);
      renderer.setAnimationLoop(null);
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

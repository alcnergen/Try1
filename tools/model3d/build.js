// Panelde gösterilen hazır 3B modeli (deri el çantası) prosedürel olarak kurar ve GLB'ye aktarır.
// Kullanım: tools/model3d/README içindeki komutlar (tarayıcıda çalışır, window.buildGlb() base64 döndürür).
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const W = 0.32;   // genişlik
const H = 0.23;   // gövde yüksekliği
const D = 0.12;   // derinlik
const R = 0.035;  // köşe yarıçapı

const leather = new THREE.MeshStandardMaterial({ name: 'Deri', color: 0x9a5528, roughness: 0.52, metalness: 0 });
const leatherDark = new THREE.MeshStandardMaterial({ name: 'Koyu deri', color: 0x5e3017, roughness: 0.48, metalness: 0 });
const gold = new THREE.MeshStandardMaterial({ name: 'Altın', color: 0xd9ab55, roughness: 0.28, metalness: 1 });
const thread = new THREE.MeshStandardMaterial({ name: 'Dikiş', color: 0xf0dcbc, roughness: 0.8, metalness: 0 });
const lining = new THREE.MeshStandardMaterial({ name: 'Astar', color: 0x2a1a12, roughness: 0.9, metalness: 0 });

function roundedRect(w, h, r, taper = 0) {
  // Alt kenarı "taper" kadar daha geniş, yumuşak köşeli dörtgen.
  const s = new THREE.Shape();
  const bw = w / 2 + taper;
  const tw = w / 2;
  s.moveTo(-bw + r, 0);
  s.lineTo(bw - r, 0);
  s.quadraticCurveTo(bw, 0, bw, r);
  s.lineTo(tw, h - r);
  s.quadraticCurveTo(tw, h, tw - r, h);
  s.lineTo(-tw + r, h);
  s.quadraticCurveTo(-tw, h, -tw, h - r);
  s.lineTo(-bw, r);
  s.quadraticCurveTo(-bw, 0, -bw + r, 0);
  return s;
}

function bodyMesh() {
  const shape = roundedRect(W, H, R, 0.012);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: D - 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 6, curveSegments: 18,
  });
  geo.translate(0, 0, -(D - 0.03) / 2);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, leather);
}

function flapMesh() {
  const s = new THREE.Shape();
  const fw = W / 2 + 0.006;
  const fh = 0.115;
  s.moveTo(-fw, 0);
  s.lineTo(fw, 0);
  s.lineTo(fw, -fh + 0.04);
  s.quadraticCurveTo(fw, -fh, fw - 0.05, -fh);
  s.lineTo(-fw + 0.05, -fh);
  s.quadraticCurveTo(-fw, -fh, -fw, -fh + 0.04);
  s.lineTo(-fw, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 3, curveSegments: 16 });
  const m = new THREE.Mesh(geo, leather);
  m.position.set(0, H + 0.004, D / 2 + 0.006);
  m.rotation.x = -0.05;
  return m;
}

function topFold() {
  // Kapağın üst kenardan arkaya dönen kısmı
  const geo = new THREE.CylinderGeometry(0.012, 0.012, W + 0.012, 24, 1, false, 0, Math.PI);
  geo.rotateZ(Math.PI / 2);
  geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, leather);
  m.position.set(0, H + 0.004, D / 2 - 0.002);
  return m;
}

function stitching() {
  const pieces = [];
  const fw = W / 2 - 0.006;
  const fh = 0.105;
  const path = new THREE.CurvePath();
  const z = 0;
  const p = (x, y) => new THREE.Vector3(x, y, z);
  path.add(new THREE.LineCurve3(p(fw, -0.006), p(fw, -fh + 0.04)));
  path.add(new THREE.QuadraticBezierCurve3(p(fw, -fh + 0.04), p(fw, -fh), p(fw - 0.045, -fh)));
  path.add(new THREE.LineCurve3(p(fw - 0.045, -fh), p(-fw + 0.045, -fh)));
  path.add(new THREE.QuadraticBezierCurve3(p(-fw + 0.045, -fh), p(-fw, -fh), p(-fw, -fh + 0.04)));
  path.add(new THREE.LineCurve3(p(-fw, -fh + 0.04), p(-fw, -0.006)));
  const len = path.getLength();
  const step = 0.009;
  for (let d = 0; d < len - step; d += step) {
    const a = path.getPointAt(d / len);
    const b = path.getPointAt(Math.min(1, (d + step * 0.6) / len));
    const dir = new THREE.Vector3().subVectors(b, a);
    const g = new THREE.CylinderGeometry(0.0011, 0.0011, dir.length(), 5);
    g.translate(0, dir.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
    g.translate(a.x, a.y, a.z);
    pieces.push(g);
  }
  const m = new THREE.Mesh(mergeGeometries(pieces), thread);
  m.position.set(0, H + 0.004, D / 2 + 0.0155);
  m.rotation.x = -0.05;
  return m;
}

function clasp() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.032, 0.008, 2, 2, 2), gold);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.012, 0.004), leatherDark);
  slot.position.z = 0.004;
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 20), gold);
  knob.rotation.x = Math.PI / 2;
  knob.position.z = 0.006;
  g.add(plate, slot, knob);
  g.position.set(0, H - 0.1, D / 2 + 0.02);
  g.rotation.x = -0.05;
  return g;
}

function handle() {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.085, H + 0.02, 0),
    new THREE.Vector3(-0.08, H + 0.1, 0),
    new THREE.Vector3(0, H + 0.145, 0),
    new THREE.Vector3(0.08, H + 0.1, 0),
    new THREE.Vector3(0.085, H + 0.02, 0),
  ]);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.009, 16, false), leatherDark);
  g.add(tube);
  for (const x of [-0.085, 0.085]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0035, 12, 32), gold);
    ring.position.set(x, H + 0.012, 0);
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.012), leatherDark);
    tab.position.set(x, H, 0);
    g.add(ring, tab);
  }
  return g;
}

function feet() {
  const g = new THREE.Group();
  for (const x of [-0.12, 0.12]) {
    for (const z of [-0.035, 0.035]) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.007, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold);
      f.rotation.x = Math.PI;
      f.position.set(x, -0.012, z);
      g.add(f);
    }
  }
  return g;
}

function buildScene() {
  const scene = new THREE.Scene();
  const bag = new THREE.Group();
  bag.name = 'Deri el çantası';
  const top = new THREE.Mesh(new THREE.BoxGeometry(W - 0.03, 0.004, D - 0.02), lining);
  top.position.y = H + 0.012;
  bag.add(bodyMesh(), top, topFold(), flapMesh(), stitching(), clasp(), handle(), feet());
  // Zemine otursun ve merkezlensin
  const box = new THREE.Box3().setFromObject(bag);
  bag.position.y = -box.min.y;
  scene.add(bag);
  return scene;
}

window.buildGlb = () => new Promise((resolve, reject) => {
  new GLTFExporter().parse(buildScene(), (buf) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    resolve(btoa(bin));
  }, reject, { binary: true });
});
window.ready = true;

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as D from './door.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1); // GTA is Z-up

const b64ToF32 = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); };
const b64ToU32 = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Uint32Array(u.buffer); };
const b64ToU8 = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
export { b64ToF32, b64ToU32, b64ToU8 };

const COL_PIVOT = 0x2fe0c8, COL_ACCENT = 0xb46cff, COL_COLL = 0x5fd38d;

export class Viewer {
  constructor(container, axesEl, hudEl) {
    this.el = container; this.axesEl = axesEl; this.hudEl = hudEl;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(40, 1, 0.01, 2000);
    this.persp.position.set(3.2, -4.2, 2.6);
    this.ortho = new THREE.OrthographicCamera(-2, 2, 2, -2, -1000, 1000);
    this.camera = this.persp;
    this.viewName = 'persp';

    // lights
    this.scene.add(new THREE.HemisphereLight(0xe8e2ff, 0x2a2233, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, -5, 7); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.7); fill.position.set(-4, 3, 2); this.scene.add(fill);

    // grid on the XY plane
    this.gridGroup = new THREE.Group(); this.scene.add(this.gridGroup);
    this.buildGrid(10);

    // door rig
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.ghost = new THREE.Group(); this.root.add(this.ghost);
    this.doorPivot = new THREE.Group(); this.root.add(this.doorPivot);
    this.doorBody = new THREE.Group(); this.doorPivot.add(this.doorBody);
    this.meshGroup = new THREE.Group(); this.doorBody.add(this.meshGroup);
    this.colGroup = new THREE.Group(); this.doorBody.add(this.colGroup);
    this.panelGroup = new THREE.Group(); this.root.add(this.panelGroup);
    this.helpers = new THREE.Group(); this.root.add(this.helpers);
    this.pivotMarker = this.makePivotMarker(); this.pivotMarker.visible = false; this.root.add(this.pivotMarker);

    this.shading = 'material';
    this.showCollision = true; this.showGhost = true;
    this.textures = new Map();
    this.model = null;
    this.panels = [];
    this.t = 0;

    this.makeControls();
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setMode('translate'); this.gizmo.setSize(0.9);
    this.gizmo.addEventListener('dragging-changed', (e) => { this.controls.enabled = !e.value; });
    this.gizmo.addEventListener('objectChange', () => { this.onPivotDrag && this.onPivotDrag(this.pivotMarker.position.clone()); });
    this.gizmoHelper = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
    this.scene.add(this.gizmoHelper);
    this.gizmo.enabled = false; this.gizmoHelper.visible = false;

    this.axesCanvas = document.createElement('canvas'); this.axesCanvas.width = 168; this.axesCanvas.height = 168;
    this.axesCanvas.style.width = '84px'; this.axesCanvas.style.height = '84px'; axesEl.appendChild(this.axesCanvas);

    this.onFrame = null;
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.clock = new THREE.Clock();
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, this.clock.getDelta());
      if (this.onFrame) this.onFrame(dt);
      this.updatePanelClipping();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.drawAxes();
    };
    loop();
  }

  makeControls() {
    const target = this.controls ? this.controls.target.clone() : new THREE.Vector3(0, 0, 1);
    if (this.controls) this.controls.dispose();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(target);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('start', () => {
      // orbiting an orthographic view switches back to perspective (like Blender's auto-perspective)
      if (this.camera === this.ortho && this.controls.getState && false) this.setView('persp');
    });
    this.controls.enableRotate = true;
    if (this.gizmo) this.gizmo.camera = this.camera;
  }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    this.updateOrtho();
  }
  updateOrtho() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    const half = this.orthoHalf || 2;
    this.ortho.left = -half * w / h; this.ortho.right = half * w / h; this.ortho.top = half; this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
  }

  buildGrid(size) {
    this.gridGroup.clear();
    const div = Math.max(10, Math.round(size * 4));
    const g = new THREE.GridHelper(size, div, 0x3a3247, 0x1c1725);
    g.rotation.x = Math.PI / 2; g.material.transparent = true; g.material.opacity = 0.85;
    this.gridGroup.add(g);
    const g2 = new THREE.GridHelper(size, Math.max(2, Math.round(size)), 0x52466b, 0x52466b);
    g2.rotation.x = Math.PI / 2; g2.position.z = 0.0005; this.gridGroup.add(g2);
    const ax = (c, a, b) => { const geo = new THREE.BufferGeometry().setFromPoints([a, b]); return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: c })); };
    this.gridGroup.add(ax(0xff5c5c, new THREE.Vector3(-size / 2, 0, 0.001), new THREE.Vector3(size / 2, 0, 0.001)));
    this.gridGroup.add(ax(0x6bdc6b, new THREE.Vector3(0, -size / 2, 0.001), new THREE.Vector3(0, size / 2, 0.001)));
  }

  makePivotMarker() {
    const g = new THREE.Group();
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.035, 20, 14), new THREE.MeshBasicMaterial({ color: COL_PIVOT, depthTest: false }));
    s.renderOrder = 10; g.add(s);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.006, 8, 48), new THREE.MeshBasicMaterial({ color: COL_PIVOT, depthTest: false, transparent: true, opacity: 0.8 }));
    ring.renderOrder = 10; g.add(ring);
    g.userData.axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1)]),
      new THREE.LineDashedMaterial({ color: COL_PIVOT, dashSize: 0.06, gapSize: 0.04, depthTest: false, transparent: true, opacity: 0.9 }));
    g.userData.axis.renderOrder = 9; g.add(g.userData.axis);
    return g;
  }

  // ---------------------------------------------------------------- model
  clearModel() {
    for (const grp of [this.meshGroup, this.ghost, this.panelGroup, this.colGroup, this.helpers]) {
      grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      grp.clear();
    }
    this.panels = [];
    this.model = null; this.pivotMarker.visible = false;
    this.enableGizmo(false);
  }

  setModel(model) {
    this.clearModel();
    this.model = model;
    for (const t of model.textures || []) this.addTexture(t);
    this.geoms = model.meshes.map((m) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m._pos, 3));
      if (m.normals) g.setAttribute('normal', new THREE.BufferAttribute(b64ToF32(m.normals), 3));
      if (m.uvs) g.setAttribute('uv', new THREE.BufferAttribute(b64ToF32(m.uvs), 2));
      g.setIndex(new THREE.BufferAttribute(b64ToU32(m.indices), 1));
      if (!m.normals) g.computeVertexNormals();
      g.computeBoundingBox(); g.computeBoundingSphere();
      g.userData.shaderIndex = m.shaderIndex;
      return g;
    });
    this.rebuildMeshes();
    this.frame(true);
  }

  addTexture(t) {
    if (!t || !t.rgba || this.textures.has(t.name)) return;
    const data = b64ToU8(t.rgba);
    const tex = new THREE.DataTexture(data, t.width, t.height, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    tex.anisotropy = 8; tex.flipY = false; tex.needsUpdate = true;
    this.textures.set(t.name, tex);
  }
  addTextures(list) { for (const t of list || []) this.addTexture(t); if (this.model) this.rebuildMeshes(); }

  materialFor(shaderIndex) {
    const sh = this.model?.materials?.[shaderIndex];
    if (this.shading === 'wire') return new THREE.MeshBasicMaterial({ color: 0x9fb6cf, wireframe: true, transparent: true, opacity: 0.85 });
    if (this.shading === 'solid') return new THREE.MeshStandardMaterial({ color: 0xb9bfc8, roughness: 0.78, metalness: 0.04, side: THREE.DoubleSide });
    const texs = sh?.textures || {};
    const diffName = texs.diffusesampler || texs.texturesampler_layer0 || Object.values(texs)[0];
    const map = (diffName && this.textures.get(diffName)) || null;
    const name = (sh?.name || '').toLowerCase();
    const alpha = /alpha|glass|decal|cutout|cloth/.test(name);
    const m = new THREE.MeshStandardMaterial({
      color: map ? 0xffffff : this.hashColor(name + diffName), map, roughness: /glass/.test(name) ? 0.15 : 0.72,
      metalness: /metal/.test(diffName || '') ? 0.4 : 0.03, side: THREE.DoubleSide,
      transparent: alpha && /glass/.test(name), opacity: /glass/.test(name) ? 0.45 : 1, alphaTest: alpha && !/glass/.test(name) ? 0.35 : 0,
    });
    return m;
  }
  hashColor(s) { let h = 0; for (const c of s || 'x') h = (h * 31 + c.charCodeAt(0)) >>> 0; return new THREE.Color().setHSL((h % 360) / 360, 0.25, 0.55); }

  rebuildMeshes() {
    if (!this.model) return;
    this.meshGroup.clear(); this.ghost.clear();
    for (const g of this.geoms) {
      const mesh = new THREE.Mesh(g, this.materialFor(g.userData.shaderIndex));
      this.meshGroup.add(mesh);
      if (this.shading !== 'wire') {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: this.shading === 'solid' ? 0.28 : 0.12 }));
        this.meshGroup.add(edges);
      }
      const gm = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: COL_ACCENT, wireframe: true, transparent: true, opacity: 0.09, depthWrite: false }));
      this.ghost.add(gm);
    }
    if (this.lastDoorArgs) this.updateDoor(...this.lastDoorArgs);
  }

  setShading(mode) { this.shading = mode; this.rebuildMeshes(); }
  setGrid(on) { this.gridGroup.visible = on; }
  setCollisionVisible(on) { this.showCollision = on; this.colGroup.visible = on; for (const p of this.panels) if (p.col) p.col.visible = on; }
  setGhostVisible(on) { this.showGhost = on; this.applyGhost(); }
  applyGhost() { this.ghost.visible = this.showGhost && this.t > 0.001 && !!this.model; }

  // ---------------------------------------------------------------- collision display (original model space)
  setCollision(trisF32) {
    this.colGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.colGroup.clear();
    this.colTris = trisF32;
    if (!trisF32 || trisF32.length < 9) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(trisF32, 3));
    const fillM = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: COL_COLL, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(g, 1), new THREE.LineBasicMaterial({ color: COL_COLL, transparent: true, opacity: 0.85 }));
    this.colGroup.add(fillM, wire);
    this.colGroup.visible = this.showCollision;
  }

  // ---------------------------------------------------------------- door rig
  updateDoor(door, an, pivot) {
    this.lastDoorArgs = [door, an, pivot];
    if (!this.model || !an) return;
    this.door = door; this.an = an; this.pivot = pivot;
    const P = new THREE.Vector3(pivot.x, pivot.y, pivot.z);
    this.doorPivot.position.copy(P);
    this.doorBody.position.copy(P).negate();
    this.pivotMarker.visible = door.created;
    if (!this.gizmoDragging) this.pivotMarker.position.copy(P);
    const axis = this.pivotMarker.userData.axis;
    axis.geometry.setFromPoints([new THREE.Vector3(0, 0, an.min[2] - pivot.z - 0.15), new THREE.Vector3(0, 0, an.max[2] - pivot.z + 0.25)]);
    axis.computeLineDistances();
    axis.visible = door.created && door.type === 'normal';

    // helpers
    this.helpers.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.helpers.clear();
    if (door.created) this.buildHelpers(door, an, pivot);

    // garage panels
    this.buildPanels(door, an, pivot);
    this.setOpen(this.t);
  }

  buildHelpers(door, an, pivot) {
    const lineMat = (c, o = 0.9) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false });
    if (door.type === 'normal') {
      const W = an.size[an.widthAxis];
      const c = an.center;
      const a0 = Math.atan2(c[1] - pivot.y, c[0] - pivot.x);
      const sgn = D.swingSign(door, an, pivot);
      const sweep = sgn * door.normal.angle * Math.PI / 180;
      const pts = [new THREE.Vector3(0, 0, 0)];
      const N = 48;
      for (let i = 0; i <= N; i++) { const a = a0 + sweep * i / N; pts.push(new THREE.Vector3(Math.cos(a) * W, Math.sin(a) * W, 0)); }
      pts.push(new THREE.Vector3(0, 0, 0));
      const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(COL_ACCENT));
      arc.position.set(pivot.x, pivot.y, an.min[2] + 0.004); arc.renderOrder = 8;
      const fan = new THREE.Mesh(new THREE.CircleGeometry(W, 48, Math.min(a0, a0 + sweep), Math.abs(sweep)),
        new THREE.MeshBasicMaterial({ color: COL_ACCENT, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide }));
      fan.position.copy(arc.position);
      this.helpers.add(fan, arc);
    } else if (door.type === 'sliding') {
      const v = D.slideVector(door, an), d = D.slideDistance(door, an);
      if (d > 0.001) {
        const origin = new THREE.Vector3(an.center[0], an.center[1], door.sliding.dir === 'up' || door.sliding.dir === 'down' ? an.center[2] : an.min[2] + 0.02);
        const arrow = new THREE.ArrowHelper(new THREE.Vector3(...v), origin, d, COL_ACCENT, Math.min(0.18, d * 0.4), Math.min(0.1, d * 0.25));
        arrow.traverse((o) => { if (o.material) { o.material.depthTest = false; o.renderOrder = 8; } });
        this.helpers.add(arrow);
        // destination outline
        const box = new THREE.Box3(new THREE.Vector3(...an.min), new THREE.Vector3(...an.max));
        const bh = new THREE.Box3Helper(box.translate(new THREE.Vector3(v[0] * d, v[1] * d, v[2] * d)), COL_ACCENT);
        bh.material.transparent = true; bh.material.opacity = 0.35; this.helpers.add(bh);
      }
    } else if (door.type === 'garage') {
      const { n } = D.frontBasis(an);
      const W = an.size[an.widthAxis];
      const wv = an.widthAxis === 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const nv = new THREE.Vector3(n[0], n[1], 0);
      const c = new THREE.Vector3(an.center[0], an.center[1], 0);
      if (door.garage.kind === 'sectional' || door.garage.kind === 'rollup') {
        // rails / drum
        const pts = [];
        const L = door.garage.kind === 'rollup' ? an.size[2] + 0.22 * Math.PI * 2 : door.garage.height + 0.35 * Math.PI / 2 + Math.max(0.3, door.garage.distance);
        for (let s = 0; s <= L; s += 0.03) { const tp = D.trackPoint(door, an, s); pts.push(tp); }
        for (const side of [-0.5, 0.5]) {
          const p3 = pts.map((tp) => c.clone().addScaledVector(nv, tp.n + 0.03).addScaledVector(wv, side * W * 1.01).setZ(tp.z));
          this.helpers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p3), lineMat(0x8f7fb0, 0.6)));
        }
      } else {
        const top = new THREE.Box3(new THREE.Vector3(...an.min), new THREE.Vector3(...an.max)).translate(new THREE.Vector3(0, 0, door.garage.height));
        const bh = new THREE.Box3Helper(top, COL_ACCENT); bh.material.transparent = true; bh.material.opacity = 0.35; this.helpers.add(bh);
      }
    }
  }

  buildPanels(door, an, pivot) {
    for (const p of this.panels) p.group.traverse((o) => { if (o.material) o.material.dispose(); });
    this.panelGroup.clear(); this.panels = [];
    const usePanels = door.created && door.type === 'garage' && (door.garage.kind === 'sectional' || door.garage.kind === 'rollup') && !door.garage.previewInGame;
    this.doorPivot.visible = !usePanels;
    if (!usePanels) return;
    const layout = D.panelLayout(door, an);
    for (const pl of layout) {
      const group = new THREE.Group(); group.matrixAutoUpdate = false;
      const planes = [new THREE.Plane(new THREE.Vector3(0, 0, 1), -pl.z0), new THREE.Plane(new THREE.Vector3(0, 0, -1), pl.z1)];
      const localPlanes = planes.map((p) => p.clone());
      for (const g of this.geoms) {
        const m = this.materialFor(g.userData.shaderIndex);
        m.clippingPlanes = planes; m.clipShadows = true;
        group.add(new THREE.Mesh(g, m));
      }
      // panel seam outline
      const W = an.size[an.widthAxis], T = an.size[an.thickAxis];
      const sx = an.widthAxis === 0 ? W : T, sy = an.widthAxis === 0 ? T : W;
      const box = new THREE.Box3(new THREE.Vector3(an.center[0] - sx / 2, an.center[1] - sy / 2, pl.z0 + 0.002), new THREE.Vector3(an.center[0] + sx / 2, an.center[1] + sy / 2, pl.z1 - 0.002));
      const bh = new THREE.Box3Helper(box, 0x000000); bh.material.transparent = true; bh.material.opacity = 0.35; group.add(bh);
      this.panelGroup.add(group);
      this.panels.push({ group, planes, localPlanes, z0: pl.z0, z1: pl.z1 });
    }
  }

  updatePanelClipping() {
    for (const p of this.panels) {
      p.group.updateMatrixWorld(true);
      for (let i = 0; i < 2; i++) p.planes[i].copy(p.localPlanes[i]).applyMatrix4(p.group.matrixWorld);
    }
  }

  setOpen(t) {
    this.t = t;
    this.applyGhost();
    if (!this.model || !this.door) return;
    const door = this.door, an = this.an, pivot = this.pivot;
    const e = D.ease(t);
    if (!door.created) { this.doorPivot.quaternion.identity(); this.doorPivot.position.set(pivot.x, pivot.y, pivot.z); return; }
    if (this.panels.length) {
      const { n } = D.frontBasis(an);
      const nv = new THREE.Vector3(n[0], n[1], 0);
      const axis = new THREE.Vector3(-n[1], n[0], 0).normalize(); // Z x n
      const travel = (door.garage.kind === 'sectional' ? door.garage.height + 0.35 * Math.PI / 2 + 0.02 : door.garage.height) * e;
      for (const p of this.panels) {
        const s = (p.z0 - an.min[2]) + travel;
        const tp = D.trackPoint(door, an, Math.max(0, s));
        const B = new THREE.Vector3(an.center[0], an.center[1], p.z0);
        const W = new THREE.Vector3(an.center[0], an.center[1], 0).addScaledVector(nv, tp.n).setZ(tp.z);
        const m = new THREE.Matrix4().makeTranslation(W.x, W.y, W.z)
          .multiply(new THREE.Matrix4().makeRotationAxis(axis, tp.phi))
          .multiply(new THREE.Matrix4().makeTranslation(-B.x, -B.y, -B.z));
        p.group.matrix.copy(m);
      }
      return;
    }
    const ms = D.motionSpec(door, an, pivot);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...ms.axis).normalize(), ms.angle * Math.PI / 180 * e);
    const C = new THREE.Vector3(...ms.center);
    const shift = C.clone().sub(C.clone().applyQuaternion(q)).add(new THREE.Vector3(...ms.offset).multiplyScalar(e));
    this.doorPivot.quaternion.copy(q);
    this.doorPivot.position.set(pivot.x, pivot.y, pivot.z).add(shift);
  }

  // ---------------------------------------------------------------- gizmo
  enableGizmo(on, cb) {
    this.onPivotDrag = cb || this.onPivotDrag;
    if (on && this.model) { this.gizmo.attach(this.pivotMarker); this.gizmo.enabled = true; this.gizmoHelper.visible = true; }
    else { this.gizmo.detach(); this.gizmo.enabled = false; this.gizmoHelper.visible = false; }
  }

  // ---------------------------------------------------------------- camera
  modelBox() {
    if (!this.model || !this.an) return new THREE.Box3(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 1, 2));
    return new THREE.Box3(new THREE.Vector3(...this.an.min), new THREE.Vector3(...this.an.max));
  }
  frame(resetDir = false) {
    const box = this.modelBox();
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const r = Math.max(0.3, sz.length() / 2);
    const gridSize = Math.max(4, Math.ceil(r * 4));
    this.buildGrid(gridSize);
    if (this.camera === this.persp) {
      let dir = this.persp.position.clone().sub(this.controls.target).normalize();
      if (resetDir || dir.lengthSq() < 0.5) dir = new THREE.Vector3(0.55, -0.72, 0.42).normalize();
      const dist = r / Math.sin((this.persp.fov * Math.PI / 180) / 2) * 1.15;
      this.persp.position.copy(c).addScaledVector(dir, dist);
      this.persp.near = dist / 200; this.persp.far = dist * 50; this.persp.updateProjectionMatrix();
    } else {
      this.orthoHalf = r * 1.25; this.updateOrtho();
      const dir = this.ortho.position.clone().sub(this.controls.target).normalize();
      this.ortho.position.copy(c).addScaledVector(dir, r * 10);
    }
    this.controls.target.copy(c);
    this.controls.update();
  }

  setView(name) {
    this.viewName = name;
    const box = this.modelBox();
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(0.3, box.getSize(new THREE.Vector3()).length() / 2);
    if (name === 'persp') {
      this.camera = this.persp; this.makeControls(); this.frame(true); return;
    }
    const an = this.an;
    const n = an ? D.frontBasis(an).n : [0, 1, 0];
    let dir, up = new THREE.Vector3(0, 0, 1);
    if (name === 'front') dir = new THREE.Vector3(-n[0], -n[1], 0);
    else if (name === 'side') dir = an && an.widthAxis === 1 ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(1, 0, 0);
    else dir = new THREE.Vector3(-n[0] * 0.002, -n[1] * 0.002, 1).normalize();
    this.camera = this.ortho;
    this.ortho.up.copy(up);
    this.ortho.position.copy(c).addScaledVector(dir, r * 10);
    this.orthoHalf = r * 1.25; this.updateOrtho();
    this.makeControls();
    this.controls.target.copy(c);
    this.ortho.lookAt(c);
    this.controls.update();
  }

  drawAxes() {
    const ctx = this.axesCanvas.getContext('2d');
    const W = this.axesCanvas.width, cx = W / 2, cy = W / 2, L = W * 0.34;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#050407aa'; ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2); ctx.fill();
    const m = new THREE.Matrix4().extractRotation(this.camera.matrixWorldInverse);
    const axes = [[new THREE.Vector3(1, 0, 0), '#ff5c5c', 'X'], [new THREE.Vector3(0, 1, 0), '#6bdc6b', 'Y'], [new THREE.Vector3(0, 0, 1), '#5c9dff', 'Z']]
      .map(([v, c, l]) => [v.clone().applyMatrix4(m), c, l]).sort((a, b) => a[0].z - b[0].z);
    ctx.lineWidth = 4; ctx.font = 'bold 22px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [v, c, l] of axes) {
      const x = cx + v.x * L, y = cy - v.y * L;
      ctx.strokeStyle = c; ctx.globalAlpha = v.z < -0.2 ? 0.45 : 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000'; ctx.fillText(l, x, y + 1);
    }
    ctx.globalAlpha = 1;
  }

  screenshot() { return this.renderer.domElement.toDataURL('image/png'); }
}

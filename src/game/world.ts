// ============================================================
//  buildWorld — процедурная геометрия всей локации
//  вышка (3 уровня), поляна, лес, серверы-бункеры, обрыв, пещера
// ============================================================
import * as THREE from "three";

export interface Collider { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number; }
export interface CanvasTex { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; }

export function makeCanvasTex(w: number, h: number): CanvasTex {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, ctx, tex };
}

// ---------------- рисование карты (стена + блокнот) ----------------
export interface MapFlags { coordsKnown: boolean; caveOpen: boolean; serversLooted: [boolean, boolean]; dug: boolean; }
export function drawMap(ctx: CanvasRenderingContext2D, w: number, h: number, f: MapFlags) {
  // parchment
  ctx.fillStyle = "#d9c79c"; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(120,84,30,${0.03 + Math.random() * 0.05})`;
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, 8 + Math.random() * 40, 0, 7);
    ctx.fill();
  }
  const X = (x: number) => ((x + 150) / 300) * w;
  const Y = (z: number) => ((z + 150) / 250) * h;
  // sea at the bottom (south)
  ctx.fillStyle = "#7d9aa6";
  ctx.fillRect(0, Y(92), w, h - Y(92));
  ctx.strokeStyle = "#54707c"; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) ctx.lineTo(x, Y(92) + 14 + i * 16 + Math.sin(x * 0.08 + i) * 3);
    ctx.stroke();
  }
  // cliff hatching
  ctx.strokeStyle = "#6b5327"; ctx.lineWidth = 1.4;
  for (let x = X(-80); x < X(80); x += 7) {
    ctx.beginPath(); ctx.moveTo(x, Y(92)); ctx.lineTo(x + 5, Y(84)); ctx.stroke();
  }
  // forest stipple
  ctx.fillStyle = "#3f5638";
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * w, y = Math.random() * Y(70);
    ctx.fillRect(x, y, 2.4, 2.4);
  }
  // paths
  ctx.strokeStyle = "#8a6c3c"; ctx.lineWidth = 2.5; ctx.setLineDash([7, 6]);
  const path = (pts: [number, number][]) => {
    ctx.beginPath(); ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
    for (const [x, z] of pts.slice(1)) ctx.lineTo(X(x), Y(z));
    ctx.stroke();
  };
  path([[0, 6], [-30, 20], [-95, -10]]);
  path([[0, 6], [30, -10], [85, -45]]);
  path([[0, 6], [-10, 40], [-34, 78]]);
  path([[0, 6], [20, 50], [40, 86]]);
  ctx.setLineDash([]);
  // tower
  const tx = X(0), ty = Y(0);
  ctx.fillStyle = "#20262b";
  ctx.beginPath(); ctx.moveTo(tx - 9, ty + 9); ctx.lineTo(tx + 9, ty + 9); ctx.lineTo(tx, ty - 14); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#20262b"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(tx, ty - 14); ctx.lineTo(tx, ty - 26); ctx.stroke();
  ctx.fillStyle = "#2c2214"; ctx.font = `bold ${Math.round(w * 0.032)}px "PT Mono"`;
  ctx.fillText("ВЫШКА-9", tx + 12, ty - 14);
  // bunkers
  const srv: [number, number, string, boolean][] = [[-95, -10, "СЕРВЕР А", f.serversLooted[0]], [85, -45, "СЕРВЕР Б", f.serversLooted[1]]];
  for (const [x, z, label, looted] of srv) {
    ctx.strokeStyle = looted ? "#4a6a4a" : "#a03a24"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(X(x) - 7, Y(z) - 7); ctx.lineTo(X(x) + 7, Y(z) + 7);
    ctx.moveTo(X(x) + 7, Y(z) - 7); ctx.lineTo(X(x) - 7, Y(z) + 7); ctx.stroke();
    ctx.fillStyle = "#2c2214"; ctx.fillText(label, X(x) + 10, Y(z) + 4);
  }
  if (f.coordsKnown) {
    ctx.fillStyle = "#a03a24"; ctx.font = `bold ${Math.round(w * 0.045)}px "PT Mono"`;
    ctx.fillText(f.dug ? "▣ раскоп" : "? 60.5 30.2", X(-34) - 20, Y(78) - 8);
  }
  if (f.caveOpen) {
    ctx.fillStyle = "#2c2214";
    ctx.beginPath(); ctx.arc(X(40), Y(90), 8, Math.PI, 0); ctx.fill();
    ctx.fillText("пещера", X(40) + 12, Y(90) + 4);
  }
  ctx.fillStyle = "#4a5a64"; ctx.font = `${Math.round(w * 0.03)}px "PT Mono"`;
  ctx.fillText("м о р е", w * 0.44, Y(92) + (h - Y(92)) * 0.55);
  // frame
  ctx.strokeStyle = "#6b5327"; ctx.lineWidth = 5; ctx.strokeRect(3, 3, w - 6, h - 6);
}

// ---------------- материалы ----------------
const M = (color: number, rough = 0.92, extra?: Partial<THREE.MeshStandardMaterialParameters>) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02, ...extra });

export interface BunkerRef { lampMat: THREE.MeshStandardMaterial; }

export interface WorldRefs {
  colliders: Collider[];
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sea: THREE.Mesh; seaBase: Float32Array;
  beamGroup: THREE.Group; beamLight: THREE.SpotLight; lensMat: THREE.MeshStandardMaterial;
  mast: THREE.Group; mastTop: THREE.Mesh;
  stoveLight: THREE.PointLight; stoveGlowMat: THREE.MeshStandardMaterial;
  fireLight: THREE.PointLight; fireGlow: THREE.Group;
  edisonLight: THREE.PointLight; genBulbMat: THREE.MeshStandardMaterial;
  receiverDisplay: CanvasTex; receiverLampMat: THREE.MeshStandardMaterial;
  sheet: CanvasTex; genDial: CanvasTex; genLampMat: THREE.MeshStandardMaterial;
  keyLever: THREE.Group; txLampMat: THREE.MeshStandardMaterial;
  mapTex: CanvasTex;
  canisters: THREE.Mesh[]; shovelMesh: THREE.Mesh; flashlightMesh: THREE.Mesh;
  partsMesh: THREE.Mesh; batteryMeshes: THREE.Mesh[]; firewoodMeshes: THREE.Mesh[];
  bunkers: BunkerRef[];
  treeFoliageMat: THREE.MeshStandardMaterial;
  runeMats: THREE.MeshStandardMaterial[];
  digGlowMat: THREE.MeshStandardMaterial; holeMesh: THREE.Mesh;
  hatchMesh: THREE.Mesh; caveLight: THREE.PointLight;
  crystalMat: THREE.MeshStandardMaterial; crystalLight: THREE.PointLight; crystalMesh: THREE.Mesh;
  filterMesh: THREE.Mesh;
  ladder: { x: number; z: number }; floors: number[];
  nearTrees: { x: number; z: number }[];
  skullGroup: THREE.Group;
}

export function buildWorld(scene: THREE.Scene): WorldRefs {
  const colliders: Collider[] = [];
  const collidersOff: Collider[] = [];

  const solid = (x: number, z: number, w: number, d: number, y0: number, y1: number, mat: THREE.Material, noColl = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, y1 - y0, d), mat);
    m.position.set(x, (y0 + y1) / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: y0, maxY: y1 };
    (noColl ? collidersOff : colliders).push(c);
    return m;
  };

  // ================= свет =================
  const hemi = new THREE.HemisphereLight(0x9db4c4, 0x2a241c, 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe3b3, 1.1);
  sun.position.set(60, 90, -50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.far = 260;
  sun.shadow.bias = -0.0016;
  sc.updateProjectionMatrix();
  scene.add(sun);

  // ================= земля / море / обрыв =================
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(330, 262), M(0x232b1e, 0.98));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -40);
  ground.receiveShadow = true;
  scene.add(ground);
  // lighter clearing
  const clearing = new THREE.Mesh(new THREE.CircleGeometry(17, 24), M(0x2e3524, 0.98));
  clearing.rotation.x = -Math.PI / 2; clearing.position.y = 0.012; clearing.receiveShadow = true;
  scene.add(clearing);

  const seaGeo = new THREE.PlaneGeometry(800, 620, 64, 44);
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshStandardMaterial({ color: 0x0e1e28, roughness: 0.55, metalness: 0.35 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -26, 290);
  scene.add(sea);
  const seaBase = Float32Array.from(seaGeo.attributes.position.array);

  const rockMat = M(0x3a3f42, 0.96);
  // cliff wall (gap x 36..44 for cave)
  solid(-22, 89.6, 116, 4.4, -30, 0.5, rockMat);
  solid(62, 89.6, 36, 4.4, -30, 0.5, rockMat);
  // cave corridor beyond the gap
  solid(35.6, 99, 0.9, 15, -0.4, 3.4, rockMat);
  solid(44.4, 99, 0.9, 15, -0.4, 3.4, rockMat);
  solid(40, 106.4, 9.7, 0.9, -0.4, 3.4, rockMat);
  solid(40, 99, 9.7, 15, 3.0, 3.6, rockMat);
  const caveFloor = new THREE.Mesh(new THREE.PlaneGeometry(8.8, 15), M(0x26221d, 1));
  caveFloor.rotation.x = -Math.PI / 2; caveFloor.position.set(40, 0.02, 99); caveFloor.receiveShadow = true;
  scene.add(caveFloor);
  // rocks along the edge
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < 26; i++) {
    const r = new THREE.Mesh(rockGeo, rockMat);
    const x = -78 + i * 6.2 + Math.random() * 2;
    if (x > 34 && x < 46) continue;
    r.position.set(x, Math.random() * 0.4, 86 + Math.random() * 1.6);
    r.scale.setScalar(0.7 + Math.random() * 1.5);
    r.rotation.set(Math.random(), Math.random() * 3, Math.random());
    r.castShadow = true;
    scene.add(r);
    colliders.push({ minX: r.position.x - 1, maxX: r.position.x + 1, minZ: 84.6, maxZ: 88.4, minY: 0, maxY: 1.6 });
  }

  // paths
  const pathMat = M(0x33301f, 1);
  const makePath = (pts: [number, number][], wd: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(wd, len), pathMat);
      p.rotation.x = -Math.PI / 2;
      p.rotation.z = Math.atan2(dx, dz);
      p.position.set((x1 + x2) / 2, 0.02, (z1 + z2) / 2);
      p.receiveShadow = true;
      scene.add(p);
    }
  };
  makePath([[0, 6], [-30, 20], [-95, -10]], 2.2);
  makePath([[0, 6], [30, -10], [85, -45]], 2.2);
  makePath([[0, 6], [-10, 40], [-34, 78]], 1.8);
  makePath([[0, 6], [20, 50], [40, 84]], 1.8);

  // ================= ВЫШКА =================
  const wd = M(0x4a3a22, 1);
  const wd2 = M(0x5a4527, 1);
  const metal = M(0x3c4043, 0.6, { metalness: 0.55 });

  const pad = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 7.4, 0.4, 10), M(0x33302a, 1));
  pad.position.set(0, -0.2, 0); pad.receiveShadow = true; scene.add(pad);

  const F = [0, 3.6, 7.2, 10.8]; // floor heights
  // slabs
  for (let i = 0; i < 4; i++) {
    const slab = solid(0, 0, 8.6, 8.6, F[i] - 0.28, F[i], i === 0 ? M(0x3d3320, 1) : wd2, i === 0);
    slab.receiveShadow = true;
  }
  // walls lvl1 (door south)
  solid(0, -4, 8.6, 0.3, F[0], F[1], wd);
  solid(-4, 0, 0.3, 8.6, F[0], F[1], wd);
  solid(4, 0, 0.3, 8.6, F[0], F[1], wd);
  solid(-2.5, 4, 3.6, 0.3, F[0], F[1], wd);
  solid(2.5, 4, 3.6, 0.3, F[0], F[1], wd);
  solid(0, 4, 1.8, 0.3, 2.3, F[1], wd); // door header
  // walls lvl2
  for (const [x, z, w, d] of [[0, -4, 8.6, 0.3], [-4, 0, 0.3, 8.6], [4, 0, 0.3, 8.6], [0, 4, 8.6, 0.3]] as const)
    solid(x, z, w, d, F[1], F[2], wd2);
  // walls lvl3 with windows (north big window, east/west small)
  solid(-3.15, -4, 2.3, 0.3, F[2], F[3], wd);
  solid(3.15, -4, 2.3, 0.3, F[2], F[3], wd);
  solid(0, -4, 8.6, 0.3, F[2], F[2] + 1.0, wd);
  solid(0, -4, 8.6, 0.3, F[3] - 1.0, F[3], wd);
  solid(0, 4, 8.6, 0.3, F[2], F[3], wd);
  solid(-4, 0, 0.3, 8.6, F[2], F[2] + 1.0, wd);
  solid(-4, 0, 0.3, 8.6, F[3] - 1.0, F[3], wd);
  solid(-4, -3.15, 0.3, 2.3, F[2] + 1.0, F[3] - 1.0, wd);
  solid(-4, 3.15, 0.3, 2.3, F[2] + 1.0, F[3] - 1.0, wd);
  solid(4, 0, 0.3, 8.6, F[2], F[2] + 1.0, wd);
  solid(4, 0, 0.3, 8.6, F[3] - 1.0, F[3], wd);
  solid(4, -3.15, 0.3, 2.3, F[2] + 1.0, F[3] - 1.0, wd);
  solid(4, 3.15, 0.3, 2.3, F[2] + 1.0, F[3] - 1.0, wd);
  // roof slab + railings
  const roof = solid(0, 0, 9.4, 9.4, F[3] - 0.26, F[3], M(0x2c2620, 1));
  roof.receiveShadow = true;
  for (const [x, z, w, d] of [[0, -4.55, 9.4, 0.25], [0, 4.55, 9.4, 0.25], [-4.55, 0, 0.25, 9.4], [4.55, 0, 0.25, 9.4]] as const)
    solid(x, z, w, d, F[3], F[3] + 1.3, metal);

  // ladder (visual)
  const ladderX = -3.2, ladderZ = -3.2;
  for (let fl = 0; fl < 3; fl++) {
    for (const off of [-0.28, 0.28]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.6, 0.08), metal);
      rail.position.set(ladderX + off, F[fl] + 1.8, ladderZ);
      scene.add(rail);
    }
    for (let r = 0; r < 8; r++) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.06, 0.06), metal);
      rung.position.set(ladderX, F[fl] + 0.3 + r * 0.44, ladderZ);
      scene.add(rung);
    }
  }

  // -------- level 1: быт --------
  const stove = solid(2.9, -3.1, 1.3, 1.3, F[0], F[0] + 1.2, metal);
  stove.castShadow = true;
  const stoveGlowMat = M(0x1a0d05, 0.4, { emissive: 0xff6a1f, emissiveIntensity: 1.6 });
  const stoveGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), stoveGlowMat);
  stoveGlow.position.set(2.9, 0.55, -2.42);
  scene.add(stoveGlow);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 6.6, 8), metal);
  chimney.position.set(2.9, 3.9, -3.1); scene.add(chimney);
  const stoveLight = new THREE.PointLight(0xff7a2a, 7, 9, 1.8);
  stoveLight.position.set(2.9, 1.1, -2.3);
  scene.add(stoveLight);

  // bed
  solid(-2.7, 2.6, 2.1, 1.2, F[0], F[0] + 0.42, wd2);
  const mattress = solid(-2.7, 2.6, 1.95, 1.05, F[0] + 0.42, F[0] + 0.62, M(0x6a5a44, 1));
  mattress.castShadow = false;
  solid(-3.6, 2.6, 0.25, 1.0, F[0] + 0.62, F[0] + 0.85, M(0x8a7a5c, 1));

  // desk + edison lamp + sheet
  solid(0.4, -3.2, 2.0, 0.95, F[0], F[0] + 0.78, wd2);
  const bulbMat = M(0xfff2cf, 0.3, { emissive: 0xffc46a, emissiveIntensity: 2.2 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), bulbMat);
  bulb.position.set(0.95, 1.28, -3.3); scene.add(bulb);
  const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.5, 8), metal);
  lampPost.position.set(0.95, 1.03, -3.3); scene.add(lampPost);
  const edisonLight = new THREE.PointLight(0xffb054, 9, 8, 1.7);
  edisonLight.position.set(0.9, 1.5, -3.1);
  scene.add(edisonLight);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), M(0x774a30, 0.8));
  mug.position.set(-0.1, 0.84, -3.1); scene.add(mug);

  // workbench (shovel, flashlight, parts, battery)
  solid(-3.4, -0.6, 0.9, 2.4, F[0], F[0] + 0.85, wd);
  const shovelMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.5, 0.09), M(0x8a6a3c, 0.8));
  shovelMesh.position.set(-3.4, 1.6, -1.3); shovelMesh.rotation.z = 0.12;
  const shovelBlade = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.05), metal);
  shovelBlade.position.y = -0.85; shovelMesh.add(shovelBlade);
  scene.add(shovelMesh);
  const flashlightMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.3, 10), M(0x777c3f, 0.5, { metalness: 0.4 }));
  flashlightMesh.position.set(-3.4, 0.95, -0.4); flashlightMesh.rotation.x = Math.PI / 2;
  scene.add(flashlightMesh);
  const partsMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.3), M(0x9a9a8a, 0.5, { metalness: 0.6 }));
  partsMesh.position.set(-3.4, 0.95, 0.3); partsMesh.visible = false;
  scene.add(partsMesh);
  const batteryMeshes: THREE.Mesh[] = [];
  const batGeo = new THREE.BoxGeometry(0.16, 0.1, 0.1);
  const batMat = M(0xb8a830, 0.5, { metalness: 0.4 });
  for (const [bx, bz] of [[-3.35, 0.75], [1.2, 4.8]]) {
    const b = new THREE.Mesh(batGeo, batMat);
    b.position.set(bx, 0.93, bz);
    scene.add(b); batteryMeshes.push(b);
  }

  // shelf with canisters (level1 east wall)
  solid(3.55, 1.6, 0.8, 2.2, 1.15, 1.28, wd);
  const canGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.5, 10);
  const canMat = M(0xa83226, 0.6, { metalness: 0.3 });
  const canisters: THREE.Mesh[] = [];
  for (const cz of [1.15, 2.05]) {
    const c = new THREE.Mesh(canGeo, canMat);
    c.position.set(3.55, 1.55, cz); c.castShadow = true;
    scene.add(c); canisters.push(c);
  }

  // -------- level 2: генератор --------
  const genBody = solid(2.4, -2.6, 2.0, 1.4, F[1], F[1] + 1.4, M(0x4a5258, 0.55, { metalness: 0.5 }));
  genBody.castShadow = true;
  const genDial = makeCanvasTex(256, 128);
  const genDialMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35), new THREE.MeshBasicMaterial({ map: genDial.tex }));
  genDialMesh.position.set(2.4, F[1] + 1.05, -1.87);
  scene.add(genDialMesh);
  const genLampMat = M(0x300a08, 0.4, { emissive: 0xff2418, emissiveIntensity: 0.4 });
  const genLamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), genLampMat);
  genLamp.position.set(3.15, F[1] + 1.25, -1.88); scene.add(genLamp);
  const genBulbMat = M(0xfff0c8, 0.4, { emissive: 0xffd98a, emissiveIntensity: 1.4 });
  const genBulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), genBulbMat);
  genBulb.position.set(-1.5, F[1] + 2.6, 0); scene.add(genBulb);
  const genLight = new THREE.PointLight(0xc8b8a0, 4, 8, 1.6);
  genLight.position.set(-1.5, F[1] + 2.4, 0); scene.add(genLight);
  // fuel pipe + filter anchor
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8), metal);
  pipe.position.set(1.3, F[1] + 0.7, -2.6); pipe.rotation.z = Math.PI / 2.4; scene.add(pipe);
  const filterMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), M(0x8a3a30, 0.7, { emissive: 0x6a1010, emissiveIntensity: 0.8 }));
  filterMesh.position.set(1.15, F[1] + 0.55, -2.05);
  filterMesh.visible = false;
  scene.add(filterMesh);
  // shelf lvl2
  solid(3.55, -0.5, 0.8, 2.0, F[1] + 0.9, F[1] + 1.02, wd);

  // -------- level 3: рубка --------
  // receiver console
  solid(-1.6, -3.2, 2.6, 1.1, F[2], F[2] + 1.0, M(0x3a332a, 0.7, { metalness: 0.25 }));
  const receiverDisplay = makeCanvasTex(512, 224);
  const rdMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.74), new THREE.MeshBasicMaterial({ map: receiverDisplay.tex }));
  rdMesh.position.set(-1.7, F[2] + 0.68, -2.63);
  rdMesh.rotation.x = -0.18;
  scene.add(rdMesh);
  const receiverLampMat = M(0x0d1a0d, 0.3, { emissive: 0x54ff7a, emissiveIntensity: 0.25 });
  const recLamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), receiverLampMat);
  recLamp.position.set(-0.55, F[2] + 1.12, -3.0); scene.add(recLamp);
  for (const kx of [-2.35, -2.75]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 14), M(0x181818, 0.4, { metalness: 0.6 }));
    knob.rotation.x = Math.PI / 2;
    knob.position.set(kx, F[2] + 0.42, -2.62);
    scene.add(knob);
  }
  const recLight = new THREE.PointLight(0x54e07a, 3.4, 6, 1.8);
  recLight.position.set(-1.6, F[2] + 1.5, -2.6); scene.add(recLight);

  // telegraph key + tx sheet + lamp
  solid(1.6, -3.2, 1.8, 0.95, F[2], F[2] + 0.78, wd2);
  const keyBase = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.28), metal);
  keyBase.position.set(1.35, F[2] + 0.86, -3.1); scene.add(keyBase);
  const keyLever = new THREE.Group();
  keyLever.position.set(1.13, F[2] + 0.93, -3.1);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.045, 0.1), M(0x8a8f94, 0.4, { metalness: 0.7 }));
  lever.position.x = 0.24;
  keyLever.add(lever);
  const knobTop = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), M(0x202020, 0.4));
  knobTop.position.set(0.46, 0.03, 0); keyLever.add(knobTop);
  scene.add(keyLever);
  const txLampMat = M(0x141008, 0.3, { emissive: 0xffa020, emissiveIntensity: 0.3 });
  const txLamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), txLampMat);
  txLamp.position.set(2.1, F[2] + 1.0, -3.2); scene.add(txLamp);
  const sheet = makeCanvasTex(384, 256);
  const sheetMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42), new THREE.MeshBasicMaterial({ map: sheet.tex }));
  sheetMesh.position.set(1.85, F[2] + 0.8, -2.92);
  sheetMesh.rotation.x = -Math.PI / 2 + 0.02;
  sheetMesh.rotation.z = 0.12;
  scene.add(sheetMesh);

  // wall map (west wall)
  const mapTex = makeCanvasTex(512, 400);
  drawMap(mapTex.ctx, 512, 400, { coordsKnown: false, caveOpen: false, serversLooted: [false, false], dug: false });
  mapTex.tex.needsUpdate = true;
  const mapMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.7), new THREE.MeshBasicMaterial({ map: mapTex.tex }));
  mapMesh.position.set(-3.83, F[2] + 1.7, -0.4);
  mapMesh.rotation.y = Math.PI / 2;
  scene.add(mapMesh);

  // telescope at north window
  const tele = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 1.1, 10), M(0x6a5a30, 0.4, { metalness: 0.6 }));
  tele.position.set(1.6, F[2] + 1.5, -3.3);
  tele.rotation.x = Math.PI / 2 - 0.15;
  scene.add(tele);
  for (const [lx, lz] of [[1.35, -3.05], [1.85, -3.05], [1.6, -3.55]] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), metal);
    leg.position.set(lx, F[2] + 0.75, lz); scene.add(leg);
  }

  // -------- roof: мачта + маяк --------
  const mast = new THREE.Group();
  mast.position.set(0, F[3] + 0.26, -1.6);
  const mastPole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 7.4, 8), metal);
  mastPole.position.y = 3.7; mastPole.castShadow = true;
  mast.add(mastPole);
  for (const cy of [2.2, 4.2, 6.0]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2 - cy * 0.2, 0.07, 0.07), metal);
    bar.position.y = cy; mast.add(bar);
  }
  const mastTop = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), M(0x888888, 0.3, { metalness: 0.7 }));
  mastTop.position.y = 7.5; mast.add(mastTop);
  scene.add(mast);

  const beamGroup = new THREE.Group();
  beamGroup.position.set(2.6, F[3] + 1.35, 2.6);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.7, 1.5), M(0x2a2e33, 0.5, { metalness: 0.5 }));
  scene.add(housing);
  housing.position.copy(beamGroup.position);
  colliders.push({ minX: 1.7, maxX: 3.5, minZ: 1.7, maxZ: 3.5, minY: F[3], maxY: F[3] + 2.4 });
  const lensMat = M(0xfff6d8, 0.2, { emissive: 0xfff0b0, emissiveIntensity: 2.6 });
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 16), lensMat);
  lens.position.copy(beamGroup.position);
  scene.add(lens);
  const beamLight = new THREE.SpotLight(0xfff2c0, 2600, 260, 0.1, 0.45, 1.6);
  beamLight.position.set(0, 0, 0);
  beamGroup.add(beamLight);
  beamLight.target.position.set(0, -6, -90);
  beamGroup.add(beamLight.target);
  const beamCone = new THREE.Mesh(
    new THREE.ConeGeometry(9, 90, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff0b8, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  beamCone.rotation.x = Math.PI / 2;
  beamCone.position.z = -45;
  beamGroup.add(beamCone);
  scene.add(beamGroup);

  // ================= поляна =================
  // campfire
  const fireGlow = new THREE.Group();
  fireGlow.position.set(8, 0, 6);
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.3, 7), M(0x3a2a18, 1));
    log.rotation.z = Math.PI / 2; log.rotation.y = (i / 3) * Math.PI * 2;
    log.position.y = 0.14;
    fireGlow.add(log);
  }
  for (let i = 0; i < 9; i++) {
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), rockMat);
    const a = (i / 9) * Math.PI * 2;
    st.position.set(Math.cos(a) * 1.0, 0.1, Math.sin(a) * 1.0);
    fireGlow.add(st);
  }
  const flameMat = M(0x200a02, 0.3, { emissive: 0xff7a20, emissiveIntensity: 2.4 });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.0, 8), flameMat);
  flame.position.y = 0.6; flame.visible = false;
  fireGlow.add(flame);
  scene.add(fireGlow);
  const fireLight = new THREE.PointLight(0xff8432, 0, 16, 1.7);
  fireLight.position.set(8, 1.4, 6);
  scene.add(fireLight);
  colliders.push({ minX: 6.9, maxX: 9.1, minZ: 4.9, maxZ: 7.1, minY: 0, maxY: 0.5 });

  // woodpile
  solid(-9.5, 6.5, 0.3, 3.4, 0, 1.5, wd);
  solid(-7.3, 6.5, 0.3, 3.4, 0, 1.5, wd);
  const firewoodMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const fw = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.6, 8), M(0x5a4226, 1));
    fw.rotation.x = Math.PI / 2;
    fw.position.set(-8.4 + (i % 2) * 0.32, 0.3 + Math.floor(i / 2) * 0.34, 6.5);
    fw.castShadow = true;
    scene.add(fw); firewoodMeshes.push(fw);
  }
  colliders.push({ minX: -9.8, maxX: -7.0, minZ: 4.7, maxZ: 8.3, minY: 0, maxY: 1.5 });

  // well
  const wellWall = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 1.0, 14, 1, true), M(0x4c4a44, 0.95));
  wellWall.position.set(11, 0.5, 9); wellWall.castShadow = true;
  scene.add(wellWall);
  const wellTop = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.12, 8, 18), M(0x3a3834, 0.9));
  wellTop.rotation.x = Math.PI / 2; wellTop.position.set(11, 1.02, 9);
  scene.add(wellTop);
  const wellDark = new THREE.Mesh(new THREE.CircleGeometry(0.92, 14), new THREE.MeshBasicMaterial({ color: 0x020304 }));
  wellDark.rotation.x = -Math.PI / 2; wellDark.position.set(11, 0.62, 9);
  scene.add(wellDark);
  solid(10.15, 9, 0.14, 0.14, 0, 2.3, wd);
  solid(11.85, 9, 0.14, 0.14, 0, 2.3, wd);
  solid(11, 9, 2.3, 0.14, 2.3, 2.44, wd);
  colliders.push({ minX: 9.8, maxX: 12.2, minZ: 7.8, maxZ: 10.2, minY: 0, maxY: 2.4 });

  // ================= лес =================
  const treeTrunkMat = M(0x3a2c20, 1);
  const treeFoliageMat = M(0x1e3324, 1);
  const pts: { x: number; z: number; s: number }[] = [];
  let guard = 0;
  while (pts.length < 380 && guard++ < 9000) {
    const a = Math.random() * Math.PI * 2;
    const r = 19 + Math.random() * 128;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.92;
    if (z > 76) continue;
    if (Math.hypot(x - 0, z - 6) < 16) continue;
    let ok = true;
    for (const p of pts) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 14) { ok = false; break; }
    if (ok) pts.push({ x, z, s: 0.7 + Math.random() * 1.1 });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 3.0, 6);
  const fol1 = new THREE.ConeGeometry(1.6, 3.6, 7);
  const fol2 = new THREE.ConeGeometry(1.15, 2.8, 7);
  const trunks = new THREE.InstancedMesh(trunkGeo, treeTrunkMat, pts.length);
  const folA = new THREE.InstancedMesh(fol1, treeFoliageMat, pts.length);
  const folB = new THREE.InstancedMesh(fol2, treeFoliageMat, pts.length);
  const dummy = new THREE.Object3D();
  pts.forEach((p, i) => {
    dummy.position.set(p.x, 1.5 * p.s, p.z); dummy.scale.setScalar(p.s); dummy.rotation.y = Math.random() * 3;
    dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 3.6 * p.s; dummy.updateMatrix(); folA.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 5.6 * p.s; dummy.updateMatrix(); folB.setMatrixAt(i, dummy.matrix);
  });
  trunks.castShadow = true; folA.castShadow = true;
  trunks.frustumCulled = false; folA.frustumCulled = false; folB.frustumCulled = false;
  scene.add(trunks, folA, folB);
  const nearTrees = pts.filter((p) => Math.hypot(p.x, p.z) < 55);

  // spiral anomalies
  const spiralMat = M(0x14231a, 1);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.5;
    const r = 40 + i * 14;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r * 0.85);
    for (let s = 0; s < 6; s++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.2 - s * 0.16, 1.4, 6), spiralMat);
      cone.position.y = 1 + s * 1.15;
      cone.rotation.y = s * 0.7;
      cone.position.x = Math.sin(s * 0.9) * 0.35;
      g.add(cone);
    }
    scene.add(g);
  }

  // runes near bunkers
  const runeMats: THREE.MeshStandardMaterial[] = [];
  const runeGlyphs = ["ᛉᚦ", "ᛟᚱ", "ᛞᚹ"];
  const runePos: [number, number][] = [[-88, -6], [78, -40], [20, 40]];
  runePos.forEach(([rx, rz], i) => {
    const ct = makeCanvasTex(128, 160);
    ct.ctx.fillStyle = "rgba(0,0,0,0)";
    ct.ctx.clearRect(0, 0, 128, 160);
    ct.ctx.font = "64px serif";
    ct.ctx.fillStyle = "#b8ffb0";
    ct.ctx.fillText(runeGlyphs[i], 18, 90);
    ct.tex.needsUpdate = true;
    const rm = new THREE.MeshStandardMaterial({ map: ct.tex, transparent: true, emissive: 0x6aff7a, emissiveMap: ct.tex, emissiveIntensity: 0.25, roughness: 1 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), rm);
    plane.position.set(rx, 1.8, rz);
    plane.rotation.y = Math.atan2(-rx, -rz);
    scene.add(plane);
    runeMats.push(rm);
  });

  // grass tufts + stones
  const tuftGeo = new THREE.ConeGeometry(0.09, 0.42, 4);
  const tuftMat = M(0x2c3a22, 1);
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 340);
  for (let i = 0; i < 340; i++) {
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 90;
    dummy.position.set(Math.cos(a) * r, 0.2, Math.sin(a) * r * 0.9);
    if (dummy.position.z > 82) { dummy.position.z = 60; }
    dummy.scale.setScalar(0.7 + Math.random());
    dummy.rotation.y = Math.random() * 3;
    dummy.updateMatrix(); tufts.setMatrixAt(i, dummy.matrix);
  }
  scene.add(tufts);
  const stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.3, 0), rockMat, 70);
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 120;
    dummy.position.set(Math.cos(a) * r, 0.12, Math.sin(a) * r * 0.9);
    if (dummy.position.z > 82) dummy.position.z = 50;
    dummy.scale.setScalar(0.5 + Math.random() * 1.4);
    dummy.rotation.set(Math.random(), Math.random() * 3, Math.random());
    dummy.updateMatrix(); stones.setMatrixAt(i, dummy.matrix);
  }
  tufts.frustumCulled = false; stones.frustumCulled = false;
  scene.add(stones);

  // ================= серверы-бункеры =================
  const bunkerMat = M(0x4c5048, 0.9);
  const bunkers: BunkerRef[] = [];
  for (const [bx, bz] of [[-95, -10], [85, -45]] as const) {
    const b = solid(bx, bz, 3.4, 3.0, 0, 2.5, bunkerMat);
    b.castShadow = true;
    const moss = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.1), M(0x2c4228, 1));
    moss.position.set(bx, 0.6, bz + 1.52); scene.add(moss);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.9), M(0x2c2e30, 0.6, { metalness: 0.5 }));
    door.position.set(bx, 0.98, bz + 1.53); scene.add(door);
    const lampMat = M(0x200808, 0.3, { emissive: 0xff2018, emissiveIntensity: 1.6 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), lampMat);
    lamp.position.set(bx + 1.1, 2.2, bz + 1.55); scene.add(lamp);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), metal);
    ant.position.set(bx - 1.2, 3.6, bz - 0.8); scene.add(ant);
    const bl = new THREE.PointLight(0xff2418, 3, 9, 2);
    bl.position.set(bx + 1.1, 2.3, bz + 2.2); scene.add(bl);
    bunkers.push({ lampMat });
  }

  // ================= раскоп + люк + пещера =================
  const digGlowMat = M(0x1c140c, 1, { emissive: 0x8a6a20, emissiveIntensity: 0 });
  const digMesh = new THREE.Mesh(new THREE.CircleGeometry(1.7, 18), digGlowMat);
  digMesh.rotation.x = -Math.PI / 2;
  digMesh.position.set(-34, 0.03, 78);
  scene.add(digMesh);
  const holeMesh = new THREE.Mesh(new THREE.CircleGeometry(1.0, 14), new THREE.MeshBasicMaterial({ color: 0x050302 }));
  holeMesh.rotation.x = -Math.PI / 2;
  holeMesh.position.set(-34, 0.045, 78);
  holeMesh.visible = false;
  scene.add(holeMesh);

  const hatchMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.16, 16), M(0x4a4038, 0.55, { metalness: 0.6 }));
  hatchMesh.rotation.x = Math.PI / 2;
  hatchMesh.position.set(40, 0.9, 87.7);
  scene.add(hatchMesh);
  const hatchFrame = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.09, 8, 20), M(0x3a322a, 0.6, { metalness: 0.5 }));
  hatchFrame.position.set(40, 0.9, 87.62);
  scene.add(hatchFrame);

  const caveLight = new THREE.PointLight(0x8ab8a0, 0, 12, 1.8);
  caveLight.position.set(40, 2.2, 99);
  scene.add(caveLight);
  const crystalMat = M(0x1a3a28, 0.25, { emissive: 0x4affb0, emissiveIntensity: 0.4, metalness: 0.2 });
  const crystalMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), crystalMat);
  crystalMesh.position.set(40, 0.9, 104.4);
  scene.add(crystalMesh);
  const crystalLight = new THREE.PointLight(0x4affb0, 0, 8, 1.8);
  crystalLight.position.set(40, 1.6, 104);
  scene.add(crystalLight);
  // skeleton of the previous keeper
  const skullGroup = new THREE.Group();
  skullGroup.position.set(42.2, 0, 103);
  const boneMat = M(0xb8ac90, 1);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 10), boneMat);
  skull.position.y = 0.2; skullGroup.add(skull);
  const radioInSkull = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.1), metal);
  radioInSkull.position.set(0, 0.3, 0.06); skullGroup.add(radioInSkull);
  for (let i = 0; i < 4; i++) {
    const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 6), boneMat);
    bone.position.set(0.25 + Math.random() * 0.5, 0.05, Math.random() * 0.6 - 0.3);
    bone.rotation.z = Math.PI / 2 + Math.random() * 0.5;
    skullGroup.add(bone);
  }
  scene.add(skullGroup);

  colliders.push(...collidersOff);

  return {
    colliders, sun, hemi, sea, seaBase,
    beamGroup, beamLight, lensMat, mast, mastTop,
    stoveLight, stoveGlowMat, fireLight, fireGlow,
    edisonLight, genBulbMat,
    receiverDisplay, receiverLampMat,
    sheet, genDial, genLampMat, keyLever, txLampMat, mapTex,
    canisters, shovelMesh, flashlightMesh, partsMesh, batteryMeshes, firewoodMeshes,
    bunkers, treeFoliageMat, runeMats, digGlowMat, holeMesh, hatchMesh, caveLight,
    crystalMat, crystalLight, crystalMesh, filterMesh,
    ladder: { x: ladderX, z: ladderZ }, floors: F, nearTrees, skullGroup,
  };
}

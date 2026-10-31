/* Робот · Небо — local 3D dance page.
   Engine: FK upper body + two-bone IK legs (feet planted on the floor),
   every pose parameter passes through a critically damped spring, so motion is continuous.
   Choreography is written on the song's beat grid (145 BPM, first beat at 0.39 s). */
(function () {
  'use strict';
  const T = THREE, V3 = T.Vector3, Q = T.Quaternion;
  const D2R = Math.PI / 180;
  const BPM = 145, BEAT = 60 / BPM, OFFSET = 0.39, LOOKAHEAD = 0.045;
  const toBeat = t => (t - OFFSET) / BEAT;

  // ============================================================ renderer
  const stage = document.getElementById('stage');
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  const scene = new T.Scene();
  scene.background = new T.Color(0xf4f4f1);
  const camera = new T.PerspectiveCamera(34, 1, 0.05, 80);

  // studio environment for the chrome: white sky, grey floor, a few black flags for crisp edges
  (function buildEnv() {
    const s = new T.Scene();
    const g = new T.SphereGeometry(10, 48, 24);
    const pos = g.attributes.position, col = [];
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 10;
      // bright sky, a crisp horizon, a dark floor: gives the chrome its contrast on a white page
      const c = y > 0.04 ? 0.82 + 0.18 * Math.pow(y, 0.5) : y > -0.04 ? 0.55 : 0.16 + 0.1 * (1 + y);
      col.push(c, c, c * 1.01);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    s.add(new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
    const panel = (w, h, c, p) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }));
      m.position.set(p[0], p[1], p[2]); m.lookAt(0, 1, 0); s.add(m);
    };
    panel(7, 3, 0xffffff, [0, 7, 4]);
    panel(2.2, 7, 0xffffff, [-6.5, 3, 2]);
    panel(2.2, 7, 0xffffff, [6.5, 3, -2]);
    panel(1.4, 9, 0x0c0c0e, [4.2, 2.5, 5.5]);
    panel(1.4, 9, 0x0c0c0e, [-5.5, 2.5, -4]);
    panel(0.9, 7, 0x1a1a1e, [-3.2, 2, 6.5]);
    panel(0.9, 8, 0x0c0c0e, [6.5, 2.5, -1]);
    panel(0.9, 8, 0x0c0c0e, [-6.8, 2.5, 1.5]);
    panel(0.5, 6, 0x9a1418, [6.8, 1.5, 3]);
    const pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(s, 0.02).texture;
    pm.dispose();
  })();

  scene.add(new T.HemisphereLight(0xffffff, 0xdcdcd6, 0.5));
  const key = new T.DirectionalLight(0xffffff, 1.25);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 0.5, far: 20 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  // infinite white floor: only the shadows are drawn
  const floor = new T.Mesh(new T.PlaneGeometry(80, 80), new T.ShadowMaterial({ opacity: 0.17 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  // soft contact blob under the robot
  const blobTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return new T.CanvasTexture(c);
  })();
  const blob = new T.Mesh(new T.PlaneGeometry(1.3, 1.3), new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.3 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.002; scene.add(blob);

  // ============================================================ robot
  const M = {
    metal: new T.MeshStandardMaterial({ color: 0xe4e6ea, metalness: 1.0, roughness: 0.12 }),
    dark: new T.MeshStandardMaterial({ color: 0x141418, metalness: 0.35, roughness: 0.32 }),
    visor: new T.MeshStandardMaterial({ color: 0x050507, metalness: 0.6, roughness: 0.05 }),
    red: new T.MeshStandardMaterial({ color: 0xc8101a, metalness: 0.0, roughness: 0.4, emissive: 0x3a0003, emissiveIntensity: 0.6 }),
  };
  // Blender coordinates (x, y, z; Z up, front = -Y) -> three (x, z, -y). Robot faces +Z.
  const B = (x, y, z) => new V3(x, z, -y);
  const PIV = { hips: B(0, 0, 1.14), spine: B(0, 0, 1.24), chest: B(0, 0, 1.46), neck: B(0, 0, 1.72), head: B(0, 0, 1.84) };
  const shP = s => B(0.24 * s, 0, 1.72), elP = s => B(0.40 * s, 0, 1.38), wrP = s => B(0.54 * s, 0, 1.04), heP = s => B(0.62 * s, 0, 0.84);
  const hipP = s => B(0.125 * s, 0, 1.12), kneeP = s => B(0.115 * s, 0, 0.62), ankP = s => B(0.14 * s, 0, 0.09);
  const UP = new V3(0, 1, 0);

  const robot = new T.Group(); robot.userData.pivot = new V3(); scene.add(robot);
  const J = {};
  const contacts = [];
  function joint(name, parent, pivot) {
    const g = new T.Group(); g.userData.pivot = pivot.clone();
    g.position.copy(pivot).sub(parent.userData.pivot); parent.add(g); J[name] = g; return g;
  }
  function put(g, mesh, wp) { mesh.position.copy(wp).sub(g.userData.pivot); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; }
  function contact(g, wp, r) { contacts.push({ g, p: wp.clone().sub(g.userData.pivot), r }); }
  function seg(g, p1, p2, r1, r2, mat, sz) {
    const d = new V3().subVectors(p2, p1);
    const m = new T.Mesh(new T.CylinderGeometry(r2, r1, d.length(), 48, 1), mat);
    m.quaternion.setFromUnitVectors(UP, d.clone().normalize());
    if (sz) m.scale.z = sz;
    return put(g, m, new V3().addVectors(p1, p2).multiplyScalar(0.5));
  }
  function ball(g, p, r, mat, sc) {
    const m = new T.Mesh(new T.SphereGeometry(r, 48, 24), mat);
    if (sc) m.scale.set(sc[0], sc[2], sc[1]);
    return put(g, m, p);
  }
  function ring(g, p, r, w, mat, dir) {
    const m = new T.Mesh(new T.CylinderGeometry(r, r, w, 48), mat);
    if (dir) m.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    return put(g, m, p);
  }
  function roundedBox(w, h, d, r) {
    const bw = w - 2 * r, bh = h - 2 * r, c = Math.min(r, bw / 2, bh / 2) * 0.6;
    const sh = new T.Shape(), x = -bw / 2, y = -bh / 2;
    sh.moveTo(x + c, y); sh.lineTo(x + bw - c, y); sh.quadraticCurveTo(x + bw, y, x + bw, y + c);
    sh.lineTo(x + bw, y + bh - c); sh.quadraticCurveTo(x + bw, y + bh, x + bw - c, y + bh);
    sh.lineTo(x + c, y + bh); sh.quadraticCurveTo(x, y + bh, x, y + bh - c);
    sh.lineTo(x, y + c); sh.quadraticCurveTo(x, y, x + c, y);
    const geo = new T.ExtrudeGeometry(sh, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 4, curveSegments: 6 });
    geo.center(); return geo;
  }
  function box(g, p, sx, sy, sz, mat) { // blender sizes
    return put(g, new T.Mesh(roundedBox(sx, sz, sy, Math.min(sx, sy, sz) * 0.28), mat), p);
  }

  const root = joint('hips', robot, PIV.hips);
  ball(root, PIV.hips, 0.13, M.dark, [1.35, 0.75, 0.62]);
  contact(root, B(0, 0.06, 1.14), 0.05); contact(root, B(0.12, 0, 1.12), 0.06); contact(root, B(-0.12, 0, 1.12), 0.06);
  const spine = joint('spine', root, PIV.spine);
  seg(spine, B(0, 0, 1.15), B(0, 0, 1.25), 0.095, 0.11, M.dark, 0.75);
  const chest = joint('chest', spine, PIV.chest);
  seg(chest, B(0, 0, 1.24), B(0, 0, 1.72), 0.125, 0.25, M.metal, 0.6);
  ring(chest, B(0, 0, 1.715), 0.25, 0.014, M.dark).scale.z = 0.6;
  box(chest, B(0, -0.148, 1.50), 0.026, 0.006, 0.36, M.red);
  contact(chest, B(0, 0.13, 1.62), 0.02); contact(chest, B(0, 0.10, 1.40), 0.02); contact(chest, B(0, -0.13, 1.62), 0.02);
  contact(chest, B(0.2, 0, 1.70), 0.03); contact(chest, B(-0.2, 0, 1.70), 0.03);
  const neck = joint('neck', chest, PIV.neck);
  seg(neck, B(0, 0, 1.71), B(0, 0, 1.84), 0.055, 0.046, M.dark);
  ring(neck, B(0, 0, 1.84), 0.056, 0.01, M.red);
  const head = joint('head', neck, PIV.head);
  ball(head, B(0, 0, 2.00), 0.115, M.visor, [0.95, 1.0, 1.45]);
  ball(head, B(0, 0.035, 1.99), 0.113, M.metal, [0.92, 0.9, 1.38]);
  contact(head, B(0, 0, 2.00), 0.16); contact(head, B(0, 0.04, 1.93), 0.1);

  const LEG = {}, ARM = {};
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    const sh = shP(s), el = elP(s), wr = wrP(s), he = heP(s);
    const ua = joint('ua' + S, chest, sh);
    ball(ua, sh, 0.075, M.dark);
    ball(ua, sh.clone().add(B(s * 0.02, 0, 0.03)), 0.095, M.metal, [0.95, 0.85, 0.72]);
    seg(ua, sh, el, 0.064, 0.05, M.metal);
    const fa = joint('fa' + S, ua, el);
    ball(fa, el, 0.055, M.dark); contact(fa, el, 0.055);
    seg(fa, el, wr, 0.05, 0.036, M.metal);
    const dh = new V3().subVectors(he, wr).normalize();
    ring(fa, wr.clone().addScaledVector(dh, -0.035), 0.038, 0.009, M.red, dh);
    const ha = joint('ha' + S, fa, wr);
    ball(ha, wr, 0.038, M.dark);
    const base = wr.clone().lerp(he, 0.55);
    seg(ha, wr, base, 0.035, 0.04, M.metal, 0.45);
    for (const off of [-0.03, -0.01, 0.01, 0.03]) {
      const o = B(0, off, 0);
      seg(ha, base.clone().add(o), base.clone().addScaledVector(dh, 0.10).add(o), 0.008, 0.006, M.dark);
    }
    const ts = wr.clone().lerp(he, 0.3).add(B(0, -0.038, 0));
    seg(ha, ts, ts.clone().addScaledVector(dh, 0.065).add(B(0, -0.02, 0)), 0.0085, 0.006, M.dark);
    contact(ha, base.clone().addScaledVector(dh, 0.1), 0.02);
    const ang = (a, b) => Math.atan2(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ARM[S] = {
      s, shY: ua.position.y,
      invU: new Q().setFromAxisAngle(new V3(0, 0, 1), s * ang(sh, el)).invert(),
      invF: new Q().setFromAxisAngle(new V3(0, 0, 1), s * ang(el, wr)).invert(),
      invH: new Q().setFromAxisAngle(new V3(0, 0, 1), s * ang(wr, he)).invert(),
    };

    const hip = hipP(s), knee = kneeP(s), ank = ankP(s);
    const th = joint('th' + S, root, hip);
    const dT = new V3().subVectors(knee, hip).normalize();
    ball(th, hip, 0.082, M.dark);
    seg(th, hip.clone().addScaledVector(dT, 0.02), knee.clone().addScaledVector(dT, -0.05), 0.105, 0.078, M.metal, 1.12);
    const sn = joint('sn' + S, th, knee);
    const dS = new V3().subVectors(ank, knee).normalize();
    ball(sn, knee, 0.07, M.dark);
    ball(sn, knee.clone().add(B(0, -0.045, 0.01)), 0.055, M.metal, [0.9, 0.6, 1.1]);
    contact(sn, knee.clone().add(B(0, -0.06, 0)), 0.05);
    seg(sn, knee.clone().addScaledVector(dS, 0.05), ank.clone().addScaledVector(dS, -0.02), 0.078, 0.048, M.metal, 1.1);
    ring(sn, ank.clone().add(B(0, 0, 0.05)), 0.052, 0.009, M.red, dS);
    const ft = joint('ft' + S, sn, ank);
    ball(ft, ank, 0.045, M.dark);
    box(ft, ank.clone().add(B(0, -0.07, -0.055)), 0.11, 0.32, 0.065, M.metal);
    // sole corners (three coords relative to ankle): toe tip at z +0.21, heel at z -0.07
    for (const cx of [-0.05, 0.05]) for (const cz of [-0.07, 0.21]) contact(ft, ank.clone().add(new V3(cx, -0.0875, cz)), 0);
    const r1 = new V3().subVectors(knee, hip), r2 = new V3().subVectors(ank, knee);
    const uR = r1.clone().add(r2).normalize();
    LEG[S] = {
      s, th, sn, ft, L1: r1.length(), L2: r2.length(),
      d1: r1.clone().normalize(), d2: r2.clone().normalize(),
      nR: new V3().crossVectors(uR, new V3(0, 0, 1)).normalize(),
      hipLocal: hip.clone().sub(PIV.hips),
    };
  }
  const BALL = new V3(0, -0.0875, 0.21); // ankle -> toe-tip contact point, foot frame
  const Z0 = 0.21; // neutral toe-tip z when the ankle is under the hip

  // ============================================================ pose model
  // Authoring parameters (degrees / meters). Feet = toe-tip position in the dance frame.
  const DEF = {
    face: 0, ox: 0, oz: 0,
    x: 0, z: 0, h: 1.12, yaw: 0, pitch: 0, roll: 0,
    spX: 0, spY: 0, spZ: 0, chX: 0, chY: 0, chZ: 0, nkX: 0, hdX: 0, hdY: 0, hdZ: 0,
    Lel: 25, Laz: 0, Lro: 0, Lbe: 6, Lfl: 0, Ltw: 0, Lsh: 0,
    Rel: 25, Raz: 0, Rro: 0, Rbe: 6, Rfl: 0, Rtw: 0, Rsh: 0,
    fLx: 0.14, fLz: Z0, fLy: 0, fLh: 0, fLw: 0, fLk: 0.15,
    fRx: -0.14, fRz: Z0, fRy: 0, fRh: 0, fRw: 0, fRk: 0.15,
    fk: 0, LlP: 0, LlA: 0, LlK: 0, LlF: 0, RlP: 0, RlA: 0, RlK: 0, RlF: 0,
    floor: 0, anchor: 0,
  };
  const BODY_KEYS = ['h', 'pitch', 'roll', 'spX', 'spY', 'spZ', 'chX', 'chY', 'chZ', 'nkX', 'hdX', 'hdY', 'hdZ',
    'Lel', 'Laz', 'Lro', 'Lbe', 'Lfl', 'Ltw', 'Lsh', 'Rel', 'Raz', 'Rro', 'Rbe', 'Rfl', 'Rtw', 'Rsh',
    'fk', 'LlP', 'LlA', 'LlK', 'LlF', 'RlP', 'RlA', 'RlK', 'RlF', 'floor', 'anchor'];
  // world-space pose (what gets smoothed)
  const W_KEYS = BODY_KEYS.concat(['rx', 'rz', 'ryaw', 'ax', 'az', 'Lx', 'Lz', 'Ly', 'Lh', 'Lw', 'Lk', 'Rx', 'Rz', 'Ry', 'Rh', 'Rw', 'Rk']);
  const UNWRAP = { ryaw: 1, Lw: 1, Rw: 1 };
  const OMEGA = {};
  for (const k of W_KEYS) OMEGA[k] = /^[LR](el|az|ro|be|fl|tw)$/.test(k) ? 22 : 28;
  for (const k of ['Lx', 'Lz', 'Ly', 'Lh', 'Lw', 'Rx', 'Rz', 'Ry', 'Rh', 'Rw']) OMEGA[k] = 42;
  OMEGA.ryaw = 26; OMEGA.fk = 14; OMEGA.floor = 14; OMEGA.anchor = 14; OMEGA.h = 32;

  function resolve(p, w) {
    const fr = p.face * D2R, c = Math.cos(fr), s = Math.sin(fr);
    for (const k of BODY_KEYS) w[k] = p[k];
    w.rx = p.ox + p.x * c + p.z * s; w.rz = p.oz - p.x * s + p.z * c;
    w.ax = w.rx; w.az = w.rz;
    w.ryaw = p.face + p.yaw;
    w.Lx = p.ox + p.fLx * c + p.fLz * s; w.Lz = p.oz - p.fLx * s + p.fLz * c;
    w.Rx = p.ox + p.fRx * c + p.fRz * s; w.Rz = p.oz - p.fRx * s + p.fRz * c;
    w.Ly = p.fLy; w.Ry = p.fRy; w.Lk = p.fLk; w.Rk = p.fRk;
    // a planted foot may only lift its heel (toes-up would push the heel through the floor)
    w.Lh = p.fLy < 0.01 ? Math.max(0, p.fLh) : p.fLh; w.Rh = p.fRy < 0.01 ? Math.max(0, p.fRh) : p.fRh;
    w.Lw = p.face + p.fLw; w.Rw = p.face - p.fRw;
    return w;
  }

  // critically damped springs, exact solution (stable for any dt)
  const SX = {}, SV = {};
  let springInit = false;
  function springStep(tg, dt, snap) {
    for (const k of W_KEYS) {
      let target = tg[k];
      if (!springInit || snap) { SX[k] = target; SV[k] = 0; continue; }
      const x = SX[k];
      if (UNWRAP[k]) target += 360 * Math.round((x - target) / 360);
      const w = OMEGA[k], y = x - target, e = Math.exp(-w * dt), j = SV[k] + w * y;
      SX[k] = target + (y + j * dt) * e;
      SV[k] = (SV[k] - w * j * dt) * e;
    }
    springInit = true;
  }

  // ---------------------------------------------------------------- apply pose
  const _q1 = new Q(), _q2 = new Q(), _q3 = new Q(), _qa = new Q(), _qb = new Q();
  const _qU = new Q(), _qF = new Q(), _qH = new Q(), _qWU = new Q(), _qWF = new Q(), _qWH = new Q();
  const AX = new V3(1, 0, 0), AY = new V3(0, 1, 0), AZ = new V3(0, 0, 1);
  const _e = new T.Euler();
  function setEuler(g, x, y, z) { g.rotation.set(x * D2R, y * D2R, z * D2R, 'YXZ'); }

  function solveArm(S, el, az, ro, be, fl, tw, shr) {
    const a = ARM[S], s = a.s;
    _qU.setFromAxisAngle(AY, -s * az * D2R);
    _qa.setFromAxisAngle(AZ, s * el * D2R); _qU.multiply(_qa);
    _qa.setFromAxisAngle(AY, s * ro * D2R); _qU.multiply(_qa);
    _qF.copy(_qU); _qa.setFromAxisAngle(AX, -be * D2R); _qF.multiply(_qa);
    _qH.copy(_qF); _qa.setFromAxisAngle(AX, -fl * D2R); _qH.multiply(_qa);
    _qa.setFromAxisAngle(AY, s * tw * D2R); _qH.multiply(_qa);
    _qWU.copy(_qU).multiply(a.invU); _qWF.copy(_qF).multiply(a.invF); _qWH.copy(_qH).multiply(a.invH);
    J['ua' + S].quaternion.copy(_qWU);
    J['fa' + S].quaternion.copy(_qb.copy(_qWU).invert().multiply(_qWF));
    J['ha' + S].quaternion.copy(_qb.copy(_qWF).invert().multiply(_qWH));
    J['ua' + S].position.y = a.shY + shr;
  }

  const _m1 = new T.Matrix4(), _m2 = new T.Matrix4();
  const _x = new V3(), _y = new V3(), _z = new V3();
  function basis(m, a, b) {
    _x.copy(a).normalize();
    _y.copy(b).addScaledVector(_x, -b.dot(_x)).normalize();
    _z.crossVectors(_x, _y);
    m.makeBasis(_x, _y, _z);
  }
  function mapQuat(out, a1, b1, a2, b2) { // rotation taking frame (a1,b1) to frame (a2,b2)
    basis(_m1, a1, b1); basis(_m2, a2, b2);
    _m2.multiply(_m1.transpose());
    return out.setFromRotationMatrix(_m2);
  }

  const legIK = { L: { th: new Q(), sn: new Q(), ft: new Q() }, R: { th: new Q(), sn: new Q(), ft: new Q() } };
  const _H = new V3(), _A = new V3(), _u = new V3(), _P = new V3(), _K = new V3(), _t1 = new V3(), _t2 = new V3(), _n = new V3(), _tmp = new V3();
  const _hipsQ = new Q(), _qt = new Q(), _qs = new Q(), _qf = new Q();
  const ankT = { L: new V3(), R: new V3() }, footQ = { L: new Q(), R: new Q() };

  function hipWorld(S, out) { return out.copy(LEG[S].hipLocal).applyMatrix4(root.matrixWorld); }

  function solveLeg(S, kneeOut) {
    const L = LEG[S];
    hipWorld(S, _H);
    root.getWorldQuaternion(_hipsQ);
    _u.subVectors(ankT[S], _H);
    let d = _u.length(); _u.divideScalar(d || 1);
    d = Math.min(Math.max(d, 0.25), (L.L1 + L.L2) * 0.9995);
    _P.set(L.s * kneeOut, 0, 1).applyQuaternion(_hipsQ);
    _P.addScaledVector(_u, -_P.dot(_u));
    if (_P.lengthSq() < 1e-6) _P.set(0, 0, 1);
    _P.normalize();
    const a = (L.L1 * L.L1 - L.L2 * L.L2 + d * d) / (2 * d);
    const hh = Math.sqrt(Math.max(0, L.L1 * L.L1 - a * a));
    _K.copy(_H).addScaledVector(_u, a).addScaledVector(_P, hh);
    _t1.subVectors(_K, _H);
    _t2.copy(_H).addScaledVector(_u, d).sub(_K);
    _n.crossVectors(_u, _P).normalize();
    mapQuat(_qt, L.d1, L.nR, _t1, _n);
    mapQuat(_qs, L.d2, L.nR, _t2, _n);
    const o = legIK[S];
    o.th.copy(_hipsQ).invert().multiply(_qt);
    o.sn.copy(_qt).invert().multiply(_qs);
    o.ft.copy(_qs).invert().multiply(footQ[S]);
  }

  const _cw = new V3(), _chestW = new V3();
  function minContactY() {
    let m = Infinity;
    for (const c of contacts) {
      _cw.copy(c.p).applyMatrix4(c.g.matrixWorld);
      const y = _cw.y - c.r; if (y < m) m = y;
    }
    return m;
  }
  const footState = { L: 0, R: 0 }; // lowest sole point per foot (for checks)

  function applyPose(w) {
    root.position.set(w.rx, w.h, w.rz);
    setEuler(root, w.pitch, w.ryaw, w.roll);
    setEuler(J.spine, w.spX, w.spY, w.spZ);
    setEuler(J.chest, w.chX, w.chY, w.chZ);
    setEuler(J.neck, w.nkX, 0, 0);
    setEuler(J.head, w.hdX, w.hdY, w.hdZ);
    solveArm('L', w.Lel, w.Laz, w.Lro, w.Lbe, w.Lfl, w.Ltw, w.Lsh);
    solveArm('R', w.Rel, w.Raz, w.Rro, w.Rbe, w.Rfl, w.Rtw, w.Rsh);
    robot.updateMatrixWorld(true);

    const ik = 1 - Math.min(1, Math.max(0, w.fk));
    if (ik > 0.001) {
      // foot targets: toe tip on (x, y, z), heel raised by h degrees around the toe tip
      for (const S of ['L', 'R']) {
        _e.set(w[S + 'h'] * D2R, w[S + 'w'] * D2R, 0, 'YXZ');
        footQ[S].setFromEuler(_e);
        ankT[S].copy(BALL).applyQuaternion(footQ[S]).negate().add(_tmp.set(w[S + 'x'], w[S + 'y'], w[S + 'z']));
      }
      // lower the pelvis if a planted foot is out of reach (this is what keeps the feet on the floor)
      let drop = 0;
      for (const S of ['L', 'R']) {
        const L = LEG[S], maxL = (L.L1 + L.L2) * 0.985;
        hipWorld(S, _H);
        _u.subVectors(ankT[S], _H);
        const dist = _u.length();
        if (dist > maxL) {
          const hz = Math.hypot(_u.x, _u.z);
          const need = hz < maxL ? ankT[S].y + Math.sqrt(maxL * maxL - hz * hz) : ankT[S].y;
          drop = Math.max(drop, _H.y - need);
        }
      }
      root.position.y -= Math.min(drop, 0.6) * ik;
      root.updateMatrixWorld(true);
      solveLeg('L', w.Lk); solveLeg('R', w.Rk);
    }
    for (const S of ['L', 'R']) {
      const s = S === 'L' ? 1 : -1, L = LEG[S];
      _q1.setFromAxisAngle(AZ, s * w[S + 'lA'] * D2R).multiply(_qa.setFromAxisAngle(AX, -w[S + 'lP'] * D2R));
      _q2.setFromAxisAngle(AX, w[S + 'lK'] * D2R);
      _q3.setFromAxisAngle(AX, w[S + 'lF'] * D2R);
      if (ik > 0.001) {
        L.th.quaternion.copy(legIK[S].th).slerp(_q1, 1 - ik);
        L.sn.quaternion.copy(legIK[S].sn).slerp(_q2, 1 - ik);
        L.ft.quaternion.copy(legIK[S].ft).slerp(_q3, 1 - ik);
      } else {
        L.th.quaternion.copy(_q1); L.sn.quaternion.copy(_q2); L.ft.quaternion.copy(_q3);
      }
    }
    robot.updateMatrixWorld(true);
    // keep the chest above a fixed spot during floor spins
    if (w.anchor > 0.001) {
      J.chest.getWorldPosition(_chestW);
      root.position.x += (w.ax - _chestW.x) * w.anchor;
      root.position.z += (w.az - _chestW.z) * w.anchor;
    }
    // floor contact: snap down for floor work, never sink below the floor
    robot.updateMatrixWorld(true);
    const minY = minContactY();
    let dy = w.floor > 0.001 ? -minY * Math.min(1, w.floor) : 0;
    if (minY + dy < 0) dy = -minY;
    root.position.y += dy;
    robot.updateMatrixWorld(true);
    return minY + dy;
  }

  // ============================================================ choreography helpers
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sm = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const smr = x => { x = clamp(x, 0, 1); return x * x * x * (x * (6 * x - 15) + 10); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const fract = x => x - Math.floor(x);
  const mod = (a, n) => ((a % n) + n) % n;
  const TAU = Math.PI * 2;
  const bounce = (lb, amp, ph = 0) => -amp * (0.5 + 0.5 * Math.cos(TAU * (lb - ph))); // lowest on the beat
  const pop = (lb, dur = 0.3) => { const f = fract(lb); return f < dur ? Math.sin(Math.PI * f / dur) : 0; };
  const set = (p, o) => { for (const k in o) p[k] = o[k]; return p; };
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  function mirror(o) {
    const r = {};
    for (const k in o) {
      let nk = k, v = o[k];
      if (/^L[a-z]/.test(k)) nk = 'R' + k.slice(1); else if (/^R[a-z]/.test(k)) nk = 'L' + k.slice(1);
      else if (k === 'fLx') { nk = 'fRx'; v = -v; } else if (k === 'fRx') { nk = 'fLx'; v = -v; }
      else if (/^f[LR]/.test(k)) nk = 'f' + (k[1] === 'L' ? 'R' : 'L') + k.slice(2);
      if (['hdY', 'hdZ', 'chY', 'chZ', 'spY', 'spZ', 'roll', 'yaw', 'x'].includes(k)) v = -v;
      r[nk] = v;
    }
    return r;
  }
  // staccato: pose changes centred on each count, w = width of the snap in counts
  function hits(p, lb, cl, keys, w = 0.3, loop = true) {
    const c = lb / cl + w / 2, i = Math.floor(c), f = c - i, n = keys.length;
    const ia = loop ? mod(i - 1, n) : clamp(i - 1, 0, n - 1), ib = loop ? mod(i, n) : clamp(i, 0, n - 1);
    const A = keys[ia], Bk = keys[ib], g = smr(f / w);
    const names = new Set(Object.keys(A).concat(Object.keys(Bk)));
    for (const k of names) { const base = p[k]; p[k] = lerp(k in A ? A[k] : base, k in Bk ? Bk[k] : base, g); }
  }
  // fluid: Catmull-Rom through keys placed on each count
  function flow(p, lb, cl, keys, loop = true) {
    const c = lb / cl, i = Math.floor(c), f = c - i, n = keys.length;
    const ix = j => (loop ? mod(j, n) : clamp(j, 0, n - 1));
    const k0 = keys[ix(i - 1)], k1 = keys[ix(i)], k2 = keys[ix(i + 1)], k3 = keys[ix(i + 2)];
    const names = new Set(Object.keys(k1).concat(Object.keys(k2)));
    for (const k of names) {
      const base = p[k];
      const v1 = k in k1 ? k1[k] : base, v2 = k in k2 ? k2[k] : base;
      const v0 = k in k0 ? k0[k] : v1, v3 = k in k3 ? k3[k] : v2;
      p[k] = cr(v0, v1, v2, v3, f);
    }
  }
  // keyframe track (non-looping): frames = [[beat, {params}], ...], eased between neighbours
  function track(p, lb, frames, ease = smr) {
    let i = 0; while (i < frames.length - 1 && lb >= frames[i + 1][0]) i++;
    const [b0, A] = frames[i], nxt = frames[Math.min(i + 1, frames.length - 1)];
    const [b1, Bk] = nxt;
    const g = b1 > b0 ? ease((lb - b0) / (b1 - b0)) : 0;
    const names = new Set(Object.keys(A).concat(Object.keys(Bk)));
    for (const k of names) { const base = p[k]; p[k] = lerp(k in A ? A[k] : base, k in Bk ? Bk[k] : base, g); }
  }
  // footwork: key k is landed at count k. Foot key = [x, z, heel, yaw, lift, slide]
  function feet(p, lb, cl, keys, o = {}) {
    const sw = o.sw ?? 0.5, arc = o.arc ?? 0.07, n = keys.length, loop = o.loop ?? true;
    const c = lb / cl, i = Math.floor(c), f = c - i;
    const ia = loop ? mod(i, n) : clamp(i, 0, n - 1), ib = loop ? mod(i + 1, n) : clamp(i + 1, 0, n - 1);
    const A = keys[ia], Bk = keys[ib];
    for (const S of ['L', 'R']) {
      const a = A[S], b = Bk[S];
      if (!a || !b) continue;
      const slide = b[5] || 0;
      const moved = Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.03;
      const g = slide ? sm(f) : clamp((f - (1 - sw)) / sw, 0, 1);
      const e = slide ? g : smr(g);
      p['f' + S + 'x'] = lerp(a[0], b[0], e);
      p['f' + S + 'z'] = lerp(a[1], b[1], e);
      p['f' + S + 'h'] = lerp(a[2] || 0, b[2] || 0, e);
      p['f' + S + 'w'] = lerp(a[3] || 0, b[3] || 0, e);
      p['f' + S + 'y'] = lerp(a[4] || 0, b[4] || 0, e) + (moved && !slide ? arc * Math.sin(Math.PI * g) : 0);
    }
    const ge = o.pelvisSwing ? smr(clamp((f - (1 - sw)) / sw, 0, 1)) : sm(f);
    for (const k of ['px', 'pz', 'ph', 'pyaw']) {
      if (A[k] === undefined && Bk[k] === undefined) continue;
      const va = A[k] ?? 0, vb = Bk[k] ?? va, v = lerp(va, vb, ge);
      if (k === 'px') p.x = v; else if (k === 'pz') p.z = v; else if (k === 'ph') p.h += v; else p.yaw = v;
    }
  }
  const stance = (p, w = 0.14, z = Z0) => { p.fLx = w; p.fRx = -w; p.fLz = z; p.fRz = z; };

  // ============================================================ moves
  const NEUTRAL_ARMS = { Lel: 25, Laz: 0, Lro: 0, Lbe: 6, Lfl: 0, Rel: 25, Raz: 0, Rro: 0, Rbe: 6, Rfl: 0 };

  // --- intro: power-on sequence
  const INTRO = (() => {
    let cur = { hdX: 30, nkX: 12, chX: 8, spX: 4, hdY: 0, chY: 0, Lel: 6, Rel: 6, Laz: 0, Raz: 0, Lro: 0, Rro: 0, Lbe: 14, Rbe: 14, Lsh: -0.03, Rsh: -0.03, h: 1.06 };
    const steps = {
      4: { hdX: 0, nkX: 0 },
      5: { chX: 0, spX: 0, Lsh: 0, Rsh: 0, h: 1.12, Lel: 25, Rel: 25, Lbe: 6, Rbe: 6 },
      6: { Lel: 90, Lro: 90, Lbe: 90 },
      7: { Rel: 90, Rro: 90, Rbe: 90 },
      8: { hdY: 55 }, 9: { hdY: -55 }, 10: { hdY: 0 },
      11: { Lbe: 0, Rbe: 0, Lro: 0, Rro: 0 },
      12: { Laz: 90, Raz: 90 },
      13: { Lro: 90, Lbe: 90 },
      14: { Rro: 90, Rbe: 90, chY: 0 },
      15: { chX: -6, hdX: -8, Lsh: 0.03, Rsh: 0.03 },
    };
    const K = [];
    for (let i = 0; i < 16; i++) { if (steps[i]) cur = Object.assign({}, cur, steps[i]); K.push(Object.assign({}, cur)); }
    return K;
  })();
  function mIntro(p, lb) {
    if (lb < 0) { set(p, INTRO[0]); p.chX += 1.5 * Math.sin(lb * 0.8); return; }
    hits(p, lb, 1, INTRO, 0.3, false);
    if (lb > 12) p.h += bounce(lb, 0.02);
  }

  // --- robot arms with step-touch
  const ROBO = [
    { Lel: 90, Laz: 0, Lro: 90, Lbe: 90, Rel: 20, Raz: 0, Rro: 0, Rbe: 8, chY: 0 },
    { Lel: 90, Laz: 0, Lro: 90, Lbe: 90, Rel: 90, Raz: 0, Rro: 90, Rbe: 90, chY: -12 },
    { Lel: 90, Laz: 90, Lro: 90, Lbe: 90, Rel: 90, Raz: 0, Rro: 90, Rbe: 90, chY: 0 },
    { Lel: 90, Laz: 90, Lro: 90, Lbe: 90, Rel: 90, Raz: 90, Rro: 90, Rbe: 90, chY: 12 },
    { Lel: 90, Laz: 90, Lro: 0, Lbe: 90, Rel: 90, Raz: 90, Rro: 0, Rbe: 90, chY: 0 },
    { Lel: 90, Laz: 0, Lro: -90, Lbe: 90, Rel: 90, Raz: 0, Rro: -90, Rbe: 90, chY: -12 },
    { Lel: 165, Laz: 15, Lro: 0, Lbe: 0, Rel: 90, Raz: 0, Rro: -90, Rbe: 90, chY: 0 },
    { Lel: 25, Laz: 0, Lro: 0, Lbe: 6, Rel: 165, Raz: 15, Rro: 0, Rbe: 0, chY: 12 },
  ];
  const STEP_TOUCH = [
    { L: [0.24, Z0], R: [-0.24, Z0], px: 0 },
    { L: [-0.02, Z0, 35], R: [-0.24, Z0], px: -0.15 },
    { L: [0.24, Z0], R: [-0.24, Z0], px: 0 },
    { L: [0.24, Z0], R: [0.02, Z0, 35], px: 0.15 },
  ];
  function mRobot(p, lb) {
    hits(p, lb, 1, ROBO, 0.34);
    hits(p, lb, 2, [{ hdY: 0, hdZ: 0 }, { hdY: 40, hdZ: -6 }, { hdY: 0, hdZ: 0 }, { hdY: -40, hdZ: 6 }], 0.22);
    feet(p, lb, 1, STEP_TOUCH, { sw: 0.55, arc: 0.06 });
    p.h += bounce(lb, 0.035);
    p.Lsh = 0.025 * pop(lb + 0.1, 0.35); p.Rsh = 0.025 * pop(lb + 0.6, 0.35);
  }

  // --- Kraftwerk march in place, stiff pendulum arms
  const MARCH = [
    { L: [0.14, Z0], R: [-0.14, Z0] },
    { L: [0.14, Z0 + 0.12, -12, 0, 0.27], R: [-0.14, Z0] },
    { L: [0.14, Z0], R: [-0.14, Z0] },
    { L: [0.14, Z0], R: [-0.14, Z0 + 0.12, -12, 0, 0.27] },
  ];
  function mMarch(p, lb) {
    feet(p, lb, 1, MARCH, { sw: 0.9, arc: 0 });
    set(p, { Laz: 90, Raz: 90, Lbe: 0, Rbe: 0, Lro: 0, Rro: 0 });
    flow(p, lb, 1, [{ Lel: 0, Rel: 0 }, { Lel: -32, Rel: 38 }, { Lel: 0, Rel: 0 }, { Lel: 38, Rel: -32 }]);
    hits(p, lb, 4, [{ hdY: 0 }, { hdY: 70 }, { hdY: 0 }, { hdY: -70 }], 0.12);
    flow(p, lb, 1, [{ spY: 0 }, { spY: -6 }, { spY: 0 }, { spY: 6 }]);
    p.h = 1.12 + bounce(lb, 0.012);
  }

  // --- disco point
  const POINT_R = [
    { Rel: 150, Raz: 45, Rro: 0, Rbe: 0, Lel: 40, Laz: -40, Lro: 90, Lbe: 105, hdY: -28, hdX: -16, roll: 5, chZ: -6 },
    { Rel: 35, Raz: -25, Rro: 0, Rbe: 0, Lel: 40, Laz: -40, Lro: 90, Lbe: 105, hdY: 22, hdX: 10, roll: -5, chZ: 6 },
  ];
  const POINT_L = POINT_R.map(mirror);
  function mDisco(p, lb) {
    hits(p, lb, 2, lb < 8 ? POINT_R : POINT_L, 0.36);
    feet(p, lb, 1, STEP_TOUCH, { sw: 0.55, arc: 0.06 });
    p.h += bounce(lb, 0.04);
  }

  // --- traveling side glide
  const GLIDE = [
    { L: [0.14, Z0], R: [-0.14, Z0], px: 0 },
    { L: [0.44, Z0], R: [-0.14, Z0], px: 0.15 },
    { L: [0.44, Z0], R: [0.16, Z0, 25], px: 0.3 },
    { L: [0.74, Z0], R: [0.16, Z0], px: 0.45 },
    { L: [0.74, Z0], R: [0.46, Z0, 25], px: 0.6 },
    { L: [0.74, Z0], R: [0.16, Z0], px: 0.45 },
    { L: [0.44, Z0, 25], R: [0.16, Z0], px: 0.3 },
    { L: [0.44, Z0], R: [-0.14, Z0], px: 0.15 },
  ];
  function mGlide(p, lb) {
    feet(p, lb, 2, GLIDE, { sw: 0.6, arc: 0.06 });
    set(p, { Laz: 70, Raz: 70, Lro: 0, Rro: 0 });
    flow(p, lb, 1, [{ Lel: 32, Lbe: 75, Rel: 18, Rbe: 105, Lsh: 0.03, Rsh: 0 }, { Lel: 18, Lbe: 105, Rel: 32, Rbe: 75, Lsh: 0, Rsh: 0.03 }]);
    const dir = mod(lb, 16) < 8 ? 1 : -1;
    p.hdY = lerp(p.hdY, 28 * dir, 1); p.chZ = -4 * dir; p.chY = 8 * dir;
    p.h += bounce(lb, 0.035);
  }

  // --- liquid arm wave travelling through the shoulders
  function mWave(p, lb) {
    stance(p, 0.24);
    p.h += bounce(lb, 0.04);
    set(p, { Lel: 90, Laz: 0, Lro: 90, Lbe: 0, Rel: 90, Raz: 0, Rro: 90, Rbe: 0 });
    const cyc = Math.floor(lb / 4), u = fract(lb / 4) * 10 - 1;
    const a = k => { const kk = cyc % 2 === 0 ? k : 8 - k; const z = (kk - u) / 0.85; return Math.exp(-z * z); };
    p.Lfl = 55 * a(0) - 30 * a(1); p.Lbe = 50 * a(1) - 28 * a(2); p.Lel = 90 + 24 * a(2); p.Lsh = 0.05 * a(3);
    p.chZ = 11 * (a(3) - a(5)); p.hdZ = -7 * (a(3) - a(5)); p.chX = -4 * a(4);
    p.Rsh = 0.05 * a(5); p.Rel = 90 + 24 * a(6); p.Rbe = 50 * a(7) - 28 * a(6); p.Rfl = 55 * a(8) - 30 * a(7);
    p.x = 0.04 * (a(3) - a(5));
  }

  // --- clap overhead / open
  function mClap(p, lb) {
    hits(p, lb, 2, [
      { Lel: 160, Laz: 8, Lro: 90, Lbe: 38, Lfl: 10, Rel: 160, Raz: 8, Rro: 90, Rbe: 38, Rfl: 10, hdX: -14, chX: -5 },
      { Lel: 105, Laz: -12, Lro: 90, Lbe: 12, Lfl: -15, Rel: 105, Raz: -12, Rro: 90, Rbe: 12, Rfl: -15, hdX: 4, chX: 6 },
    ], 0.3);
    feet(p, lb, 1, STEP_TOUCH, { sw: 0.55, arc: 0.06 });
    p.h += bounce(lb, 0.045);
  }
  // --- charge: sink and vibrate before a big moment (8 beats)
  function mCharge(p, lb) {
    const k = sm(lb / 7);
    stance(p, lerp(0.2, 0.27, k));
    set(p, { Lel: lerp(60, 38, k), Laz: lerp(20, -55, k), Lbe: lerp(30, 8, k), Rel: lerp(60, 38, k), Raz: lerp(20, -55, k), Rbe: lerp(30, 8, k) });
    p.h = lerp(1.08, 0.84, k); p.chX = lerp(4, 26, k); p.spX = lerp(0, 10, k); p.hdX = lerp(0, -22, k);
    const v = k * k;
    p.chZ = 2.2 * v * Math.sin(lb * TAU * 4); p.hdY = 3 * v * Math.sin(lb * TAU * 5.3);
    p.Lsh = 0.01 * v * Math.sin(lb * TAU * 6); p.Rsh = -p.Lsh;
  }

  // --- chorus "НЕБО"
  const CH_ARMS = [
    { Lel: 156, Laz: 12, Lro: 0, Lbe: 0, Lfl: -10, Rel: 156, Raz: 12, Rro: 0, Rbe: 0, Rfl: -10, hdX: -26, chX: -10, nkX: -6 },
    { Lel: 150, Laz: 4, Lro: 0, Lbe: 0, Lfl: 28, Rel: 150, Raz: 4, Rro: 0, Rbe: 0, Rfl: 28, hdX: -16, chX: -6, nkX: -3 },
    { Lel: 96, Laz: -15, Lro: 0, Lbe: 6, Lfl: 0, Rel: 96, Raz: -15, Rro: 0, Rbe: 6, Rfl: 0, hdX: 0, chX: 9, nkX: 0 },
    { Lel: 82, Laz: 112, Lro: 90, Lbe: 72, Lfl: 0, Rel: 82, Raz: 112, Rro: 90, Rbe: 72, Rfl: 0, hdX: 12, chX: 4, nkX: 4 },
  ];
  const CH_FEET = [
    { L: [0.3, Z0], R: [-0.3, Z0] },
    { L: [0.3, Z0], R: [-0.3, Z0] },
    { L: [0.11, Z0], R: [-0.11, Z0] },
    { L: [0.11, Z0], R: [-0.11, Z0] },
  ];
  function mChorus(p, lb, big) {
    const q = mod(lb, 16);
    if (q < 12) {
      hits(p, lb, 1, CH_ARMS, 0.32);
      feet(p, lb, 1, CH_FEET, { sw: 0.45, arc: big ? 0.15 : 0.06 });
      const c = mod(lb, 4);
      p.h += bounce(lb, 0.035);
      if (c >= 3) p.h -= 0.05 * Math.sin(Math.PI * clamp((c - 3) / 0.55, 0, 1)); // dip before the jump
      if (big && c >= 3.5) p.h += 0.15 * Math.sin(Math.PI * (c - 3.5) / 0.5);
    } else {
      // pirouette with arms in the sky
      const u = (q - 12) / 3.4;
      set(p, { Lel: 162, Laz: 10, Lro: 90, Lbe: 14, Lfl: 0, Rel: 162, Raz: 10, Rro: 90, Rbe: 14, Rfl: 0, hdX: -18, chX: -6 });
      stance(p, 0.1);
      p.face = 360 * smr(u);
      p.fLh = p.fRh = 28 * Math.sin(Math.PI * clamp((q - 12) / 3.8, 0, 1));
      p.h = 1.1 + 0.03 * Math.sin(Math.PI * clamp(u, 0, 1));
      if (q > 15.6) { const k = (q - 15.6) / 0.4; p.fLx = lerp(0.1, 0.3, smr(k)); p.fRx = -p.fLx; }
    }
  }

  // --- moonwalk in profile: 3 legs with pivot turns, ends back at centre
  const MW_S = 0.1;
  function moonPhase(p, lb, s) {
    const ph = lb / 2, k = Math.floor(ph), f = ph - k;
    const w0 = 0.16, fs = clamp((f - w0) / (1 - w0), 0, 1);
    const xF = -s * k + s / 2, xB = xF - s;
    const slideL = k % 2 === 0;
    const slider = xF - 2 * s * fs, heelUp = 38 * smr(f / w0), heelDown = 38 * (1 - smr(f / w0));
    const zs = slider + Z0, zb = xB + Z0;
    if (slideL) { p.fLz = zs; p.fLh = heelDown; p.fRz = zb; p.fRh = heelUp; }
    else { p.fRz = zs; p.fRh = heelDown; p.fLz = zb; p.fLh = heelUp; }
    p.fLx = 0.1; p.fRx = -0.1;
    p.z = -s * (k + fs);
    p.h = 1.05 + 0.015 * Math.sin(TAU * ph);
    p.chX = 8; p.spX = 3; p.hdX = -4;
    set(p, { Laz: 90, Raz: 90, Lbe: 40, Rbe: 40 });
    p.Lel = 8 + 14 * Math.sin(TAU * ph * 0.5); p.Rel = 8 - 14 * Math.sin(TAU * ph * 0.5);
    p.Lsh = 0.02 * pop(lb, 0.4); p.Rsh = 0.02 * pop(lb + 0.5, 0.4);
  }
  function pivotTurn(p, f, from, to) {
    p.face = lerp(from, to, smr(f));
    stance(p, 0.1);
    p.fLh = p.fRh = 25 * Math.sin(Math.PI * clamp(f, 0, 1));
    p.h = 1.08;
    set(p, { Laz: 90, Raz: 90, Lbe: 70, Rbe: 70, Lel: 20, Rel: 20 });
  }
  function mMoon(p, lb) {
    const s = MW_S;
    if (lb < 8) { p.face = 90; moonPhase(p, lb, s); }
    else if (lb < 10) { p.face = 90; p.ox = -4 * s; pivotTurn(p, (lb - 8) / 1.3, 90, 270); }
    else if (lb < 24) { p.face = 270; p.ox = -4 * s; moonPhase(p, lb - 10, s); }
    else if (lb < 26) { p.ox = 3 * s; pivotTurn(p, (lb - 24) / 1.3, 270, 450); }
    else { p.face = 450; p.ox = 3 * s; moonPhase(p, lb - 26, s); }
    p.hdY = 25 * Math.sin(TAU * lb / 16);
  }

  // --- robot walk along a square, 90° turns (built in world coordinates)
  const BOX = (() => {
    const keys = [], u = 0.18, half = 0.13;
    let cx = 0, cz = 0, hd = 450;
    const fw = h => [Math.sin(h * D2R), Math.cos(h * D2R)], lf = h => [Math.cos(h * D2R), -Math.sin(h * D2R)];
    // toe position of a foot whose ankle is `n` units ahead of the side's start point
    const toe = (h, side, n) => { const f = fw(h), l = lf(h), a = n * u + Z0; return [cx + l[0] * half * side + f[0] * a, cz + l[1] * half * side + f[1] * a]; };
    const pel = (h, n) => { const f = fw(h); return [cx + f[0] * n * u, cz + f[1] * n * u]; };
    const key = (nl, nr, np) => { const L = toe(hd, 1, nl), R = toe(hd, -1, nr), P = pel(hd, np); return { L: [L[0], L[1], 0, hd], R: [R[0], R[1], 0, -hd], px: P[0], pz: P[1], pyaw: hd }; };
    keys.push(key(0, 0, 0));
    const turn = () => { hd -= 90; keys.push(key(0, 0, 0)); keys.push(key(0, 0, 0)); };
    turn(); // profile -> facing the camera
    for (let side = 0; side < 4; side++) {
      keys.push(key(1, 0, 0.5)); keys.push(key(1, 2, 1.5)); keys.push(key(3, 2, 2.5)); keys.push(key(3, 3, 3));
      const f = fw(hd); cx += f[0] * 3 * u; cz += f[1] * 3 * u;
      turn();
    }
    return keys; // 27 keys, one per beat
  })();
  function mBox(p, lb) {
    feet(p, lb, 1, BOX, { sw: 0.6, arc: 0.07, loop: false, pelvisSwing: true });
    set(p, { Laz: 90, Raz: 90, Lbe: 10, Rbe: 10, Lro: 0, Rro: 0 });
    flow(p, lb, 1, [{ Lel: 30, Rel: -24 }, { Lel: -24, Rel: 30 }]);
    p.h += bounce(lb, 0.02);
    const c = Math.floor(lb);
    p.hdY = [0, 6, 12, 18, 24].includes(c) ? -35 * sm(fract(lb) * 2) : 0; // look into the turn
    p.chX = 4;
  }

  // --- glitch / malfunction
  const GLITCH = [
    { hdZ: 0 }, { hdZ: 28 }, { hdZ: 28, Lel: 70, Lbe: 50 }, { hdZ: -12, hdY: 45 }, { Rsh: 0.06, Rel: 50, Rbe: 30 },
    { chZ: 10, hdZ: -30, hdY: 0 }, { hdX: 34, nkX: 16, chX: 18, Lel: 8, Rel: 8, Lbe: 20, Rbe: 20, Lsh: -0.04, Rsh: -0.04 },
    { hdX: 34, nkX: 16, chX: 18 }, { hdX: -10, nkX: 0, chX: -6, Lel: 25, Rel: 25, Lsh: 0.05, Rsh: 0.05 },
    { hdX: 0, chX: 0, Lsh: 0, Rsh: 0, hdY: 0, hdZ: 0, chZ: 0 }, {}, {},
  ];
  function mGlitch(p, lb) {
    let acc = {}; const keys = GLITCH.map(k => (acc = Object.assign({}, acc, k)));
    hits(p, lb, 0.5, keys, 0.22, false);
    const env = lb < 3 ? Math.sin(Math.PI * lb / 3) : 0;
    p.hdY += 5 * env * Math.sin(lb * TAU * 7.3); p.chZ += 2 * env * Math.sin(lb * TAU * 9.1);
    if (lb > 3 && lb < 4.2) p.h -= 0.06 * Math.sin(Math.PI * (lb - 3) / 1.2);
  }

  // --- popping / hits
  const POPS = [
    { Lel: 90, Laz: 0, Lro: 90, Lbe: 90, Rel: 90, Raz: 0, Rro: -90, Rbe: 90, hdY: 0, chY: 0 },
    { Lel: 90, Laz: 0, Lro: -90, Lbe: 90, Rel: 90, Raz: 0, Rro: 90, Rbe: 90, hdY: 35, chY: 10 },
    { Lel: 90, Laz: 90, Lro: 90, Lbe: 90, Rel: 90, Raz: 90, Rro: 90, Rbe: 90, hdY: 0, chY: 0 },
    { Lel: 170, Laz: 0, Lro: 0, Lbe: 0, Rel: 90, Raz: 0, Rro: 0, Rbe: 0, hdY: -45, chY: -10 },
    { Lel: 45, Laz: -55, Lro: 90, Lbe: 100, Rel: 45, Raz: -55, Rro: 90, Rbe: 100, hdY: 0, chY: 0 },
    { Lel: 88, Laz: 120, Lro: 90, Lbe: 62, Rel: 88, Raz: 120, Rro: 90, Rbe: 62, hdY: 20, chY: 12 },
    { Lel: 135, Laz: 0, Lro: 90, Lbe: 95, Rel: 135, Raz: 0, Rro: 90, Rbe: 95, hdY: 0, chY: 0 },
    { Lel: 25, Laz: 0, Lro: 0, Lbe: 6, Rel: 25, Raz: 0, Rro: 0, Rbe: 6, hdY: -30, chY: -8 },
  ];
  function mPop(p, lb) {
    stance(p, 0.22);
    hits(p, lb, 1, POPS, 0.2);
    const k = pop(lb + 0.05, 0.28);
    p.chX += 6 * k; p.h -= 0.03 * k;
    const even = Math.floor(lb) % 2 === 0;
    if (even) p.fLh = 22 * pop(lb + 0.05, 0.45); else p.fRh = 22 * pop(lb + 0.05, 0.45);
    p.Lsh = 0.03 * (even ? k : 0); p.Rsh = 0.03 * (even ? 0 : k);
  }

  // --- bridge: weightless float
  const FLOAT = [
    { Lel: 35, Laz: -10, Lro: 90, Lbe: 25, Lfl: -15, Rel: 35, Raz: -10, Rro: 90, Rbe: 25, Rfl: -15, hdX: 5, chX: 4, chY: 0, x: 0, roll: 0, fLh: 0, fRh: 0 },
    { Lel: 112, Laz: 5, Lro: 90, Lbe: 15, Lfl: 22, Rel: 70, Raz: 5, Rro: 90, Rbe: 30, Rfl: -10, hdX: -10, chX: -4, chY: 12, x: 0.06, roll: -3, fLh: 0, fRh: 12 },
    { Lel: 158, Laz: 15, Lro: 90, Lbe: 10, Lfl: 10, Rel: 158, Raz: 15, Rro: 90, Rbe: 10, Rfl: 10, hdX: -28, chX: -10, chY: 0, x: 0, roll: 0, fLh: 22, fRh: 22 },
    { Lel: 70, Laz: 5, Lro: 90, Lbe: 30, Lfl: -10, Rel: 112, Raz: 5, Rro: 90, Rbe: 15, Rfl: 22, hdX: -10, chX: -4, chY: -12, x: -0.06, roll: 3, fLh: 12, fRh: 0 },
  ];
  function mFloat(p, lb) {
    stance(p, 0.2);
    flow(p, lb, 4, FLOAT);
    p.h += 0.025 * Math.sin(TAU * lb / 8) - 0.02;
    p.yaw = 14 * Math.sin(TAU * lb / 16);
  }

  // --- drop: big jump
  function mJump(p, lb) {
    stance(p, 0.24);
    const air = clamp((lb - 0.06) / 0.86, 0, 1);
    const J = air > 0 && air < 1 ? 0.36 * Math.sin(Math.PI * air) : 0;
    p.fLy = p.fRy = J; p.fLh = p.fRh = J > 0 ? 30 * Math.sin(Math.PI * air) : 0;
    p.h = air <= 0 ? 0.86 : air < 1 ? lerp(0.86, 1.1, sm(air * 2.5)) + J : 1.1 - 0.2 * Math.sin(Math.PI * clamp((lb - 0.92) / 1.08, 0, 1));
    hits(p, lb + 0.85, 1, [
      { Lel: 40, Laz: -55, Lbe: 8, Rel: 40, Raz: -55, Rbe: 8, hdX: -20, chX: 20 },
      { Lel: 165, Laz: 15, Lbe: 0, Rel: 165, Raz: 15, Rbe: 0, hdX: -28, chX: -12 },
      { Lel: 70, Laz: 40, Lbe: 60, Rel: 70, Raz: 40, Rbe: 60, hdX: 6, chX: 12 },
    ], 0.35, false);
  }

  // --- running man
  const RUNMAN = [
    { L: [0.13, Z0 + 0.14], R: [-0.13, Z0 - 0.1, 35] },
    { L: [0.13, Z0 - 0.08, 0, 0, 0, 1], R: [-0.13, Z0 + 0.12, -12, 0, 0.3] },
    { L: [0.13, Z0 - 0.1, 35], R: [-0.13, Z0 + 0.14] },
    { L: [0.13, Z0 + 0.12, -12, 0, 0.3], R: [-0.13, Z0 - 0.08, 0, 0, 0, 1] },
  ];
  function mRunMan(p, lb) {
    feet(p, lb, 1, RUNMAN, { sw: 0.7, arc: 0.05 });
    set(p, { Laz: 90, Raz: 90, Lbe: 85, Rbe: 85, Lro: 0, Rro: 0 });
    flow(p, lb, 1, [{ Lel: 12, Rel: 12 }, { Lel: 42, Rel: -22 }, { Lel: 12, Rel: 12 }, { Lel: -22, Rel: 42 }]);
    p.h = 1.08 + bounce(lb, 0.04); p.chX = 7; p.hdX = 6 * pop(lb, 0.4);
    p.chY = 8 * Math.sin(TAU * lb / 2);
  }

  // --- kicks and sky punches
  const KICK = [
    { L: [0.14, Z0], R: [-0.14, Z0] },
    { L: [0.14, Z0 + 0.34, -30, 0, 0.24], R: [-0.14, Z0] },
    { L: [0.14, Z0], R: [-0.14, Z0] },
    { L: [0.14, Z0], R: [-0.14, Z0 + 0.34, -30, 0, 0.24] },
  ];
  const GUARD = { Lel: 40, Laz: 70, Lro: 0, Lbe: 110, Rel: 40, Raz: 70, Rro: 0, Rbe: 110, hdX: 4 };
  function mKick(p, lb) {
    feet(p, lb, 1, KICK, { sw: 0.75, arc: 0 });
    hits(p, lb, 1, [GUARD, Object.assign({}, GUARD, { Rel: 172, Raz: 12, Rbe: 0, hdX: -18 }), GUARD, Object.assign({}, GUARD, { Lel: 172, Laz: 12, Lbe: 0, hdX: -18 })], 0.24);
    p.h += bounce(lb, 0.04); p.chX = 5;
  }

  // --- breaking: toprock, go-down, backspin, headspin, freeze, kip-up
  const TOPROCK = [
    { L: [0.14, Z0], R: [-0.14, Z0] },
    { L: [-0.06, Z0 + 0.24, 0, -25], R: [-0.14, Z0] },
    { L: [0.14, Z0], R: [-0.14, Z0] },
    { L: [0.14, Z0], R: [0.06, Z0 + 0.24, 0, -25] },
  ];
  const ARMS_OPEN = { Lel: 85, Laz: -15, Lro: 90, Lbe: 35, Rel: 85, Raz: -15, Rro: 90, Rbe: 35 };
  const ARMS_CLOSE = { Lel: 70, Laz: 85, Lro: 0, Lbe: 70, Rel: 70, Raz: 85, Rro: 0, Rbe: 70 };
  function mToprock(p, lb) {
    feet(p, lb, 1, TOPROCK, { sw: 0.6, arc: 0.06 });
    flow(p, lb, 1, [ARMS_CLOSE, ARMS_OPEN, ARMS_CLOSE, ARMS_OPEN]);
    flow(p, lb, 1, [{ chY: 0, hdY: 0 }, { chY: -18, hdY: -12 }, { chY: 0, hdY: 0 }, { chY: 18, hdY: 12 }]);
    p.chX = 12; p.spX = 5; p.h += bounce(lb, 0.05);
  }
  // spin speed knots (revolutions per beat) for the floor section, integrated analytically
  const SPIN = [[0, 0], [4, 0], [6, 0.55], [17, 0.55], [20, 0.28], [24, 0.3], [26, 0.42], [36, 0.42], [38.5, 0], [48, 0]];
  function spinAngle(lb) {
    let a = 0;
    for (let i = 0; i < SPIN.length - 1; i++) {
      const [x0, v0] = SPIN[i], [x1, v1] = SPIN[i + 1];
      if (lb <= x0) break;
      const xe = Math.min(lb, x1), ve = v0 + (v1 - v0) * (xe - x0) / (x1 - x0);
      a += (v0 + ve) * 0.5 * (xe - x0);
    }
    return a * 360;
  }
  const LEGS_TUCK = { LlP: 112, LlA: 22, LlK: 115, LlF: 20, RlP: 112, RlA: 22, RlK: 115, RlF: 20 };
  const LEGS_V = { LlP: 0, LlA: 30, LlK: 0, LlF: 25, RlP: 0, RlA: 30, RlK: 0, RlF: 25 };
  const BREAK = [
    [0, { fk: 0, floor: 0, anchor: 0, pitch: 0, roll: 0, h: 1.08, chX: 12, spX: 5, hdX: 0, nkX: 0, Lel: 70, Laz: 85, Lro: 0, Lbe: 70, Rel: 70, Raz: 85, Rro: 0, Rbe: 70, LlP: 0, LlA: 0, LlK: 0, LlF: 0, RlP: 0, RlA: 0, RlK: 0, RlF: 0 }],
    [2, { fk: 0, floor: 0, anchor: 0, pitch: 10, roll: 0, h: 0.72, chX: 30, spX: 14, hdX: -18, nkX: 0, Lel: 32, Laz: 90, Lro: 0, Lbe: 10, Rel: 32, Raz: 90, Rro: 0, Rbe: 10, LlP: 105, LlA: 18, LlK: 135, LlF: -25, RlP: 105, RlA: 18, RlK: 135, RlF: -25 }],
    [3, { fk: 1, floor: 1, anchor: 0.5, pitch: -35, roll: 0, h: 0.6, chX: 12, spX: 4, hdX: 0, nkX: 0, Lel: 30, Laz: -70, Lro: 0, Lbe: 10, Rel: 30, Raz: -70, Rro: 0, Rbe: 10, LlP: 100, LlA: 18, LlK: 120, LlF: 0, RlP: 100, RlA: 18, RlK: 120, RlF: 0 }],
    [4, Object.assign({ fk: 1, floor: 1, anchor: 1, pitch: -78, roll: 0, h: 0.4, chX: -10, spX: -10, hdX: 32, nkX: 10, Lel: 82, Laz: -10, Lro: 90, Lbe: 22, Rel: 82, Raz: -10, Rro: 90, Rbe: 22 }, LEGS_TUCK)],
    [20, Object.assign({ fk: 1, floor: 1, anchor: 1, pitch: -78, roll: 0, h: 0.4, chX: -10, spX: -10, hdX: 32, nkX: 10, Lel: 82, Laz: -10, Lro: 90, Lbe: 22, Rel: 82, Raz: -10, Rro: 90, Rbe: 22 }, LEGS_TUCK)],
    [22, Object.assign({ fk: 1, floor: 1, anchor: 1, pitch: -130, roll: 0, h: 0.5, chX: 0, spX: 0, hdX: 20, nkX: 5, Lel: 150, Laz: 40, Lro: 90, Lbe: 40, Rel: 150, Raz: 40, Rro: 90, Rbe: 40 }, { LlP: 80, LlA: 15, LlK: 60, LlF: 20, RlP: 80, RlA: 15, RlK: 60, RlF: 20 })],
    [24, Object.assign({ fk: 1, floor: 1, anchor: 1, pitch: -180, roll: 0, h: 1.0, chX: 0, spX: 0, hdX: 0, nkX: 0, Lel: 95, Laz: 0, Lro: 90, Lbe: 10, Rel: 95, Raz: 0, Rro: 90, Rbe: 10 }, LEGS_V)],
    [38, Object.assign({ fk: 1, floor: 1, anchor: 1, pitch: -180, roll: 0, h: 1.0, chX: 0, spX: 0, hdX: 0, nkX: 0, Lel: 95, Laz: 0, Lro: 90, Lbe: 10, Rel: 95, Raz: 0, Rro: 90, Rbe: 10 }, LEGS_V)],
    [39, { fk: 1, floor: 1, anchor: 1, pitch: -172, roll: 14, h: 1.0, chX: 4, spX: 0, hdX: 0, nkX: 0, Lel: 120, Laz: 30, Lro: 90, Lbe: 60, Rel: 70, Raz: -20, Rro: 90, Rbe: 20, LlP: 35, LlA: 10, LlK: 100, LlF: 30, RlP: -12, RlA: 38, RlK: 0, RlF: 30 }],
    [43, { fk: 1, floor: 1, anchor: 1, pitch: -172, roll: 14, h: 1.0, chX: 4, spX: 0, hdX: 0, nkX: 0, Lel: 120, Laz: 30, Lro: 90, Lbe: 60, Rel: 70, Raz: -20, Rro: 90, Rbe: 20, LlP: 35, LlA: 10, LlK: 100, LlF: 30, RlP: -12, RlA: 38, RlK: 0, RlF: 30 }],
    [45, Object.assign({ fk: 1, floor: 1, anchor: 1, pitch: -95, roll: 0, h: 0.4, chX: -6, spX: -6, hdX: 25, nkX: 8, Lel: 165, Laz: 20, Lro: 90, Lbe: 40, Rel: 165, Raz: 20, Rro: 90, Rbe: 40 }, LEGS_TUCK)],
    [46.3, Object.assign({ fk: 1, floor: 1, anchor: 0.8, pitch: -40, roll: 0, h: 0.5, chX: 8, spX: 6, hdX: 0, nkX: 0, Lel: 60, Laz: 80, Lro: 0, Lbe: 30, Rel: 60, Raz: 80, Rro: 0, Rbe: 30 }, { LlP: 95, LlA: 15, LlK: 125, LlF: 0, RlP: 95, RlA: 15, RlK: 125, RlF: 0 })],
    [47.3, { fk: 0.5, floor: 0.6, anchor: 0.3, pitch: 5, roll: 0, h: 0.72, chX: 22, spX: 10, hdX: -12, nkX: 0, Lel: 45, Laz: 90, Lro: 0, Lbe: 20, Rel: 45, Raz: 90, Rro: 0, Rbe: 20, LlP: 100, LlA: 18, LlK: 130, LlF: -25, RlP: 100, RlA: 18, RlK: 130, RlF: -25 }],
    [48, { fk: 0, floor: 0, anchor: 0, pitch: 0, roll: 0, h: 1.04, chX: 6, spX: 0, hdX: -20, nkX: 0, Lel: 156, Laz: 12, Lro: 0, Lbe: 0, Rel: 156, Raz: 12, Rro: 0, Rbe: 0, LlP: 0, LlA: 0, LlK: 0, LlF: 0, RlP: 0, RlA: 0, RlK: 0, RlF: 0 }],
  ];
  function mBreakFloor(p, lb) {
    track(p, lb, BREAK, sm);
    if (lb < 2.5) { stance(p, lerp(0.14, 0.2, sm(lb / 2))); }
    else if (lb > 46.5) { stance(p, lerp(0.2, 0.3, sm((lb - 47.3) / 0.7))); }
    p.yaw = spinAngle(lb);
    if (lb >= 4 && lb < 20) { // leg pump while spinning on the back
      const pump = Math.sin(TAU * lb / 2) * 10;
      p.LlP += pump; p.RlP -= pump; p.LlK += pump * 0.5; p.RlK -= pump * 0.5;
    }
    if (lb >= 24 && lb < 38) { const sc = Math.sin(TAU * lb / 4) * 8; p.LlA += sc; p.RlA -= sc; }
  }

  // --- final: alternating sky jabs, build-up, final pose
  const SKY = [
    { Rel: 166, Raz: 22, Rro: 0, Rbe: 0, Lel: 42, Laz: 65, Lro: 0, Lbe: 105, hdX: -22, hdY: -12, chZ: -4 },
    { Lel: 166, Laz: 22, Lro: 0, Lbe: 0, Rel: 42, Raz: 65, Rro: 0, Rbe: 105, hdX: -22, hdY: 12, chZ: 4 },
  ];
  function mSky(p, lb) {
    hits(p, lb, 1, SKY, 0.26);
    feet(p, lb, 1, STEP_TOUCH, { sw: 0.55, arc: 0.06 });
    p.h += bounce(lb, 0.045);
  }
  function mRise(p, lb) {
    stance(p, 0.12);
    const k = sm(lb / 8);
    set(p, { Lel: lerp(30, 165, k), Laz: lerp(-10, 10, k), Lro: 90, Lbe: lerp(30, 0, k), Lfl: lerp(-20, 0, k), Rel: lerp(30, 165, k), Raz: lerp(-10, 10, k), Rro: 90, Rbe: lerp(30, 0, k), Rfl: lerp(-20, 0, k) });
    p.fLh = p.fRh = 30 * k; p.hdX = -25 * k; p.chX = -8 * k; p.h = 1.08 + 0.03 * k;
    p.Lfl += 15 * k * Math.sin(lb * TAU); p.Rfl -= 15 * k * Math.sin(lb * TAU);
  }
  const FINAL = { Rel: 168, Raz: 16, Rro: 0, Rbe: 0, Rfl: -5, Lel: 42, Laz: -38, Lro: 90, Lbe: 105, Lfl: 0, hdX: -24, hdY: -14, chX: -6, chZ: 4, roll: -3,
    fLx: 0.17, fLz: Z0, fRx: -0.31, fRz: Z0 + 0.06, fRh: 24, fRw: 25, x: 0.06, fLh: 0 };
  function mFinal(p, lb, t) {
    hits(p, lb + 1, 1, [{ Lel: 165, Laz: 10, Lro: 90, Lbe: 0, Rel: 165, Raz: 10, Rro: 90, Rbe: 0, hdX: -25, chX: -8, fLh: 30, fRh: 30, fLx: 0.12, fRx: -0.12, fRz: Z0, fRw: 0, x: 0, roll: 0, hdY: 0, chZ: 0, Lfl: 0, Rfl: 0 }, FINAL], 0.3, false);
    p.chX += 1.2 * Math.sin(t * 1.5); p.hdY += 2 * Math.sin(t * 0.4);
  }

  // ============================================================ timeline
  const SECTIONS = [
    { from: -99, to: 16, label: 'Интро', move: 'Включение', fn: mIntro, shots: ['close', 'low'] },
    { from: 16, to: 32, label: 'Хук', move: 'Робот', fn: mRobot, shots: ['front', 'three'] },
    { from: 32, to: 48, label: 'Хук', move: 'Марш', fn: mMarch, shots: ['low', 'side'] },
    { from: 48, to: 64, label: 'Хук', move: 'Диско', fn: mDisco, shots: ['close', 'orbit'] },
    { from: 64, to: 96, label: 'Куплет', move: 'Глайд', fn: mGlide, shots: ['wide', 'three', 'front', 'low'] },
    { from: 96, to: 128, label: 'Куплет', move: 'Волна', fn: mWave, shots: ['close', 'front', 'three', 'close'] },
    { from: 128, to: 152, label: 'Куплет', move: 'Хлопки', fn: mClap, shots: ['low', 'orbit', 'front'] },
    { from: 152, to: 160, label: 'Куплет', move: 'Заряд', fn: mCharge, shots: ['low'] },
    { from: 160, to: 192, label: 'Припев', move: 'Небо', fn: (p, lb) => mChorus(p, lb, false), shots: ['low', 'orbit', 'top', 'front'] },
    { from: 192, to: 224, label: 'Куплет 2', move: 'Мунвок', fn: mMoon, shots: ['front', 'feet', 'three', 'feet'] },
    { from: 224, to: 250, label: 'Куплет 2', move: 'Робо-шаг', fn: mBox, shots: ['wide', 'top', 'three', 'wide'] },
    { from: 250, to: 256, label: 'Куплет 2', move: 'Сбой системы', fn: mGlitch, shots: ['close'] },
    { from: 256, to: 288, label: 'Предприпев', move: 'Поппинг', fn: mPop, shots: ['close', 'three', 'low', 'front'] },
    { from: 288, to: 320, label: 'Припев', move: 'Небо', fn: (p, lb) => mChorus(p, lb, true), shots: ['low', 'orbit', 'top', 'front'] },
    { from: 320, to: 344, label: 'Бридж', move: 'Невесомость', fn: mFloat, shots: ['wide', 'orbit', 'close'] },
    { from: 344, to: 352, label: 'Бридж', move: 'Заряд', fn: mCharge, shots: ['low'] },
    { from: 352, to: 354, label: 'Дроп', move: 'Прыжок', fn: mJump, shots: ['low'] },
    { from: 354, to: 384, label: 'Дроп', move: 'Раннинг-мэн', fn: mRunMan, shots: ['feet', 'three', 'front', 'low'] },
    { from: 384, to: 416, label: 'Дроп', move: 'Удары в небо', fn: mKick, shots: ['orbit', 'low', 'close', 'top'] },
    { from: 416, to: 432, label: 'Брейк', move: 'Топрок', fn: mToprock, shots: ['three', 'low'] },
    { from: 432, to: 456, label: 'Брейк', move: 'Бэкспин', fn: (p, lb) => mBreakFloor(p, lb), shots: ['floorLow', 'floor', 'floorLow'] },
    { from: 456, to: 476, label: 'Брейк', move: 'Хедспин', fn: (p, lb) => mBreakFloor(p, lb + 24), shots: ['low', 'floor', 'front'] },
    { from: 476, to: 480, label: 'Брейк', move: 'Кип-ап', fn: (p, lb) => mBreakFloor(p, lb + 44), shots: ['front'] },
    { from: 480, to: 512, label: 'Финал', move: 'Небо', fn: (p, lb) => mChorus(p, lb, true), shots: ['low', 'orbit', 'top', 'front'] },
    { from: 512, to: 528, label: 'Финал', move: 'Небо! Небо!', fn: mSky, shots: ['close', 'three'] },
    { from: 528, to: 544, label: 'Финал', move: 'Небо', fn: (p, lb) => mChorus(p, lb, true), shots: ['orbit', 'low'] },
    { from: 544, to: 552, label: 'Финал', move: 'Взлёт', fn: mRise, shots: ['wide'] },
    { from: 552, to: 99999, label: 'Аутро', move: 'Финальная поза', fn: mFinal, shots: ['low'] },
  ];
  function sectionAt(b) { for (const s of SECTIONS) if (b < s.to) return s; return SECTIONS[SECTIONS.length - 1]; }

  function idlePose(p, t) {
    p.chX = 1.2 * Math.sin(t * 1.4); p.hdY = 10 * Math.sin(t * 0.33); p.hdX = -2 + 2 * Math.sin(t * 0.5);
    p.h = 1.12 + 0.004 * Math.sin(t * 1.4); p.Lfl = p.Rfl = 3 * Math.sin(t * 0.9);
  }

  // ============================================================ camera
  const SHOTS = {
    front: { az: 0, el: 7, d: 5.6, ty: 1.05, dr: 8, dd: -0.5, fov: 34 },
    three: { az: 35, el: 10, d: 5.0, ty: 1.05, dr: -10, dd: -0.3, fov: 34 },
    low: { az: -28, el: -4, d: 5.0, ty: 1.0, dr: 12, dd: -0.25, fov: 40 },
    floor: { az: 25, el: 56, d: 4.2, ty: 0.2, dr: 40, dd: -0.3, fov: 38 },
    floorLow: { az: -30, el: 6, d: 4.4, ty: 0.55, dr: 16, dd: -0.2, fov: 38 },
    close: { az: 18, el: 4, d: 2.5, ty: 1.58, dr: -10, dd: -0.2, fov: 32 },
    side: { az: 90, el: 6, d: 5.2, ty: 1.0, dr: -8, dd: 0, fov: 34 },
    top: { az: 25, el: 48, d: 5.6, ty: 0.85, dr: 30, dd: -0.3, fov: 36 },
    orbit: { az: -40, el: 12, d: 5.0, ty: 1.0, dr: 110, dd: 0, fov: 36 },
    feet: { az: -35, el: 5, d: 3.0, ty: 0.5, dr: 12, dd: -0.2, fov: 38 },
    wide: { az: -12, el: 15, d: 7.6, ty: 0.95, dr: 8, dd: -0.6, fov: 34 },
    attract: { az: 24, el: 8, d: 5.8, ty: 1.02, dr: 0, dd: 0, fov: 34 },
  };
  const cam = { mode: 'clip', faz: 24, fel: 8, fd: 5.8, caz: 24, cel: 8, cd: 5.8, tgt: new V3(0, 1, 0), lastShot: -1, dragging: false };
  const camTgtSpring = { x: 0, z: 0, vx: 0, vz: 0 };
  function placeCam(az, el, d, ty, fov) {
    if (camera.aspect < 0.85) d *= Math.pow(0.85 / camera.aspect, 0.6); // portrait screens: step back so the arms fit
    const a = az * D2R, e = el * D2R;
    camera.position.set(cam.tgt.x + d * Math.cos(e) * Math.sin(a), ty + d * Math.sin(e), cam.tgt.z + d * Math.cos(e) * Math.cos(a));
    camera.lookAt(cam.tgt.x, ty, cam.tgt.z);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  function updateCamera(dt, b, playingSong, wall) {
    // follow the chest, softly
    J.chest.getWorldPosition(_chestW);
    const w = 3.2, ex = Math.exp(-w * dt);
    for (const ax of ['x', 'z']) {
      const v = ax === 'x' ? 'vx' : 'vz', y = camTgtSpring[ax] - _chestW[ax], j = camTgtSpring[v] + w * y;
      camTgtSpring[ax] = _chestW[ax] + (y + j * dt) * ex; camTgtSpring[v] = (camTgtSpring[v] - w * j * dt) * ex;
    }
    cam.tgt.set(camTgtSpring.x, 0, camTgtSpring.z);
    if (cam.mode === 'free') {
      const k = 1 - Math.exp(-dt * 9);
      cam.caz += (cam.faz - cam.caz) * k; cam.cel += (cam.fel - cam.cel) * k; cam.cd += (cam.fd - cam.cd) * k;
      placeCam(cam.caz, cam.cel, cam.cd, 1.0, 36);
      return;
    }
    let sh, t;
    if (!playingSong) { sh = SHOTS.attract; t = 0; sh = Object.assign({}, sh, { az: 24 + 10 * Math.sin(wall * 0.12) }); cam.lastShot = -1; }
    else {
      const sec = sectionAt(b);
      const local = sec.from < 0 ? Math.max(0, b) + 16 : b - sec.from; // the intro opens on its close-up from the very first frame
      const idx = Math.floor(local / 8);
      sh = SHOTS[sec.shots[idx % sec.shots.length]];
      t = sec.to > 9000 ? Math.min(1, local / 24) : fract(local / 8);
      const id = sec.from * 100 + idx;
      if (id !== cam.lastShot) cam.lastShot = id;
    }
    const az = sh.az + sh.dr * (t - 0.5), d = sh.d + sh.dd * t;
    placeCam(az, sh.el, d, sh.ty, sh.fov);
    cam.caz = az; cam.cel = sh.el; cam.cd = d;
  }


  // ============================================================ clock + audio (the track loops forever)
  const audio = document.getElementById('audio');
  audio.loop = true;
  const clock = { t: 0, playing: false, started: false, audioOK: false };
  const snd = { userMuted: false, none: false };
  // no music file next to the page (e.g. the online copy): dance in silence and hide the sound button
  const lastSrc = document.getElementById('lastSource');
  if (lastSrc) lastSrc.addEventListener('error', () => { snd.none = true; clock.audioOK = false; syncButtons(); });

  // ============================================================ frame
  const P = {}, Wt = {};
  function computePose(t, wall) {
    for (const k in DEF) P[k] = DEF[k];
    const b = toBeat(t + LOOKAHEAD);
    let label = null, move = null;
    if (!clock.started) mIntro(P, toBeat(LOOKAHEAD)); // the clip's opening pose, waiting for the guest
    else {
      const sec = sectionAt(b);
      sec.fn(P, sec.from < 0 ? b : b - sec.from, t); // intro counts from the song's first beat
      label = sec.label; move = sec.move;
    }
    return { b, label, move };
  }

  let minYLast = 0;
  function step(dt, t, wall, snap) {
    const info = computePose(t, wall);
    resolve(P, Wt);
    springStep(Wt, dt, snap);
    minYLast = applyPose(SX);
    return info;
  }


  // ============================================================ UI: sound + pause, tabs
  const $ = id => document.getElementById(id);
  const btnSound = $('btnSound'), btnPlay = $('btnPlay'), gate = $('gate'), gateOn = $('gateOn');
  const beatEls = Array.from(document.querySelectorAll('#beats i'));
  let DUR = 235.47;
  audio.addEventListener('loadedmetadata', () => { if (isFinite(audio.duration) && audio.duration > 10) DUR = audio.duration; });

  function syncButtons() {
    // before the first tap the sound counts as "on": it starts together with the dance
    const muted = snd.userMuted || (clock.started && (audio.muted || !clock.audioOK));
    const need = clock.started && clock.playing && (audio.muted || !clock.audioOK) && !snd.userMuted && !snd.none; // browser still holding the sound back
    btnSound.hidden = snd.none;
    btnSound.classList.toggle('need', need);
    btnSound.classList.toggle('off', muted && !need);
    btnSound.setAttribute('aria-pressed', String(!muted));
    btnSound.setAttribute('aria-label', muted ? 'Включить звук' : 'Выключить звук');
    btnSound.title = need ? 'Нажмите, чтобы включить звук' : muted ? 'Звук выключен' : 'Звук включён';
    btnPlay.classList.toggle('paused', !clock.playing);
    btnPlay.setAttribute('aria-label', clock.playing ? 'Пауза' : 'Дальше');
  }
  function tryPlay(withSound) {
    audio.muted = !withSound;
    let pr;
    try { pr = audio.play(); } catch (e) { pr = Promise.reject(e); }
    if (!pr || !pr.then) { clock.audioOK = true; syncButtons(); return; }
    pr.then(() => { clock.audioOK = true; syncButtons(); })
      .catch(() => {
        // browsers refuse sound before the first tap: keep dancing in silence until then
        if (withSound) tryPlay(false); else { clock.audioOK = false; syncButtons(); }
      });
  }
  function start(withSound) {
    clock.t = 0; clock.started = true; clock.playing = true;
    try { audio.currentTime = 0; } catch (e) { /* not loaded yet */ }
    tryPlay(withSound);
    syncButtons();
  }
  function pause() { // the robot freezes mid-move, the music holds
    clock.playing = false;
    audio.pause();
    syncButtons();
  }
  function resume() {
    if (!clock.started) { start(!snd.userMuted); return; }
    clock.playing = true;
    try { audio.currentTime = clock.t % DUR; } catch (e) { /* ignore */ }
    tryPlay(!snd.userMuted);
    syncButtons();
  }
  function soundOn() { // called from a tap, so the browser allows sound
    snd.userMuted = false;
    audio.muted = false;
    if (clock.playing && (audio.paused || !clock.audioOK)) {
      try { audio.currentTime = clock.t % DUR; } catch (e) { /* ignore */ }
      tryPlay(true);
    }
    syncButtons();
  }
  btnSound.addEventListener('click', () => {
    if (!clock.started) { snd.userMuted = !snd.userMuted; syncButtons(); return; }
    if (audio.muted || !clock.audioOK) soundOn();
    else { audio.muted = true; snd.userMuted = true; syncButtons(); }
  });
  btnPlay.addEventListener('click', () => { if (clock.playing) pause(); else resume(); });

  // track line with a tick at every part of the song; tap or drag to jump
  const tl = $('tl'), fillEl = $('fill'), headEl2 = $('playhead'), ticksEl = $('ticks');
  function buildTicks() {
    ticksEl.innerHTML = '';
    let last = null;
    for (const sec of SECTIONS) {
      if (sec.label !== last && sec.from > 0) {
        const t0 = OFFSET + sec.from * BEAT;
        if (t0 < DUR) { const d = document.createElement('i'); d.className = 'tick'; d.style.left = (t0 / DUR * 100) + '%'; ticksEl.appendChild(d); }
      }
      last = sec.label;
    }
  }
  buildTicks();
  audio.addEventListener('loadedmetadata', buildTicks);
  function seek(t) {
    t = Math.min(Math.max(t, 0), DUR - 0.05);
    clock.t = t;
    if (clock.audioOK || !audio.paused) { try { audio.currentTime = t; } catch (e) { /* ignore */ } }
  }
  let scrubbing = false;
  const tlTime = e => { const r = tl.getBoundingClientRect(); return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * DUR; };
  tl.addEventListener('pointerdown', e => { scrubbing = true; tl.setPointerCapture(e.pointerId); if (!clock.started) start(!snd.userMuted); seek(tlTime(e)); });
  tl.addEventListener('pointermove', e => { if (scrubbing) seek(tlTime(e)); });
  tl.addEventListener('pointerup', () => { scrubbing = false; });
  tl.addEventListener('keydown', e => { if (e.key === 'ArrowRight') seek(clock.t + 5); else if (e.key === 'ArrowLeft') seek(clock.t - 5); });
  // the first tap anywhere opens the invitation: dance + music start together (browsers allow sound only after a tap)
  // dark gate: nothing moves until the guest chooses; then the dark fades away and the dance starts
  function openGate(withSound) {
    snd.userMuted = !withSound;
    start(withSound);
    gate.classList.add('gone');
    document.body.classList.remove('pre'); document.body.classList.add('reveal');
    layout();
    setTimeout(() => { gate.hidden = true; }, 1600);
  }
  gateOn.addEventListener('click', () => openGate(true));
  document.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('.gbtn, .tbtn, .tl, .gate')) return;
    if (!clock.started) return;
    if (clock.playing && (audio.muted || !clock.audioOK) && !snd.userMuted && !snd.none) soundOn();
  }, true);
  window.addEventListener('keydown', e => {
    if (e.target && e.target.classList && e.target.classList.contains('tab') && (e.code === 'Space' || e.code === 'Enter')) return;
    if (e.code === 'Space') { e.preventDefault(); btnPlay.click(); }
    else if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') btnSound.click();
  });

  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panes = Array.from(document.querySelectorAll('.pane'));
  const content = $('content');
  function showTab(id, focus) {
    tabs.forEach(t => {
      const on = t.dataset.tab === id;
      t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    panes.forEach(p => { p.hidden = p.id !== 'pane-' + id; });
    content.scrollTop = 0;
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showTab(t.dataset.tab));
    t.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        showTab(n.dataset.tab, true);
      }
    });
  });
  showTab('schedule');

  // ============================================================ layout: frame the clip inside the free part of the screen
  const headEl = document.querySelector('.head'), panelEl = document.querySelector('.panel'), transportEl = $('transport'), dockEl = $('dock');
  function layout() {
    const W = stage.clientWidth, H = stage.clientHeight;
    renderer.setSize(W, H, false);
    const wide = window.matchMedia('(min-width: 900px) and (min-aspect-ratio: 11/10)').matches;
    const hb = headEl.getBoundingClientRect();
    document.documentElement.style.setProperty('--dockTop', Math.round(hb.bottom + 26) + 'px');
    const pb = panelEl.getBoundingClientRect();
    const tb = transportEl.getBoundingClientRect();
    let x0 = 0, y0 = hb.bottom + 4, x1 = W, y1 = tb.height > 0 ? tb.bottom + 6 : pb.top + pb.height * 0.8; // phone: the robot stands right above the track line
    if (wide) { // glass column on the left under the date: the robot dances to its right, standing just above the track
      x0 = pb.right + 16; x1 = W; y0 = 24; y1 = tb.top + tb.height * 0.6;
    }
    view.tx0 = x0; view.ty0 = y0; view.tx1 = x1; view.ty1 = y1; view.W = W; view.H = H;
    document.documentElement.style.setProperty('--sx', Math.round((x0 + x1) / 2) + 'px');
    if (!view.init) { view.x0 = x0; view.y0 = y0; view.x1 = x1; view.y1 = y1; view.init = true; }
    applyView();
  }
  // the framing glides to its target (robot moves into place when the UI slides in)
  const view = { init: false };
  function applyView() {
    const fw = Math.max(80, view.x1 - view.x0), fh = Math.max(80, view.y1 - view.y0);
    camera.aspect = fw / fh;
    camera.setViewOffset(fw, fh, -view.x0, -view.y0, view.W, view.H);
    camera.updateProjectionMatrix();
  }
  function glideView(dt) {
    const k = 1 - Math.exp(-dt * 3.2); let moved = false;
    for (const a of ['x0', 'y0', 'x1', 'y1']) {
      const d = view['t' + a] - view[a];
      if (Math.abs(d) > 0.3) { view[a] += d * k; moved = true; } else view[a] = view['t' + a];
    }
    if (moved) applyView();
  }
  window.addEventListener('resize', layout);
  if (window.ResizeObserver) { const ro = new ResizeObserver(layout); ro.observe(dockEl); ro.observe(headEl); }
  layout();

  // ============================================================ loop
  let lastWall = performance.now() / 1000, wallT = 0;
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0.001, now - lastWall)); lastWall = now; wallT += dt;
    if (clock.playing) {
      clock.t += dt;
      const at = audio.currentTime;
      if (clock.audioOK && !audio.paused && isFinite(at)) {
        const err = at - clock.t;
        if (Math.abs(err) > 0.12) clock.t = at; else clock.t += err * 0.08; // follows the track, loops with it
      }
      if (clock.t >= DUR) clock.t -= DUR;
    }
    glideView(dt);
    const info = step(dt, clock.t, wallT, false);
    J.chest.getWorldPosition(_chestW);
    key.target.position.set(_chestW.x, 0, _chestW.z);
    key.position.set(_chestW.x + 2.2, 7.5, _chestW.z + 3.2);
    blob.position.x = _chestW.x; blob.position.z = _chestW.z;
    // before the start the camera already holds the clip's first frame, so nothing moves when the guest taps
    updateCamera(dt, clock.started ? info.b : toBeat(LOOKAHEAD), true, wallT);
    const bi = clock.playing && info.b >= 0 ? mod(Math.floor(info.b), 4) : -1;
    beatEls.forEach((el, i) => el.classList.toggle('on', i === bi));
    const pct = Math.min(Math.max(clock.t / DUR, 0), 1) * 100;
    fillEl.style.width = pct + '%'; headEl2.style.left = pct + '%';
    renderer.render(scene, camera);
  }
  syncButtons(); // the robot waits in its A-pose until the invitation is opened
  frame();

  // ============================================================ test hooks (used for automated checks)
  window.ROBO = {
    SECTIONS, BEAT, OFFSET,
    // run the pose engine from t0 to t1 at fps without rendering; return quality stats
    simulate(t0, t1, fps) {
      clock.started = true; springInit = false;
      const dt = 1 / fps, out = { minY: Infinity, worstFloat: 0, worstFloatAt: 0, sinkAt: null, maxJointSpeed: 0, maxJointAt: 0, maxJoint: '', maxRootSpeed: 0, maxRootAt: 0, frames: 0 };
      const names = Object.keys(J).filter(n => n !== 'hips');
      const prev = {}; let prevRoot = null;
      const sole = { L: [], R: [] };
      for (let t = t0; t <= t1; t += dt) {
        step(dt, t, t, false);
        out.frames++;
        if (minYLast < out.minY) { out.minY = minYLast; out.sinkAt = t; }
        // planted-foot float: a foot whose target lift is 0 and heel 0 should touch the floor
        if (SX.fk < 0.02 && SX.floor < 0.02) {
          for (const S of ['L', 'R']) {
            if (Wt[S + 'y'] < 0.001 && Math.abs(SX[S + 'y']) < 0.002) {
              let m = Infinity;
              for (const c of contacts) if (c.g === LEG[S].ft) { _cw.copy(c.p).applyMatrix4(c.g.matrixWorld); m = Math.min(m, _cw.y); }
              if (m > out.worstFloat) { out.worstFloat = m; out.worstFloatAt = t; }
            }
          }
        }
        for (const n of names) {
          const q = J[n].quaternion;
          if (prev[n]) {
            const ang = 2 * Math.acos(Math.min(1, Math.abs(prev[n].dot(q)))) / D2R / dt;
            if (ang > out.maxJointSpeed) { out.maxJointSpeed = ang; out.maxJointAt = t; out.maxJoint = n; }
            prev[n].copy(q);
          } else prev[n] = q.clone();
        }
        const rp = root.position.clone();
        if (prevRoot) { const v = rp.distanceTo(prevRoot) / dt; if (v > out.maxRootSpeed) { out.maxRootSpeed = v; out.maxRootAt = t; } }
        prevRoot = rp;
      }
      return out;
    },
    // jump to time t (warming the springs over the previous 2 s) and render one frame with the clip camera
    renderAt(t, mode) {
      clock.started = true; clock.playing = false; springInit = false; clock.t = t;
      for (let x = Math.max(0, t - 2); x < t; x += 1 / 60) step(1 / 60, x, x, false);
      step(1 / 60, t, t, false);
      J.chest.getWorldPosition(_chestW);
      camTgtSpring.x = _chestW.x; camTgtSpring.z = _chestW.z; camTgtSpring.vx = camTgtSpring.vz = 0;
      key.target.position.set(_chestW.x, 0, _chestW.z); key.position.set(_chestW.x + 2.2, 7.5, _chestW.z + 3.2);
      blob.position.x = _chestW.x; blob.position.z = _chestW.z;
      audio.pause(); cam.mode = 'clip';
      updateCamera(1 / 60, toBeat(t), true, t);
      renderer.render(scene, camera);
      return { minY: minYLast };
    },
    pause() { clock.playing = false; },
  };
})();

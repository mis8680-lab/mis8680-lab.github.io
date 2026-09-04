(function () {
  "use strict";

  var IMAGE_URL = "assets/insu-stipple.png";
  var DESKTOP_FACE = 640;
  var PHONE_FACE = 360;
  var DESKTOP_W = 1280;
  var PHONE_W = 390;
  var MENU_NY = 0.46;
  var TARGET_PARTICLES = 16000;

  var canvas = document.getElementById("field");
  var menu = document.getElementById("site-nav");
  if (!canvas || typeof THREE === "undefined") return;

  var renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  var scene = new THREE.Scene();
  var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
  camera.position.z = 2;

  var points = null;
  var positions = null;
  var rest = null;
  var scatter = null;
  var vel = null;
  var imgPts = null;
  var ptStride = 3;
  var count = 0;
  var imgW = 1;
  var imgH = 1;
  var pointer = { x: 0, y: 0, active: false, over: false };
  var look = { x: 0, y: 0, tracking: false };
  var menuOn = false;
  var openAmt = 0;
  var suppressHoverOpen = false;
  var fieldClicks = 0;
  var hoverOrigin = null;
  var hoverReady = false;
  var legoOn = false;
  var lookYaw = 0;
  var lookPitch = 0;
  var LOOK_YAW_MAX = 0.38;
  var LOOK_PITCH_MAX = 0.26;
  var LOOK_DEPTH = 170;
  var LOOK_TARGET_Z = 2;
  var mouseNDC = new THREE.Vector2();
  var lookRay = new THREE.Raycaster();
  var lookPlane = new THREE.Plane();
  var lookHit = new THREE.Vector3();
  var lookTarget = new THREE.Vector3(0, 0, LOOK_TARGET_Z);
  var FACE_CX = 0.5;
  var FACE_CY = 0.35;
  var FACE_RX = 0.20;
  var FACE_RY = 0.28;
  var NECK_CY = 0.52;
  var NECK_RX = 0.12;
  var NECK_RY = 0.10;
  var studTex = null;
  var colors = null;
  var sizes = null;
  var baseDepth = null;
  var headW = null;
  var neckY = 0;
  var pointMat = null;
  var legoMat = null;
  var BRICK_RGB = [
    [0.79, 0.1, 0.11],
    [0.95, 0.8, 0.12],
    [0.0, 0.34, 0.75],
    [0.14, 0.55, 0.2],
    [0.96, 0.48, 0.12],
    [1, 1, 1],
  ];

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function layout() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var t = clamp((w - PHONE_W) / (DESKTOP_W - PHONE_W), 0, 1);
    var faceH = PHONE_FACE + t * (DESKTOP_FACE - PHONE_FACE);
    if (w >= 900) faceH = DESKTOP_FACE * clamp(h / 800, 0.88, 1.12);
    var holeScale = faceH / DESKTOP_FACE;
    return {
      w: w,
      h: h,
      scale: faceH / imgH,
      yLift: h * 0.035,
      menuX: 0,
      menuY: (0.5 - MENU_NY) * h,
      mouseR: 88 * holeScale,
      mouseForce: 16 * holeScale,
    };
  }

  function applyCamera(L) {
    camera.left = -L.w / 2;
    camera.right = L.w / 2;
    camera.top = L.h / 2;
    camera.bottom = -L.h / 2;
    camera.near = -2000;
    camera.far = 2000;
    camera.updateProjectionMatrix();
    renderer.setSize(L.w, L.h, false);
  }

  function worldFromEvent(ev) {
    var L = layout();
    return { x: ev.clientX - L.w / 2, y: L.h / 2 - ev.clientY };
  }

  function setPointer(ev, down) {
    var p = worldFromEvent(ev);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.over = true;
    if (down === true) pointer.active = true;
    if (down === false) pointer.active = false;
  }

  function sampleImage(img) {
    var maxDim = 900;
    var s = Math.min(1, maxDim / Math.max(img.width, img.height));
    var w = Math.max(1, Math.round(img.width * s));
    var h = Math.max(1, Math.round(img.height * s));
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h).data;
    var occ = new Uint8Array(w * h);
    var hits = [];
    var i, x, y, lum, idx;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = (y * w + x) * 4;
        if (data[i + 3] < 20) continue;
        lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        if (lum > 42) {
          occ[y * w + x] = 1;
          hits.push(x, y, lum);
        }
      }
    }
    function edgeDist(px, py) {
      var r, a, sx, sy, steps, k;
      if (!occ[py * w + px]) return 0;
      for (r = 1; r <= 64; r += 1) {
        steps = Math.max(8, r * 4);
        for (k = 0; k < steps; k++) {
          a = (k / steps) * Math.PI * 2;
          sx = (px + Math.cos(a) * r + 0.5) | 0;
          sy = (py + Math.sin(a) * r + 0.5) | 0;
          if (sx < 0 || sy < 0 || sx >= w || sy >= h || !occ[sy * w + sx]) return r;
        }
      }
      return 64;
    }
    var n = hits.length / 3;
    var keep = Math.min(TARGET_PARTICLES, n);
    var chosen = [];
    var step = n / keep;
    var acc = 0;
    var maxEdge = 1;
    var edges = [];
    if (n <= keep) {
      for (i = 0; i < n; i++) {
        edges.push(edgeDist(hits[i * 3], hits[i * 3 + 1]));
        if (edges[i] > maxEdge) maxEdge = edges[i];
      }
      for (i = 0; i < n; i++) {
        chosen.push(hits[i * 3], hits[i * 3 + 1], hits[i * 3 + 2], edges[i] / maxEdge);
      }
      return { pts: chosen, w: w, h: h, stride: 4 };
    }
    for (i = 0; i < n && chosen.length / 4 < keep; i++) {
      acc += 1;
      if (acc >= step) {
        acc -= step;
        var ed = edgeDist(hits[i * 3], hits[i * 3 + 1]);
        if (ed > maxEdge) maxEdge = ed;
        chosen.push(hits[i * 3], hits[i * 3 + 1], hits[i * 3 + 2], ed);
      }
    }
    for (i = 3; i < chosen.length; i += 4) {
      chosen[i] = chosen[i] / maxEdge;
    }
    return { pts: chosen, w: w, h: h, stride: 4 };
  }

  function syncRest(L) {
    var i, px, py, fx, fy, r2, ellip, lum, amp, ny, w, face, neck, edge, stride, o;
    stride = ptStride || 3;
    amp = LOOK_DEPTH * L.scale;
    neckY = (imgH / 2 - imgH * FACE_CY - imgH * FACE_RY * 0.55) * L.scale + L.yLift;
    for (i = 0; i < count; i++) {
      o = i * stride;
      px = imgPts[o];
      py = imgPts[o + 1];
      lum = imgPts[o + 2];
      edge = stride >= 4 ? imgPts[o + 3] : 0.5;
      /* slight jitter breaks scanline rows */
      rest[i * 2] = (px - imgW / 2) * L.scale + (hash01(i, 1.7) - 0.5) * 0.55 * L.scale;
      rest[i * 2 + 1] = (imgH / 2 - py) * L.scale + L.yLift + (hash01(i, 9.1) - 0.5) * 0.45 * L.scale;
      ny = py / imgH;
      fx = (px / imgW - FACE_CX) / FACE_RX;
      fy = (ny - FACE_CY) / FACE_RY;
      r2 = fx * fx + fy * fy;
      face = 1 - smoothstep(0.78, 1.12, Math.sqrt(Math.max(0, r2)));
      fx = (px / imgW - FACE_CX) / NECK_RX;
      fy = (ny - NECK_CY) / NECK_RY;
      r2 = fx * fx + fy * fy;
      neck = (1 - smoothstep(0.65, 1.15, Math.sqrt(Math.max(0, r2)))) *
        smoothstep(0.40, 0.48, ny) *
        (1 - smoothstep(0.56, 0.68, ny));
      w = Math.min(1, face * 1.0 + neck * 0.5);
      if (w < 0.04) w = 0;
      headW[i] = w;
      /* Half-ellipsoid volume (ref-like thickness) + silhouette inflate + lum relief */
      fx = (px - imgW / 2) / (imgW * 0.36);
      fy = (py - imgH * 0.40) / (imgH * 0.46);
      r2 = fx * fx + fy * fy;
      ellip = Math.sqrt(Math.max(0, 1 - r2));
      baseDepth[i] = (ellip * 0.72 + edge * 0.38 + (lum / 255 - 0.35) * 0.22) * amp;
      if (baseDepth[i] < 0) baseDepth[i] = 0;
    }
    buildScatter(L);
  }

  function hash01(i, salt) {
    var x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453123;
    return x - Math.floor(x);
  }

  function buildScatter(L) {
    var i, sx, sy, rx, ry;
    for (i = 0; i < count; i++) {
      rx = rest[i * 2];
      ry = rest[i * 2 + 1];
      sx = rx + (hash01(i, 1) - 0.5) * L.w * 2.2;
      sy = ry + (hash01(i, 2) - 0.5) * L.h * 2.2;
      if (Math.abs(sx - L.menuX) < 100 && Math.abs(sy - L.menuY) < 120) {
        sx += (hash01(i, 3) < 0.5 ? -1 : 1) * (140 + hash01(i, 4) * 280);
        sy += (hash01(i, 5) - 0.5) * 320;
      }
      scatter[i * 2] = sx;
      scatter[i * 2 + 1] = sy;
    }
  }

  function setMenu(open) {
    /* Top-right nav stays visible; open only drives particle scatter. */
    if (!menu) return;
  }

  function openMenu() {
    /* Scatter disabled — top nav is always available. */
    menuOn = false;
  }

  function closeMenu() {
    menuOn = false;
    suppressHoverOpen = true;
  }

  function isMenuLink(el) {
    return !!(el && el.closest && el.closest(".site-nav a"));
  }

  function makeStudTexture() {
    var s = 64;
    var c = document.createElement("canvas");
    c.width = s;
    c.height = s;
    var g = c.getContext("2d");
    g.clearRect(0, 0, s, s);
    g.fillStyle = "#b4b4b4";
    g.beginPath();
    if (g.roundRect) g.roundRect(3, 3, 58, 58, 7);
    else g.rect(3, 3, 58, 58);
    g.fill();
    g.fillStyle = "#7a7a7a";
    g.beginPath();
    g.arc(32, 37, 15, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(32, 30, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.beginPath();
    g.arc(27, 26, 4.5, 0, Math.PI * 2);
    g.fill();
    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function applyLegoMode() {
    if (!points) return;
    var i, brick;
    if (legoOn) {
      if (!studTex) studTex = makeStudTexture();
      if (!legoMat) {
        legoMat = new THREE.PointsMaterial({
          map: studTex,
          size: 7,
          sizeAttenuation: false,
          transparent: true,
          alphaTest: 0.12,
          depthWrite: false,
          vertexColors: true,
        });
      }
      for (i = 0; i < count; i++) {
        brick = BRICK_RGB[i % BRICK_RGB.length];
        colors[i * 3] = brick[0];
        colors[i * 3 + 1] = brick[1];
        colors[i * 3 + 2] = brick[2];
      }
      points.geometry.attributes.color.needsUpdate = true;
      points.material = legoMat;
    } else {
      if (!pointMat) pointMat = makePointMaterial();
      points.material = pointMat;
    }
  }

  function setLookFromEvent(ev) {
    /* Wael pattern: NDC → Raycaster → camera-facing Plane; look Z fixed */
    mouseNDC.x = (ev.clientX / window.innerWidth) * 2 - 1;
    mouseNDC.y = -(ev.clientY / window.innerHeight) * 2 + 1;
    lookPlane.normal.copy(camera.position).normalize();
    lookPlane.constant = 0;
    lookRay.setFromCamera(mouseNDC, camera);
    if (lookRay.ray.intersectPlane(lookPlane, lookHit)) {
      lookTarget.set(lookHit.x, lookHit.y, LOOK_TARGET_Z);
      look.x = lookHit.x;
      look.y = lookHit.y;
      look.tracking = true;
    }
  }

  function lookTargets(L) {
    /* look-at HOLDED per Insu — front volumetric only */
    return { yaw: 0, pitch: 0 };
    if (!look.tracking) return { yaw: 0, pitch: 0 };
    /* yaw/pitch from neck pivot toward look target (fixed Z) */
    var dx = lookTarget.x - 0;
    var dy = lookTarget.y - neckY;
    var dz = LOOK_TARGET_Z;
    var yaw = Math.atan2(dx, Math.max(0.001, dz));
    var pitch = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    yaw = clamp(yaw, -LOOK_YAW_MAX, LOOK_YAW_MAX);
    pitch = clamp(pitch, -LOOK_PITCH_MAX, LOOK_PITCH_MAX);
    return { yaw: yaw, pitch: pitch };
  }

  function rotateHead(rx, ry, depth, yaw, pitch, pivotY) {
    var x = rx;
    var y = ry - pivotY;
    var z = depth;
    var cosY = Math.cos(yaw);
    var sinY = Math.sin(yaw);
    var cosX = Math.cos(pitch);
    var sinX = Math.sin(pitch);
    var x1 = x * cosY + z * sinY;
    var z1 = -x * sinY + z * cosY;
    var y1 = y * cosX - z1 * sinX;
    var z2 = y * sinX + z1 * cosX;
    return { x: x1, y: y1 + pivotY, z: z2 };
  }

  function makePointMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {},
      vertexShader: [
        "attribute float aSize;",
        "attribute vec3 color;",
        "varying vec3 vColor;",
        "void main() {",
        "  vColor = color;",
        "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "  gl_PointSize = max(1.0, aSize);",
        "  gl_Position = projectionMatrix * mv;",
        "}"
      ].join("\n"),
      fragmentShader: [
        "varying vec3 vColor;",
        "void main() {",
        "  vec2 c = gl_PointCoord - vec2(0.5);",
        "  float d = dot(c, c);",
        "  if (d > 0.25) discard;",
        "  float soft = 1.0 - smoothstep(0.08, 0.25, d);",
        "  gl_FragColor = vec4(vColor, soft);",
        "}"
      ].join("\n"),
    });
  }

  function step() {
    var L = layout();
    openAmt += ((menuOn ? 1 : 0) - openAmt) * 0.12;

    var i, x, y, tx, ty, rx, ry, rz, depth, rot, zN, b, idle, w;
    var t = performance.now() * 0.001;
    var spring = 0.09;
    var damp = 0.8;
    var want = lookTargets(L);
    lookYaw += (want.yaw - lookYaw) * 0.08;
    lookPitch += (want.pitch - lookPitch) * 0.08;
    var amp = Math.max(1, LOOK_DEPTH * L.scale);

    for (i = 0; i < count; i++) {
      x = positions[i * 3];
      y = positions[i * 3 + 1];
      depth = baseDepth[i];
      w = headW[i];
      /* look-at HOLDED — front volumetric rest pose only */
      rx = rest[i * 2];
      ry = rest[i * 2 + 1];
      rz = depth;
      tx = rx + (scatter[i * 2] - rest[i * 2]) * openAmt;
      ty = ry + (scatter[i * 2 + 1] - rest[i * 2 + 1]) * openAmt;
      idle = 1 - openAmt;
      if (idle > 0.02) {
        tx += Math.sin(t * 1.15 + i * 2.17) * 0.4 * idle;
        ty += Math.cos(t * 0.97 + i * 1.73) * 0.32 * idle;
      }

      vel[i * 2] += (tx - x) * spring;
      vel[i * 2 + 1] += (ty - y) * spring;
      vel[i * 2] *= damp;
      vel[i * 2 + 1] *= damp;
      positions[i * 3] = x + vel[i * 2];
      positions[i * 3 + 1] = y + vel[i * 2 + 1];
      positions[i * 3 + 2] = rz;

      zN = clamp(rz / Math.max(1, amp), 0, 1);
      zN = Math.pow(zN, 0.85);
      sizes[i] = 1.15 + zN * 6.2;
      if (!legoOn) {
        b = 0.2 + zN * 0.8;
        colors[i * 3] = b;
        colors[i * 3 + 1] = Math.min(1, b * 1.04);
        colors[i * 3 + 2] = Math.min(1, b * 1.1);
      }
    }

    points.geometry.attributes.position.needsUpdate = true;
    points.geometry.attributes.aSize.needsUpdate = true;
    if (!legoOn) points.geometry.attributes.color.needsUpdate = true;
    renderer.render(scene, camera);
    requestAnimationFrame(step);
  }

  function onResize() {
    var L = layout();
    applyCamera(L);
    syncRest(L);
  }

  function bind() {
    window.addEventListener("pointermove", function (ev) {
      setLookFromEvent(ev);
      var p = worldFromEvent(ev);
      if (!hoverOrigin) {
        hoverOrigin = p;
        return;
      }
      if (!hoverReady) {
        if (Math.hypot(p.x - hoverOrigin.x, p.y - hoverOrigin.y) < 4) return;
        hoverReady = true;
      }
      setPointer(ev);
    });
    window.addEventListener("pointerdown", function (ev) {
      setLookFromEvent(ev);
      setPointer(ev, true);
      if (isMenuLink(ev.target) || (ev.target && ev.target.closest && (ev.target.closest(".wordmark") || ev.target.closest(".nav-toggle") || ev.target.closest(".site-nav")))) return;
      fieldClicks += 1;
      if (fieldClicks % 5 === 0) {
        legoOn = !legoOn;
        applyLegoMode();
      }
      /* No click/tap scatter — look-at + idle shimmer + Lego only. */
    });
    window.addEventListener("pointerup", function (ev) {
      setPointer(ev, false);
      if (ev.pointerType === "touch" || ev.pointerType === "pen") {
        look.tracking = false;
      }
    });
    window.addEventListener("pointercancel", function () {
      pointer.over = false;
      pointer.active = false;
      look.tracking = false;
    });
    window.addEventListener("pointerleave", function () {
      pointer.over = false;
      pointer.active = false;
      look.tracking = false;
      suppressHoverOpen = false;
      hoverOrigin = null;
      hoverReady = false;
    });
    window.addEventListener("blur", function () {
      pointer.over = false;
      pointer.active = false;
      look.tracking = false;
    });
    window.addEventListener("resize", onResize);
    if (menu) {
      menu.addEventListener("pointerdown", function (ev) {
        ev.stopPropagation();
      });
    }
  }

  function start(sample) {
    imgPts = sample.pts;
    imgW = sample.w;
    imgH = sample.h;
    ptStride = sample.stride || 3;
    count = imgPts.length / ptStride;
    rest = new Float32Array(count * 2);
    scatter = new Float32Array(count * 2);
    vel = new Float32Array(count * 2);
    positions = new Float32Array(count * 3);
    sizes = new Float32Array(count);
    baseDepth = new Float32Array(count);
    headW = new Float32Array(count);
    colors = new Float32Array(count * 3);
    var L = layout();
    applyCamera(L);
    syncRest(L);
    var i;
    for (i = 0; i < count; i++) {
      positions[i * 3] = rest[i * 2];
      positions[i * 3 + 1] = rest[i * 2 + 1];
      positions[i * 3 + 2] = baseDepth[i];
      sizes[i] = 2.6;
      colors[i * 3] = 0.9;
      colors[i * 3 + 1] = 0.92;
      colors[i * 3 + 2] = 0.98;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    pointMat = makePointMaterial();
    points = new THREE.Points(geo, pointMat);
    scene.add(points);
    bind();
    requestAnimationFrame(step);
  }

  var img = new Image();
  img.onload = function () {
    start(sampleImage(img));
  };
  img.onerror = function () {
    console.error("Missing particle source:", IMAGE_URL);
  };
  img.src = IMAGE_URL;
})();

(function () {
  "use strict";

  var IMAGE_URL = "assets/insu-stipple.png";
  var DESKTOP_FACE = 640;
  var PHONE_FACE = 360;
  var DESKTOP_W = 1280;
  var PHONE_W = 390;
  var MENU_NY = 0.46;
  var TARGET_PARTICLES = 14500;
  var FIELD_PARTICLES = 980;

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
  var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;

  var points = null;
  var positions = null;
  var rest = null;
  var scatter = null;
  var vel = null;
  var imgPts = null;
  var imgEdge = null;
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
  var LOOK_YAW_MAX = 0.28;
  var LOOK_PITCH_MAX = 0.2;
  var LOOK_DEPTH = 42;
  var studTex = null;
  var colors = null;
  var sizes = null;
  var glowColors = null;
  var glowMat = null;
  var legoMat = null;
  var field = null;
  var fieldPos = null;
  var fieldBase = null;
  var fieldSizes = null;
  var fieldColors = null;
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

  function takeStride4(src, n, keep, outPts, outEdge) {
    var i, acc, step;
    if (n <= keep) {
      for (i = 0; i < n; i++) {
        outPts.push(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
        outEdge.push(src[i * 4 + 3]);
      }
      return;
    }
    step = n / keep;
    acc = 0;
    for (i = 0; i < n && outPts.length / 3 < keep; i++) {
      acc += 1;
      if (acc >= step) {
        acc -= step;
        outPts.push(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
        outEdge.push(src[i * 4 + 3]);
      }
    }
  }

  function sampleImage(img) {
    var maxDim = 820;
    var s = Math.min(1, maxDim / Math.max(img.width, img.height));
    var w = Math.max(1, Math.round(img.width * s));
    var h = Math.max(1, Math.round(img.height * s));
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h).data;
    var lumMap = new Float32Array(w * h);
    var i, x, y, lum, p, minN, edge;
    for (i = 0; i < w * h; i++) {
      if (data[i * 4 + 3] < 20) lumMap[i] = 0;
      else lumMap[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    }
    var edges = [];
    var fills = [];
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        p = y * w + x;
        lum = lumMap[p];
        if (lum <= 12) continue;
        minN = lum;
        if (x > 0) minN = Math.min(minN, lumMap[p - 1]);
        else minN = 0;
        if (x < w - 1) minN = Math.min(minN, lumMap[p + 1]);
        else minN = 0;
        if (y > 0) minN = Math.min(minN, lumMap[p - w]);
        else minN = 0;
        if (y < h - 1) minN = Math.min(minN, lumMap[p + w]);
        else minN = 0;
        edge = lum - minN;
        if (edge > 16 && lum > 16) edges.push(x, y, lum, edge);
        else if (lum > 42) fills.push(x, y, lum, edge);
      }
    }
    var edgeN = edges.length / 4;
    var fillN = fills.length / 4;
    var edgeKeep = Math.min(edgeN, Math.round(TARGET_PARTICLES * 0.42));
    var fillKeep = Math.min(fillN, TARGET_PARTICLES - edgeKeep);
    var chosen = [];
    var chosenEdge = [];
    takeStride4(edges, edgeN, edgeKeep, chosen, chosenEdge);
    takeStride4(fills, fillN, fillKeep, chosen, chosenEdge);
    return { pts: chosen, edges: chosenEdge, w: w, h: h };
  }

  function syncRest(L) {
    var i, px, py;
    for (i = 0; i < count; i++) {
      px = imgPts[i * 3];
      py = imgPts[i * 3 + 1];
      rest[i * 2] = (px - imgW / 2) * L.scale;
      rest[i * 2 + 1] = (imgH / 2 - py) * L.scale + L.yLift;
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

  function glowTint(lum, edge) {
    var e = clamp(edge / 72, 0, 1);
    var l = clamp(lum / 255, 0, 1);
    var w = clamp(e * 0.82 + l * 0.18, 0, 1);
    return [0.16 + w * 0.78, 0.74 + w * 0.24, 0.9 + w * 0.1];
  }

  function glowSize(lum, edge, L) {
    var e = clamp(edge / 72, 0, 1);
    var px = 3.35 + e * 3.55 + clamp(lum / 255, 0, 1) * 0.55;
    if (L.w >= 900) px *= 1.12;
    return px;
  }

  function syncSizes(L) {
    if (!sizes || !imgPts) return;
    var i, lum, edge;
    for (i = 0; i < count; i++) {
      lum = imgPts[i * 3 + 2];
      edge = imgEdge ? imgEdge[i] : 0;
      sizes[i] = glowSize(lum, edge, L);
    }
    if (points && points.geometry.attributes.aSize) {
      points.geometry.attributes.aSize.needsUpdate = true;
    }
  }

  function syncField(L) {
    var i, n;
    if (!fieldBase) return;
    n = FIELD_PARTICLES;
    for (i = 0; i < n; i++) {
      fieldPos[i * 3] = fieldBase[i * 2] * L.w * 1.08;
      fieldPos[i * 3 + 1] = fieldBase[i * 2 + 1] * L.h * 1.08;
      fieldPos[i * 3 + 2] = 0;
    }
    if (field) field.geometry.attributes.position.needsUpdate = true;
  }

  function makeGlowMaterial() {
    return new THREE.ShaderMaterial({
      vertexShader: [
        "attribute float aSize;",
        "attribute vec3 aColor;",
        "varying vec3 vColor;",
        "void main() {",
        "  vColor = aColor;",
        "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
        "  gl_Position = projectionMatrix * mvPosition;",
        "  gl_PointSize = aSize;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "varying vec3 vColor;",
        "void main() {",
        "  vec2 uv = gl_PointCoord - vec2(0.5);",
        "  float d = length(uv) * 2.0;",
        "  float core = exp(-d * d * 5.2);",
        "  float bloom = exp(-d * d * 1.35) * 0.58;",
        "  float glow = core + bloom;",
        "  if (glow < 0.018) discard;",
        "  gl_FragColor = vec4(vColor * glow, glow);",
        "}",
      ].join("\n"),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
  }

  function makeField(L) {
    var n = FIELD_PARTICLES;
    var i, b;
    fieldPos = new Float32Array(n * 3);
    fieldBase = new Float32Array(n * 2);
    fieldSizes = new Float32Array(n);
    fieldColors = new Float32Array(n * 3);
    for (i = 0; i < n; i++) {
      fieldBase[i * 2] = hash01(i, 31) - 0.5;
      fieldBase[i * 2 + 1] = hash01(i, 32) - 0.5;
      b = 0.1 + hash01(i, 33) * 0.2;
      fieldColors[i * 3] = 0.2 + b * 0.15;
      fieldColors[i * 3 + 1] = 0.55 + b * 0.35;
      fieldColors[i * 3 + 2] = 0.62 + b * 0.32;
      fieldSizes[i] = 1.2 + hash01(i, 34) * 2.15;
    }
    syncField(L);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(fieldPos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(fieldSizes, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(fieldColors, 3));
    field = new THREE.Points(geo, glowMat);
    scene.add(field);
  }

  function setMenu(open) {
    /* Top-right nav stays visible; open only drives particle scatter. */
    if (!menu) return;
  }

  function openMenu() {
    menuOn = true;
    if (menu) menu.style.pointerEvents = "none";
    setMenu(true);
    setTimeout(function () {
      if (menuOn && menu) menu.style.pointerEvents = "auto";
    }, 320);
  }

  function closeMenu() {
    menuOn = false;
    setMenu(false);
    suppressHoverOpen = true;
    if (menu) menu.style.pointerEvents = "";
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
    if (!points || !legoMat || !glowMat) return;
    if (legoOn) {
      if (!studTex) studTex = makeStudTexture();
      legoMat.map = studTex;
      legoMat.vertexColors = true;
      legoMat.size = 7;
      legoMat.transparent = true;
      legoMat.alphaTest = 0.12;
      legoMat.needsUpdate = true;
      points.material = legoMat;
    } else {
      points.material = glowMat;
    }
  }

  function setLookFromEvent(ev) {
    var p = worldFromEvent(ev);
    look.x = p.x;
    look.y = p.y;
    look.tracking = true;
  }

  function lookTargets(L) {
    if (!look.tracking) return { yaw: 0, pitch: 0 };
    var nx = clamp(look.x / (L.w * 0.42), -1, 1);
    var ny = clamp(look.y / (L.h * 0.42), -1, 1);
    return { yaw: nx * LOOK_YAW_MAX, pitch: ny * LOOK_PITCH_MAX };
  }

  function rotateRest(rx, ry, depth, yaw, pitch, cy) {
    var x = rx;
    var y = ry - cy;
    var z = depth;
    var cosY = Math.cos(yaw);
    var sinY = Math.sin(yaw);
    var cosX = Math.cos(pitch);
    var sinX = Math.sin(pitch);
    var x1 = x * cosY + z * sinY;
    var z1 = -x * sinY + z * cosY;
    var y1 = y * cosX - z1 * sinX;
    return { x: x1, y: y1 + cy };
  }

  function step() {
    var L = layout();
    openAmt += ((menuOn ? 1 : 0) - openAmt) * 0.12;

    var i, x, y, tx, ty, rx, ry, depth, rot;
    var t = performance.now() * 0.001;
    var spring = menuOn ? 0.075 : 0.09;
    var damp = 0.8;
    var want = lookTargets(L);
    lookYaw += (want.yaw - lookYaw) * 0.08;
    lookPitch += (want.pitch - lookPitch) * 0.08;
    var faceCy = L.yLift;
    var depthScale = LOOK_DEPTH * L.scale;

    for (i = 0; i < count; i++) {
      x = positions[i * 3];
      y = positions[i * 3 + 1];
      depth = (imgPts[i * 3 + 2] / 255 - 0.42) * depthScale;
      rot = rotateRest(rest[i * 2], rest[i * 2 + 1], depth, lookYaw, lookPitch, faceCy);
      rx = rot.x;
      ry = rot.y;
      tx = rx + (scatter[i * 2] - rest[i * 2]) * openAmt;
      ty = ry + (scatter[i * 2 + 1] - rest[i * 2 + 1]) * openAmt;
      if (openAmt < 0.98) {
        var idle = 1 - openAmt;
        tx += Math.sin(t * 1.15 + i * 2.17) * 0.55 * idle;
        ty += Math.cos(t * 0.97 + i * 1.73) * 0.45 * idle;
      }

      vel[i * 2] += (tx - x) * spring;
      vel[i * 2 + 1] += (ty - y) * spring;

      vel[i * 2] *= damp;
      vel[i * 2 + 1] *= damp;
      positions[i * 3] = x + vel[i * 2];
      positions[i * 3 + 1] = y + vel[i * 2 + 1];
    }

    points.geometry.attributes.position.needsUpdate = true;

    if (fieldPos) {
      var n = FIELD_PARTICLES;
      for (i = 0; i < n; i++) {
        fieldPos[i * 3] = fieldBase[i * 2] * L.w * 1.08 + Math.sin(t * 0.18 + i * 0.31) * 2.2;
        fieldPos[i * 3 + 1] = fieldBase[i * 2 + 1] * L.h * 1.08 + Math.cos(t * 0.14 + i * 0.27) * 1.8;
      }
      field.geometry.attributes.position.needsUpdate = true;
    }

    renderer.render(scene, camera);
    requestAnimationFrame(step);
  }

  function onResize() {
    var L = layout();
    applyCamera(L);
    syncRest(L);
    syncSizes(L);
    syncField(L);
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
      if (menuOn) {
        closeMenu();
      } else {
        openMenu();
      }
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
    imgEdge = sample.edges;
    imgW = sample.w;
    imgH = sample.h;
    count = imgPts.length / 3;
    rest = new Float32Array(count * 2);
    scatter = new Float32Array(count * 2);
    vel = new Float32Array(count * 2);
    positions = new Float32Array(count * 3);
    var L = layout();
    applyCamera(L);
    syncRest(L);
    var i;
    for (i = 0; i < count; i++) {
      positions[i * 3] = rest[i * 2];
      positions[i * 3 + 1] = rest[i * 2 + 1];
      positions[i * 3 + 2] = 0;
    }
    colors = new Float32Array(count * 3);
    glowColors = new Float32Array(count * 3);
    sizes = new Float32Array(count);
    var brick, tint, lum, edge;
    for (i = 0; i < count; i++) {
      brick = BRICK_RGB[i % BRICK_RGB.length];
      colors[i * 3] = brick[0];
      colors[i * 3 + 1] = brick[1];
      colors[i * 3 + 2] = brick[2];
      lum = imgPts[i * 3 + 2];
      edge = imgEdge ? imgEdge[i] : 0;
      tint = glowTint(lum, edge);
      glowColors[i * 3] = tint[0];
      glowColors[i * 3 + 1] = tint[1];
      glowColors[i * 3 + 2] = tint[2];
    }
    syncSizes(L);
    glowMat = makeGlowMaterial();
    legoMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 7,
      sizeAttenuation: false,
      depthWrite: false,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.12,
    });
    makeField(L);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(glowColors, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    points = new THREE.Points(geo, glowMat);
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

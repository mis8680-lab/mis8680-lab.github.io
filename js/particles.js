(function () {
  "use strict";

  var IMAGE_URL = "assets/insu-stipple.png";
  var DESKTOP_FACE = 640;
  var PHONE_FACE = 360;
  var DESKTOP_W = 1280;
  var PHONE_W = 390;
  var MENU_NY = 0.46;
  var TARGET_PARTICLES = 11000;

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
  var count = 0;
  var imgW = 1;
  var imgH = 1;
  var pointer = { x: 0, y: 0, active: false, over: false };
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
    var hits = [];
    var i, x, y, lum;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = (y * w + x) * 4;
        if (data[i + 3] < 20) continue;
        lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        if (lum > 42) hits.push(x, y, lum);
      }
    }
    var n = hits.length / 3;
    var keep = Math.min(TARGET_PARTICLES, n);
    var chosen = [];
    if (n <= keep) return { pts: hits, w: w, h: h };
    var step = n / keep;
    var acc = 0;
    for (i = 0; i < n && chosen.length / 3 < keep; i++) {
      acc += 1;
      if (acc >= step) {
        acc -= step;
        chosen.push(hits[i * 3], hits[i * 3 + 1], hits[i * 3 + 2]);
      }
    }
    return { pts: chosen, w: w, h: h };
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
    if (!points) return;
    var mat = points.material;
    if (legoOn) {
      if (!studTex) studTex = makeStudTexture();
      mat.map = studTex;
      mat.vertexColors = true;
      mat.size = 7;
      mat.transparent = true;
      mat.alphaTest = 0.12;
    } else {
      mat.map = null;
      mat.vertexColors = false;
      mat.size = 2.4;
      mat.transparent = false;
      mat.alphaTest = 0;
    }
    mat.needsUpdate = true;
  }

  function lookTargets(L) {
    if (!pointer.over) return { yaw: 0, pitch: 0 };
    var nx = clamp(pointer.x / (L.w * 0.42), -1, 1);
    var ny = clamp(pointer.y / (L.h * 0.42), -1, 1);
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

    var i, x, y, tx, ty, dx, dy, d, f, inv, rx, ry, depth, rot;
    var t = performance.now() * 0.001;
    var spring = menuOn ? 0.075 : 0.09;
    var damp = 0.8;
    var mouseOn = pointer.over || pointer.active;
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

      if (mouseOn) {
        dx = x - pointer.x;
        dy = y - pointer.y;
        d = Math.hypot(dx, dy);
        if (d < L.mouseR && d > 0.05) {
          f = (1 - d / L.mouseR) * L.mouseForce;
          inv = 1 / d;
          vel[i * 2] += dx * inv * f;
          vel[i * 2 + 1] += dy * inv * f;
        }
      }

      vel[i * 2] *= damp;
      vel[i * 2 + 1] *= damp;
      positions[i * 3] = x + vel[i * 2];
      positions[i * 3 + 1] = y + vel[i * 2 + 1];
    }

    points.geometry.attributes.position.needsUpdate = true;
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
      setPointer(ev, true);
      if (isMenuLink(ev.target)) return;
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
    });
    window.addEventListener("pointerleave", function () {
      pointer.over = false;
      pointer.active = false;
      suppressHoverOpen = false;
      hoverOrigin = null;
      hoverReady = false;
    });
    window.addEventListener("blur", function () {
      pointer.over = false;
      pointer.active = false;
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
    var i, brick;
    for (i = 0; i < count; i++) {
      brick = BRICK_RGB[i % BRICK_RGB.length];
      colors[i * 3] = brick[0];
      colors[i * 3 + 1] = brick[1];
      colors[i * 3 + 2] = brick[2];
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2.4,
      sizeAttenuation: false,
      depthWrite: false,
      vertexColors: false,
    });
    points = new THREE.Points(geo, mat);
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

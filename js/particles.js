(function () {
  "use strict";

  var IMAGE_URL = "assets/insu-stipple.png";
  var DESKTOP_FACE = 640;
  var PHONE_FACE = 360;
  var DESKTOP_W = 1280;
  var PHONE_W = 390;
  var HOLE_NY = 0.46;
  var HOLE_RADIUS = 186;
  var HOLE_PUSH = 152;
  var TARGET_PARTICLES = 22000;

  var canvas = document.getElementById("field");
  var menu = document.getElementById("hole-menu");
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
  var vel = null;
  var imgPts = null;
  var count = 0;
  var imgW = 1;
  var imgH = 1;
  var pointer = { x: 0, y: 0, active: false, over: false };
  var holeOpen = 0;

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
      holeX: 0,
      holeY: (0.5 - HOLE_NY) * h,
      holeR: HOLE_RADIUS * holeScale,
      holePush: HOLE_PUSH * holeScale,
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

  function makeDotTexture() {
    var c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    var g = c.getContext("2d");
    g.beginPath();
    g.arc(16, 16, 10, 0, Math.PI * 2);
    g.fillStyle = "#fff";
    g.fill();
    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function syncRest(L) {
    var i, px, py;
    for (i = 0; i < count; i++) {
      px = imgPts[i * 3];
      py = imgPts[i * 3 + 1];
      rest[i * 2] = (px - imgW / 2) * L.scale;
      rest[i * 2 + 1] = (imgH / 2 - py) * L.scale + L.yLift;
    }
  }

  function setMenu(open) {
    if (!menu) return;
    if (open) {
      menu.hidden = false;
      menu.classList.add("is-open");
    } else {
      menu.classList.remove("is-open");
    }
  }

  function step() {
    var L = layout();
    var wantHole = pointer.over || pointer.active;
    holeOpen += ((wantHole ? 1 : 0) - holeOpen) * 0.14;
    setMenu(holeOpen > 0.55);

    var i, x, y, rx, ry, dx, dy, d, f, inv, rim;
    var spring = 0.085;
    var damp = 0.78;
    var hx = L.holeX;
    var hy = L.holeY;
    var hr = L.holeR;
    var hp = L.holePush * holeOpen;
    var mouseOn = pointer.over || pointer.active;

    for (i = 0; i < count; i++) {
      x = positions[i * 3];
      y = positions[i * 3 + 1];
      rx = rest[i * 2];
      ry = rest[i * 2 + 1];

      vel[i * 2] += (rx - x) * spring;
      vel[i * 2 + 1] += (ry - y) * spring;

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

      if (holeOpen > 0.02) {
        dx = x - hx;
        dy = y - hy;
        d = Math.hypot(dx, dy);
        if (d < hr) {
          if (d < 0.08) {
            vel[i * 2] += hp * 0.35;
          } else {
            inv = 1 / d;
            f = (1 - d / hr);
            f = f * f * hp * 0.55;
            vel[i * 2] += dx * inv * f;
            vel[i * 2 + 1] += dy * inv * f;
            rim = (hr + 6 - d) * f * 0.08;
            x += dx * inv * rim;
            y += dy * inv * rim;
          }
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
      setPointer(ev);
    });
    window.addEventListener("pointerdown", function (ev) {
      setPointer(ev, true);
    });
    window.addEventListener("pointerup", function (ev) {
      setPointer(ev, false);
    });
    window.addEventListener("pointerleave", function () {
      pointer.over = false;
      pointer.active = false;
    });
    window.addEventListener("blur", function () {
      pointer.over = false;
      pointer.active = false;
    });
    window.addEventListener("resize", onResize);
  }

  function start(sample) {
    imgPts = sample.pts;
    imgW = sample.w;
    imgH = sample.h;
    count = imgPts.length / 3;
    rest = new Float32Array(count * 2);
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
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.5,
      sizeAttenuation: false,
      map: makeDotTexture(),
      transparent: true,
      alphaTest: 0.35,
      depthWrite: false,
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

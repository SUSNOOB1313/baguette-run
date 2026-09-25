/* ============================================================
   BAGUETTE RUN — an 8-bit-style bakery + delivery game
   Two phases per order:
     1) SHOP   — knead, shape, bake and top a baguette to match an order
     2) DELIVERY — first-person pseudo-3D street ride, dodging traffic
                   and riding to the glowing house
   Pure canvas + vanilla JS, no build step, no external assets.
   ============================================================ */
(function () {
  "use strict";

  // ---------------------------------------------------------
  // Canvas / core setup
  // ---------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const W = canvas.width;   // 384
  const H = canvas.height;  // 216

  const PALETTE = {
    counter: "#8a5a34",
    counterDark: "#6b4426",
    dough: "#f0d9a0",
    crust: "#c98a3f",
    crustDark: "#8a5222",
    paper: "#e8d9b8",
    ink: "#241a12",
    white: "#f4ead0",
    red: "#d94f3c",
    green: "#57b567",
    yellow: "#ffcf5c",
    blue: "#4f8ad9",
    purple: "#8a5cc9",
  };

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randi(min, max) { return Math.floor(rand(min, max + 1)); }
  function choice(arr) { return arr[randi(0, arr.length - 1)]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  // What a delivery actually pays — weighted so most runs land on the $4
  // floor, with a shrinking chance of a bigger tip up to $7.
  function deliveryPayout() {
    const r = Math.random();
    if (r < 0.65) return 4;
    if (r < 0.85) return 5;
    if (r < 0.95) return 6;
    return 7;
  }

  // ---------------------------------------------------------
  // Tiny WebAudio beeper for 8-bit sfx (no external files)
  // ---------------------------------------------------------
  const Audio8 = (function () {
    let actx = null;
    function ctxReady() {
      if (!actx) {
        try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { return null; }
      }
      return actx;
    }
    function beep(freq, dur, type, vol, slideTo) {
      const ac = ctxReady();
      if (!ac) return;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type || "square";
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, ac.currentTime + dur);
      gain.gain.setValueAtTime((vol || 0.08), ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + dur);
    }
    return {
      click: () => beep(520, 0.05, "square", 0.06),
      toggle: () => beep(340, 0.06, "square", 0.06),
      good: () => { beep(660, 0.08, "square", 0.07); setTimeout(() => beep(880, 0.1, "square", 0.07), 70); },
      bad: () => beep(140, 0.25, "sawtooth", 0.08, 80),
      crash: () => beep(90, 0.35, "sawtooth", 0.12, 40),
      success: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.12, "square", 0.07), i * 90)); },
      start: () => { [392, 523, 659].forEach((f, i) => setTimeout(() => beep(f, 0.1, "square", 0.06), i * 80)); },
      gameover: () => { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => beep(f, 0.22, "sawtooth", 0.08), i * 140)); },
    };
  })();

  // ---------------------------------------------------------
  // Pixel-sprite renderer — sprites are drawn from string grids
  // ---------------------------------------------------------
  function drawSprite(g, x, y, scale, sprite) {
    const rows = sprite.rows;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === ".") continue;
        const color = sprite.colors[ch];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x + c * scale), Math.round(y + r * scale), Math.ceil(scale), Math.ceil(scale));
      }
    }
  }
  function spriteSize(sprite, scale) {
    const h = sprite.rows.length * scale;
    const w = (sprite.rows[0] ? sprite.rows[0].length : 0) * scale;
    return { w, h };
  }

  const SPRITES = {
    baguetteBare: {
      colors: { a: PALETTE.crustDark, b: PALETTE.crust, c: PALETTE.dough },
      rows: [
        ".aaaaaaaaaaaaaaaa.",
        "abbbbbbbbbbbbbbbba",
        "bcccccccccccccccbb",
        "bccccccccccccccccb",
        "bcccccccccccccccbb",
        "abbbbbbbbbbbbbbbba",
        ".aaaaaaaaaaaaaaaa.",
      ],
    },
    houseTarget: {
      colors: { r: "#d94f3c", w: "#f4ead0", d: "#8a5222", y: "#ffcf5c", k: "#241a12" },
      rows: [
        "....rrrrrrrr....",
        "...rrrrrrrrrr...",
        "..rrrrrrrrrrrr..",
        ".rrrrrrrrrrrrrr.",
        "wwwwwwwwwwwwwwww",
        "wwwwykwwwwwwwwww",
        "wwwwykwwwwwwwwww",
        "wwwwwwwwwwwwwwww",
        "ddddddddddddddddd",
      ],
    },
    houseFlag: {
      colors: { p: "#5a4a3a", f: "#ffcf5c" },
      rows: [
        "p.ffff",
        "p.ffff",
        "p.ffff",
        "p.....",
        "p.....",
      ],
    },
    houseBgA: {
      colors: { r: "#6b4b8a", w: "#c9bfa8", d: "#5a4230", k: "#241a12" },
      rows: [
        "....rrrrrrrr....",
        "...rrrrrrrrrr...",
        "..rrrrrrrrrrrr..",
        ".rrrrrrrrrrrrrr.",
        "wwwwwwwwwwwwwwww",
        "wwwwwkwwwwwwwwww",
        "wwwwwkwwwwwwwwww",
        "wwwwwwwwwwwwwwww",
        "ddddddddddddddddd",
      ],
    },
    houseBgB: {
      colors: { r: "#4f7a5c", w: "#d8ccae", d: "#6b4426", k: "#241a12" },
      rows: [
        "....rrrrrrrr....",
        "...rrrrrrrrrr...",
        "..rrrrrrrrrrrr..",
        ".rrrrrrrrrrrrrr.",
        "wwwwwwwwwwwwwwww",
        "wwwwwkwwwwwwwwww",
        "wwwwwkwwwwwwwwww",
        "wwwwwwwwwwwwwwww",
        "ddddddddddddddddd",
      ],
    },
    heart: {
      colors: { r: PALETTE.red, d: "#8a2a20" },
      rows: [
        ".rr.rr.",
        "rrrrrrr",
        "rrrrrrr",
        ".rrrrr.",
        "..rrr..",
        "...r...",
      ],
    },
    heartEmpty: {
      colors: { d: "#4a3a3a" },
      rows: [
        ".dd.dd.",
        "ddddddd",
        "ddddddd",
        ".ddddd.",
        "..ddd..",
        "...d...",
      ],
    },
  };

  function carRearSprite(color) {
    // seen from behind: taillights near the bottom (closer/rear) edge
    return {
      colors: { k: "#141018", b: color, w: "#20242c", t: "#ff5544" },
      rows: [
        ".kkkkkkkkkkkk.",
        "kbbbbbbbbbbbbk",
        "kbbwwwwwwwbbbk",
        "kbbbbbbbbbbbbk",
        "ktbbbbbbbbbtbk",
        ".k..........k.",
      ],
    };
  }
  function carFrontSprite(color) {
    // seen head-on: bright headlights near the bottom edge
    return {
      colors: { k: "#141018", b: color, w: "#bfe6ff", y: "#fff2b0" },
      rows: [
        ".kkkkkkkkkkkk.",
        "kbbbbbbbbbbbbk",
        "kbbwwwwwwwbbbk",
        "kbbbbbbbbbbbbk",
        "kybbbbbbbbbybk",
        ".k..........k.",
      ],
    };
  }

  const TOPPINGS = [
    { id: "cinnamon", label: "Cinnamon", color: "#a5622a", icon: "swirl" },
    { id: "sugar", label: "Pwd. Sugar", color: "#ffffff", icon: "dots" },
    { id: "butter", label: "Butter", color: "#ffe27a", icon: "melt" },
    { id: "cheese", label: "Cheese", color: "#f2a63a", icon: "squares" },
    { id: "herbs", label: "Herbs", color: "#3fa34d", icon: "flecks" },
    { id: "sesame", label: "Sesame", color: "#e8dcb0", icon: "seeds" },
    { id: "choco", label: "Chocolate", color: "#5a3520", icon: "drizzle" },
  ];

  function drawToppingsOnBaguette(x, y, scale, toppingIds) {
    // baguette body spans roughly cols 1..16, rows 2..4 in the 18-wide grid
    const seedFor = toppingIds.join("|");
    let seed = 0;
    for (let i = 0; i < seedFor.length; i++) seed = (seed * 31 + seedFor.charCodeAt(i)) >>> 0;
    function prand() { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 0xFFFFFF; }
    toppingIds.forEach((id) => {
      const t = TOPPINGS.find((tp) => tp.id === id);
      if (!t) return;
      ctx.fillStyle = t.color;
      for (let n = 0; n < 26; n++) {
        const px = x + (1 + prand() * 15) * scale;
        const py = y + (2 + prand() * 3) * scale;
        const s = t.icon === "melt" ? scale * 1.4 : scale * (0.6 + prand() * 0.5);
        ctx.fillRect(px, py, s, s);
      }
    });
  }
  function drawToppingParticles(x, y, scale, particlesById) {
    // Renders whatever's actually been poured so far — persistent sprinkle
    // positions (not regenerated each frame) so pouring visibly accumulates
    // instead of jittering.
    Object.keys(particlesById).forEach((id) => {
      const arr = particlesById[id];
      if (!arr || !arr.length) return;
      const t = TOPPINGS.find((tp) => tp.id === id);
      if (!t) return;
      ctx.fillStyle = t.color;
      arr.forEach((p) => {
        const px = x + (1 + p.fx * 15) * scale;
        const py = y + (2 + p.fy * 3) * scale;
        const s = t.icon === "melt" ? scale * 1.4 : scale * (0.6 + p.fs * 0.5);
        ctx.fillRect(px, py, s, s);
      });
    });
  }
  function drawPourStream(x, y, color, wobble, drops, splat) {
    ctx.fillStyle = color;
    let sy = y + 8;
    for (let i = 0; i < drops; i++) {
      sy += 6;
      ctx.fillRect(x - 1 + Math.sin(wobble * 10 + i) * 2, sy, 2, 4);
    }
    if (splat) {
      ctx.beginPath();
      ctx.ellipse(x, sy + 5, 6, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Topping bottles for the Shop's TOP step: instead of toggling a topping
  // on/off, the player picks up a bottle and drags it over the baguette to
  // pour — holding it there adds more, letting go stops, so coverage is
  // entirely up to how long (and how often) they pour.
  const TOP_BAGUETTE_X = 150, TOP_BAGUETTE_Y = 50;
  const BOTTLE_RACK_X = 14, BOTTLE_RACK_Y = 116, BOTTLE_W = 46, BOTTLE_H = 30, BOTTLE_GAP = 4;
  const BOTTLE_TILT_HELD = -20, BOTTLE_TILT_POURING = -65;
  function bottleRackPos(i) {
    return { x: BOTTLE_RACK_X + i * (BOTTLE_W + BOTTLE_GAP), y: BOTTLE_RACK_Y };
  }
  // Where the bottle's cap actually ends up on screen once it's tipped —
  // the cap sits dead center over the pivot before any rotation, so tilting
  // swings it out to the side the bottle's tipped toward.
  function bottleCapPos(x, y, tiltDeg) {
    const pivotX = x + BOTTLE_W / 2, pivotY = y + BOTTLE_H;
    const dy = 0.5 - BOTTLE_H; // cap's offset from the pivot before rotation
    const rad = (tiltDeg * Math.PI) / 180;
    return { x: pivotX - dy * Math.sin(rad), y: pivotY + dy * Math.cos(rad) };
  }
  // tiltDeg tips the bottle around its base, like it's being tipped over to
  // pour — 0 upright on the rack, a little when just picked up, a lot once
  // it's actually held over the baguette and pouring.
  function drawBottle(x, y, t, used, tiltDeg) {
    ctx.save();
    if (tiltDeg) {
      const pivotX = x + BOTTLE_W / 2, pivotY = y + BOTTLE_H;
      ctx.translate(pivotX, pivotY);
      ctx.rotate((tiltDeg * Math.PI) / 180);
      ctx.translate(-pivotX, -pivotY);
    }
    const w = BOTTLE_W - 6, h = BOTTLE_H - 4;
    const bx = x + 3, by = y + 2;
    ctx.fillStyle = "#c9c9c9";
    ctx.fillRect(bx + w / 2 - 4, by, 8, 8);
    ctx.fillStyle = t.color;
    ctx.fillRect(bx + w / 2 - 5, by - 4, 10, 5);
    ctx.fillStyle = tiltDeg ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.2)";
    ctx.fillRect(bx, by + 8, w, h - 8);
    ctx.fillStyle = t.color;
    ctx.fillRect(bx + 2, by + 12, w - 4, h - 14);
    ctx.strokeStyle = used ? PALETTE.yellow : PALETTE.ink;
    ctx.lineWidth = used ? 2 : 1;
    ctx.strokeRect(bx, by + 8, w, h - 8);
    ctx.restore();
  }

  // ---------------------------------------------------------
  // Input
  // ---------------------------------------------------------
  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  // Touch/click steering (tap-and-hold left/right half of the screen) for the delivery phase
  let steerPointer = 0;
  let activePointerId = null;
  function pointerToLogicalX(e) {
    const rect = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return (cx / rect.width) * W;
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (Game.scene !== "DELIVERY") return;
    activePointerId = e.pointerId;
    steerPointer = pointerToLogicalX(e) < W / 2 ? -1 : 1;
  });
  window.addEventListener("pointerup", (e) => { if (e.pointerId === activePointerId) { steerPointer = 0; activePointerId = null; } });
  window.addEventListener("pointercancel", () => { steerPointer = 0; activePointerId = null; });

  // Free-form dough sculpting for the Shop's SHAPE step: the dough is a ring of
  // grabbable control points, and any one of them can be picked up and dragged
  // to pull that part of the dough toward (or away from) a baguette shape.
  const SHAPE_GRAB_R = 34;
  canvas.addEventListener("pointerdown", (e) => {
    if (Game.scene !== "SHOP" || Shop.step !== "SHAPE") return;
    const p = canvasPointFromEvent(e);
    let bestI = -1, bestD = SHAPE_GRAB_R;
    Shop.shapePoints.forEach((pt, i) => {
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d < bestD) { bestD = d; bestI = i; }
    });
    if (bestI >= 0) Shop.shapeDragIndex = bestI;
  });
  window.addEventListener("pointermove", (e) => {
    if (Shop.shapeDragIndex < 0) return;
    const p = canvasPointFromEvent(e);
    const pt = Shop.shapePoints[Shop.shapeDragIndex];
    pt.x = clamp(p.x, 120, 250);
    pt.y = clamp(p.y, 38, 118);
  });
  window.addEventListener("pointerup", () => { Shop.shapeDragIndex = -1; });
  window.addEventListener("pointercancel", () => { Shop.shapeDragIndex = -1; });

  // Oven interaction for the Shop's BAKE step, all drag-driven:
  //  1. Grab the door handle and drag it DOWN to pull the oven open.
  //  2. Grab the peel handle and drag it in to push the baguette to the back.
  //  3. Once it's loaded (peel auto-retracts), grab the door handle again
  //     and drag it back UP to close the oven and start the bake timer.
  const OVEN_X = 150, OVEN_Y = 50;
  const OVEN_HANDLE_GRAB_R = 34;
  const OVEN_DOOR_CLOSED_Y = OVEN_Y + 16, OVEN_DOOR_OPEN_Y = OVEN_Y + 54;
  function ovenPeelPos() {
    const frontY = OVEN_Y + 52, backY = OVEN_Y + 18;
    return { x: OVEN_X + 40, y: frontY - (frontY - backY) * Shop.insertProgress };
  }
  function ovenHandlePos() {
    return { x: OVEN_X + 65, y: OVEN_DOOR_CLOSED_Y + (OVEN_DOOR_OPEN_Y - OVEN_DOOR_CLOSED_Y) * Shop.doorProgress };
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (Game.scene !== "SHOP" || Shop.step !== "BAKE") return;
    const p = canvasPointFromEvent(e);
    if (Shop.bakeStage === "loading") {
      const handle = ovenPeelPos();
      if (Math.hypot(p.x - handle.x, p.y - handle.y) <= OVEN_HANDLE_GRAB_R) Shop.peelDragging = true;
    } else if (Shop.bakeStage === "closed" || Shop.bakeStage === "opening" || Shop.bakeStage === "closing") {
      const handle = ovenHandlePos();
      if (Math.hypot(p.x - handle.x, p.y - handle.y) <= OVEN_HANDLE_GRAB_R) {
        Shop.doorDragging = true;
        if (Shop.bakeStage === "closed") Shop.bakeStage = "opening";
      }
    }
  });
  window.addEventListener("pointermove", (e) => {
    if (Shop.peelDragging) {
      if (Game.scene !== "SHOP" || Shop.step !== "BAKE" || Shop.bakeStage !== "loading") { Shop.peelDragging = false; return; }
      const p = canvasPointFromEvent(e);
      const frontY = OVEN_Y + 52, backY = OVEN_Y + 18;
      Shop.insertProgress = clamp((frontY - p.y) / (frontY - backY), 0, 1);
      if (Shop.insertProgress >= 1) {
        Shop.peelDragging = false;
        Shop.bakeStage = "retracting";
        Shop.ovenAnimT = 0;
        Shop.ovenAnimDur = 0.4;
        Audio8.toggle();
      }
    } else if (Shop.doorDragging) {
      if (Game.scene !== "SHOP" || Shop.step !== "BAKE") { Shop.doorDragging = false; return; }
      const p = canvasPointFromEvent(e);
      Shop.doorProgress = clamp((p.y - OVEN_DOOR_CLOSED_Y) / (OVEN_DOOR_OPEN_Y - OVEN_DOOR_CLOSED_Y), 0, 1);
      if (Shop.bakeStage === "opening" && Shop.doorProgress >= 1) {
        Shop.doorDragging = false;
        Shop.bakeStage = "loading";
        Shop.insertProgress = 0;
        Audio8.toggle();
      } else if (Shop.bakeStage === "closing" && Shop.doorProgress <= 0) {
        Shop.doorDragging = false;
        Shop.bakeStage = "baking";
        Audio8.toggle();
      }
    }
  });
  window.addEventListener("pointerup", () => { Shop.peelDragging = false; Shop.doorDragging = false; });
  window.addEventListener("pointercancel", () => { Shop.peelDragging = false; Shop.doorDragging = false; });

  // Topping bottles for the Shop's TOP step: pick one up off the rack and
  // drag it over the baguette to pour — coverage builds up for as long as
  // it's held there, however much or little the player wants.
  canvas.addEventListener("pointerdown", (e) => {
    if (Game.scene !== "SHOP" || Shop.step !== "TOP" || Shop.pouringId) return;
    const p = canvasPointFromEvent(e);
    for (let i = 0; i < TOPPINGS.length; i++) {
      const r = bottleRackPos(i);
      if (p.x >= r.x && p.x <= r.x + BOTTLE_W && p.y >= r.y && p.y <= r.y + BOTTLE_H) {
        Shop.pouringId = TOPPINGS[i].id;
        Shop.pourPos = { x: p.x, y: p.y };
        Audio8.toggle();
        break;
      }
    }
  });
  window.addEventListener("pointermove", (e) => {
    if (!Shop.pouringId) return;
    if (Game.scene !== "SHOP" || Shop.step !== "TOP") {
      Shop.pouringId = null; Shop.pourTilted = false; Shop.pourOverBaguette = false; return;
    }
    const p = canvasPointFromEvent(e);
    Shop.pourPos = p;
    // Lift the bottle up off the rack and it tips over ready to pour — but
    // tipped-over only means it's spilling. Whether anything actually lands
    // on the baguette depends on where the CAP ends up once tilted, not on
    // the raw mouse position (they're offset once the bottle leans over).
    Shop.pourTilted = p.y < BOTTLE_RACK_Y - 4;
    if (Shop.pourTilted) {
      const cap = bottleCapPos(p.x - BOTTLE_W / 2, p.y - BOTTLE_H / 2, BOTTLE_TILT_POURING);
      const bx = TOP_BAGUETTE_X + 10, by = TOP_BAGUETTE_Y + 20;
      const sz = spriteSize(SPRITES.baguetteBare, 3);
      Shop.pourOverBaguette = cap.x >= bx - 4 && cap.x <= bx + sz.w + 4 && cap.y >= by - 4 && cap.y <= by + sz.h + 6;
    } else {
      Shop.pourOverBaguette = false;
    }
  });
  window.addEventListener("pointerup", () => { Shop.pouringId = null; Shop.pourTilted = false; Shop.pourOverBaguette = false; });
  window.addEventListener("pointercancel", () => { Shop.pouringId = null; Shop.pourTilted = false; Shop.pourOverBaguette = false; });

  let buttons = []; // active clickable regions for current scene: {x,y,w,h,label,sub,onClick,disabled,style}
  function addButton(b) { buttons.push(b); return b; }

  function canvasPointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return { x: (cx / rect.width) * W, y: (cy / rect.height) * H };
  }
  function handleClick(e) {
    e.preventDefault();
    const p = canvasPointFromEvent(e);
    for (const b of buttons) {
      if (b.disabled) continue;
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        b.onClick();
        break;
      }
    }
  }
  canvas.addEventListener("click", handleClick);

  function drawButton(b) {
    ctx.fillStyle = b.disabled ? "#332b22" : (b.active ? PALETTE.yellow : PALETTE.counter);
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = b.disabled ? "#544838" : PALETTE.crustDark;
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    ctx.fillStyle = b.disabled ? "#8a7a68" : (b.active ? PALETTE.ink : PALETTE.white);
    ctx.font = (b.font || "7px") + " 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    wrapText(b.label, b.x + b.w / 2, b.y + b.h / 2 - (b.sub ? 5 : 0), b.w - 8, 8);
    if (b.sub) {
      ctx.font = "6px 'Press Start 2P', monospace";
      ctx.fillText(b.sub, b.x + b.w / 2, b.y + b.h / 2 + 8);
    }
  }
  function wrapText(text, cx, cy, maxWidth, lineHeight) {
    const words = String(text).split(" ");
    let lines = [];
    let cur = "";
    words.forEach((w) => {
      const test = cur ? cur + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w; }
      else cur = test;
    });
    if (cur) lines.push(cur);
    const startY = cy - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
  }

  function drawPanelText(text, x, y, size, color, align) {
    ctx.fillStyle = color || PALETTE.white;
    ctx.font = (size || 8) + "px 'Press Start 2P', monospace";
    ctx.textAlign = align || "left";
    ctx.textBaseline = "top";
    ctx.fillText(text, x, y);
  }

  // ---------------------------------------------------------
  // Game state
  // ---------------------------------------------------------
  const CUSTOMERS = ["Marie", "Pierre", "Colette", "Henri", "Odette", "Jules", "Fifi", "Remy", "Babette", "Gaspard"];

  const Game = {
    scene: "TITLE",
    score: 0,
    lives: 1,
    day: 1,
    ordersThisDay: 0,
    ordersPerDay: 3,
    deliveredTotal: 0,
    order: null,
    invuln: 0,
    lastQuality: null,
    popupTimer: 0,
    popupText: "",
    paused: false,
  };

  function newOrder() {
    const count = Math.random() < 0.18 ? 0 : randi(1, Math.min(3, 1 + Math.floor(Game.day / 2)));
    const pool = TOPPINGS.slice();
    const picked = [];
    for (let i = 0; i < count; i++) {
      const idx = randi(0, pool.length - 1);
      picked.push(pool.splice(idx, 1)[0].id);
    }
    return { customer: choice(CUSTOMERS), toppings: picked };
  }

  function startNewOrderFlow() {
    Game.order = newOrder();
    Game.scene = "SHOP";
    Shop.reset();
  }

  function resetGame() {
    Game.score = 0;
    Game.lives = 1;
    Game.day = 1;
    Game.ordersThisDay = 0;
    Game.ordersPerDay = 3;
    Game.deliveredTotal = 0;
    Game.invuln = 0;
    startNewOrderFlow();
  }

  // Decrements a life, plays sfx, shows the popup and flips to GAMEOVER if out of lives.
  // Callers are responsible for repositioning/resetting the delivery run afterwards
  // (checking Game.scene is still "DELIVERY" first, since it may have just become GAMEOVER).
  function loseLife(reasonText) {
    Game.lives--;
    Audio8.crash();
    Game.popupText = reasonText || "CRASH!";
    Game.popupTimer = 1.1;
    if (Game.lives <= 0) {
      Game.scene = "GAMEOVER";
      Audio8.gameover();
    }
  }

  // ---------------------------------------------------------
  // SHOP SCENE
  // ---------------------------------------------------------
  // The SHAPE step models the dough as a ring of draggable control points.
  // Point i starts on a circle (round dough ball) and has a fixed target on
  // an outline for whichever bread shape was picked this order, both sampled
  // along the SAME ray angle from the shared center. That keeps each point's
  // target in the same rough direction as its start (the point on the right
  // side of the ball targets the right tip, not some other part of the
  // outline), so dragging a handle toward the nearest bit of the ghost
  // outline is always correct, whatever the target shape looks like.
  const SHAPE_N = 10;
  const SHAPE_CENTER = { x: 195, y: 78 };
  function circlePointAtAngle(theta, cx, cy, r) {
    return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
  }
  // A superellipse boundary sampled by ray angle: |x/a|^n + |y/b|^n = 1.
  // One formula reproduces every target silhouette just by varying a, b, n —
  // a high n gives flat sides and rounded ends (a baguette/batard), n=2 with
  // a=b gives a perfect circle (a boule), and a low n pulls the ends into
  // points (a torpedo roll).
  function superellipsePointAtAngle(theta, cx, cy, a, b, n) {
    const c = Math.abs(Math.cos(theta)), s = Math.abs(Math.sin(theta));
    const r = Math.pow(Math.pow(c / a, n) + Math.pow(s / b, n), -1 / n);
    return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
  }
  // Each order picks one of these bread shapes to sculpt toward. a = half
  // length (horizontal reach from center), b = half thickness (vertical
  // reach) — both kept within the draggable panel's bounds for every preset.
  const SHAPE_TYPES = [
    { name: "Baguette", n: 4.5, aMin: 32, aMax: 48, bMin: 8, bMax: 13 },
    { name: "Batard", n: 2.6, aMin: 20, aMax: 32, bMin: 13, bMax: 19 },
    { name: "Boule", n: 2, round: true, aMin: 18, aMax: 26, bMin: 18, bMax: 26 },
    { name: "Torpedo Roll", n: 1.55, aMin: 26, aMax: 40, bMin: 9, bMax: 15 },
  ];

  const Shop = {
    step: "KNEAD", // KNEAD -> SHAPE -> BAKE -> TOP -> WRAP -> DONE
    bakeNeedle: 0,
    bakeDir: 1,
    bakeSpeed: 1.7,
    bakeResult: null, // 'perfect' | 'good' | 'burnt' | 'raw'
    // closed -> opening -> loading -> retracting -> closing -> baking
    bakeStage: "closed",
    doorProgress: 0, // 0 = door shut, 1 = door fully pulled open
    doorDragging: false,
    ovenAnimT: 0,
    ovenAnimDur: 0,
    insertProgress: 0, // 0-1, how far the peel has been dragged into the oven
    peelDragging: false,
    toppingParticles: {}, // id -> array of {fx,fy,fs} sprinkles poured so far
    pouringId: null, // id of the topping bottle currently picked up, or null
    pourPos: { x: 0, y: 0 },
    pourTilted: false, // lifted up off the rack, tipped over ready to pour
    pourOverBaguette: false, // AND actually lined up with the baguette
    wobble: 0,
    shapePoints: [],
    shapeTargets: [],
    shapeInitDist: [],
    shapeDragIndex: -1,
    shapeAccuracy: 0,
    shapeTypeName: "Baguette",
    reset() {
      this.step = "KNEAD";
      this.bakeNeedle = 0;
      this.bakeDir = 1;
      this.bakeSpeed = 1.6 + Game.day * 0.15;
      this.bakeResult = null;
      this.bakeStage = "closed";
      this.doorProgress = 0;
      this.doorDragging = false;
      this.ovenAnimT = 0;
      this.ovenAnimDur = 0;
      this.insertProgress = 0;
      this.peelDragging = false;
      this.toppingParticles = {};
      this.pouringId = null;
      this.pourPos = { x: 0, y: 0 };
      this.pourTilted = false;
      this.pourOverBaguette = false;
      this.wobble = 0;
      this.shapeDragIndex = -1;
      this.shapeAccuracy = 0;
      this.shapePoints = [];
      this.shapeTargets = [];
      this.shapeInitDist = [];
      // A different bread shape every order — not just a different size, but
      // a different silhouette family (baguette/batard/boule/torpedo roll).
      const type = choice(SHAPE_TYPES);
      this.shapeTypeName = type.name;
      const a = rand(type.aMin, type.aMax);
      const b = type.round ? a : rand(type.bMin, type.bMax);
      const circleR = rand(20, 28);
      for (let i = 0; i < SHAPE_N; i++) {
        const theta = (i / SHAPE_N) * Math.PI * 2;
        const start = circlePointAtAngle(theta, SHAPE_CENTER.x, SHAPE_CENTER.y, circleR);
        const target = superellipsePointAtAngle(theta, SHAPE_CENTER.x, SHAPE_CENTER.y, a, b, type.n);
        this.shapePoints.push({ x: start.x, y: start.y });
        this.shapeTargets.push(target);
        this.shapeInitDist.push(Math.max(1, Math.hypot(start.x - target.x, start.y - target.y)));
      }
    },
    updateShapeAccuracy() {
      let sum = 0;
      for (let i = 0; i < this.shapePoints.length; i++) {
        const p = this.shapePoints[i], t = this.shapeTargets[i];
        const d = Math.hypot(p.x - t.x, p.y - t.y);
        // A steeply concave falloff: even roughly nudging a point toward its
        // target earns most of the credit, so the score is very forgiving
        // about exact placement.
        const r = clamp(d / this.shapeInitDist[i], 0, 4);
        sum += clamp(1 - Math.pow(r, 3.2), 0, 1);
      }
      this.shapeAccuracy = this.shapePoints.length ? Math.round((sum / this.shapePoints.length) * 100) : 0;
    },
    update(dt) {
      this.wobble += dt;
      if (this.step === "SHAPE") this.updateShapeAccuracy();
      if (this.step === "BAKE") {
        if (this.bakeStage === "retracting") {
          // The only auto-advancing beat: the emptied peel slides itself
          // back out once the baguette's been dropped at the back.
          this.ovenAnimT += dt / this.ovenAnimDur;
          if (this.ovenAnimT >= 1) {
            this.bakeStage = "closing";
            this.ovenAnimT = 0;
          }
        } else if (this.bakeStage === "baking") {
          this.bakeNeedle += this.bakeDir * this.bakeSpeed * dt;
          if (this.bakeNeedle > 1) { this.bakeNeedle = 1; this.bakeDir = -1; }
          if (this.bakeNeedle < 0) { this.bakeNeedle = 0; this.bakeDir = 1; }
        }
        // 'closed', 'opening', 'loading' and 'closing' are all driven by the
        // player dragging a handle, not by time.
      }
      if (this.step === "TOP" && this.pouringId && this.pourOverBaguette) {
        this.pourTopping(this.pouringId, dt);
      }
    },
    pullFromOven() {
      if (this.step !== "BAKE" || this.bakeStage !== "baking") return;
      const n = this.bakeNeedle;
      // Perfect zone centered ~0.62 (golden brown), width tuned by day (harder = narrower)
      const center = 0.62;
      const perfectHalf = clamp(0.09 - Game.day * 0.004, 0.04, 0.09);
      const goodHalf = perfectHalf + 0.12;
      const dist = Math.abs(n - center);
      if (dist <= perfectHalf) this.bakeResult = "perfect";
      else if (dist <= goodHalf) this.bakeResult = "good";
      else if (n < center) this.bakeResult = "raw";
      else this.bakeResult = "burnt";
      Audio8.click();
      this.step = "TOP";
    },
    pourTopping(id, dt) {
      // Free-form pouring: each tick while the bottle's held over the
      // baguette adds more sprinkles — no toggle, no fixed amount, and no
      // gameplay cap, so holding it there long enough genuinely buries the
      // baguette. SAFETY_CEILING only guards against unbounded memory growth
      // if a bottle is somehow left pouring for a very long time.
      const SAFETY_CEILING = 20000;
      const POUR_RATE = 26; // particles per second
      if (!this.toppingParticles[id]) this.toppingParticles[id] = [];
      const arr = this.toppingParticles[id];
      if (arr.length >= SAFETY_CEILING) return;
      const toAdd = Math.min(SAFETY_CEILING - arr.length, Math.max(1, Math.round(POUR_RATE * dt)));
      for (let i = 0; i < toAdd; i++) {
        arr.push({ fx: rand(0, 1), fy: rand(0, 1), fs: rand(0, 1) });
      }
    },
    scoreOrder() {
      const order = Game.order;
      const want = new Set(order.toppings);
      const got = new Set(Object.keys(this.toppingParticles).filter((id) => this.toppingParticles[id].length > 0));
      let mismatches = 0;
      want.forEach((t) => { if (!got.has(t)) mismatches++; });
      got.forEach((t) => { if (!want.has(t)) mismatches++; });
      const bakeRank = { perfect: 3, good: 2, raw: 1, burnt: 1 }[this.bakeResult];
      const shapeRank = this.shapeAccuracy >= 55 ? 3 : this.shapeAccuracy >= 35 ? 2 : this.shapeAccuracy >= 15 ? 1 : 0;
      let rank = Math.round((bakeRank + shapeRank) / 2) - mismatches;
      rank = clamp(rank, 0, 3);
      const labels = ["RUINED", "OKAY", "GOOD", "PERFECT"];
      const points = [10, 40, 75, 120];
      return { rank, label: labels[rank], points: points[rank] };
    },
    render() {
      buttons = [];
      // Background: cozy shop
      ctx.fillStyle = "#2a2038";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = PALETTE.counterDark;
      ctx.fillRect(0, H - 30, W, 30);
      ctx.fillStyle = PALETTE.counter;
      ctx.fillRect(0, H - 32, W, 6);

      drawHUD();

      drawPanelText("ORDER — " + Game.order.customer, 10, 26, 8, PALETTE.yellow);
      // order card
      const cardX = 10, cardY = 38, cardW = 110, cardH = 60;
      ctx.fillStyle = PALETTE.paper;
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.strokeStyle = PALETTE.ink;
      ctx.strokeRect(cardX, cardY, cardW, cardH);
      const bs = spriteSize(SPRITES.baguetteBare, 2.5);
      drawSprite(ctx, cardX + (cardW - bs.w) / 2, cardY + 6, 2.5, SPRITES.baguetteBare);
      drawToppingsOnBaguette(cardX + (cardW - bs.w) / 2, cardY + 6, 2.5, Game.order.toppings);
      if (Game.order.toppings.length === 0) {
        drawPanelText("PLAIN", cardX + cardW / 2, cardY + 30, 6, PALETTE.ink, "center");
      }
      ctx.textAlign = "left";
      let ty = cardY + cardH - 16;
      if (Game.order.toppings.length) {
        drawPanelText(Game.order.toppings.map(id => TOPPINGS.find(t=>t.id===id).label).join(", "), cardX + 4, ty, 5.5, PALETTE.ink);
      } else {
        drawPanelText("no toppings", cardX + 4, ty, 5.5, PALETTE.ink);
      }

      // Working baguette preview area
      const wx = 150, wy = 50;
      const panelLabel = this.step === "SHAPE" ? "FORM A " + this.shapeTypeName.toUpperCase() : "YOUR BAGUETTE";
      drawPanelText(panelLabel, wx, 26, this.step === "SHAPE" ? 6 : 7, PALETTE.white);
      const bob = this.step !== "BAKE" ? Math.sin(this.wobble * 4) * 1.5 : 0;
      if (this.step === "KNEAD" ) {
        drawDoughBlob(wx + 20, wy + 10 + bob);
      } else if (this.step === "SHAPE") {
        // dough first, ghost outline drawn on top (stroke-only, so it stays
        // visible as a guide even where the target sits inside the dough,
        // e.g. a small torpedo roll target next to a bigger starting ball)
        drawDoughSculpt(this.shapePoints, this.shapeDragIndex);
        drawShapeTargetGhost(this.shapeTargets);
        drawShapeGauge(150, 108, this.shapeAccuracy / 100);
        drawPanelText("ACCURACY " + this.shapeAccuracy + "%", 150, 120, 6,
          this.shapeAccuracy >= 55 ? PALETTE.green : this.shapeAccuracy >= 35 ? PALETTE.yellow : PALETTE.red);
      } else if (this.step === "BAKE") {
        drawOvenScene(wx, wy, this.bakeStage, this.doorProgress, this.ovenAnimT, this.insertProgress);
      } else {
        const sc = 3;
        const size = spriteSize(SPRITES.baguetteBare, sc);
        const bx = wx + 10, by = wy + 20;
        drawSprite(ctx, bx, by, sc, SPRITES.baguetteBare);
        if (this.bakeResult === "burnt") {
          ctx.fillStyle = "rgba(20,10,5,0.45)";
          ctx.fillRect(bx, by, size.w, size.h);
        }
        if (this.bakeResult === "raw") {
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fillRect(bx, by, size.w, size.h);
        }
        drawToppingParticles(bx, by, sc, this.toppingParticles);
        if (this.pouringId && this.pourTilted) {
          const cap = bottleCapPos(this.pourPos.x - BOTTLE_W / 2, this.pourPos.y - BOTTLE_H / 2, BOTTLE_TILT_POURING);
          const color = TOPPINGS.find((t) => t.id === this.pouringId).color;
          // Lined up with the baguette: a short stream actually lands on it.
          // Off to the side: a longer stream misses and spills on the counter.
          if (this.pourOverBaguette) drawPourStream(cap.x, cap.y, color, this.wobble, 2, false);
          else drawPourStream(cap.x, cap.y, color, this.wobble, 6, true);
        }
      }

      // Step-specific controls
      if (this.step === "KNEAD") {
        addButton({ x: 260, y: 60, w: 110, h: 34, label: "KNEAD DOUGH", onClick: () => { Audio8.click(); this.step = "SHAPE"; } });
      } else if (this.step === "SHAPE") {
        addButton({
          x: 260, y: 60, w: 110, h: 34, label: "BAKE IT!",
          sub: this.shapeAccuracy + "% shaped",
          onClick: () => { Audio8.click(); this.step = "BAKE"; },
        });
      } else if (this.step === "BAKE") {
        drawBakeGauge(150, 130);
        if (this.bakeStage === "closed") {
          drawPanelText("DRAG THE HANDLE DOWN", 150, 116, 6, PALETTE.yellow);
        } else if (this.bakeStage === "opening") {
          drawPanelText("PULLING OPEN...", 150, 116, 6, PALETTE.yellow);
        } else if (this.bakeStage === "loading") {
          drawPanelText("DRAG THE PEEL IN!", 150, 116, 6, PALETTE.yellow);
        } else if (this.bakeStage === "retracting") {
          drawPanelText("LOADED!", 150, 116, 6, PALETTE.yellow);
        } else if (this.bakeStage === "closing") {
          drawPanelText("DRAG THE HANDLE UP", 150, 116, 6, PALETTE.yellow);
        } else {
          drawPanelText("PRESS B TO BAKE!", 150, 116, 6, PALETTE.yellow);
          addButton({ x: 260, y: 60, w: 110, h: 34, label: "BAKE IT!", sub: "(B)", onClick: () => this.pullFromOven() });
        }
      } else if (this.step === "TOP") {
        drawPanelText("Result: " + this.bakeResult.toUpperCase(), 150, 96, 6, this.bakeResult === "perfect" ? PALETTE.green : (this.bakeResult === "good" ? PALETTE.yellow : PALETTE.red));
        drawPanelText(
          this.pouringId && this.pourTilted && !this.pourOverBaguette ? "MISSING THE BAGUETTE!" : "PICK UP A BOTTLE & POUR IT ON:",
          14, 108, 5.5, this.pouringId && this.pourTilted && !this.pourOverBaguette ? PALETTE.red : PALETTE.white
        );
        TOPPINGS.forEach((t, i) => {
          const r = bottleRackPos(i);
          drawPanelText(t.label, r.x + BOTTLE_W / 2, r.y + BOTTLE_H + 2, 4.5, PALETTE.white, "center");
          if (this.pouringId === t.id) return; // drawn held, at the pointer, below
          const used = (this.toppingParticles[t.id] || []).length > 0;
          drawBottle(r.x, r.y, t, used, 0);
        });
        if (this.pouringId) {
          const t = TOPPINGS.find((tp) => tp.id === this.pouringId);
          const tilt = this.pourTilted ? BOTTLE_TILT_POURING : BOTTLE_TILT_HELD;
          drawBottle(this.pourPos.x - BOTTLE_W / 2, this.pourPos.y - BOTTLE_H / 2, t, true, tilt);
        }
        const gridX = 14, tw = 84, gap = 4;
        addButton({ x: gridX, y: 168, w: 4 * tw + 3 * gap, h: 22, label: "WRAP & GO", font:"6px", onClick: () => {
          Audio8.click();
          // No money changes hands until it's actually delivered — this is
          // just a quality readout for what's about to head out the door.
          const result = this.scoreOrder();
          Game.lastQuality = result;
          Game.popupText = result.label + "!";
          Game.popupTimer = 1.2;
          Game.scene = "DELIVERY";
          Delivery.reset();
        }});
      }

      drawPopup();
    },
  };

  function drawDoughBlob(x, y) {
    ctx.fillStyle = PALETTE.dough;
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(ang) * 14, y + Math.sin(ang) * 10 + 20, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y + 20, 22, 0, Math.PI * 2); ctx.fill();
  }
  function drawDoughSculpt(points, dragIndex) {
    ctx.fillStyle = PALETTE.dough;
    ctx.beginPath();
    points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PALETTE.crust;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    points.forEach((p, i) => {
      ctx.fillStyle = i === dragIndex ? PALETTE.yellow : "rgba(138,82,34,0.85)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === dragIndex ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  function drawShapeTargetGhost(targets) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,207,92,0.55)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    targets.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  function drawShapeGauge(x, y, progress) {
    const w = 190, h = 10;
    ctx.fillStyle = "#241a12";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = PALETTE.yellow;
    ctx.fillRect(x, y, w * progress, h);
    ctx.strokeStyle = PALETTE.ink;
    ctx.strokeRect(x, y, w, h);
  }
  function drawOvenDoor(x, y, frac) {
    // Closed oven door: solid panel with a glowing window.
    // frac: 1 = fully closed, shrinks toward 0 as the door lifts open.
    if (frac <= 0.02) return;
    const doorH = 44 * frac;
    ctx.fillStyle = "#3a2a1e";
    ctx.fillRect(x + 8, y + 12, 114, doorH);
    if (doorH > 16) {
      ctx.fillStyle = "#241a12";
      ctx.fillRect(x + 22, y + 20, 86, Math.min(24, doorH - 8));
      const flick = 0.5 + Math.abs(Math.sin(performance.now() / 90)) * 0.5;
      ctx.fillStyle = `rgba(255,140,40,${flick * 0.6})`;
      ctx.fillRect(x + 24, y + 22, 82, Math.min(20, doorH - 10));
    }
  }
  function drawOvenHandle(hx, hy, grabbable) {
    ctx.fillStyle = grabbable ? PALETTE.yellow : "#c9a227";
    ctx.fillRect(hx - 10, hy - 3, 20, 6);
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(hx - 10, hy - 3, 20, 6);
  }
  function drawPeel(px, py, carrying, highlight) {
    // A first-person peel (paddle) reaching in from the viewer's side to
    // place the baguette, its handle trailing off toward the bottom edge.
    ctx.fillStyle = highlight ? PALETTE.yellow : "#8a5222";
    ctx.fillRect(px - 3, py + 6, 6, 40);
    ctx.fillStyle = "#c98a4b";
    ctx.fillRect(px - 24, py - 4, 48, 8);
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(px - 24, py - 4, 48, 8);
    if (carrying) {
      drawSprite(ctx, px - 18, py - 14, 2, SPRITES.baguetteBare);
    }
  }
  function drawOvenScene(x, y, bakeStage, doorProgress, animT, insertProgress) {
    ctx.fillStyle = "#1a1210";
    ctx.fillRect(x, y + 4, 130, 60);
    ctx.strokeStyle = PALETTE.yellow;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 4, y + 8, 122, 52);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 4, y + 8, 122, 52);
    ctx.clip();

    // The interior (flame + whatever's inside) only shows once the door has
    // lifted enough to see past it.
    if (doorProgress > 0.05) {
      const flick = 0.5 + Math.abs(Math.sin(performance.now() / 90)) * 0.5;
      ctx.fillStyle = `rgba(255,140,40,${flick})`;
      ctx.fillRect(x + 10, y + 48, 110, 8);

      const backY = y + 18, frontY = y + 52;
      if (bakeStage === "loading") {
        // Waiting on the player to drag the peel handle in to push the
        // baguette to the back — it only moves as far as they've dragged it.
        const py = frontY - (frontY - backY) * insertProgress;
        drawPeel(x + 40, py, true, true);
      } else if (bakeStage === "retracting") {
        // Baguette dropped at the back; the empty peel slides back out on its own.
        drawSprite(ctx, x + 30, y + 18, 2.5, SPRITES.baguetteBare);
        const py = backY + (frontY - backY) * animT;
        drawPeel(x + 40, py, false, false);
      } else if (bakeStage === "closing") {
        drawSprite(ctx, x + 30, y + 18, 2.5, SPRITES.baguetteBare);
      }
    }

    drawOvenDoor(x, y, 1 - doorProgress);

    ctx.restore();

    // The door handle, grabbed to pull the door open or push it shut —
    // drawn outside the clip since it hangs below the door's frame.
    if (bakeStage === "closed" || bakeStage === "opening" || bakeStage === "closing") {
      const closedY = y + 16, openY = y + 54;
      drawOvenHandle(x + 65, closedY + (openY - closedY) * doorProgress, true);
    }
  }
  function drawBakeGauge(x, y) {
    const w = 190, h = 16;
    ctx.fillStyle = "#241a12";
    ctx.fillRect(x, y, w, h);
    const center = 0.62;
    const perfectHalf = clamp(0.09 - Game.day * 0.004, 0.04, 0.09);
    const goodHalf = perfectHalf + 0.12;
    ctx.fillStyle = "#6b3520";
    ctx.fillRect(x + (center - goodHalf) * w, y, goodHalf * 2 * w, h);
    ctx.fillStyle = PALETTE.yellow;
    ctx.fillRect(x + (center - perfectHalf) * w, y, perfectHalf * 2 * w, h);
    ctx.fillStyle = PALETTE.white;
    const nx = x + Shop.bakeNeedle * w;
    ctx.fillRect(nx - 2, y - 5, 4, h + 10);
    ctx.strokeStyle = PALETTE.ink;
    ctx.strokeRect(x, y, w, h);
    drawPanelText("raw", x - 2, y + h + 4, 5, "#aaa");
    drawPanelText("burnt", x + w - 22, y + h + 4, 5, "#aaa");
  }

  // ---------------------------------------------------------
  // DELIVERY SCENE — first-person pseudo-3D street ride
  // ---------------------------------------------------------
  const SEG_LEN = 200;         // world units per road segment
  const ROAD_HALF = 1000;      // half road width, in world units
  const RUMBLE_LEN = 3;        // segments per rumble/grass color band
  const LANES = [-620, 0, 620];
  const CAR_HALF_W = 280, PLAYER_HALF_W = 80;
  const CAMERA_DEPTH = 1 / Math.tan((100 / 2) * Math.PI / 180);
  const CAMERA_HEIGHT = 1000;
  const DRAW_DIST = 130;       // segments rendered each frame
  const HORIZON = H * 0.46;
  const X_FACTOR = 64;
  const Y_FACTOR = 26000 * (CAMERA_HEIGHT / 1000);
  const STEER_SPEED = 1950;
  const STOP_ZONE = 1300;      // world units before the house where the bike brakes to a stop
  const ROAD_LIMIT = ROAD_HALF - PLAYER_HALF_W; // how far off-center the bike can steer, keeping it on the pavement
  function baseSpeed(day) { return 2350 + Math.min(day, 12) * 120; }

  const Delivery = {
    segments: [],
    cars: [],
    lastCarZ: -99999,
    roadState: { mode: "straight", remaining: 24, curveDir: 1, curveMag: 0, chunkLen: 1, phase: 0 },
    player: { z: 0, laneOffset: 0, speed: 0 },
    steer: 0,
    targetZ: 0,
    targetSegIndex: 0,
    finished: false,
    finishTimer: 0,

    reset() {
      this.segments = [];
      this.cars = [];
      this.lastCarZ = -99999;
      this.roadState = { mode: "straight", remaining: 24, curveDir: 1, curveMag: 0, chunkLen: 1, phase: 0 };
      this.player.z = 0;
      this.player.laneOffset = 0;
      this.player.speed = baseSpeed(Game.day);
      this.steer = 0;
      this.finished = false;
      this.finishTimer = 0;
      this.targetZ = 34000 + Game.day * 2800 + rand(0, 9000);
      this.targetSegIndex = Math.floor(this.targetZ / SEG_LEN);
      this.ensureUpTo(Math.floor(this.player.z / SEG_LEN) + DRAW_DIST + 5);
    },

    genNextSegment() {
      const st = this.roadState;
      let curve;
      if (st.mode === "straight") {
        curve = 0;
        st.remaining--;
        if (st.remaining <= 0) {
          if (Math.random() < 0.78) {
            st.mode = "curve";
            st.curveDir = Math.random() < 0.5 ? -1 : 1;
            st.chunkLen = randi(18, 34);
            st.phase = 0;
            st.curveMag = (0.9 + Math.random() * 1.0) * (1 + Math.min(Game.day, 10) * 0.05);
          } else {
            st.remaining = randi(14, 30);
          }
        }
      } else {
        st.phase++;
        curve = st.curveDir * st.curveMag * Math.sin(Math.PI * st.phase / st.chunkLen);
        if (st.phase >= st.chunkLen) {
          st.mode = "straight";
          st.remaining = randi(16, 32);
        }
      }
      const idx = this.segments.length ? this.segments[this.segments.length - 1].index + 1 : 0;
      const prevX1 = this.segments.length ? this.segments[this.segments.length - 1].x1 : 0;
      const seg = { index: idx, x0: prevX1, x1: prevX1 + curve, rumble: Math.floor(idx / RUMBLE_LEN) % 2 === 0 };
      this.segments.push(seg);

      if (idx === this.targetSegIndex) {
        seg.deco = { kind: "target" };
      } else if (idx > 4 && idx % 7 === 0) {
        seg.deco = { kind: Math.random() < 0.5 ? "bgA" : "bgB", side: (Math.floor(idx / 7) % 2 === 0) ? -1 : 1 };
      } else if (idx > 4 && idx % 5 === 2) {
        seg.deco = { kind: "tree", side: Math.random() < 0.5 ? -1 : 1 };
      }

      const segZ = idx * SEG_LEN + SEG_LEN * 0.5;
      const farEnoughFromPlayer = segZ > this.player.z + 3600;
      const farEnoughFromLastCar = segZ > this.lastCarZ + 620;
      const shortOfDriveway = segZ < this.targetZ - STOP_ZONE - 300;
      if (farEnoughFromPlayer && farEnoughFromLastCar && shortOfDriveway
          && Math.random() < (0.26 + Math.min(Game.day, 10) * 0.024)) {
        const oncomingChance = 0.55 + Math.min(Game.day, 10) * 0.025;
        const oncoming = Math.random() < oncomingChance;
        this.cars.push({
          z: segZ,
          laneX: choice(LANES),
          vz: oncoming ? -rand(380, 760) : rand(0, 260),
          kind: oncoming ? "front" : "rear",
          color: choice(["#d94f3c", "#4f8ad9", "#ffcf5c", "#8a5cc9", "#57b567"]),
        });
        this.lastCarZ = segZ;
      }
    },
    ensureUpTo(index) {
      index = Math.min(index, this.targetSegIndex);
      while (!this.segments.length || this.segments[this.segments.length - 1].index < index) {
        this.genNextSegment();
      }
      const baseIdx = Math.floor(this.player.z / SEG_LEN);
      while (this.segments.length && this.segments[0].index < baseIdx - 4) this.segments.shift();
      this.cars = this.cars.filter((c) => c.z > this.player.z - 700);
    },
    segmentAt(index) {
      if (!this.segments.length) return null;
      const i = index - this.segments[0].index;
      if (i < 0) return this.segments[0];
      if (i >= this.segments.length) return this.segments[this.segments.length - 1];
      return this.segments[i];
    },
    roadCenterXAt(z) {
      const idx = Math.floor(z / SEG_LEN);
      const seg = this.segmentAt(idx);
      if (!seg) return 0;
      const frac = (z - idx * SEG_LEN) / SEG_LEN;
      return seg.x0 + (seg.x1 - seg.x0) * frac;
    },
    respawnAfterCrash() {
      this.player.z = Math.max(0, this.player.z - 700);
      this.player.laneOffset *= 0.3;
      Game.invuln = 1.4;
    },

    update(dt) {
      if (this.finished) {
        this.finishTimer -= dt;
        if (this.finishTimer <= 0) {
          Game.deliveredTotal++;
          Game.ordersThisDay++;
          if (Game.ordersThisDay >= Game.ordersPerDay) {
            Game.ordersThisDay = 0;
            Game.day++;
            Game.ordersPerDay = 3 + Math.floor(Game.day / 2);
          }
          startNewOrderFlow();
        }
        return;
      }
      if (Game.invuln > 0) Game.invuln -= dt;

      const throttle = (keys.has("ArrowUp") || keys.has("KeyW")) ? 1 : (keys.has("ArrowDown") || keys.has("KeyS")) ? -1 : 0;
      const cruise = baseSpeed(Game.day);
      let targetSpeed = throttle > 0 ? cruise * 1.42 : throttle < 0 ? cruise * 0.55 : cruise;
      const distToEnd = this.targetZ - this.player.z;
      if (distToEnd < STOP_ZONE) {
        // brake to a stop as the house comes up, so the road's end is a real stop, not a fly-by
        targetSpeed = Math.min(targetSpeed, cruise * clamp(distToEnd / STOP_ZONE, 0, 1));
      }
      this.player.speed += (targetSpeed - this.player.speed) * clamp(dt * 3, 0, 1);

      let steer = 0;
      if (keys.has("ArrowLeft") || keys.has("KeyA")) steer -= 1;
      if (keys.has("ArrowRight") || keys.has("KeyD")) steer += 1;
      if (steerPointer) steer += steerPointer;
      steer = clamp(steer, -1, 1);
      this.steer = steer;
      this.player.laneOffset = clamp(this.player.laneOffset + steer * STEER_SPEED * dt, -ROAD_LIMIT, ROAD_LIMIT);

      this.player.z = Math.min(this.targetZ, this.player.z + this.player.speed * dt);
      this.ensureUpTo(Math.floor(this.player.z / SEG_LEN) + DRAW_DIST + 5);

      this.cars.forEach((c) => { c.z += c.vz * dt; });

      if (Game.invuln <= 0) {
        const px = this.roadCenterXAt(this.player.z) + this.player.laneOffset;
        for (const c of this.cars) {
          if (Math.abs(c.z - this.player.z) < 170) {
            const cx = this.roadCenterXAt(c.z) + c.laneX;
            if (Math.abs(cx - px) < CAR_HALF_W + PLAYER_HALF_W) {
              loseLife("CRASH!");
              if (Game.scene === "DELIVERY") this.respawnAfterCrash();
              return;
            }
          }
        }
      }

      if (!this.finished && this.player.z >= this.targetZ) {
        this.finished = true;
        this.finishTimer = 1.3;
        // This is the only moment money actually changes hands.
        const tip = deliveryPayout();
        Game.score += tip;
        Game.popupText = "DELIVERED! +$" + tip;
        Game.popupTimer = 1.3;
        Audio8.success();
      }
    },

    render() {
      buttons = [];
      ctx.fillStyle = "#1a1430";
      ctx.fillRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 0, 0, HORIZON);
      grad.addColorStop(0, "#231c40");
      grad.addColorStop(1, "#3d3164");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, HORIZON);
      ctx.fillStyle = "#2b2350";
      const parallax = (this.player.z * 0.018) % 160;
      for (let i = -1; i < Math.ceil(W / 160) + 1; i++) {
        ctx.fillRect(i * 160 - parallax, HORIZON - 22, 96, 22);
      }

      const camX = this.roadCenterXAt(this.player.z) + this.player.laneOffset;
      const camZ = this.player.z;
      const baseIndex = Math.floor(this.player.z / SEG_LEN);

      const project = (worldX, worldZ) => {
        let dz = worldZ - camZ;
        if (dz < 1) dz = 1;
        const scale = CAMERA_DEPTH / dz;
        return {
          x: W / 2 + scale * (worldX - camX) * X_FACTOR,
          y: HORIZON + scale * Y_FACTOR,
          w: scale * ROAD_HALF * X_FACTOR * 2,
          scale,
        };
      };
      const quad = (x1, y1, x2, y2, x3, y3, x4, y4, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
        ctx.closePath();
        ctx.fill();
      };

      const decos = []; // deferred so nearer ones draw over farther road strips, in far-to-near order
      for (let n = DRAW_DIST - 1; n >= 0; n--) {
        const idx = baseIndex + n;
        if (idx > this.targetSegIndex) continue; // the road physically ends at the house
        const seg = this.segmentAt(idx);
        if (!seg) continue;
        const p1 = project(seg.x0, idx * SEG_LEN);
        const p2 = project(seg.x1, (idx + 1) * SEG_LEN);
        if (p1.y <= HORIZON || p2.y <= HORIZON) continue;

        const grassColor = seg.rumble ? "#2f6b3a" : "#295f33";
        const roadColor = seg.rumble ? "#3a3a44" : "#37374a";
        const rumbleColor = seg.rumble ? "#c94f3c" : "#e8d9a0";

        ctx.fillStyle = grassColor;
        ctx.fillRect(0, Math.min(p2.y, H), W, Math.max(1, Math.min(p1.y, H) - Math.min(p2.y, H)));

        const rw1 = p1.w * 1.14, rw2 = p2.w * 1.14;
        quad(p1.x - p1.w / 2, p1.y, p1.x + p1.w / 2, p1.y, p2.x + p2.w / 2, p2.y, p2.x - p2.w / 2, p2.y, roadColor);
        quad(p1.x - rw1 / 2, p1.y, p1.x - p1.w / 2, p1.y, p2.x - p2.w / 2, p2.y, p2.x - rw2 / 2, p2.y, rumbleColor);
        quad(p1.x + p1.w / 2, p1.y, p1.x + rw1 / 2, p1.y, p2.x + rw2 / 2, p2.y, p2.x + p2.w / 2, p2.y, rumbleColor);
        if (seg.rumble) {
          const lw1 = Math.max(1, p1.w * 0.035), lw2 = Math.max(1, p2.w * 0.035);
          quad(p1.x - lw1 / 2, p1.y, p1.x + lw1 / 2, p1.y, p2.x + lw2 / 2, p2.y, p2.x - lw2 / 2, p2.y, "#e8d9a0");
        }

        if (idx === this.targetSegIndex) {
          // a hedge closing off the far end, so the road visibly stops here
          const hw1 = p2.w * 1.2;
          const hedgeTopY = p2.y - Math.max(2, p2.w * 0.08);
          quad(p2.x - hw1 / 2, hedgeTopY, p2.x + hw1 / 2, hedgeTopY, p2.x + hw1 / 2, p2.y, p2.x - hw1 / 2, p2.y, "#245029");
        }

        if (seg.deco) decos.push({ deco: seg.deco, idx, x0: seg.x0, x1: seg.x1 });
        this.cars.forEach((c) => {
          if (Math.floor(c.z / SEG_LEN) === idx) decos.push({ car: c });
        });
      }

      // draw decorations/cars in the same far-to-near order they were collected
      decos.forEach((d) => {
        if (d.car) {
          const c = d.car;
          const wx = this.roadCenterXAt(c.z) + c.laneX;
          const p = project(wx, c.z);
          if (p.y <= HORIZON) return;
          // Scale the sprite so its on-screen width matches the car's actual world-space
          // width (same math as the road itself), so it fills roughly one lane instead
          // of ballooning toward the full road width as it gets close.
          const carWorldW = CAR_HALF_W * 2;
          const sc = clamp((p.scale * carWorldW * X_FACTOR) / 14, 0.3, 9);
          const spr = c.kind === "front" ? carFrontSprite(c.color) : carRearSprite(c.color);
          const sz = spriteSize(spr, sc);
          drawSprite(ctx, p.x - sz.w / 2, p.y - sz.h, sc, spr);
        } else {
          const deco = d.deco;
          if (deco.kind === "target") {
            // the destination sits centered, right at the literal end of the road
            const p = project(d.x1, this.targetZ);
            if (p.y <= HORIZON) return;
            const sc = clamp((p.scale * 1500 * X_FACTOR) / 17, 0.6, 8);
            const spr = SPRITES.houseTarget;
            const sz = spriteSize(spr, sc);
            const pulse = 0.6 + Math.sin(performance.now() / 150) * 0.4;
            ctx.save();
            ctx.shadowColor = `rgba(255,207,92,${pulse})`;
            ctx.shadowBlur = 12 * sc;
            drawSprite(ctx, p.x - sz.w / 2, p.y - sz.h, sc, spr);
            ctx.restore();
            drawSprite(ctx, p.x - sz.w / 2 - 12 * sc, p.y - sz.h - 18 * sc, sc, SPRITES.houseFlag);
            return;
          }
          const margin = deco.kind === "tree" ? 260 : 900;
          const wx = d.x0 + deco.side * (ROAD_HALF + margin);
          const p = project(wx, d.idx * SEG_LEN);
          if (p.y <= HORIZON) return;
          if (deco.kind === "bgA" || deco.kind === "bgB") {
            const spr = deco.kind === "bgA" ? SPRITES.houseBgA : SPRITES.houseBgB;
            const sc = clamp(p.scale * 8000, 0.4, 5.5);
            const sz = spriteSize(spr, sc);
            drawSprite(ctx, p.x - sz.w / 2, p.y - sz.h, sc, spr);
          } else if (deco.kind === "tree") {
            const sc = clamp(p.scale * 7000, 0.4, 5);
            ctx.fillStyle = "#5a3f2a";
            ctx.fillRect(p.x - 2 * sc, p.y - 10 * sc, 4 * sc, 10 * sc);
            ctx.fillStyle = "#2f6b3a";
            ctx.beginPath();
            ctx.arc(p.x, p.y - 14 * sc, 8 * sc, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      drawCockpit(this.steer);
      drawHUD();

      // progress bar
      const barX = 10, barY = 24, barW = W - 20;
      ctx.fillStyle = "rgba(10,6,16,0.5)";
      ctx.fillRect(barX, barY, barW, 5);
      const frac = clamp(this.player.z / this.targetZ, 0, 1);
      ctx.fillStyle = PALETTE.yellow;
      ctx.fillRect(barX, barY, barW * frac, 5);
      ctx.fillStyle = PALETTE.ink;
      ctx.beginPath();
      ctx.moveTo(barX + barW, barY - 2); ctx.lineTo(barX + barW + 5, barY + 2.5); ctx.lineTo(barX + barW, barY + 7);
      ctx.closePath(); ctx.fill();

      const distRemaining = Math.max(0, Math.round((this.targetZ - this.player.z) / 10));
      const label = this.finished ? "Delivered!" : "To " + Game.order.customer + "'s — " + distRemaining + "m";
      drawPanelText(label, W / 2, H - 8, 5.5, PALETTE.white, "center");

      // faint tap-zone hints for touch steering
      ctx.fillStyle = "rgba(244,234,208,0.10)";
      ctx.beginPath(); ctx.moveTo(14, H - 20); ctx.lineTo(26, H - 26); ctx.lineTo(26, H - 14); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(W - 14, H - 20); ctx.lineTo(W - 26, H - 26); ctx.lineTo(W - 26, H - 14); ctx.closePath(); ctx.fill();

      drawPopup();
    },
  };

  function drawCockpit(steer) {
    const lean = steer * 9;
    const cx = W / 2 + lean;
    ctx.save();
    const glow = ctx.createRadialGradient(W / 2, HORIZON + 6, 4, W / 2, HORIZON + 6, 100);
    glow.addColorStop(0, "rgba(255,240,190,0.16)");
    glow.addColorStop(1, "rgba(255,240,190,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, HORIZON - 20, W, 110);
    ctx.restore();

    ctx.fillStyle = "#1c1712";
    ctx.beginPath();
    ctx.moveTo(cx - 74, H);
    ctx.lineTo(cx - 42, H - 24);
    ctx.lineTo(cx + 42, H - 24);
    ctx.lineTo(cx + 74, H);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#3a3a44";
    ctx.fillRect(cx - 76, H - 13, 20, 13);
    ctx.fillRect(cx + 56, H - 13, 20, 13);
    ctx.fillStyle = PALETTE.crust;
    ctx.fillRect(cx - 14, H - 28, 28, 7);

    const bx = W - 56, by = H - 38;
    ctx.fillStyle = "#6b4426";
    ctx.fillRect(bx, by + 8, 40, 20);
    drawSprite(ctx, bx + 1, by - 4, 1.5, SPRITES.baguetteBare);
    drawToppingsOnBaguette(bx + 1, by - 4, 1.5, Game.order.toppings);
  }

  // ---------------------------------------------------------
  // HUD / Popup
  // ---------------------------------------------------------
  function drawHUD() {
    ctx.fillStyle = "rgba(10,6,16,0.55)";
    ctx.fillRect(0, 0, W, 20);
    // one hit and it's over, so the HUD shows a single life, not a row of hearts
    drawSprite(ctx, 8, 6, 1.6, Game.lives > 0 ? SPRITES.heart : SPRITES.heartEmpty);
    drawPanelText("$" + Game.score, 30, 6, 7, PALETTE.yellow);
    drawPanelText("DAY " + Game.day, W - 10, 6, 6, "#a89a86", "right");
  }
  function drawPopup() {
    if (Game.popupTimer > 0) {
      Game.popupTimer -= 1 / 60;
      const alpha = clamp(Game.popupTimer, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = PALETTE.ink;
      ctx.font = "10px 'Press Start 2P', monospace";
      ctx.textAlign = "center";
      const ty = H / 2 - 40;
      const tw = ctx.measureText(Game.popupText).width + 16;
      ctx.fillStyle = "rgba(20,14,10,0.8)";
      ctx.fillRect(W / 2 - tw / 2, ty - 12, tw, 20);
      ctx.fillStyle = PALETTE.yellow;
      ctx.fillText(Game.popupText, W / 2, ty - 2);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------
  // TITLE / GAME OVER
  // ---------------------------------------------------------
  function renderTitle() {
    buttons = [];
    ctx.fillStyle = "#1a1430";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = i % 2 ? "#3a2f5c" : "#2b2350";
      ctx.fillRect((i * 37) % W, (i * 71) % H, 2, 2);
    }
    const sc = 4;
    const sz = spriteSize(SPRITES.baguetteBare, sc);
    const bob = Math.sin(performance.now() / 300) * 4;
    drawSprite(ctx, W / 2 - sz.w / 2, 40 + bob, sc, SPRITES.baguetteBare);
    drawToppingsOnBaguette(W / 2 - sz.w / 2, 40 + bob, sc, ["cinnamon", "sugar"]);

    drawPanelText("Run a bakery. Fill orders.", W / 2, 110, 7, PALETTE.white, "center");
    drawPanelText("Ride the street to deliver!", W / 2, 122, 7, PALETTE.white, "center");

    addButton({
      x: W / 2 - 70, y: 145, w: 140, h: 30, label: "START GAME",
      onClick: () => { Audio8.start(); resetGame(); },
    });
    drawPanelText("Steer: Arrows/A,D · Throttle: Up/Down", W / 2, 190, 5.5, "#a89a86", "center");
  }

  function renderGameOver() {
    buttons = [];
    ctx.fillStyle = "#1a0f0f";
    ctx.fillRect(0, 0, W, H);
    drawPanelText("GAME OVER", W / 2, 50, 14, PALETTE.red, "center");
    drawPanelText("Total Earned: $" + Game.score, W / 2, 90, 8, PALETTE.yellow, "center");
    drawPanelText("Orders Delivered: " + Game.deliveredTotal, W / 2, 105, 7, PALETTE.white, "center");
    drawPanelText("Days Survived: " + Game.day, W / 2, 118, 7, PALETTE.white, "center");
    addButton({
      x: W / 2 - 70, y: 145, w: 140, h: 30, label: "TRY AGAIN",
      onClick: () => { Audio8.start(); resetGame(); },
    });
  }

  // ---------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyP" && (Game.scene === "SHOP" || Game.scene === "DELIVERY")) {
      Game.paused = !Game.paused;
    }
    if (e.code === "Enter" && Game.scene === "TITLE") { Audio8.start(); resetGame(); }
    if (e.code === "Enter" && Game.scene === "GAMEOVER") { Audio8.start(); resetGame(); }
    if (Game.scene === "SHOP" && Shop.step === "BAKE") {
      if (e.code === "KeyB") Shop.pullFromOven();
    }
  });

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (!Game.paused) {
      if (Game.scene === "SHOP") Shop.update(dt);
      else if (Game.scene === "DELIVERY") Delivery.update(dt);
    }

    if (Game.scene === "TITLE") renderTitle();
    else if (Game.scene === "SHOP") Shop.render();
    else if (Game.scene === "DELIVERY") Delivery.render();
    else if (Game.scene === "GAMEOVER") renderGameOver();

    buttons.forEach(drawButton);

    if (Game.paused && (Game.scene === "SHOP" || Game.scene === "DELIVERY")) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, W, H);
      drawPanelText("PAUSED", W / 2, H / 2 - 6, 10, PALETTE.white, "center");
      drawPanelText("press P to resume", W / 2, H / 2 + 10, 6, "#a89a86", "center");
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();

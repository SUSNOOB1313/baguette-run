/* ============================================================
   BAGUETTE RUN — an 8-bit-style bakery + delivery game
   Two phases per order:
     1) SHOP   — knead, shape, bake and top a baguette to match an order
     2) DELIVERY — dodge cars across a Frogger-style street to the house
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
    sky: "#1a1430",
    sky2: "#2b2350",
    road: "#3a3a44",
    roadLine: "#e8d9a0",
    sidewalk: "#6b5a44",
    grass: "#2f6b3a",
    grassDark: "#245029",
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
        ctx.fillRect(Math.round(x + c * scale), Math.round(y + r * scale), scale, scale);
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

  // Bike + rider, viewed from behind/above (moving up the screen)
  function bikeSprite(leanFrame) {
    const lean = leanFrame || 0; // -1 left, 0 straight, 1 right
    const shift = lean === -1 ? "l" : lean === 1 ? "r" : "s";
    const base = {
      s: [
        "...kkk...",
        "..kwwwk..",
        "..kssss..",
        ".kssssssk.",
        ".kssssssk.",
        "..kbbbbk..",
        "...kbbk...",
        "..wk..kw..",
        ".ww....ww.",
      ],
      l: [
        "..kkk....",
        ".kwwwk...",
        ".kssss...",
        "kssssssk.",
        "kssssssk.",
        ".kbbbbk..",
        "..kbbk...",
        ".wk..kw..",
        "ww....ww.",
      ],
      r: [
        "....kkk..",
        "...kwwwk.",
        "...ssssk.",
        ".kssssssk",
        ".kssssssk",
        "..kbbbbk.",
        "...kbbk..",
        "..wk..kw.",
        ".ww....ww",
      ],
    };
    return {
      colors: { k: "#241a12", w: "#f4c9a3", s: "#d94f3c", b: "#3a3a44" },
      rows: base[shift],
    };
  }

  function carSprite(color) {
    return {
      colors: { k: "#141018", b: color, w: "#bfe6ff", t: "#0f0f0f" },
      rows: [
        ".kkkkkkkkkkkk.",
        "kbbbbbbbbbbbbk",
        "kbbwwwwwwwbbbk",
        "kbbbbbbbbbbbbk",
        "kbbbbbbbbbbbbk",
        ".t..t..t..t..",
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

  // ---------------------------------------------------------
  // Input
  // ---------------------------------------------------------
  const keys = new Set();
  const keysPressed = new Set(); // edge-triggered
  window.addEventListener("keydown", (e) => {
    if (!keys.has(e.code)) keysPressed.add(e.code);
    keys.add(e.code);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));

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
  canvas.addEventListener("touchstart", handleClick, { passive: false });

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
    lives: 3,
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
    return {
      customer: choice(CUSTOMERS),
      toppings: picked,
      house: randi(0, 4), // which house column to deliver to
    };
  }

  function startNewOrderFlow() {
    Game.order = newOrder();
    Game.scene = "SHOP";
    Shop.reset();
  }

  function resetGame() {
    Game.score = 0;
    Game.lives = 3;
    Game.day = 1;
    Game.ordersThisDay = 0;
    Game.ordersPerDay = 3;
    Game.deliveredTotal = 0;
    Game.invuln = 0;
    startNewOrderFlow();
  }

  function loseLife(reasonText) {
    Game.lives--;
    Audio8.crash();
    if (Game.lives <= 0) {
      Game.scene = "GAMEOVER";
      Audio8.gameover();
    } else {
      Game.popupText = reasonText || "CRASH!";
      Delivery.respawn();
    }
  }

  // ---------------------------------------------------------
  // SHOP SCENE
  // ---------------------------------------------------------
  const Shop = {
    step: "KNEAD", // KNEAD -> SHAPE -> BAKE -> TOP -> WRAP -> DONE
    bakeNeedle: 0,
    bakeDir: 1,
    bakeSpeed: 1.7,
    bakeResult: null, // 'perfect' | 'good' | 'burnt' | 'raw'
    selectedToppings: [],
    wobble: 0,
    reset() {
      this.step = "KNEAD";
      this.bakeNeedle = 0;
      this.bakeDir = 1;
      this.bakeSpeed = 1.6 + Game.day * 0.15;
      this.bakeResult = null;
      this.selectedToppings = [];
      this.wobble = 0;
    },
    update(dt) {
      this.wobble += dt;
      if (this.step === "BAKE") {
        this.bakeNeedle += this.bakeDir * this.bakeSpeed * dt;
        if (this.bakeNeedle > 1) { this.bakeNeedle = 1; this.bakeDir = -1; }
        if (this.bakeNeedle < 0) { this.bakeNeedle = 0; this.bakeDir = 1; }
      }
    },
    pullFromOven() {
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
    toggleTopping(id) {
      const i = this.selectedToppings.indexOf(id);
      if (i >= 0) this.selectedToppings.splice(i, 1);
      else this.selectedToppings.push(id);
      Audio8.toggle();
    },
    scoreOrder() {
      const order = Game.order;
      const want = new Set(order.toppings);
      const got = new Set(this.selectedToppings);
      let mismatches = 0;
      want.forEach((t) => { if (!got.has(t)) mismatches++; });
      got.forEach((t) => { if (!want.has(t)) mismatches++; });
      const bakeRank = { perfect: 3, good: 2, raw: 1, burnt: 1 }[this.bakeResult];
      let rank = bakeRank - mismatches;
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
      drawPanelText("YOUR BAGUETTE", wx, 26, 7, PALETTE.white);
      const bob = this.step !== "BAKE" ? Math.sin(this.wobble * 4) * 1.5 : 0;
      if (this.step === "KNEAD" ) {
        drawDoughBlob(wx + 20, wy + 10 + bob);
      } else if (this.step === "SHAPE") {
        drawDoughLoaf(wx + 10, wy + 6 + bob);
      } else if (this.step === "BAKE") {
        drawOvenScene(wx, wy);
      } else {
        const sc = 3;
        const size = spriteSize(SPRITES.baguetteBare, sc);
        const bx = wx + 10, by = wy + 20;
        const tint = this.bakeResult === "burnt" ? "#3a2010" : null;
        drawSprite(ctx, bx, by, sc, SPRITES.baguetteBare);
        if (this.bakeResult === "burnt") {
          ctx.fillStyle = "rgba(20,10,5,0.45)";
          ctx.fillRect(bx, by, size.w, size.h);
        }
        if (this.bakeResult === "raw") {
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fillRect(bx, by, size.w, size.h);
        }
        drawToppingsOnBaguette(bx, by, sc, this.selectedToppings);
      }

      // Step-specific controls
      if (this.step === "KNEAD") {
        addButton({ x: 260, y: 60, w: 110, h: 34, label: "KNEAD DOUGH", onClick: () => { Audio8.click(); this.step = "SHAPE"; } });
      } else if (this.step === "SHAPE") {
        addButton({ x: 260, y: 60, w: 110, h: 34, label: "SHAPE LOAF", onClick: () => { Audio8.click(); this.step = "BAKE"; } });
      } else if (this.step === "BAKE") {
        drawBakeGauge(150, 130);
        addButton({ x: 260, y: 60, w: 110, h: 34, label: "PULL FROM OVEN!", onClick: () => this.pullFromOven() });
      } else if (this.step === "TOP") {
        drawPanelText("Result: " + this.bakeResult.toUpperCase(), 150, 96, 6, this.bakeResult === "perfect" ? PALETTE.green : (this.bakeResult === "good" ? PALETTE.yellow : PALETTE.red));
        drawPanelText("ADD TOPPINGS TO MATCH:", 14, 108, 6, PALETTE.white);
        const gridX = 14, tw = 84, th = 20, gap = 4;
        TOPPINGS.forEach((t, i) => {
          const col = i % 4, row = Math.floor(i / 4);
          const bx = gridX + col * (tw + gap);
          const by = 118 + row * (th + gap);
          const active = this.selectedToppings.includes(t.id);
          addButton({ x: bx, y: by, w: tw, h: th, label: t.label, active, font: "6px",
            onClick: () => this.toggleTopping(t.id) });
        });
        addButton({ x: gridX, y: 168, w: 4 * tw + 3 * gap, h: 22, label: "WRAP & GO", font:"6px", onClick: () => {
          Audio8.click();
          const result = this.scoreOrder();
          Game.lastQuality = result;
          Game.score += result.points;
          Game.popupText = result.label + "  +" + result.points;
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
  function drawDoughLoaf(x, y) {
    ctx.fillStyle = PALETTE.dough;
    ctx.fillRect(x, y + 10, 100, 26);
    ctx.beginPath(); ctx.arc(x, y + 23, 13, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 100, y + 23, 13, 0, Math.PI * 2); ctx.fill();
  }
  function drawOvenScene(x, y) {
    ctx.fillStyle = "#1a1210";
    ctx.fillRect(x, y + 4, 130, 60);
    ctx.strokeStyle = PALETTE.yellow;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 4, y + 8, 122, 52);
    const flick = 0.5 + Math.abs(Math.sin(performance.now() / 90)) * 0.5;
    ctx.fillStyle = `rgba(255,140,40,${flick})`;
    ctx.fillRect(x + 10, y + 48, 110, 8);
    drawSprite(ctx, x + 30, y + 18, 2.5, SPRITES.baguetteBare);
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
  // DELIVERY SCENE — Frogger-style street crossing
  // ---------------------------------------------------------
  const ROAD_TOP = 34, ROAD_BOTTOM = 178;
  const Delivery = {
    player: { x: W / 2, y: 0, w: 14, h: 16, lean: 0 },
    lanes: [],
    targetCol: 2,
    timeLeft: 0,
    finished: false,
    finishTimer: 0,
    reset() {
      this.player.x = W / 2;
      this.player.y = ROAD_BOTTOM + 16;
      this.player.lean = 0;
      this.finished = false;
      this.finishTimer = 0;
      this.targetCol = Game.order.house;
      const laneCount = Math.min(3 + Math.floor(Game.day / 2), 7);
      this.lanes = [];
      const laneH = (ROAD_BOTTOM - ROAD_TOP) / laneCount;
      const baseSpeed = 24 + Game.day * 5;
      for (let i = 0; i < laneCount; i++) {
        const isSafe = i % 3 === 2 && laneCount > 3; // occasional median every 3rd
        const dir = i % 2 === 0 ? 1 : -1;
        const speed = isSafe ? 0 : baseSpeed * rand(0.7, 1.3);
        const cars = [];
        if (!isSafe) {
          const carCount = randi(2, 2 + Math.floor(Game.day / 2));
          for (let c = 0; c < carCount; c++) {
            cars.push({
              x: rand(0, W),
              color: choice(["#d94f3c", "#4f8ad9", "#ffcf5c", "#8a5cc9", "#57b567"]),
              w: 26, h: 14,
            });
          }
        }
        this.lanes.push({ y: ROAD_TOP + i * laneH + laneH / 2 - 7, h: laneH, dir, speed, cars, safe: isSafe });
      }
      this.timeLeft = 18 + laneCount * 2;
    },
    respawn() {
      this.player.x = W / 2;
      this.player.y = ROAD_BOTTOM + 16;
      Game.invuln = 1.5;
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
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        loseLife("TOO SLOW! BAGUETTE WENT COLD.");
        return;
      }

      const speed = 62;
      let dx = 0, dy = 0;
      if (keys.has("ArrowLeft") || keys.has("KeyA")) dx -= 1;
      if (keys.has("ArrowRight") || keys.has("KeyD")) dx += 1;
      if (keys.has("ArrowUp") || keys.has("KeyW")) dy -= 1;
      if (keys.has("ArrowDown") || keys.has("KeyS")) dy += 1;
      this.player.lean = dx < 0 ? -1 : dx > 0 ? 1 : 0;
      if (dx || dy) {
        const len = Math.hypot(dx, dy) || 1;
        this.player.x += (dx / len) * speed * dt;
        this.player.y += (dy / len) * speed * dt;
      }
      this.player.x = clamp(this.player.x, 12, W - 12);
      this.player.y = clamp(this.player.y, ROAD_TOP - 10, ROAD_BOTTOM + 20);

      // move cars
      this.lanes.forEach((lane) => {
        lane.cars.forEach((car) => {
          car.x += lane.dir * lane.speed * dt;
          if (lane.dir > 0 && car.x > W + 20) car.x = -20;
          if (lane.dir < 0 && car.x < -20) car.x = W + 20;
        });
      });

      // collisions
      if (Game.invuln <= 0) {
        for (const lane of this.lanes) {
          if (lane.safe) continue;
          if (this.player.y + this.player.h / 2 < lane.y || this.player.y - this.player.h / 2 > lane.y + lane.h) continue;
          for (const car of lane.cars) {
            if (Math.abs(this.player.x - car.x) < (car.w / 2 + this.player.w / 2 - 3)) {
              loseLife("CRASH!");
              return;
            }
          }
        }
      }

      // reached house?
      if (this.player.y < ROAD_TOP - 2) {
        const houseX = houseColumnX(this.targetCol);
        if (Math.abs(this.player.x - houseX) < 26) {
          this.finished = true;
          this.finishTimer = 1.1;
          Game.score += Math.round(this.timeLeft) * 2;
          Game.popupText = "DELIVERED! +" + (Math.round(this.timeLeft) * 2);
          Game.popupTimer = 1.1;
          Audio8.success();
        } else {
          this.player.y = ROAD_TOP - 2;
        }
      }
    },
    render() {
      buttons = [];
      // sky / start sidewalk
      ctx.fillStyle = PALETTE.sky;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = PALETTE.grass;
      ctx.fillRect(0, 0, W, ROAD_TOP);
      ctx.fillStyle = PALETTE.sidewalk;
      ctx.fillRect(0, ROAD_BOTTOM, W, H - ROAD_BOTTOM);

      // houses along the top
      for (let i = 0; i < 5; i++) {
        const hx = houseColumnX(i);
        const isTarget = i === this.targetCol;
        ctx.save();
        if (isTarget) {
          const pulse = 0.7 + Math.sin(performance.now() / 150) * 0.3;
          ctx.shadowColor = `rgba(255,207,92,${pulse})`;
          ctx.shadowBlur = 8;
        }
        const sc = 2;
        const sz = spriteSize(SPRITES.houseTarget, sc);
        drawSprite(ctx, hx - sz.w / 2, 4, sc, SPRITES.houseTarget);
        ctx.restore();
        if (isTarget) {
          drawSprite(ctx, hx - sz.w / 2 - 8, -2, 1.6, SPRITES.houseFlag);
        }
      }

      // lanes
      this.lanes.forEach((lane) => {
        if (lane.safe) {
          ctx.fillStyle = PALETTE.grassDark;
          ctx.fillRect(0, lane.y - 3, W, lane.h);
        } else {
          ctx.fillStyle = PALETTE.road;
          ctx.fillRect(0, lane.y - 3, W, lane.h);
          ctx.fillStyle = PALETTE.roadLine;
          const dashW = 10, gap = 8;
          const offset = (performance.now() / 20) % (dashW + gap) * -Math.sign(lane.dir || 1);
          for (let dx = offset; dx < W; dx += dashW + gap) {
            ctx.fillRect(dx, lane.y + lane.h / 2 - 4, dashW, 2);
          }
          lane.cars.forEach((car) => {
            const sc = 2;
            const spr = carSprite(car.color);
            const sz = spriteSize(spr, sc);
            ctx.save();
            if (lane.dir < 0) { ctx.translate(car.x, lane.y + lane.h / 2 - sz.h / 2 + sz.h/2); ctx.scale(-1, 1); ctx.translate(-car.x, -(lane.y + lane.h / 2 - sz.h / 2 + sz.h/2)); }
            drawSprite(ctx, car.x - sz.w / 2, lane.y + lane.h / 2 - sz.h / 2, sc, spr);
            ctx.restore();
          });
        }
      });

      // player
      if (Game.invuln <= 0 || Math.floor(performance.now() / 100) % 2 === 0) {
        const sc = 1.7;
        const spr = bikeSprite(this.player.lean);
        const sz = spriteSize(spr, sc);
        drawSprite(ctx, this.player.x - sz.w / 2, this.player.y - sz.h / 2, sc, spr);
        drawToppingsOnBaguette(this.player.x - 6, this.player.y - sz.h / 2 - 2, 1, Game.order.toppings);
      }

      drawHUD();
      drawPanelText("TIME " + Math.max(0, Math.ceil(this.timeLeft)), W - 10, 6, 7, this.timeLeft < 5 ? PALETTE.red : PALETTE.white, "right");
      drawPanelText("Deliver to Marie's — glowing house!".replace("Marie's", Game.order.customer + "'s"), W / 2, H - 10, 5.5, PALETTE.white, "center");

      drawPopup();
    },
  };
  function houseColumnX(col) {
    return 76 + col * ((W - 152) / 4);
  }

  // ---------------------------------------------------------
  // HUD / Popup
  // ---------------------------------------------------------
  function drawHUD() {
    ctx.fillStyle = "rgba(10,6,16,0.55)";
    ctx.fillRect(0, 0, W, 20);
    for (let i = 0; i < 3; i++) {
      const spr = i < Game.lives ? SPRITES.heart : SPRITES.heartEmpty;
      drawSprite(ctx, 8 + i * 12, 6, 1.6, spr);
    }
    drawPanelText("SCORE " + Game.score, 70, 6, 7, PALETTE.yellow);
    drawPanelText("DAY " + Game.day, W - 10, H - 12, 6, "#a89a86", "right");
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
    ctx.fillStyle = PALETTE.sky;
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
    drawPanelText("Dodge cars to deliver!", W / 2, 122, 7, PALETTE.white, "center");

    addButton({
      x: W / 2 - 70, y: 145, w: 140, h: 30, label: "START GAME",
      onClick: () => { Audio8.start(); resetGame(); },
    });
    drawPanelText("Arrow Keys/WASD to ride · Click to bake", W / 2, 190, 5.5, "#a89a86", "center");
  }

  function renderGameOver() {
    buttons = [];
    ctx.fillStyle = "#1a0f0f";
    ctx.fillRect(0, 0, W, H);
    drawPanelText("GAME OVER", W / 2, 50, 14, PALETTE.red, "center");
    drawPanelText("Final Score: " + Game.score, W / 2, 90, 8, PALETTE.yellow, "center");
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
  });

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    keysPressed.clear();

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

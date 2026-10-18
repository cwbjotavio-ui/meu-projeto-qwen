/* =========================================================
   🐍 COBRA LADRÃO — Jogo da cobrinha clássico multijogador
   - Até 4 jogadores no mesmo teclado
   - BATER NA CABEÇA DE OUTRO = ROUBAR METADE DAS BOLINHAS
   - Bater no corpo de outro jogador ou na parede = morre
     (e as bolinhas dele viram "bônus" que outros podem roubar)
   ========================================================= */

(() => {
  "use strict";

  // ---------- Configuração do tabuleiro ----------
  const COLS = 48, ROWS = 32, CELL = 15;      // canvas = 720x480
  const MAX_PLAYERS = 4;

  const PLAYER_DEFS = [
    { name: "Jogador 1", color: "#4ade80", keys: { up:"KeyW", down:"KeyS", left:"KeyA", right:"KeyD" }, keyLabel: "W A S D" },
    { name: "Jogador 2", color: "#f87171", keys: { up:"ArrowUp", down:"ArrowDown", left:"ArrowLeft", right:"ArrowRight" }, keyLabel: "Setas ↑↓←→" },
    { name: "Jogador 3", color: "#facc15", keys: { up:"KeyI", down:"KeyK", left:"KeyJ", right:"KeyL" }, keyLabel: "I J K L" },
    { name: "Jogador 4", color: "#a78bfa", keys: { up:"Numpad8", down:"Numpad5", left:"Numpad4", right:"Numpad6" }, keyLabel: "Teclado numérico 8 4 5 6" },
  ];

  // Bolinhas especiais (aparecem de vez em quando)
  const FOOD_TYPES = {
    normal: { value: 1, color: "#f472b6", radius: .35, grow: 1 },
    big:    { value: 3, color: "#fb923c", radius: .45, grow: 3 },
    bonus:  { value: 2, color: "#38bdf8", radius: .40, grow: 2 }, // solta por quem morreu
  };

  // ---------- Estado ----------
  let players = [], foods = [], floaters = [];
  let tickMs = 105, timer = null, running = false, paused = false;
  let round = 0;
  let occupied = new Set();          // células ocupadas por cobras
  let respawnTimers = new Map();     // playerIndex -> ticks restantes p/ respawn
  let gameOverFlag = false;
  let deaths = new Map();            // playerIndex -> nº de mortes (limite p/ modo solo)

  const $ = (id) => document.getElementById(id);
  const canvas = $("board"), ctx = canvas.getContext("2d");

  // ---------- Utilidades ----------
  const key = (x, y) => x + "," + y;
  const rand = (n) => Math.floor(Math.random() * n);

  function freeCell() {
    for (let tries = 0; tries < 400; tries++) {
      const x = rand(COLS), y = rand(ROWS);
      if (!occupied.has(key(x, y)) && !foods.some(f => f.x === x && f.y === y)) return { x, y };
    }
    // fallback lento
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (!occupied.has(key(x, y)) && !foods.some(f => f.x === x && f.y === y)) return { x, y };
    return null;
  }

  function spawnFood(type = "normal") {
    const c = freeCell();
    if (!c) return;
    foods.push({ ...c, type });
  }

  // Posições iniciais: cantos diferentes para cada jogador
  function startPos(i) {
    const spots = [
      { x: 5,  y: Math.floor(ROWS / 2), dx: 1, dy: 0 },
      { x: COLS - 6, y: Math.floor(ROWS / 2), dx: -1, dy: 0 },
      { x: Math.floor(COLS / 2), y: 5, dy: 1, dx: 0 },
      { x: Math.floor(COLS / 2), y: ROWS - 6, dy: -1, dx: 0 },
    ];
    return spots[i];
  }

  // ---------- Criação dos jogadores ----------
  function makePlayer(def, score) {
    const s = startPos(def.idx);
    const body = [];
    for (let k = 0; k < 4; k++) body.push({ x: s.x - s.dx * k, y: s.y - s.dy * k });
    return {
      ...def,
      body,
      dir: { dx: s.dx, dy: s.dy },
      nextDir: { dx: s.dx, dy: s.dy },
      alive: true,
      score,               // bolinhas roubadas nesta rodada
      totalScore: score,   // acumulado entre rodadas
      flash: 0,            // efeito ao roubar
    };
  }

  // ---------- HUD ----------
  function buildHUD() {
    const hud = $("hud");
    hud.innerHTML = "";
    players.forEach(p => {
      const card = document.createElement("div");
      card.className = "card";
      card.id = "card-" + p.idx;
      card.style.setProperty("--c", p.color);
      card.innerHTML =
        `<span class="swatch" style="background:${p.color};color:${p.color}"></span>` +
        `<div><div class="p-name">${p.name}</div>` +
        `<div class="p-score">🔘 <b id="score-${p.idx}">${p.score}</b> · total <b>${p.totalScore}</b></div></div>`;
      hud.appendChild(card);
    });
    updateHUD();
  }

  function updateHUD() {
    players.forEach(p => {
      const el = $(`score-${p.idx}`);
      if (el) el.textContent = p.score;
      const card = $(`card-${p.idx}`);
      if (card) {
        card.classList.toggle("dead", !p.alive);
        const st = card.querySelector(".p-score");
        if (!p.alive) {
          const t = respawnTimers.get(p.idx);
          st.innerHTML = t ? `💀 volta em ${t}` : "💀 eliminado";
        } else {
          st.innerHTML = `🔘 <b id="score-${p.idx}">${p.score}</b> · total <b>${p.totalScore}</b>`;
        }
      }
    });
  }

  // ---------- Loop principal ----------
  function recomputeOccupied() {
    occupied.clear();
    players.forEach(p => p.body.forEach(c => occupied.add(key(c.x, c.y))));
  }

  function step() {
    round++;

    // timers de respawn
    for (const [idx, t] of respawnTimers) {
      if (t <= 1) {
        respawnTimers.delete(idx);
        respawnPlayer(players[idx]);
      } else {
        respawnTimers.set(idx, t - 1);
      }
    }

    // 1) valida direções (proibe reversão de 180°)
    players.forEach(p => {
      if (!p.alive) return;
      const d = p.nextDir, cur = p.dir;
      if (!(d.dx === -cur.dx && d.dy === -cur.dy)) p.dir = d;
    });

    // 2) calcula cabeças novas
    const heads = players.map(p =>
      p.alive ? { x: p.body[0].x + p.dir.dx, y: p.body[0].y + p.dir.dy } : null
    );

    // 3) colisões com parede / corpo próprio / corpo de outros
    players.forEach((p, i) => {
      if (!p.alive) return;
      const h = heads[i];
      const hitWall = h.x < 0 || h.y < 0 || h.x >= COLS || h.y >= ROWS;
      let hitBody = false;
      // corpo próprio: ignorar a cauda (ela sai do lugar neste tick, exceto se for crescer)
      const tailIdx = p.body.length - 1;
      for (let k = 1; k < p.body.length; k++) {
        if (k === tailIdx && !(p.pendingGrow > 0)) continue;
        if (p.body[k].x === h.x && p.body[k].y === h.y) { hitBody = true; break; }
      }
      // corpos dos outros jogadores (cabeça será tratada à parte)
      if (!hitBody) {
        for (let j = 0; j < players.length && !hitBody; j++) {
          if (i === j) continue;
          const o = players[j];
          if (!o.alive) continue;
          for (let k = 1; k < o.body.length; k++) {
            if (o.body[k].x === h.x && o.body[k].y === h.y) { hitBody = true; break; }
          }
        }
      }
      if (hitWall || hitBody) killPlayer(p, "parede/corpo");
    });

    // 4) colisões entre cabeças
    for (let i = 0; i < players.length; i++) {
      const a = players[i];
      if (!a.alive || !heads[i]) continue;
      for (let j = i + 1; j < players.length; j++) {
        const b = players[j];
        if (!b.alive || !heads[j]) continue;
        if (heads[i].x === heads[j].x && heads[i].y === heads[j].y) {
          handleHeadOn(a, b);
        }
      }
    }

    // 5) encostar na cabeça de outro jogador = ROUBO
    players.forEach((p, i) => {
      if (!p.alive || !heads[i]) return;
      for (let j = 0; j < players.length; j++) {
        if (i === j) continue;
        const v = players[j];
        if (!v.alive || !heads[j]) continue;
        // a cabeça de P entra na célula da cabeça de V ou na célula logo à frente dela
        const frontOfV = { x: heads[j].x + v.dir.dx, y: heads[j].y + v.dir.dy };
        if ((heads[i].x === frontOfV.x && heads[i].y === frontOfV.y) ||
            (heads[i].x === heads[j].x && heads[i].y === heads[j].y)) {
          stealFrom(p, v);
        }
      }
    });

    // 6) mover corpos
    players.forEach((p, i) => {
      if (!p.alive || !heads[i]) return;
      p.body.unshift(heads[i]);
      if (p.pendingGrow > 0) { p.pendingGrow--; }
      else { const t = p.body.pop(); occupied.delete(key(t.x, t.y)); }
      occupied.add(key(heads[i].x, heads[i].y));
      if (p.flash > 0) p.flash--;
    });

    // 7) comer
    players.forEach((p, i) => {
      if (!p.alive || !heads[i]) return;
      const fi = foods.findIndex(f => f.x === heads[i].x && f.y === heads[i].y);
      if (fi >= 0) eatFood(p, fi);
    });

    // 8) manter comida no tabuleiro
    while (foods.length < 4 + players.filter(p => p.alive).length) spawnFood("normal");
    if (round % 90 === 0 && Math.random() < 0.6) spawnFood("big");

    // 9) floaters (textinhos flutuantes)
    floaters = floaters.filter(fl => --fl.life > 0);

    // 10) checar fim de partida
    checkGameEnd();

    draw();
    updateHUD();
  }

  // ---------- Roubos, mortes, renascimentos ----------
  const stealCooldown = new Map();   // "thief-victim" -> round em que pode roubar de novo

  function stealFrom(thief, victim) {
    if (!thief.alive || !victim.alive) return;
    if (victim.score <= 0) return;
    const ck = thief.idx + "-" + victim.idx;
    const until = stealCooldown.get(ck) || 0;
    if (round < until) return;               // anti-spam: só 1 roubo a cada ~2s por par
    stealCooldown.set(ck, round + 20);
    const amount = Math.ceil(victim.score / 2);
    victim.score -= amount;
    thief.score += amount;
    thief.totalScore += amount;
    victim.totalScore -= amount;
    thief.flash = 8;
    addFloater(`+${amount} 😈`, thief.body[0], thief.color);
    addFloater(`-${amount}`, victim.body[0], "#ffffff");
    beep(660, .08); setTimeout(() => beep(880, .08), 90);
  }

  function handleHeadOn(a, b) {
    // cabeças se chocam de frente: maior cobra sobrevive e rouba metade
    const la = a.body.length, lb = b.body.length;
    if (la === lb) {
      // empate: ambas morrem
      killPlayer(a, "choque"); killPlayer(b, "choque");
    } else if (la > lb) {
      stealFrom(a, b);
      killPlayer(b, "choque");
    } else {
      stealFrom(b, a);
      killPlayer(a, "choque");
    }
  }

  function killPlayer(p, cause) {
    if (!p.alive) return;
    p.alive = false;
    deaths.set(p.idx, (deaths.get(p.idx) || 0) + 1);
    // solta bolinhas como "bônus" no tabuleiro
    const drops = Math.min(p.score, 6);
    for (let k = 0; k < drops; k++) {
      const c = freeCellNear(p.body[rand(p.body.length)]);
      if (c) foods.push({ ...c, type: "bonus" });
    }
    p.score = 0;
    addFloater("💀", p.body[0], "#ff6666");
    beep(200, .15); setTimeout(() => beep(140, .2), 120);
    recomputeOccupied();
    const maxDeaths = players.length === 1 ? 1 : Infinity;
    if (deaths.get(p.idx) >= maxDeaths) {
      respawnTimers.delete(p.idx);   // eliminado de vez
    } else {
      respawnTimers.set(p.idx, 22);  // renasce em ~2-3s
    }
  }

  function respawnPlayer(p) {
    const s = startPos(p.idx);
    // acha uma área livre deslocando do ponto padrão
    let sx = s.x, sy = s.y;
    outer: for (let r = 0; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = clamp(sx + dx, 1, COLS - 2), y = clamp(sy + dy, 1, ROWS - 2);
          let ok = true;
          for (let k = 0; k < 4; k++) {
            const bx = x - s.dx * k, by = y - s.dy * k;
            if (bx < 0 || by < 0 || bx >= COLS || by >= ROWS || occupied.has(key(bx, by))) { ok = false; break; }
          }
          if (ok) { sx = x; sy = y; break outer; }
        }
      }
    }
    p.body = [];
    for (let k = 0; k < 4; k++) p.body.push({ x: sx - s.dx * k, y: sy - s.dy * k });
    p.dir = { dx: s.dx, dy: s.dy };
    p.nextDir = { dx: s.dx, dy: s.dy };
    p.alive = true;
    p.pendingGrow = 0;
    recomputeOccupied();
    addFloater("✦", p.body[0], p.color);
  }

  function freeCellNear(cell) {
    for (let r = 1; r <= 6; r++) {
      const x = clamp(cell.x + rand(r * 2 + 1) - r, 0, COLS - 1);
      const y = clamp(cell.y + rand(r * 2 + 1) - r, 0, ROWS - 1);
      if (!occupied.has(key(x, y)) && !foods.some(f => f.x === x && f.y === y)) return { x, y };
    }
    return freeCell();
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function eatFood(p, fi) {
    const f = foods[fi];
    const t = FOOD_TYPES[f.type];
    p.score += t.value;
    p.totalScore += t.value;
    p.pendingGrow = (p.pendingGrow || 0) + t.grow;
    addFloater(`+${t.value}`, f, t.color);
    foods.splice(fi, 1);
    beep(520 + p.score * 6, .05);
  }

  function addFloater(text, cell, color) {
    floaters.push({ text, x: cell.x, y: cell.y, color, life: 12 });
  }

  // ---------- Fim de jogo ----------
  // Partida: primeiro a atingir META (ou último sobrevivente em modo solo)
  const TARGET_SCORE = 21;

  function checkGameEnd() {
    if (gameOverFlag) return;
    const winner = players.find(p => p.alive && p.score >= TARGET_SCORE);
    if (winner) return endGame(winner, `atingiu ${winner.score} bolinhas! 🏆`);

    if (players.length === 1) {
      const p = players[0];
      if (!p.alive && !respawnTimers.has(p.idx)) {
        return endGame(null, "Você morreu! 💀");
      }
    } else {
      // fim apenas quando sobra 1 jogador VIVO e nenhum outro vai renascer
      const alive = players.filter(p => p.alive);
      if (alive.length <= 1 && respawnTimers.size === 0) {
        const last = alive[0];
        if (last) return endGame(last, "foi o último sobrevivente! 👑");
        return endGame(bestByTotal(), "vence pela pontuação!");
      }
    }
  }

  function bestByTotal() {
    return [...players].sort((a, b) => b.totalScore - a.totalScore)[0];
  }

  function endGame(winner, msg) {
    gameOverFlag = true;
    stopLoop();
    $("ovTitle").textContent = winner ? `🎉 ${winner.name} venceu!` : "😵 Fim de jogo!";
    $("ovMsg").textContent = winner ? `${winner.name} ${msg}` : msg;
    const ranking = [...players].sort((a, b) => b.totalScore - a.totalScore)
      .map(p => `<span style="color:${p.color}">●</span> ${p.name}: ${p.totalScore}`).join("&nbsp;&nbsp; ");
    $("ovWinner").innerHTML = ranking;
    $("overlay").style.display = "flex";
    if (winner) { beep(523,.1); setTimeout(()=>beep(659,.1),120); setTimeout(()=>beep(784,.18),240); }
  }

  // ---------- Desenho ----------
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // grade sutil
    ctx.strokeStyle = "rgba(148,163,184,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= COLS; x++) { ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, ROWS * CELL); }
    for (let y = 0; y <= ROWS; y++) { ctx.moveTo(0, y * CELL); ctx.lineTo(COLS * CELL, y * CELL); }
    ctx.stroke();

    // comidas
    foods.forEach(f => {
      const t = FOOD_TYPES[f.type];
      const cx = f.x * CELL + CELL / 2, cy = f.y * CELL + CELL / 2;
      const pulse = 1 + Math.sin(round * 0.15 + f.x + f.y) * 0.12;
      ctx.save();
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * t.radius * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // cobras
    players.forEach(p => {
      if (!p.alive) return;
      const len = p.body.length;
      p.body.forEach((c, i) => {
        const isHead = i === 0;
        const shade = 1 - (i / len) * 0.45;
        ctx.fillStyle = shadeColor(p.color, shade);
        const pad = isHead ? 0.5 : 1.2;
        const x = c.x * CELL + pad, y = c.y * CELL + pad, s = CELL - pad * 2;
        roundRect(ctx, x, y, s, s, isHead ? 5 : 3.5);
        ctx.fill();

        if (isHead) {
          if (p.flash > 0) { // aura de roubo
            ctx.save();
            ctx.shadowColor = "#fff";
            ctx.shadowBlur = 18;
            roundRect(ctx, x, y, s, s, 5); ctx.fill();
            ctx.restore();
          }
          // olhos
          ctx.fillStyle = "#0b1220";
          const ex = p.dir.dx, ey = p.dir.dy;
          const cx = c.x * CELL + CELL / 2, cy = c.y * CELL + CELL / 2;
          const off = 3.2;
          const px = -ey, py = ex; // perpendicular
          ctx.beginPath();
          ctx.arc(cx + ex * 3 + px * off, cy + ey * 3 + py * off, 1.7, 0, 7);
          ctx.arc(cx + ex * 3 - px * off, cy + ey * 3 - py * off, 1.7, 0, 7);
          ctx.fill();
        }
      });
    });

    // textinhos flutuantes
    ctx.textAlign = "center";
    ctx.font = "bold 13px sans-serif";
    floaters.forEach(fl => {
      ctx.globalAlpha = Math.min(1, fl.life / 8);
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, fl.x * CELL + CELL / 2, fl.y * CELL - (12 - fl.life) * 1.6);
    });
    ctx.globalAlpha = 1;

    if (paused) {
      ctx.fillStyle = "rgba(5,8,16,0.6)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 34px sans-serif";
      ctx.fillText("⏸ PAUSADO", canvas.width / 2, canvas.height / 2);
      ctx.font = "14px sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("Pressione Espaço para continuar", canvas.width / 2, canvas.height / 2 + 30);
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function shadeColor(hex, factor) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * factor);
    const g = Math.round(((n >> 8) & 255) * factor);
    const b = Math.round((n & 255) * factor);
    return `rgb(${r},${g},${b})`;
  }

  // ---------- Som simples (WebAudio) ----------
  let audioCtx = null;
  function beep(freq, dur) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "square"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.04, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* sem áudio, segue o jogo */ }
  }

  // ---------- Controles ----------
  function onKey(e) {
    if (e.code === "Space") {
      if (running) { e.preventDefault(); togglePause(); }
      return;
    }
    players.forEach(p => {
      const k = p.keys;
      if (!k) return;
      if (e.code === k.up && p.dir.dy !== 1) p.nextDir = { dx: 0, dy: -1 };
      else if (e.code === k.down && p.dir.dy !== -1) p.nextDir = { dx: 0, dy: 1 };
      else if (e.code === k.left && p.dir.dx !== 1) p.nextDir = { dx: -1, dy: 0 };
      else if (e.code === k.right && p.dir.dx !== -1) p.nextDir = { dx: 1, dy: 0 };
    });
  }

  // Suporte a toque (swipe) para o jogador 1 em dispositivos móveis
  let touchStart = null;
  canvas.addEventListener("touchstart", e => { touchStart = e.touches[0]; }, { passive: true });
  canvas.addEventListener("touchend", e => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.clientX, dy = t.clientY - touchStart.clientY;
    const p = players[0];
    if (p && Math.abs(dx) + Math.abs(dy) > 24) {
      if (Math.abs(dx) > Math.abs(dy)) p.nextDir = { dx: Math.sign(dx), dy: 0 };
      else p.nextDir = { dx: 0, dy: Math.sign(dy) };
    }
    touchStart = null;
  }, { passive: true });

  // ---------- Ciclo de vida ----------
  function startLoop() { stopLoop(); timer = setInterval(step, tickMs); }
  function stopLoop() { if (timer) clearInterval(timer); timer = null; }

  function togglePause() {
    paused = !paused;
    if (paused) stopLoop(); else startLoop();
    $("btnPause").textContent = paused ? "▶ Continuar (Espaço)" : "⏸ Pausar (Espaço)";
    draw();
  }

  function beginGame(nPlayers, speed, names) {
    gameOverFlag = false; paused = false; round = 0;
    tickMs = speed;
    foods = []; floaters = []; respawnTimers.clear();
    deaths.clear(); stealCooldown.clear();
    players = PLAYER_DEFS.slice(0, nPlayers).map((d, i) =>
      makePlayer({ ...d, idx: i, name: names[i] || d.name }, 0)
    );
    recomputeOccupied();
    for (let i = 0; i < 6 + nPlayers; i++) spawnFood("normal");
    if (nPlayers === 1) spawnFood("big");

    $("setup").style.display = "none";
    $("gameWrap").style.display = "flex";
    $("overlay").style.display = "none";
    buildHUD();

    const hints = players.map(p => `${p.name}: ${p.keyLabel}`).join("  •  ");
    $("hint").textContent = `Meta: ${TARGET_SCORE} bolinhas para vencer · ${hints}`;

    countdown(() => { draw(); startLoop(); });
  }

  function countdown(cb) {
    const el = $("countdown");
    el.style.display = "flex";
    let n = 3;
    el.textContent = n;
    const iv = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(iv); el.style.display = "none"; cb(); }
      else { el.textContent = n; beep(440 + (3 - n) * 110, .07); }
    }, 600);
  }

  function backToMenu() {
    stopLoop();
    running = false;
    $("gameWrap").style.display = "none";
    $("overlay").style.display = "none";
    $("setup").style.display = "block";
  }

  // ---------- Tela de configuração ----------
  function renderPlayerRows() {
    const n = +$("numPlayers").value;
    const box = $("playersConfig");
    box.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const d = PLAYER_DEFS[i];
      const row = document.createElement("div");
      row.className = "player-row";
      row.innerHTML =
        `<span class="swatch" style="background:${d.color};color:${d.color}"></span>` +
        `<input type="text" maxlength="14" placeholder="${d.name}" data-i="${i}" value="${d.name}">` +
        `<span class="badge">${d.keyLabel}</span>`;
      box.appendChild(row);
    }
  }

  // ---------- Eventos de UI ----------
  $("numPlayers").addEventListener("change", renderPlayerRows);
  $("btnStart").addEventListener("click", () => {
    const n = +$("numPlayers").value;
    const speed = +$("speed").value;
    const names = [...document.querySelectorAll("#playersConfig input")].map(inp => inp.value.trim());
    running = true;
    beginGame(n, speed, names);
  });
  $("btnAgain").addEventListener("click", () => {
    $("overlay").style.display = "none";
    const n = +$("numPlayers").value;
    const speed = +$("speed").value;
    const names = [...document.querySelectorAll("#playersConfig input")].map(inp => inp.value.trim());
    running = true;
    beginGame(n, speed, names);
  });
  $("btnMenu").addEventListener("click", backToMenu);
  $("btnPause").addEventListener("click", () => { if (running && !gameOverFlag) togglePause(); });
  document.addEventListener("keydown", onKey);

  renderPlayerRows();
})();

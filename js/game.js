// ------------------------------------------------------------
// DASH - arcade time-attack racer
// ------------------------------------------------------------
// Sections of this file:
//   1. config + assets
//   2. helpers
//   3. sound manager (music, sfx, volume)
//   4. lap scoreboard (Blackout + player laps)
//   5. map
//   6. game state + flow (menu / countdown / race / result)
//   7. UI wiring
//   8. game loop (update + draw)
//   9. init
// ------------------------------------------------------------

// ------------------------------------------------------------
// 1. config + assets
// ------------------------------------------------------------

const TIME_LIMIT = 120; // seconds the player has to cross the finish line
const COUNTDOWN_STEPS = ["5", "4", "3", "2"]; // then GO!

// Blackout is not a player: he is the unbeaten ghost time on the board.
// The other rivals come from the magazine's high-score screen.
const BOARD_RIVALS = [
  { name: "BLACKOUT", ms: 54221, ghost: true },
  { name: "ACE", ms: 62884 },
  { name: "RVN", ms: 65117 },
  { name: "TX9", ms: 68460 },
];
const PLAYER_NAME = "REX";
const BLACKOUT_MS = BOARD_RIVALS[0].ms;
const BLACKOUT_S = BLACKOUT_MS / 1000;
const NEAR_MISS_POINTS = 250; // bonus for a close call with traffic

const ASSETS = {
  COLOR: {
    TAR: ["#959298", "#9c9a9d"],
    RUMBLE: ["#959298", "#f5f2f6"],
    GRASS: ["#eedccd", "#e6d4c5"],
  },

  IMAGE: {
    TREE: { src: "assets/images/tree.png", width: 132, height: 192 },
    HERO: { src: "assets/images/hero.png", width: 110, height: 56 },
    CAR: { src: "assets/images/car04.png", width: 50, height: 36 },
    FINISH: {
      src: "assets/images/finish.png",
      width: 339,
      height: 180,
      offset: -0.5,
    },
    SKY: { src: "assets/images/cloud.jpg" },
  },

  // engine hum: pitch-shifted every frame through WebAudio
  AUDIO: {
    engine: "https://s3-us-west-2.amazonaws.com/s.cdpn.io/155629/engine.wav",
  },

  MUSIC: {
    menu: "assets/audio/menu_music.mp3", // main menu
    race: "assets/audio/race_music.mp3", // while racing
  },

  SFX: {
    countdown: "assets/audio/countdown.mp3", // beeps at 0s,1s,2s,3s
    go: "assets/audio/go.mp3",
    finish: "assets/audio/finish.wav",
    crash: "assets/audio/crash.mp3",
    timeup: "assets/audio/time_up.mp3",
  },
};

// ------------------------------------------------------------
// 2. helpers
// ------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const el = {
  game: $("game"),
  road: $("road"),
  cloud: $("cloud"),
  hero: $("hero"),
  hud: $("hud"),
  time: $("time"),
  score: $("score"),
  lap: $("lap"),
  tacho: $("tacho"),
  countdown: $("countdown"),
  home: $("home"),
  lapBoard: $("lapBoard"),
  pauseMenu: $("pauseMenu"),
  howPanel: $("howPanel"),
  settingsPanel: $("settingsPanel"),
  resultPanel: $("resultPanel"),
  resultTitle: $("resultTitle"),
  resultLap: $("resultLap"),
  resultMsg: $("resultMsg"),
  resultBoard: $("resultBoard"),
  musicVol: $("musicVol"),
  musicVolVal: $("musicVolVal"),
  sfxVol: $("sfxVol"),
  sfxVolVal: $("sfxVolVal"),
  muteToggle: $("muteToggle"),
  againBtn: $("againBtn"),
  mmPlayer: $("mmPlayer"),
  mmGhost: $("mmGhost"),
};

Number.prototype.clamp = function (min, max) {
  return Math.max(min, Math.min(this, max));
};

const pad = (n, len) => String(Math.floor(Math.abs(n))).padStart(len, "0");
const accelerate = (v, accel, dt) => v + accel * dt;
const isCollide = (x1, w1, x2, w2) => (x1 - x2) ** 2 <= (w2 + w1) ** 2;

// 54221 -> 0'54"221
function formatMs(ms) {
  ms = Math.max(0, Math.round(ms));
  const m = Math.floor(ms / 60000);
  const s = Math.floor(ms / 1000) % 60;
  return `${m}'${pad(s, 2)}"${pad(ms % 1000, 3)}`;
}

function randomProperty(obj) {
  let keys = Object.keys(obj);
  return obj[keys[(keys.length * Math.random()) << 0]];
}

// small seeded generator so the road is the same every run:
// a leaderboard only means something on one single track
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawQuad(element, layer, color, x1, y1, w1, x2, y2, w2) {
  element.style.zIndex = layer;
  element.style.background = color;
  element.style.top = y2 + `px`;
  element.style.left = x1 - w1 / 2 - w1 + `px`;
  element.style.width = w1 * 3 + `px`;
  element.style.height = y1 - y2 + `px`;

  let leftOffset = w1 + x2 - x1 + Math.abs(w2 / 2 - w1 / 2);
  element.style.clipPath = `polygon(${leftOffset}px 0, ${
    leftOffset + w2
  }px 0, 66.66% 100%, 33.33% 100%)`;
}

// arrow keys only: other keys (F5, Ctrl+R, Tab...) keep working normally
const KEYS = {};
const DRIVE_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
// WASD works exactly like the arrow keys
const KEY_ALIAS = {
  KeyW: "ArrowUp",
  KeyA: "ArrowLeft",
  KeyS: "ArrowDown",
  KeyD: "ArrowRight",
};

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}
function restore(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

// ------------------------------------------------------------
// 3. sound manager
// ------------------------------------------------------------

const AUDIO_KEY = "dash.audio";

class SoundManager {
  constructor() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new Ctx();
    this.engineGain = this.audioCtx.createGain();
    this.engineGain.connect(this.audioCtx.destination);
    this.files = {};
    this.loading = {};

    // saved volume (0..1) and mute state
    const saved = restore(AUDIO_KEY, {});
    const level = (v, d) => (typeof v === "number" ? v.clamp(0, 1) : d);
    this.musicVol = level(saved.music, 0.6);
    this.sfxVol = level(saved.sfx, 1);
    this.muted = saved.muted === true;

    // two background tracks. plain <audio> also works from file://
    this.tracks = {};
    for (const key in ASSETS.MUSIC) {
      const a = document.createElement("audio");
      a.src = ASSETS.MUSIC[key];
      a.loop = true;
      a.preload = "auto";
      this.tracks[key] = a;
    }

    // one-off sound effects
    this.sfx = {};
    for (const key in ASSETS.SFX) {
      const a = document.createElement("audio");
      a.src = ASSETS.SFX[key];
      a.preload = "auto";
      this.sfx[key] = a;
    }

    this.apply();
  }

  // push the current volume / mute state to every sound
  apply() {
    for (const key in this.tracks) {
      this.tracks[key].volume = this.musicVol;
      this.tracks[key].muted = this.muted;
    }
    for (const key in this.sfx) {
      this.sfx[key].volume = this.sfxVol;
      this.sfx[key].muted = this.muted;
    }
    this.engineGain.gain.value = this.muted ? 0 : this.sfxVol;
  }

  save() {
    store(AUDIO_KEY, {
      music: this.musicVol,
      sfx: this.sfxVol,
      muted: this.muted,
    });
  }

  setMusicVolume(v) {
    this.musicVol = v.clamp(0, 1);
    this.apply();
    this.save();
  }
  setSfxVolume(v) {
    this.sfxVol = v.clamp(0, 1);
    this.apply();
    this.save();
  }
  setMuted(m) {
    this.muted = m;
    this.apply();
    this.save();
  }

  unlock() {
    if (this.audioCtx.state === "suspended") this.audioCtx.resume();
  }

  // ---- music ----
  startMusic(key, fromStart = true) {
    this.stopMusic(key === "menu" ? "race" : "menu");
    const t = this.tracks[key];
    if (fromStart) t.currentTime = 0;
    if (t.paused) t.play().catch(() => {});
  }
  stopMusic(key) {
    const t = this.tracks[key];
    t.pause();
    t.currentTime = 0;
  }
  pauseMusic(key) {
    this.tracks[key].pause();
  }

  // ---- sound effects ----
  playSfx(key) {
    const a = this.sfx[key];
    a.currentTime = 0;
    a.play().catch(() => {});
  }
  stopSfx() {
    for (const key in this.sfx) {
      this.sfx[key].pause();
      this.sfx[key].currentTime = 0;
    }
  }

  // ---- engine (WebAudio, pitch follows speed) ----
  play(key, pitch) {
    // never fetch from here: init() preloads once, and a failed
    // load is replaced by a synthesized sound
    const buffer = this.files[key];
    if (!buffer || this.muted || this.sfxVol === 0) return;
    let source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.engineGain);
    if (pitch) source.detune.value = pitch;
    source.start(0);
  }

  // short generated stand-in used when the remote engine file can't load
  synth() {
    const rate = this.audioCtx.sampleRate;
    const buffer = this.audioCtx.createBuffer(1, Math.floor(rate * 0.12), rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / rate;
      const fade = Math.min(1, (data.length - i) / (rate * 0.03));
      data[i] = (((t * 70) % 1) * 2 - 1) * fade * 0.15; // sawtooth buzz
    }
    return buffer;
  }

  load(src, key) {
    const self = this;
    if (this.files[key] || this.loading[key]) return;
    this.loading[key] = true;

    const useFallback = function () {
      self.files[key] = self.synth();
    };

    try {
      let request = new XMLHttpRequest();
      request.open("GET", src, true);
      request.responseType = "arraybuffer";
      request.onload = function () {
        if (request.status && request.status >= 400) return useFallback();
        self.audioCtx.decodeAudioData(
          request.response,
          function (decoded) {
            self.files[key] = decoded;
          },
          useFallback
        );
      };
      request.onerror = useFallback;
      request.ontimeout = useFallback;
      request.timeout = 8000;
      request.send();
    } catch (e) {
      useFallback();
    }
  }
}

// ------------------------------------------------------------
// 4. lap scoreboard
// ------------------------------------------------------------

const LAPS_KEY = "dash.laps.v2";

// the player's current lap in ms (at most one entry). It is temporary: every
// new finished run replaces the previous one, and it is not saved between
// page loads.
let playerLaps = [];
try {
  localStorage.removeItem(LAPS_KEY); // drop laps saved by older versions
} catch (e) {}

let lastLapId = null; // identifies the lap that was just driven

// every entry sorted by time (fastest = rank 1)
function buildBoard() {
  const rows = BOARD_RIVALS.map((r) => ({ ...r }));
  playerLaps.forEach((ms, i) => {
    rows.push({ name: PLAYER_NAME, ms, you: true, id: ms + ":" + i });
  });
  rows.sort((a, b) => a.ms - b.ms);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

function boardRowHTML(r, highlightId) {
  const cls = [];
  if (r.ghost) cls.push("blackout");
  if (r.you) cls.push("you");
  const isNew = highlightId && r.id === highlightId;
  const sub = r.ghost
    ? "<small>UNBEATEN GHOST TIME</small>"
    : r.you
    ? `<small>${isNew ? "YOUR NEW LAP" : "YOU"}</small>`
    : "";
  if (isNew) cls.push("new");
  return (
    `<li class="${cls.join(" ")}">` +
    `<span class="rank">${pad(r.rank, 2)}.</span>` +
    `<span>${r.name}${sub}</span>` +
    `<span>${formatMs(r.ms)}</span></li>`
  );
}

function renderMenuBoard() {
  el.lapBoard.innerHTML = buildBoard()
    .slice(0, 7)
    .map((r) => boardRowHTML(r))
    .join("");
}

function renderResultBoard(highlightId) {
  const board = buildBoard();
  const mine = highlightId ? board.findIndex((r) => r.id === highlightId) : -1;
  let html = board
    .slice(0, 5)
    .map((r) => boardRowHTML(r, highlightId))
    .join("");
  if (mine >= 5) {
    html += '<li class="gap">...</li>' + boardRowHTML(board[mine], highlightId);
  }
  el.resultBoard.innerHTML = html;
}

// ------------------------------------------------------------
// 5. map
// ------------------------------------------------------------

const width = 800;
const halfWidth = width / 2;
const height = 500;
const roadW = 4000;
const segL = 200;
const camD = 0.2;
const H = 1500;
const N = 70;

const maxSpeed = 200;
const accel = 38;
const breaking = -80;
const decel = -40;
const maxOffSpeed = 40;
const offDecel = -70;
const enemy_speed = 8;
const hitSpeed = 20;
const STUN_TIME = 1; // seconds out of control after a crash (no steering or throttle)
const OFFROAD_EDGE = 1.4; // how far off the road you may drive (road edge is ~0.55)
const INVINCIBLE_TIME = 3; // seconds of ghost mode after the spin-out ends

const LANE = {
  A: -2.3,
  B: -0.5,
  C: 1.2,
};

// Track length (distance units). At top speed (200) one unit costs
// 1/200 s, so a flawless lap takes about (mapLength + 560) / 200 + 2.6 s
// (560 = distance from the moment the banner appears to the line,
// 2.6 s = time lost accelerating from standstill):
//   9000 -> ~50.6 s   perfect run, Blackout (54.2 s) is just beatable
//   typical clean run ~60-80 s, leaving room for a crash inside 120 s
const mapLength = 9000;
const MAP_SEED = 20261028;

function genMap() {
  const rnd = mulberry32(MAP_SEED);
  const rand = (min, max) => (rnd() * (max - min) + min) | 0;

  let map = [];

  for (let i = 0; i < mapLength; i += rand(0, 50)) {
    let section = {
      from: i,
      to: (i = Math.min(i + rand(300, 600), mapLength)),
    };

    let randHeight = rand(-5, 5);
    let randCurve = rand(5, 30) * (rnd() >= 0.5 ? 1 : -1);
    let randInterval = rand(20, 40);

    if (rnd() > 0.9)
      Object.assign(section, {
        curve: (_) => randCurve,
        height: (_) => randHeight,
      });
    else if (rnd() > 0.8)
      Object.assign(section, {
        curve: (_) => 0,
        height: (i) => Math.sin(i / randInterval) * 1000,
      });
    else if (rnd() > 0.8)
      Object.assign(section, {
        curve: (_) => 0,
        height: (_) => randHeight,
      });
    else
      Object.assign(section, {
        curve: (_) => randCurve,
        height: (_) => 0,
      });

    map.push(section);
  }

  // checkered finish banner (assets/images/finish.png)
  map.push({
    from: mapLength,
    to: mapLength + N,
    curve: (_) => 0,
    height: (_) => 0,
    special: ASSETS.IMAGE.FINISH,
  });
  map.push({ from: Infinity });
  return map;
}

const map = genMap();

// ------------------------------------------------------------
// 6. game state + flow
// ------------------------------------------------------------

class Line {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;

    this.X = 0;
    this.Y = 0;
    this.W = 0;

    this.curve = 0;
    this.scale = 0;

    this.elements = [];
    this.special = null;
  }

  project(camX, camY, camZ) {
    this.scale = camD / (this.z - camZ);
    this.X = (1 + this.scale * (this.x - camX)) * halfWidth;
    this.Y = Math.ceil(((1 - this.scale * (this.y - camY)) * height) / 2);
    this.W = this.scale * roadW * halfWidth;
  }

  clearSprites() {
    for (let e of this.elements) e.style.background = "transparent";
  }

  drawSprite(depth, layer, sprite, offset) {
    let destX = this.X + this.scale * halfWidth * offset;
    let destY = this.Y + 4;
    let destW = (sprite.width * this.W) / 265;
    let destH = (sprite.height * this.W) / 265;

    destX += destW * offset;
    destY += destH * -1;

    let obj = layer instanceof Element ? layer : this.elements[layer + 6];
    obj.style.background = `url('${sprite.src}') no-repeat`;
    obj.style.backgroundSize = `${destW}px ${destH}px`;
    obj.style.left = destX + `px`;
    obj.style.top = destY + `px`;
    obj.style.width = destW + `px`;
    obj.style.height = destH + `px`;
    obj.style.zIndex = depth;
  }
}

class Car {
  constructor(pos, type, lane) {
    this.pos = pos;
    this.type = type;
    this.lane = lane;

    var element = document.createElement("div");
    el.road.appendChild(element);
    this.element = element;
  }
}

// loop: the simulation runs on a fixed 25 fps clock so lap times
// are the same on 60 Hz, 144 Hz or slower machines
const FIXED_STEP = 1 / 25;

let audio;
let paused = false;

// menu | countdown | racing | result
let state = "menu";

let playerX,
  speed,
  scoreVal,
  pos,
  cloudOffset,
  sectionProg,
  mapIndex,
  raceTime, // seconds driven since GO (also keeps running after a crash)
  countDown; // seconds left on the 120s clock
let lines = [];
let cars = [];
let stunLeft = 0; // seconds of knock-back / spin-out left
let stunKind = "hit"; // "hit" = knocked back by a car, "offroad" = knocked back to the road
let finishLine = -1; // index of the road line that carries the finish banner
let invincibleLeft = 0; // seconds of crash immunity left
let bonus = 0; // near-miss points, kept apart from distance so they don't move the car
let countdownTimers = [];

function setCountdownText(text, isGo) {
  el.countdown.classList.remove("show", "go");
  void el.countdown.offsetWidth; // restart the pop animation
  el.countdown.textContent = text;
  el.countdown.classList.add("show");
  if (isGo) el.countdown.classList.add("go");
}

function hideCountdownText() {
  el.countdown.classList.remove("show", "go");
  el.countdown.textContent = "";
}

function clearCountdown() {
  countdownTimers.forEach(clearTimeout);
  countdownTimers = [];
  hideCountdownText();
}

// back to the starting line
function resetRun() {
  raceTime = 0;
  countDown = TIME_LIMIT;

  playerX = 0;
  speed = 0;
  scoreVal = 0;
  bonus = 0;
  stunLeft = 0;
  invincibleLeft = 0;
  finishLine = -1;
  el.hero.style.transform = "";
  el.hero.style.opacity = "";

  pos = 0;
  cloudOffset = 0;
  sectionProg = 0;
  mapIndex = 0;

  // also drop the finish banner, otherwise it would trigger at the start
  for (let line of lines) line.curve = line.y = 0;
  for (let line of lines) line.special = null;

  scatterCars();
  el.hero.style.backgroundPosition = "-110px 0";
}

// spread the traffic out so nobody starts on top of the player
function scatterCars() {
  const spawnPos = [10, 18, 26, 35, 48, 58, 66];
  cars.forEach((car, i) => {
    car.pos = spawnPos[i % spawnPos.length] % N;
    car.lane = randomProperty(LANE);
  });
}

function showMenuScene() {
  el.road.style.opacity = 0.4;
  el.hud.style.display = "none";
  el.home.style.display = "block";
}

function showRaceScene() {
  el.home.style.display = "none";
  el.road.style.opacity = 1;
  el.hero.style.display = "block";
  el.hud.style.display = "block";
  el.tacho.style.display = "block";
  el.tacho.innerText = "0";
  el.time.innerText = pad(TIME_LIMIT, 3);
  el.time.classList.remove("warn");
  el.score.innerText = pad(0, 8);
  el.lap.innerText = formatMs(0);
  el.mmPlayer.style.left = "6px";
  el.mmGhost.style.left = "6px";
}

function anyModalOpen() {
  return (
    el.howPanel.classList.contains("show") ||
    el.settingsPanel.classList.contains("show")
  );
}

function closeModals() {
  el.howPanel.classList.remove("show");
  el.settingsPanel.classList.remove("show");
  el.resultPanel.classList.remove("show");
  el.pauseMenu.classList.remove("show");
}

// START / PLAY AGAIN / RETRY / RESTART
function startRace() {
  if (state === "countdown" || state === "racing") return;

  clearCountdown();
  closeModals();
  paused = false;
  audio.unlock();
  audio.stopMusic("menu"); // menu music ends, race music starts at GO
  audio.stopMusic("race");
  audio.stopSfx();

  resetRun();
  showRaceScene();
  state = "countdown";

  // 5, 4, 3, 2 on screen, one per second, in time with the 4 beeps
  audio.playSfx("countdown");
  COUNTDOWN_STEPS.forEach((n, i) =>
    countdownTimers.push(setTimeout(() => setCountdownText(n), i * 1000))
  );

  // GO!
  countdownTimers.push(
    setTimeout(() => {
      setCountdownText("GO!", true);
      audio.playSfx("go");
      audio.startMusic("race");
      scatterCars();
      state = "racing";
    }, COUNTDOWN_STEPS.length * 1000)
  );
  countdownTimers.push(
    setTimeout(hideCountdownText, COUNTDOWN_STEPS.length * 1000 + 1000)
  );
}

function pauseGame() {
  if (state !== "racing" || paused) return;
  paused = true;
  audio.pauseMusic("race");
  el.pauseMenu.classList.add("show");
}

function resumeGame() {
  if (!paused) return;
  paused = false;
  el.pauseMenu.classList.remove("show");
  el.settingsPanel.classList.remove("show");
  audio.startMusic("race", false); // continue where it stopped
}

// EXIT / MAIN MENU
function quitToMainMenu() {
  clearCountdown();
  closeModals();
  paused = false;
  state = "menu";

  audio.stopMusic("race");
  audio.stopSfx();

  resetRun();
  showMenuScene();
  renderMenuBoard();
  audio.startMusic("menu");
}

// race over: either the line was crossed (finished) or the clock hit zero
function finishRace(finished) {
  state = "result";
  el.hud.style.display = "none";
  audio.stopMusic("race");
  audio.stopSfx();

  // the result screen keeps the menu music going
  audio.startMusic("menu", false);

  let highlightId = null;
  const lapMs = Math.round(raceTime * 1000);

  if (finished) {
    playerLaps = [lapMs]; // the new lap replaces the old one
    highlightId = lapMs + ":0";
    lastLapId = highlightId;

    audio.playSfx("finish");

    const board = buildBoard();
    const mine = board.find((r) => r.id === highlightId);
    const rank = mine ? mine.rank : null;

    el.resultTitle.textContent = "FINISH!";
    el.resultTitle.className = "win";
    el.resultLap.textContent = formatMs(lapMs);

    let msg;
    if (lapMs < BLACKOUT_MS) {
      msg = `YOU BEAT BLACKOUT BY ${((BLACKOUT_MS - lapMs) / 1000).toFixed(
        3
      )}s!<br>RANK #${rank}`;
      el.resultMsg.className = "msg good";
    } else {
      msg = `BLACKOUT STILL LEADS BY ${((lapMs - BLACKOUT_MS) / 1000).toFixed(
        3
      )}s<br>${rank ? "YOUR RANK #" + rank : "NOT ON THE TOP LIST"}`;
      el.resultMsg.className = "msg bad";
    }
    el.resultMsg.innerHTML = msg;
    el.againBtn.textContent = "Play Again";
  } else {
    audio.playSfx("timeup");
    lastLapId = null;

    el.resultTitle.textContent = "TIME'S UP!";
    el.resultTitle.className = "lose";
    el.resultLap.textContent = "NO LAP TIME";
    el.resultMsg.className = "msg bad";
    el.resultMsg.innerHTML =
      "YOU DIDN'T REACH THE FINISH LINE<br>BEFORE THE 120s CLOCK RAN OUT";
    el.againBtn.textContent = "Retry";
  }

  renderResultBoard(highlightId);
  renderMenuBoard();
  el.resultPanel.classList.add("show");
}

// ------------------------------------------------------------
// 7. UI wiring
// ------------------------------------------------------------

function syncSettingsUI() {
  const m = Math.round(audio.musicVol * 100);
  const s = Math.round(audio.sfxVol * 100);
  el.musicVol.value = m;
  el.musicVolVal.textContent = m + "%";
  el.sfxVol.value = s;
  el.sfxVolVal.textContent = s + "%";
  el.muteToggle.checked = audio.muted;
}

function openSettings() {
  audio.unlock();
  syncSettingsUI();
  el.settingsPanel.classList.add("show");
}

// browsers block autoplay: start the menu music on the first click / key
function firstInteraction() {
  if (!audio) return;
  audio.unlock();
  if (state === "menu") audio.startMusic("menu", false);
}
["pointerdown", "keydown"].forEach((type) =>
  addEventListener(type, firstInteraction, { once: true })
);

$("startBtn").addEventListener("click", startRace);
$("howBtn").addEventListener("click", () => el.howPanel.classList.add("show"));
$("howBackBtn").addEventListener("click", () =>
  el.howPanel.classList.remove("show")
);
$("settingsBtn").addEventListener("click", openSettings);
$("pauseSettingsBtn").addEventListener("click", openSettings);
$("backBtn").addEventListener("click", () =>
  el.settingsPanel.classList.remove("show")
);

$("resumeBtn").addEventListener("click", resumeGame);
$("restartBtn").addEventListener("click", () => {
  state = "menu"; // allow startRace() to run while paused in a race
  startRace();
});
$("pauseMenuBtn").addEventListener("click", quitToMainMenu);

$("againBtn").addEventListener("click", startRace);
$("exitBtn").addEventListener("click", quitToMainMenu);

el.musicVol.addEventListener("input", () => {
  audio.setMusicVolume(el.musicVol.value / 100);
  el.musicVolVal.textContent = el.musicVol.value + "%";
});
el.sfxVol.addEventListener("input", () => {
  audio.setSfxVolume(el.sfxVol.value / 100);
  el.sfxVolVal.textContent = el.sfxVol.value + "%";
});
el.muteToggle.addEventListener("change", () =>
  audio.setMuted(el.muteToggle.checked)
);

addEventListener("keydown", (e) => {
  const drive = KEY_ALIAS[e.code] || e.code;
  if (DRIVE_KEYS.includes(drive)) {
    KEYS[drive] = true;
    e.preventDefault();
    return;
  }
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.code === "KeyM") {
    audio.setMuted(!audio.muted);
    syncSettingsUI();
  } else if (e.code === "KeyC") {
    // C starts from the main menu or the result panel
    if ((state === "menu" && !anyModalOpen()) || state === "result")
      startRace();
  } else if (e.code === "KeyP") {
    paused ? resumeGame() : pauseGame();
  } else if (e.code === "Escape") {
    e.preventDefault();
    if (el.settingsPanel.classList.contains("show"))
      el.settingsPanel.classList.remove("show");
    else if (el.howPanel.classList.contains("show"))
      el.howPanel.classList.remove("show");
    else paused ? resumeGame() : pauseGame();
  }
});

addEventListener("keyup", (e) => {
  const drive = KEY_ALIAS[e.code] || e.code;
  if (DRIVE_KEYS.includes(drive)) {
    KEYS[drive] = false;
    e.preventDefault();
  }
});

// don't keep steering after the window loses focus; pause the race instead
addEventListener("blur", () => {
  for (const k in KEYS) KEYS[k] = false;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseGame();
});

// ------------------------------------------------------------
// 8. game loop
// ------------------------------------------------------------

function update(step) {
  const racing = state === "racing";

  // prepare this iteration
  const prevPos = pos; // needed to time the finish line crossing exactly
  pos += speed;
  while (pos >= N * segL) pos -= N * segL;
  while (pos < 0) pos += N * segL;

  var startPos = (pos / segL) | 0;
  let endPos = (startPos + N - 1) % N;

  scoreVal += speed * step;
  if (racing) {
    raceTime += step;
    countDown = TIME_LIMIT - raceTime;
  }

  // crash timers: spin-out first, then a short window of immunity
  const stunned = stunLeft > 0;
  if (stunned) {
    stunLeft = Math.max(0, stunLeft - step);
    if (stunLeft === 0) invincibleLeft = INVINCIBLE_TIME;
  } else if (invincibleLeft > 0) {
    invincibleLeft = Math.max(0, invincibleLeft - step);
  }
  updateHeroEffects();

  // off-road is allowed (the car just slows down), but reaching the outer
  // edge knocks the car back onto the road
  if (racing && !stunned && Math.abs(playerX) >= OFFROAD_EDGE) {
    audio.playSfx("crash");
    crash("offroad");
  }

  // left / right position
  playerX -= (lines[startPos].curve / 5000) * step * speed;

  if (stunned) {
    // out of control: no steering input; after an off-road knock-back the
    // car is pushed back toward the middle of the road
    if (stunKind === "offroad") playerX -= playerX * Math.min(1, step * 3);
  } else if (racing && KEYS.ArrowRight)
    (el.hero.style.backgroundPosition = "-220px 0"),
      (playerX += 0.007 * step * speed);
  else if (racing && KEYS.ArrowLeft)
    (el.hero.style.backgroundPosition = "0 0"),
      (playerX -= 0.007 * step * speed);
  else el.hero.style.backgroundPosition = "-110px 0";

  playerX = playerX.clamp(-3, 3);

  // speed
  if (stunned) speed = accelerate(speed, stunKind === "hit" ? breaking * 2 : breaking, step); // slow to a crawl
  else if (racing && KEYS.ArrowUp) speed = accelerate(speed, accel, step);
  else if (racing && KEYS.ArrowDown) speed = accelerate(speed, breaking, step);
  else speed = accelerate(speed, decel, step);

  if (Math.abs(playerX) > 0.55 && speed >= maxOffSpeed) {
    speed = accelerate(speed, offDecel, step);
  }

  speed = speed.clamp(0, maxSpeed);

  // update map
  let current = map[mapIndex];
  let use = current.from < scoreVal && current.to > scoreVal;
  if (use) sectionProg += speed * step;
  lines[endPos].curve = use ? current.curve(sectionProg) : 0;
  lines[endPos].y = use ? current.height(sectionProg) : 0;
  // never wipe the finish banner once it has been placed, otherwise it
  // disappears whenever the car is slower than top speed at that moment
  if (endPos !== finishLine) lines[endPos].special = null;

  if (current.to <= scoreVal) {
    mapIndex++;
    sectionProg = 0;

    lines[endPos].special = map[mapIndex].special;
    if (map[mapIndex].special) finishLine = endPos;
  }

  // win / lose + HUD
  if (!racing) {
    speed = accelerate(speed, breaking, step);
    speed = speed.clamp(0, maxSpeed);
  } else if (lines[startPos].special) {
    // the line was crossed somewhere inside this tick: work out the exact
    // moment instead of rounding up to the end of the tick
    const lineStart = startPos * segL;
    const dist = (lineStart - prevPos + N * segL) % (N * segL);
    const frac = speed > 0 ? Math.min(1, Math.max(0, dist / speed)) : 1;
    raceTime = raceTime - step * (1 - frac);
    el.lap.innerText = formatMs(raceTime * 1000); // HUD shows the same lap
    finishRace(raceTime < TIME_LIMIT);
  } else if (countDown <= 0) {
    finishRace(false);
  } else {
    el.time.innerText = pad(Math.ceil(countDown), 3);
    el.time.classList.toggle("warn", countDown <= 10);
    el.score.innerText = pad(scoreVal + bonus, 8);
    el.tacho.innerText = speed | 0;
    el.lap.innerText = formatMs(raceTime * 1000);

    // minimap: you = distance driven, Blackout = pace of his unbeaten time
    const done = Math.min(1, scoreVal / mapLength);
    const ghost = Math.min(1, raceTime / BLACKOUT_S);
    el.mmPlayer.style.left = `calc(6px + (100% - 20px) * ${done})`;
    el.mmGhost.style.left = `calc(6px + (100% - 20px) * ${ghost})`;
  }

  // engine sound
  if (racing && speed > 0) audio.play("engine", speed * 4);

  // draw cloud
  el.cloud.style.backgroundPosition = `${
    (cloudOffset -= lines[startPos].curve * step * speed * 0.13) | 0
  }px 0`;

  // other cars
  for (let car of cars) {
    car.pos = (car.pos + enemy_speed * step) % N;

    // respawn
    if ((car.pos | 0) === endPos) {
      // always recycle to the far end of the road; never drop a car onto
      // (or behind) the player, which caused a crash right after GO
      car.pos = (endPos - 2 + N) % N;
      car.lane = randomProperty(LANE);
    }

    // collision + near miss
    const offsetRatio = 5;
    const carX = playerX * offsetRatio + LANE.B;
    const onMySegment = (car.pos | 0) === startPos;

    // "alongside" = within 2 segments of you, ahead or behind.
    // hysteresis: award when a car gets within 2 segments, but only re-arm
    // once it has pulled 4+ segments clear (a slow pass wobbles in and out)
    const gap = (car.pos - startPos + N) % N;
    const alongside = gap < 2 || gap > N - 2;
    if (gap >= 4 && gap <= N - 4) car.nearDone = false; // ready for the next pass

    // near miss: a close call just outside the hit box, scored once per pass
    if (
      racing &&
      speed >= 30 && // only real passes at speed, no farming while crawling
      alongside &&
      !car.nearDone &&
      !isCollide(carX, 0.5, car.lane, 0.5) && // not touching (hit box = 1.0)
      isCollide(carX, 0.625, car.lane, 0.625)  // but within 1.25: a true close call
    ) {
      bonus += NEAR_MISS_POINTS;
      car.nearDone = true;
    }

    // a hit only counts when not already spinning out or invincible
    if (
      onMySegment &&
      stunLeft <= 0 &&
      invincibleLeft <= 0 &&
      isCollide(carX, 0.5, car.lane, 0.5)
    ) {
      speed = Math.min(hitSpeed, speed);

      if (racing && state === "racing") {
        audio.playSfx("crash");
        crash("hit");
        break; // stop checking this frame, one crash per hit
      }
    }
  }

  // draw road
  let maxy = height;
  let camH = H + lines[startPos].y;
  let x = 0;
  let dx = 0;

  for (let n = startPos; n < startPos + N; n++) {
    let l = lines[n % N];
    let level = N * 2 - n;

    // update view
    l.project(
      playerX * roadW - x,
      camH,
      startPos * segL - (n >= N ? N * segL : 0)
    );
    x += dx;
    dx += l.curve;

    // clear assets
    l.clearSprites();

    // first draw section assets
    if (n % 10 === 0) l.drawSprite(level, 0, ASSETS.IMAGE.TREE, -2);
    if ((n + 5) % 10 === 0) l.drawSprite(level, 0, ASSETS.IMAGE.TREE, 1.3);

    if (l.special) l.drawSprite(level, 0, l.special, l.special.offset || 0);

    for (let car of cars)
      if ((car.pos | 0) === n % N)
        l.drawSprite(level, car.element, car.type, car.lane);

    // update road
    if (l.Y >= maxy) continue;
    maxy = l.Y;

    let even = ((n / 2) | 0) % 2;
    let grass = ASSETS.COLOR.GRASS[even * 1];
    let rumble = ASSETS.COLOR.RUMBLE[even * 1];
    let tar = ASSETS.COLOR.TAR[even * 1];

    let p = lines[(n - 1) % N];

    drawQuad(
      l.elements[0],
      level,
      grass,
      width / 4,
      p.Y,
      halfWidth + 2,
      width / 4,
      l.Y,
      halfWidth
    );
    drawQuad(
      l.elements[1],
      level,
      grass,
      (width / 4) * 3,
      p.Y,
      halfWidth + 2,
      (width / 4) * 3,
      l.Y,
      halfWidth
    );

    drawQuad(
      l.elements[2],
      level,
      rumble,
      p.X,
      p.Y,
      p.W * 1.15,
      l.X,
      l.Y,
      l.W * 1.15
    );
    drawQuad(l.elements[3], level, tar, p.X, p.Y, p.W, l.X, l.Y, l.W);

    if (!even) {
      drawQuad(
        l.elements[4],
        level,
        ASSETS.COLOR.RUMBLE[1],
        p.X,
        p.Y,
        p.W * 0.4,
        l.X,
        l.Y,
        l.W * 0.4
      );
      drawQuad(
        l.elements[5],
        level,
        tar,
        p.X,
        p.Y,
        p.W * 0.35,
        l.X,
        l.Y,
        l.W * 0.35
      );
    }
  }
}

// kind "hit": hitting a car knocks the player backward and slows them (no
// rotation). kind "offroad": reaching the outer off-road edge does the same
// and pushes the car back onto the road.
// Either way there is STUN_TIME without control, then INVINCIBLE_TIME of
// immunity. Distance, score, bonus, map progress, traffic and the clock are
// left untouched.
function crash(kind) {
  stunKind = kind === "offroad" ? "offroad" : "hit";
  stunLeft = STUN_TIME;
  invincibleLeft = 0;
}

// visual feedback: knock-back or spin while stunned, blink while invincible
function updateHeroEffects() {
  const KNOCK_PX = 35; // how far the car is pushed back down the screen
  if (stunLeft > 0) {
    const t = 1 - stunLeft / STUN_TIME; // 0 -> 1 over the stun
    // shoved back at once, then eases forward again (no rotation)
    const k = (1 - t) * (1 - t);
    el.hero.style.transform = `translateY(${KNOCK_PX * k}px) scale(${
      1.4 - 0.2 * k
    })`;
    el.hero.style.opacity = "1";
  } else if (invincibleLeft > 0) {
    el.hero.style.transform = "";
    el.hero.style.opacity = Math.floor(invincibleLeft * 8) % 2 ? "0.35" : "1";
  } else {
    el.hero.style.transform = "";
    el.hero.style.opacity = "";
  }
}

// ------------------------------------------------------------
// 9. init
// ------------------------------------------------------------

function init() {
  el.game.style.width = width + "px";
  el.game.style.height = height + "px";

  el.hero.style.top = height - 80 + "px";
  el.hero.style.left = halfWidth - ASSETS.IMAGE.HERO.width / 2 + "px";
  el.hero.style.background = `url(${ASSETS.IMAGE.HERO.src})`;
  el.hero.style.width = `${ASSETS.IMAGE.HERO.width}px`;
  el.hero.style.height = `${ASSETS.IMAGE.HERO.height}px`;

  el.cloud.style.backgroundImage = `url(${ASSETS.IMAGE.SKY.src})`;

  audio = new SoundManager();
  Object.keys(ASSETS.AUDIO).forEach((key) =>
    audio.load(ASSETS.AUDIO[key], key)
  );
  syncSettingsUI();

  cars.push(new Car(0, ASSETS.IMAGE.CAR, LANE.C));
  cars.push(new Car(10, ASSETS.IMAGE.CAR, LANE.B));
  cars.push(new Car(20, ASSETS.IMAGE.CAR, LANE.C));
  cars.push(new Car(35, ASSETS.IMAGE.CAR, LANE.C));
  cars.push(new Car(50, ASSETS.IMAGE.CAR, LANE.A));
  cars.push(new Car(60, ASSETS.IMAGE.CAR, LANE.B));
  cars.push(new Car(70, ASSETS.IMAGE.CAR, LANE.A));

  for (let i = 0; i < N; i++) {
    var line = new Line();
    line.z = i * segL + 270;

    for (let j = 0; j < 6 + 2; j++) {
      var element = document.createElement("div");
      el.road.appendChild(element);
      line.elements.push(element);
    }

    lines.push(line);
  }

  resetRun();
  showMenuScene();
  renderMenuBoard();

  // START GAME LOOP (fixed 25 fps simulation)
  let last = performance.now();
  let acc = 0;
  (function loop(now) {
    requestAnimationFrame(loop);

    acc += Math.min(0.25, (now - last) / 1000);
    last = now;

    // run as many fixed steps as real time requires, so the race clock
    // stays true to the wall clock even when frames are slow
    while (acc >= FIXED_STEP) {
      acc -= FIXED_STEP;
      if (!paused) update(FIXED_STEP);
    }
  })(last);
}

init();

// The scene renders at a fixed 800x500 so the pixel art keeps its
// proportions. Scale the whole stage to fit the window instead of
// changing the render size. Swap Math.min for Math.max to fill the
// screen edge to edge (this crops the top and bottom slightly).
function fitStage() {
  const scale = Math.min(
    window.innerWidth / width,
    window.innerHeight / height
  );
  el.game.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

fitStage();
addEventListener("resize", fitStage);

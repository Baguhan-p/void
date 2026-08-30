// ============================================================
//  Game — движок «Частоты Забвения»
//  игрок, время, паранойя, Морзе-приём/передача, квесты, события
// ============================================================
import * as THREE from "three";
import { AudioManager } from "./audio";
import type { Surface } from "./audio";
import { buildWorld, drawMap } from "./world";
import type { WorldRefs, MapFlags } from "./world";
import { buildMorseTimeline, decodeCode, MORSE_TABLE, NIGHT_SIGNALS, TRANSMIT_WORDS, normalize } from "./morse";
import type { MorseEvent } from "./morse";

export type Screen = "menu" | "playing" | "paused" | "dead" | "won";
export interface JournalEntry { day: number; title: string; text: string; }
export interface Toast { id: number; text: string; tag?: string; }

export interface Snapshot {
  screen: Screen;
  day: number; timeLabel: string; isNight: boolean;
  prompt: string; altPrompt: string; holdProgress: number | null;
  objective: string;
  paranoia: number; battery: number; flashOn: boolean;
  held: string[]; firewood: number;
  notebookOpen: boolean; notebookTab: "journal" | "morse" | "map";
  journal: JournalEntry[];
  toasts: Toast[];
  hasSave: boolean;
  lockless: boolean;
  settings: { volume: number; sens: number; subtitles: boolean };
  eventFlash: number;
  mapFlags: MapFlags;
  stats: { decoded: number; transmitted: number; cassettes: number };
  deathReason: string;
}

interface Flags {
  sheetRead: boolean; flashlightTaken: boolean; shovelTaken: boolean; partsTaken: boolean;
  rx: Record<number, boolean>; tx1: boolean;
  coordsKnown: boolean; dug: boolean; caveOpen: boolean; caveLooted: boolean; crystalTaken: boolean;
  antennaBroken: boolean; antennaFixed: boolean;
  molchiPending: boolean; molchiChoice: "sent" | "silent" | null;
  filterSpawned: boolean; filterRemoved: boolean; forestDark: boolean; wellSeen: boolean;
  bunkerLooted: [boolean, boolean]; cassetteTaken: [boolean, boolean, boolean]; txDone: [boolean, boolean, boolean];
  canistersTakenToday: number; batteriesTaken: string[]; firewoodTaken: number;
}

interface Interactable {
  id: string; pos: THREE.Vector3; radius: number;
  prompt: () => string | null;
  altPrompt?: () => string | null;
  action: () => void;
  altAction?: () => void;
  hold?: number;
}

const DAY_SECONDS = 150;               // игровые сутки = 150 реальных секунд
const SAVE_KEY = "chastota_zabveniya_v1";
const EYE = 1.68;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function fmtTime(h: number): string {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ключевые кадры неба: [час, цвет, плотность тумана, солнце, цвет солнца, hemi]
const SKY: [number, string, number, number, string, number][] = [
  [0, "#04060c", 0.030, 0.0, "#3a4a6a", 0.05],
  [5, "#0a0f18", 0.027, 0.02, "#5a6a8a", 0.09],
  [7, "#66798c", 0.017, 0.5, "#ffd9a0", 0.36],
  [9, "#8ba0aa", 0.013, 1.05, "#ffe3b3", 0.55],
  [16, "#8b9da6", 0.013, 0.95, "#ffe0a8", 0.52],
  [18, "#6d504a", 0.017, 0.45, "#ff9a4a", 0.3],
  [20, "#10151f", 0.026, 0.04, "#4a5a7a", 0.1],
  [24, "#04060c", 0.030, 0.0, "#3a4a6a", 0.05],
];

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  audio = new AudioManager();
  world: WorldRefs;
  onSnap: (s: Snapshot) => void;

  // ---- state ----
  screen: Screen = "menu";
  day = 1; hour = 7.0;
  paranoia = 0; fuel = 72; battery = 100; stamina = 100;
  flashOn = false; firewood = 0; fireLitT = 0;
  inventory: string[] = [];
  flags: Flags = this.freshFlags();
  journal: JournalEntry[] = [];
  toasts: Toast[] = []; private toastId = 0;
  notebookOpen = false; notebookTab: "journal" | "morse" | "map" = "journal";
  settings = { volume: 0.8, sens: 1.0, subtitles: true };
  hasSave = false;
  deathReason = "";
  eventFlash = 0; private shake = 0;

  // ---- player ----
  pos = new THREE.Vector3(0, EYE, 9);
  yaw = 0; pitch = 0; floorLevel = 0;
  private keys = new Set<string>();
  private bobT = 0; private stepAcc = 0;
  private flash!: THREE.SpotLight;

  // ---- morse rx ----
  freq = 600; private pendingDay = 0; private rxLocked = false;
  private rxTimeline: MorseEvent[] = []; private rxTotal = 1; private rxPlayT = 0;
  private rxCode = ""; private rxDecoded = ""; private rxFails = 0; private rxLastInput = -10;
  private lampGlow = 0;

  // ---- morse tx ----
  private txTarget: string | null = null; private txTargetKey = "";
  private txCode = ""; private txDecoded = ""; private txFails = 0; private txLastInput = -10;
  private txPressStart = 0; private txPressing = false; private txPressDur = 0;

  private holdTarget: Interactable | null = null; private holdProgress = 0;
  private promptNow = ""; private altNow = "";
  // фолбэк управления, если браузер/iframe не даёт pointer lock
  lockless = false; private lookDrag = false; private lastMX = 0; private lastMY = 0;
  private lockWarned = false;
  private interactables: Interactable[] = [];
  private clock = new THREE.Clock();
  private raf = 0; private disposed = false;
  private snapT = 0; private canvasT = 0; private mapDirty = true;
  private locked = false;
  private creakT = 8; private breatheT = 0; private lightningT = 4;
  private wellCooldown = 0; private fovPunch = 0;
  private seaPos: THREE.BufferAttribute;

  constructor(canvas: HTMLCanvasElement, onSnap: (s: Snapshot) => void) {
    this.onSnap = onSnap;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 700);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.scene.fog = new THREE.FogExp2(0x8ba0aa, 0.013);
    this.scene.background = new THREE.Color(0x8ba0aa);

    this.world = buildWorld(this.scene);
    this.seaPos = (this.world.sea.geometry as THREE.PlaneGeometry).attributes.position as THREE.BufferAttribute;

    // фонарик
    this.flash = new THREE.SpotLight(0xfff0d0, 0, 70, 0.46, 0.42, 1.3);
    this.flash.position.set(0.32, -0.28, 0.1);
    const ft = new THREE.Object3D(); ft.position.set(0, 0, -12);
    this.camera.add(ft); this.flash.target = ft;
    this.camera.add(this.flash);

    // коллизии от деревьев рядом с поляной
    for (const t of this.world.nearTrees)
      this.world.colliders.push({ minX: t.x - 0.4, maxX: t.x + 0.4, minZ: t.z - 0.4, maxZ: t.z + 0.4, minY: 0, maxY: 3 });

    this.registerInteractables();
    this.loadSaveMeta();
    this.bind();
    this.resize();
    window.addEventListener("resize", this.resize);
    this.camera.position.set(17, 6, 32);
    this.camera.lookAt(0, 7, 0);
    this.clock.start();
    this.loop();
    this.emit();
  }

  private freshFlags(): Flags {
    return {
      sheetRead: false, flashlightTaken: false, shovelTaken: false, partsTaken: false,
      rx: {}, tx1: false, coordsKnown: false, dug: false, caveOpen: false, caveLooted: false,
      crystalTaken: false, antennaBroken: false, antennaFixed: false, molchiPending: false,
      molchiChoice: null, filterSpawned: false, filterRemoved: false, forestDark: false, wellSeen: false,
      bunkerLooted: [false, false], cassetteTaken: [false, false, false], txDone: [false, false, false],
      canistersTakenToday: 0, batteriesTaken: [], firewoodTaken: 0,
    };
  }

  // ============================================================
  //  ВВОД
  // ============================================================
  private bind() {
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMouse);
    document.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("contextmenu", this.onCtx);
  }
  private onCtx = (e: MouseEvent) => {
    if (this.screen === "playing") e.preventDefault();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMouse);
    document.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("contextmenu", this.onCtx);
    window.removeEventListener("resize", this.resize);
    this.renderer.dispose();
  }

  private resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private onLockChange = () => {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.renderer.domElement;
    if (this.locked) this.lookDrag = false;
    // авто-пауза только если захват был и сорвался (Esc); в фолбэк-режиме пауза — по клавише Esc
    if (!this.locked && was && this.screen === "playing" && !this.notebookOpen) this.pause();
  };
  private onMouse = (e: MouseEvent) => {
    if (this.screen !== "playing" || this.notebookOpen) return;
    if (!this.locked && !(this.lockless && this.lookDrag)) return;
    const dx = this.locked ? e.movementX : e.clientX - this.lastMX;
    const dy = this.locked ? e.movementY : e.clientY - this.lastMY;
    this.lastMX = e.clientX; this.lastMY = e.clientY;
    this.yaw -= dx * 0.0021 * this.settings.sens;
    this.pitch = clamp(this.pitch - dy * 0.0021 * this.settings.sens, -1.45, 1.45);
  };
  private onMouseDown = (e: MouseEvent) => {
    if (!(this.locked || this.lockless) || this.screen !== "playing" || this.notebookOpen) return;
    if (e.button === 2) {
      if (this.lockless && !this.locked) {
        this.lookDrag = true; this.lastMX = e.clientX; this.lastMY = e.clientY;
        e.preventDefault();
      }
      return;
    }
    if (e.button !== 0) return;
    const keyNear = this.nearKey();
    if (keyNear && this.txTarget && this.powerOn()) {
      this.txPressing = true; this.txPressStart = performance.now();
      this.world.keyLever.rotation.z = -0.2;
      this.audio.keyClack();
    }
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) { this.lookDrag = false; return; }
    if (e.button !== 0 || !this.txPressing) return;
    this.txPressing = false;
    this.world.keyLever.rotation.z = 0;
    if (this.screen !== "playing") return;
    const dur = (performance.now() - this.txPressStart) / 1000;
    this.txPressDur = dur;
    const el = dur < 0.21 ? "." : "-";
    this.audio.morseBeep(dur, true);
    this.pushTx(el);
  };
  private onWheel = (e: WheelEvent) => {
    if (!(this.locked || this.lockless) || this.screen !== "playing") return;
    if (this.distTo(new THREE.Vector3(-1.6, this.floorEye(), -3.2)) < 3.4) {
      e.preventDefault();
      const nf = clamp(this.freq + (e.deltaY > 0 ? -5 : 5), 500, 1600);
      if (nf !== this.freq) { this.freq = nf; this.audio.dialTick(); }
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (["Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Backspace", "Tab"].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (this.screen === "menu") return;

    if (e.code === "KeyN" && (this.screen === "playing" || this.notebookOpen)) {
      this.toggleNotebook(); return;
    }
    if (e.code === "Escape") {
      if (this.notebookOpen) { this.closeNotebook(); return; }
      // в фолбэк-режиме (без pointer lock) Esc сам вызывает паузу;
      // при захвате курсора Esc снимает захват → пауза придёт из onLockChange
      if (this.screen === "playing" && this.lockless && !this.locked) this.pause();
      return;
    }
    if (this.notebookOpen || this.screen !== "playing") return;

    switch (e.code) {
      case "KeyF": this.toggleFlash(); break;
      case "KeyE": this.tryInteract(); break;
      case "KeyQ": this.tryAlt(); break;
      case "KeyZ": this.rxInput("."); break;
      case "KeyX": this.rxInput("-"); break;
      case "Space": this.rxInput(" "); break;
      case "Backspace": this.rxDelete(); break;
      case "ArrowLeft": this.tuneFreq(-4); break;
      case "ArrowRight": this.tuneFreq(4); break;
    }
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };

  // ============================================================
  //  PUBLIC API (для React)
  // ============================================================
  startNew() {
    localStorage.removeItem(SAVE_KEY);
    this.resetState();
    this.beginPlay();
    this.toast("День 1. Вышка-9 приняла вас на вахту.", "[щёлкает реле]");
    this.journalPush(1, "Журнал смотрителя", "Прибыл на вышку. Всё нормально, только лес какой-то тихий...");
  }
  continueGame() {
    if (!this.loadSave()) { this.startNew(); return; }
    this.beginPlay();
    this.toast(`День ${this.day}. Вахта продолжается.`);
  }
  resume() {
    this.screen = "playing";
    this.audio.resume();
    this.lock();
    this.emit();
  }
  pause() {
    if (this.screen !== "playing") return;
    this.screen = "paused";
    this.saveGame();
    this.emit();
  }
  quitToMenu() {
    this.saveGame();
    this.screen = "menu";
    this.hasSave = !!localStorage.getItem(SAVE_KEY);
    this.notebookOpen = false;
    if (this.locked) document.exitPointerLock();
    this.emit();
  }
  restart() {
    localStorage.removeItem(SAVE_KEY);
    window.location.reload();
  }
  setSettings(p: Partial<{ volume: number; sens: number; subtitles: boolean }>) {
    Object.assign(this.settings, p);
    this.audio.setVolume(this.settings.volume);
    try { localStorage.setItem("chastota_settings", JSON.stringify(this.settings)); } catch { /* ignore */ }
    this.emit();
  }
  closeNotebook() {
    if (!this.notebookOpen) return;
    this.notebookOpen = false;
    this.lock();
    this.emit();
  }
  setNotebookTab(t: "journal" | "morse" | "map") { this.notebookTab = t; this.emit(); }
  toggleNotebook() {
    if (this.screen !== "playing" && !this.notebookOpen) return;
    this.notebookOpen = !this.notebookOpen;
    if (this.notebookOpen) { if (this.locked) document.exitPointerLock(); this.audio.uiClick(); }
    else this.lock();
    this.emit();
  }
  playMorseLetter(ch: string) {
    const code = MORSE_TABLE[ch.toUpperCase()];
    if (!code) return;
    let t = 0;
    for (const el of code) {
      const d = el === "." ? 0.09 : 0.27;
      window.setTimeout(() => this.audio.morseBeep(d, true), t * 1000);
      t += d + 0.09;
    }
  }

  // ============================================================
  //  СЛУЖЕБНОЕ
  // ============================================================
  private lock() {
    if (this.locked) return;
    let settled = false;
    try {
      const p = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.then === "function") {
        settled = true;
        p.then(() => { /* захват получен — onLockChange подхватит */ })
          .catch(() => this.fallbackLook());
      }
    } catch {
      this.fallbackLook();
      return;
    }
    // браузер без промиса (старый Safari) — проверяем фактом через ~1с
    if (!settled) {
      window.setTimeout(() => {
        if (!this.locked) this.fallbackLook();
      }, 1000);
    }
  }
  private fallbackLook() {
    if (this.locked) return;
    this.lockless = true;
    if (!this.lockWarned && (this.screen === "playing" || this.screen === "paused")) {
      this.lockWarned = true;
      this.toast("Захват курсора запрещён средой: обзор — зажать правую кнопку мыши", "[помехи]");
    }
    this.emit();
  }
  private beginPlay() {
    this.audio.init();
    this.audio.resume();
    this.audio.setVolume(this.settings.volume);
    this.screen = "playing";
    this.lock();
    this.emit();
  }
  private resetState() {
    this.day = 1; this.hour = 7; this.paranoia = 0; this.fuel = 72; this.battery = 100;
    this.stamina = 100; this.flashOn = false; this.firewood = 0; this.fireLitT = 0;
    this.inventory = []; this.flags = this.freshFlags(); this.journal = []; this.toasts = [];
    this.pos.set(0, EYE, 10); this.yaw = 0; this.pitch = 0; this.floorLevel = 0;
    this.pendingDay = 0; this.rxDecoded = ""; this.rxCode = ""; this.txFails = 0;
    this.applyVisualState();
  }
  private emit() { this.onSnap(this.snapshot()); }
  private snapshot(): Snapshot {
    const held: string[] = [];
    if (this.inventory.includes("flashlight")) held.push(this.flashOn ? "Фонарик (вкл)" : "Фонарик");
    if (this.inventory.includes("shovel")) held.push("Лопата");
    if (this.inventory.includes("canister")) held.push("Канистра");
    if (this.inventory.includes("key")) held.push("Ржавый ключ");
    if (this.inventory.includes("parts")) held.push("Запчасти");
    if (this.inventory.includes("crystal")) held.push("Кристалл памяти");
    for (let i = 0; i < 3; i++) if (this.inventory.includes(`cassette${i + 1}`)) held.push(`Кассета ДАННЫЕ-${i + 1}`);
    return {
      screen: this.screen, day: this.day, timeLabel: fmtTime(this.hour),
      isNight: this.isNight(), prompt: this.promptNow, altPrompt: this.altNow,
      holdProgress: this.holdTarget ? this.holdProgress : null,
      objective: this.objective(), paranoia: this.paranoia, battery: this.battery,
      flashOn: this.flashOn, held, firewood: this.firewood,
      notebookOpen: this.notebookOpen, notebookTab: this.notebookTab,
      journal: this.journal, toasts: this.toasts.slice(-4), hasSave: this.hasSave,
      lockless: this.lockless && !this.locked,
      settings: { ...this.settings }, eventFlash: this.eventFlash,
      mapFlags: this.mapFlags(),
      stats: {
        decoded: Object.values(this.flags.rx).filter(Boolean).length,
        transmitted: (this.flags.tx1 ? 1 : 0) + this.flags.txDone.filter(Boolean).length,
        cassettes: this.flags.txDone.filter(Boolean).length,
      },
      deathReason: this.deathReason,
    };
  }
  private mapFlags(): MapFlags {
    return {
      coordsKnown: this.flags.coordsKnown, caveOpen: this.flags.caveOpen,
      serversLooted: [...this.flags.bunkerLooted] as [boolean, boolean], dug: this.flags.dug,
    };
  }

  toast(text: string, tag?: string) {
    const t: Toast = { id: ++this.toastId, text, tag: this.settings.subtitles ? tag : undefined };
    this.toasts.push(t);
    if (this.toasts.length > 5) this.toasts.shift();
    window.setTimeout(() => { this.toasts = this.toasts.filter((x) => x.id !== t.id); this.emit(); }, tag ? 4200 : 3400);
    this.emit();
  }
  private journalPush(day: number, title: string, text: string) {
    this.journal.push({ day, title, text });
  }
  private give(id: string) { if (!this.inventory.includes(id)) this.inventory.push(id); this.audio.pickup(); }
  private take(id: string) { this.inventory = this.inventory.filter((x) => x !== id); }
  private has(id: string) { return this.inventory.includes(id); }

  private powerOn() { return this.fuel > 0; }
  private antennaOK() { return !this.flags.antennaBroken || this.flags.antennaFixed; }
  private isNight() { return this.hour >= 19.5 || this.hour < 6.5; }
  private floorEye() { return this.world.floors[this.floorLevel]; }

  private distTo(p: THREE.Vector3) {
    const dy = this.pos.y - EYE - p.y;
    return Math.hypot(this.pos.x - p.x, this.pos.z - p.z, dy * 0.15);
  }
  private nearKey() {
    return this.floorLevel === 2 && Math.hypot(this.pos.x - 1.6, this.pos.z - (-3.2)) < 2.0;
  }
  private nearReceiver() {
    return this.floorLevel === 2 && Math.hypot(this.pos.x - (-1.6), this.pos.z - (-3.2)) < 2.6;
  }

  // ============================================================
  //  ИНТЕРАКТИВЫ
  // ============================================================
  private reg(i: Interactable) { this.interactables.push(i); }
  private V(x: number, y: number, z: number) { return new THREE.Vector3(x, y, z); }

  private registerInteractables() {
    const W = this.world, F = W.floors, L = W.ladder;
    // лестница
    this.reg({
      id: "ladder", pos: this.V(L.x, 0, L.z), radius: 1.7,
      prompt: () => {
        const inside = Math.abs(this.pos.x) < 4.2 && Math.abs(this.pos.z) < 4.2;
        if (!inside) return null;
        const up = this.floorLevel < 3 ? "вверх [E]" : "";
        const dn = this.floorLevel > 0 ? "вниз [Q]" : "";
        if (!up && !dn) return null;
        return `Лестница — ${up}${up && dn ? " · " : ""}${dn}`;
      },
      action: () => { if (this.floorLevel < 3) { this.floorLevel++; this.audio.footstep("metal", false); this.audio.creak(); } },
      altPrompt: () => (this.floorLevel > 0 && Math.abs(this.pos.x) < 4.4 && Math.abs(this.pos.z) < 4.4) ? "Лестница — вниз [Q]" : null,
      altAction: () => { if (this.floorLevel > 0) { this.floorLevel--; this.audio.footstep("metal", false); } },
    });
    // печь
    this.reg({
      id: "stove", pos: this.V(2.9, 0, -2.4), radius: 1.7,
      prompt: () => (this.floorLevel === 0 ? "Печь — погреть руки [E]" : null),
      action: () => {
        if (this.wellCooldown > 0) return;
        this.wellCooldown = 4; this.paranoia = clamp(this.paranoia - 3, 0, 100);
        this.toast("Тепло печки. Дыхание ровнее.", "[треск огня]");
      },
    });
    // лист передачи (стол, уровень 1)
    this.reg({
      id: "sheetRead", pos: this.V(0.4, 0, -3.2), radius: 1.6,
      prompt: () => (this.floorLevel === 0 && !this.flags.sheetRead ? "Лист передачи — прочитать [E]" : null),
      action: () => {
        this.flags.sheetRead = true; this.audio.paper();
        this.journalPush(this.day, "Лист передачи", "Ответ станции: «МОРЕ». Отстукать ключом на верхнем этаже: коротко — точка, длинно — тире.");
        this.toast("Лист передачи: ответ — «МОРЕ». Ключ — наверху.", "[шелест бумаги]");
      },
    });
    // канистры
    for (let i = 0; i < 2; i++) {
      this.reg({
        id: `canister${i}`, pos: this.V(3.55, 0, i === 0 ? 1.15 : 2.05), radius: 1.6,
        prompt: () => {
          if (this.floorLevel !== 0 || this.flags.canistersTakenToday > i) return null;
          return this.has("canister") ? "Канистра — руки заняты" : "Взять канистру [E]";
        },
        action: () => {
          if (this.floorLevel !== 0 || this.flags.canistersTakenToday > i || this.has("canister")) return;
          this.flags.canistersTakenToday = i + 1;
          W.canisters[i].visible = false;
          this.give("canister");
          this.toast("Канистра с топливом. К генератору — на средний этаж.");
        },
      });
    }
    // генератор: заправка
    this.reg({
      id: "generator", pos: this.V(2.4, F[1], -2.6), radius: 1.9,
      prompt: () => {
        if (this.floorLevel !== 1) return null;
        if (this.has("canister")) return "Заправить генератор [E]";
        return this.fuel < 30 ? `Генератор — топливо ${Math.round(this.fuel)}%` : null;
      },
      action: () => {
        if (!this.has("canister")) return;
        this.take("canister");
        this.fuel = clamp(this.fuel + 45, 0, 100);
        this.audio.success();
        this.toast(`Генератор заправлен: ${Math.round(this.fuel)}%.`, "[гул выравнивается]");
      },
    });
    // фильтр (плоть)
    this.reg({
      id: "filter", pos: this.V(1.15, F[1], -2.05), radius: 1.5,
      prompt: () => (this.flags.filterSpawned && !this.flags.filterRemoved && this.floorLevel === 1 ? "Извлечь массу из фильтра [E — держать]" : null),
      action: () => {
        this.flags.filterRemoved = true;
        W.filterMesh.visible = false;
        this.paranoia = clamp(this.paranoia + 8, 0, 100);
        this.audio.fail(); this.audio.whisper(); this.eventFlash = 1;
        this.journalPush(this.day, "Фильтр", "Это было не железо. Оно было тёплое. Радио сказало: СПАСИБО. РАССВЕТ БУДЕТ.");
        this.toast("РАДИО: «СПАСИБО. РАССВЕТ БУДЕТ.»", "[мокрый хруст]");
      },
      hold: 3.5,
    });
    // верстак: лопата / фонарик / запчасти / батарея
    this.reg({
      id: "shovel", pos: this.V(-3.4, 0, -1.3), radius: 1.5,
      prompt: () => (this.floorLevel === 0 && !this.flags.shovelTaken ? "Взять лопату [E]" : null),
      action: () => { this.flags.shovelTaken = true; W.shovelMesh.visible = false; this.give("shovel"); this.toast("Лопата. Тяжёлая, с ржавчиной."); },
    });
    this.reg({
      id: "flashlight", pos: this.V(-3.4, 0, -0.4), radius: 1.5,
      prompt: () => (this.floorLevel === 0 && !this.flags.flashlightTaken ? "Взять фонарик [E]" : null),
      action: () => { this.flags.flashlightTaken = true; W.flashlightMesh.visible = false; this.give("flashlight"); this.toast("Фонарик. Клавиша [F]. Берегите батарею."); },
    });
    this.reg({
      id: "parts", pos: this.V(-3.4, 0, 0.3), radius: 1.5,
      prompt: () => (this.floorLevel === 0 && !this.flags.partsTaken && W.partsMesh.visible ? "Взять запчасти антенны [E]" : null),
      action: () => { this.flags.partsTaken = true; W.partsMesh.visible = false; this.give("parts"); this.toast("Запасные секции антенны."); },
    });
    const batSpots: [string, number, number, number, number][] = [
      ["bat0", -3.35, 0.93, 0.75, 0], ["bat1", 1.2, 0.93, 4.8, 0], ["bat2", 40, 0.5, 101, -1],
    ];
    batSpots.forEach(([bid, bx, , bz], i) => {
      this.reg({
        id: bid as string, pos: this.V(bx as number, 0, bz as number), radius: 1.5,
        prompt: () => {
          if (this.flags.batteriesTaken.includes(bid as string)) return null;
          if (i === 2 && !this.flags.caveOpen) return null;
          return "Взять батарею [E]";
        },
        action: () => {
          this.flags.batteriesTaken.push(bid as string);
          W.batteryMeshes[i] && (W.batteryMeshes[i].visible = false);
          this.battery = 100;
          this.audio.pickup();
          this.toast("Свежая батарея. Фонарик заряжен.");
        },
      });
    });
    // антенна (мачта на крыше)
    this.reg({
      id: "antenna", pos: this.V(0, F[3], -1.6), radius: 2.0,
      prompt: () => {
        if (this.floorLevel !== 3) return null;
        if (this.flags.antennaBroken && !this.flags.antennaFixed)
          return this.has("parts") ? "Починить антенну [E — держать]" : "Антенна сломана — нужны запчасти";
        return null;
      },
      action: () => {
        if (!this.has("parts")) return;
        this.take("parts");
        this.flags.antennaFixed = true;
        W.mast.rotation.z = 0;
        this.audio.success();
        this.journalPush(this.day, "Антенна", "Собрал антенну из запасных секций. Ветер сегодня злой.");
        this.toast("Антенна восстановлена. Приём снова возможен.");
      },
      hold: 2.2,
    });
    // костёр
    this.reg({
      id: "fire", pos: this.V(8, 0, 6), radius: 2.0,
      prompt: () => {
        if (this.fireLitT > 0) return "Костёр горит — тепло";
        return this.firewood > 0 ? "Разжечь костёр [E]" : "Кострище — нужны поленья (дровник)";
      },
      action: () => {
        if (this.fireLitT > 0 || this.firewood <= 0) return;
        this.firewood--; this.fireLitT = 75;
        W.fireGlow.children.forEach((c, i) => { if (i === W.fireGlow.children.length - 1) c.visible = true; });
        this.audio.match();
        this.toast("Костёр разожжён. Свет держит тьму.", "[треск огня]");
      },
    });
    // дровник
    this.reg({
      id: "woodpile", pos: this.V(-8.4, 0, 6.5), radius: 2.0,
      prompt: () => {
        const left = 6 - this.flags.firewoodTaken;
        if (left <= 0) return "Дровник пуст";
        return this.firewood >= 3 ? "Поленья — больше не унести" : "Взять полено [E]";
      },
      action: () => {
        if (this.firewood >= 3 || this.flags.firewoodTaken >= 6) return;
        const idx = this.flags.firewoodTaken;
        this.flags.firewoodTaken++;
        W.firewoodMeshes[idx].visible = false;
        this.firewood++;
        this.audio.pickup();
        this.toast(`Полено (${this.firewood}/3).`);
      },
    });
    // колодец
    this.reg({
      id: "well", pos: this.V(11, 0, 9), radius: 2.2,
      prompt: () => "Заглянуть в колодец [E]",
      action: () => {
        if (this.wellCooldown > 0) return;
        this.wellCooldown = 6;
        if (this.day >= 6 && !this.flags.wellSeen) {
          this.flags.wellSeen = true;
          this.audio.whisper(); this.paranoia = clamp(this.paranoia + 9, 0, 100); this.eventFlash = 0.8;
          this.journalPush(this.day, "Колодец", "Заглянул в колодец. Снизу на меня смотрели. И моргнули первыми.");
          this.toast("Из глубины кто-то моргнул.", "[плеск]");
        } else {
          this.toast("Чёрная вода. Ваше лицо — и что-то ещё.");
        }
      },
    });
    // раскоп
    this.reg({
      id: "dig", pos: this.V(-34, 0, 78), radius: 2.6,
      prompt: () => {
        if (!this.flags.coordsKnown || this.flags.dug) return this.flags.dug ? "Разрытая яма — пусто" : null;
        return this.has("shovel") ? "Копать [E — держать]" : "Рыхлая земля мерцает — нужна лопата";
      },
      action: () => {
        if (!this.has("shovel") || this.flags.dug) return;
        this.flags.dug = true;
        W.holeMesh.visible = true;
        this.give("key");
        this.audio.dig(); this.audio.heartSpike();
        this.mapDirty = true;
        this.journalPush(this.day, "Раскоп", "На глубине полуметра — ржавый ключ. Тёплый. Ключи не бывают тёплыми.");
        this.toast("Найден РЖАВЫЙ КЛЮЧ. Он тёплый.", "[сердцебиение]");
      },
      hold: 2.6,
    });
    // люк → пещера
    this.reg({
      id: "hatch", pos: this.V(40, 0, 87.7), radius: 2.2,
      prompt: () => {
        if (!this.flags.caveOpen) return this.has("key") ? "Открыть люк ржавым ключом [E]" : "Люк в скале — заперт";
        return "Спуститься в пещеру [E]";
      },
      action: () => {
        if (!this.flags.caveOpen) {
          if (!this.has("key")) return;
          this.flags.caveOpen = true;
          W.hatchMesh.visible = false;
          W.caveLight.intensity = 5;
          this.audio.hatchOpen(); this.mapDirty = true;
          this.journalPush(this.day, "Люк", "Ключ подошёл. За люком — коридор. Гул, как у серверной, только ниже. Как дыхание.");
          this.toast("Люк открыт. Изнутри тянет теплом.", "[скрежет]");
        } else {
          this.pos.set(40, EYE, 95.5); this.floorLevel = 0;
          this.audio.footstep("metal", false);
        }
      },
    });
    this.reg({
      id: "caveExit", pos: this.V(40, 0, 92.6), radius: 1.8,
      prompt: () => (this.pos.z > 91 ? "Выйти из пещеры [E]" : null),
      action: () => { this.pos.set(40, EYE, 85.5); this.audio.footstep("dirt", false); },
    });
    // кассета в пещере + кристалл
    this.reg({
      id: "cassette3", pos: this.V(40, 0, 104), radius: 2.2,
      prompt: () => (this.flags.caveOpen && !this.flags.caveLooted && this.pos.z > 91 ? "Взять кассету ДАННЫЕ-3 [E]" : null),
      action: () => { this.flags.caveLooted = true; this.give("cassette3"); this.toast("Кассета ДАННЫЕ-3. Липкая от конденсата."); },
    });
    this.reg({
      id: "crystal", pos: this.V(40, 0.9, 104.4), radius: 1.6,
      prompt: () => (this.flags.caveOpen && !this.flags.crystalTaken && this.pos.z > 91 ? "Взять кристалл памяти [E]" : null),
      action: () => {
        this.flags.crystalTaken = true;
        this.give("crystal");
        W.crystalMesh.visible = false;
        W.crystalLight.intensity = 0;
        this.paranoia = clamp(this.paranoia - 12, 0, 100);
        this.audio.success();
        this.journalPush(this.day, "Кристалл", "Вакуумная лампа, внутри — зеленоватый кристалл. С ним тише. Голова почти моя.");
        this.toast("Кристалл памяти гасит шёпот.", "[звон стекла]");
      },
    });
    // череп предыдущего смотрителя
    this.reg({
      id: "skull", pos: this.V(42.2, 0, 103), radius: 1.6,
      prompt: () => (this.flags.caveOpen && this.pos.z > 91 ? "Останки смотрителя [E]" : null),
      action: () => {
        if (this.wellCooldown > 0) return;
        this.wellCooldown = 5;
        this.audio.whisper();
        this.toast("В черепе — приёмник. Он настроен на вашу частоту.", "[шёпот]");
      },
    });
    // серверы
    const srvPos: [number, number][] = [[-95, -10], [85, -45]];
    srvPos.forEach(([sx, sz], i) => {
      this.reg({
        id: `bunker${i}`, pos: this.V(sx, 0, sz + 2.2), radius: 2.8,
        prompt: () => {
          if (this.flags.bunkerLooted[i]) return "Сервер пуст — данные считаны";
          if (this.day < 2) return "Терминал молчит — питание придёт завтра";
          return "Считать данные сервера [E — держать]";
        },
        action: () => {
          if (this.flags.bunkerLooted[i] || this.day < 2) return;
          this.flags.bunkerLooted[i] = true;
          this.give(`cassette${i + 1}`);
          this.audio.download();
          this.mapDirty = true;
          this.journalPush(this.day, `Сервер ${i === 0 ? "А" : "Б"}`, `Машина выплюнула кассету ДАННЫЕ-${i + 1}. Лампа сменила цвет — теперь она смотрит зелёным.`);
          this.toast(`Кассета ДАННЫЕ-${i + 1} получена. Несите к передатчику.`);
        },
        hold: 3.0,
      });
    });
    // карта на стене
    this.reg({
      id: "map", pos: this.V(-3.8, F[2], -0.4), radius: 1.9,
      prompt: () => (this.floorLevel === 2 ? "Карта сектора [E]" : null),
      action: () => { this.notebookTab = "map"; this.toggleNotebook(); },
    });
    // подзорная труба
    this.reg({
      id: "scope", pos: this.V(1.6, F[2], -3.3), radius: 1.5,
      prompt: () => (this.floorLevel === 2 ? "Подзорная труба [E]" : null),
      action: () => {
        this.fovPunch = 2.4;
        if (this.day >= 3 && Math.random() < 0.4) {
          this.audio.whisper();
          this.toast("В воде — сотни глаз. Вы отводите трубу.");
          this.paranoia = clamp(this.paranoia + 5, 0, 100);
        } else this.toast("Море пустое. Слишком пустое.");
      },
    });
    // выбор «молчи» у телеграфного ключа
    this.reg({
      id: "molchi", pos: this.V(1.6, F[2], -3.2), radius: 1.7,
      prompt: () =>
        this.floorLevel === 2 && this.flags.molchiPending && !this.flags.molchiChoice
          ? "Голос ждёт решения: передать данные — [E]"
          : null,
      altPrompt: () =>
        this.floorLevel === 2 && this.flags.molchiPending && !this.flags.molchiChoice
          ? "Промолчать сегодня [Q]"
          : null,
      action: () => this.toast("Ключ готов. Наберите код ЛКМ — или промолчите [Q]."),
      altAction: () => {
        this.flags.molchiChoice = "silent";
        this.flags.molchiPending = false;
        this.audio.whisper();
        this.journalPush(this.day, "Молчание", "Я не стал передавать. В динамике — долгий вздох. Не человеческий. Вышка скрипит, как обиженное животное.");
        this.toast("Вы промолчали. Вышка услышала.", "[вздох в динамике]");
        this.emit();
      },
    });
    // приёмник — подсказка
    this.reg({
      id: "receiver", pos: this.V(-1.6, F[2], -3.2), radius: 1.8,
      prompt: () => {
        if (this.floorLevel !== 2) return null;
        if (!this.powerOn()) return "Приёмник обесточен — генератор";
        if (!this.antennaOK()) return "Приёмник молчит — антенна повреждена";
        if (this.pendingDay > 0 && this.rxLocked) return "Z — точка · X — тире · Пробел — слово · ⌫ — стереть";
        if (this.pendingDay > 0) return "Крутите частоту (колесо мыши) — ищите сигнал";
        return "Приёмник — сигналы приходят ночью";
      },
      action: () => { this.audio.uiClick(); },
    });
  }

  private tuneFreq(d: number) {
    if (!this.nearReceiver()) return;
    const nf = clamp(this.freq + d, 500, 1600);
    if (nf !== this.freq) { this.freq = nf; this.audio.dialTick(); }
  }

  private findInteractable(): Interactable | null {
    let best: Interactable | null = null; let bd = 1e9;
    for (const it of this.interactables) {
      const d = this.distTo(it.pos);
      if (d < it.radius && d < bd) { bd = d; best = it; }
    }
    if (best && best.prompt() === null && (best.altPrompt?.() ?? null) === null) return null;
    return best;
  }
  private tryInteract() {
    const it = this.findInteractable();
    if (!it) return;
    if (it.hold) { this.holdTarget = it; this.holdProgress = 0; this.audio.keyClack(); return; }
    it.action();
    this.emit();
  }
  private tryAlt() {
    const it = this.findInteractable();
    if (!it || !it.altAction) return;
    it.altAction();
    this.emit();
  }
  private toggleFlash() {
    if (!this.has("flashlight")) { this.toast("Фонарик остался на верстаке."); return; }
    if (!this.flashOn && this.battery <= 1) { this.toast("Батарея мертва."); return; }
    this.flashOn = !this.flashOn;
    this.audio.keyClack();
    this.emit();
  }

  // ============================================================
  //  МОРЗЕ — ПРИЁМ
  // ============================================================
  private startSignal(day: number) {
    const sig = NIGHT_SIGNALS[day];
    if (!sig) return;
    this.pendingDay = day;
    this.rxDecoded = ""; this.rxCode = ""; this.rxFails = 0; this.rxLastInput = -10;
    const tl = buildMorseTimeline(sig.text);
    this.rxTimeline = tl.events; this.rxTotal = tl.total; this.rxPlayT = 0;
    this.audio.staticBurst();
    this.toast(`Ночной эфир: кто-то передаёт на ${sig.freq} кГц`, "[азбука Морзе]");
  }
  private rxInput(el: "." | "-" | " ") {
    if (!this.nearReceiver() || !this.rxLocked || this.pendingDay === 0) {
      if (this.nearReceiver() && this.pendingDay === 0) this.toast("Тишина. Сигналы приходят после 20:00.");
      return;
    }
    if (el === " ") {
      if (this.rxCode) { this.commitRxLetter(); this.rxDecoded += " "; }
      this.rxLastInput = this.rxPlayT;
      this.audio.dialTick();
      return;
    }
    if (this.rxCode.length >= 6) return;
    this.rxCode += el;
    this.rxLastInput = this.rxPlayT;
    this.audio.keyClack();
  }
  private rxDelete() {
    if (!this.nearReceiver()) return;
    if (this.rxCode) this.rxCode = this.rxCode.slice(0, -1);
    else if (this.rxDecoded) this.rxDecoded = this.rxDecoded.slice(0, -1);
    this.audio.dialTick();
  }
  private commitRxLetter() {
    const ch = decodeCode(this.rxCode);
    this.rxDecoded += ch ?? "?";
    this.rxCode = "";
  }
  private rxAutoCommit() {
    if (!this.rxCode) {
      // пауза после слова — проверяем сообщение целиком
      if (this.rxDecoded && this.pendingDay > 0 && this.rxPlayT - this.rxLastInput > 2.0) this.evaluateRx();
      return;
    }
    this.commitRxLetter();
  }
  private evaluateRx() {
    const sig = NIGHT_SIGNALS[this.pendingDay];
    if (!sig) return;
    if (normalize(this.rxDecoded) === normalize(sig.text)) {
      const d = this.pendingDay;
      this.flags.rx[d] = true;
      this.pendingDay = 0; this.rxDecoded = ""; this.rxCode = "";
      this.audio.success();
      this.journalPush(this.day, `Сигнал · ночь ${d}`, `Расшифровано: «${sig.text}» (частота ${sig.freq} кГц).`);
      this.toast(`Расшифровано: «${sig.text}»`);
      this.eventFlash = 0.5;
      if (d === 3) {
        this.flags.coordsKnown = true; this.mapDirty = true;
        this.journalPush(this.day, "Координаты", "60.5, 30.2 — это обрыв к западу. Ночью, под светом фонаря, земля там мерцает.");
        this.toast("Координаты нанесены на карту. Ищите мерцающую землю — ночью, с фонариком.");
      }
      if (d === 4) {
        this.flags.molchiPending = true;
        this.audio.whisper();
        this.toast("Тот же голос: «НЕ ОТПРАВЛЯЙ ДАННЫЕ СЕГОДНЯ».", "[шёпот]");
      }
      this.emit();
    } else {
      this.rxFails++;
      this.rxDecoded = ""; this.rxCode = "";
      this.audio.fail();
      this.toast(this.rxFails >= 1 ? "Не совпало. Образ сигнала проявился на табло." : "Не совпало. Сигнал повторяется.");
    }
  }

  // ============================================================
  //  МОРЗЕ — ПЕРЕДАЧА
  // ============================================================
  private computeTxTarget() {
    if (this.flags.rx[1] && !this.flags.tx1) { this.txTarget = TRANSMIT_WORDS.echo_tutorial; this.txTargetKey = "tutorial"; return; }
    for (let i = 0; i < 3; i++) {
      if (this.has(`cassette${i + 1}`) && !this.flags.txDone[i]) {
        this.txTarget = TRANSMIT_WORDS[`cassette${i + 1}`];
        this.txTargetKey = `cassette${i + 1}`;
        return;
      }
    }
    this.txTarget = null; this.txTargetKey = "";
  }
  private pushTx(el: "." | "-") {
    if (!this.txTarget) return;
    this.txLastInput = performance.now();
    this.txCode += el;
    this.world.txLampMat.emissive.setHex(0xffa020);
    this.world.txLampMat.emissiveIntensity = 2.4;
  }
  private txCommitLetter() {
    const ch = decodeCode(this.txCode);
    this.txCode = "";
    if (!ch || !this.txTarget) { this.txFails++; this.txDecoded = ""; this.audio.fail(); this.toast("Ключ щёлкнул впустую — код сбился."); return; }
    this.txDecoded += ch;
    if (this.txDecoded.length >= this.txTarget.length) this.evaluateTx();
  }
  private evaluateTx() {
    if (!this.txTarget) return;
    if (normalize(this.txDecoded) === normalize(this.txTarget)) {
      const key = this.txTargetKey;
      this.audio.success();
      this.world.txLampMat.emissive.setHex(0x54ff7a);
      if (key === "tutorial") {
        this.flags.tx1 = true;
        this.journalPush(this.day, "Первый выход", "Ответ «МОРЕ» ушёл в эфир. Кто-то принял. Хочу верить, что люди.");
        this.toast("Передано: «МОРЕ». Эфир принял ответ.");
      } else {
        const i = parseInt(key.replace("cassette", ""), 10) - 1;
        this.flags.txDone[i] = true;
        this.take(`cassette${i + 1}`);
        const n = this.flags.txDone.filter(Boolean).length;
        this.journalPush(this.day, `Передача данных ${n}/3`, `ДАННЫЕ-${i + 1} ушли на частоту, которую я не выбирал. Адресат известен адресату.`);
        this.toast(`Передано: «${this.txTarget}» (${n}/3).`);
        if (this.flags.molchiPending && !this.flags.molchiChoice) {
          this.flags.molchiChoice = "sent";
          this.flags.molchiPending = false;
          this.flags.forestDark = true;
          this.world.treeFoliageMat.color.setHex(0x0b130c);
          this.world.runeMats.forEach((m) => { m.emissiveIntensity = 1.4; });
          this.paranoia = clamp(this.paranoia + 20, 0, 100);
          this.audio.thunder(); this.audio.whisper(); this.eventFlash = 1; this.shake = 1.2;
          this.journalPush(this.day, "Голос не солгал", "Лес почернел за одну минуту. Серверы кровоточат красным светом. Я отправил данные. Простите.");
        }
      }
      this.txFails = 0;
    } else {
      this.txFails++;
      this.audio.fail();
      this.toast("Станция не приняла. Сверьтесь с таблицей Морзе [N].");
    }
    this.txDecoded = ""; this.txCode = "";
    this.emit();
  }

  // ============================================================
  //  ЦЕЛЬ
  // ============================================================
  private objective(): string {
    const f = this.flags;
    if (this.screen === "dead") return "";
    if (!f.flashlightTaken) return "Обживитесь: фонарик на верстаке слева";
    if (this.fuel <= 2) return "Генератор заглохнет! Канистры на полке (1-й этаж) → к генератору";
    if (f.antennaBroken && !f.antennaFixed)
      return f.partsTaken ? "Почините антенну — мачта на крыше [E держать]" : "Антенна сломана — возьмите запчасти с верстака";
    if (this.pendingDay > 0 && !this.rxLocked) return `Поймайте сигнал ${NIGHT_SIGNALS[this.pendingDay].freq} кГц — рубка, колесо мыши`;
    if (this.pendingDay > 0 && this.rxLocked) return "Запишите сигнал: Z — точка, X — тире, Пробел — слово";
    this.computeTxTarget();
    if (this.txTarget) return `Передайте ключом «${this.txTarget}» (таблица Морзе — [N])`;
    if (f.molchiPending && !f.molchiChoice) return "Голос просит молчать... или передать данные — ваш выбор";
    if (f.coordsKnown && !f.dug) return "Раскоп у обрыва: 60.5, 30.2 — ночью, фонарик + лопата";
    if (this.has("key") && !f.caveOpen) return "Ржавый ключ: найдите люк в скале у моря";
    if (f.caveOpen && !f.caveLooted) return "Пещера под обрывом хранит ДАННЫЕ-3";
    const cassHeld = [1, 2, 3].filter((i) => this.has(`cassette${i}`)).length;
    if (cassHeld > 0) return "Вставьте кассету в ритм ключа — передайте данные";
    const left = f.bunkerLooted.filter((x) => !x).length + (f.caveLooted ? 0 : 1);
    if (this.day >= 2 && left > 0) return `Серверы в лесу ждут: данных осталось ${left}/3 (карта — [N])`;
    if (f.filterSpawned && !f.filterRemoved) return "Генератор хрипит — извлеките массу из фильтра [E держать]";
    if (this.day >= 7) return "Продержитесь до рассвета 07:00";
    if (this.fuel < 30) return "Топливо на исходе — канистры на полке у генератора";
    return "Несите вахту. Сигнал придёт после 20:00";
  }

  // ============================================================
  //  СОХРАНЕНИЕ
  // ============================================================
  private saveGame() {
    try {
      const data = {
        day: this.day, hour: this.hour, paranoia: this.paranoia, fuel: this.fuel, battery: this.battery,
        stamina: this.stamina, inventory: this.inventory, flags: this.flags, journal: this.journal,
        pos: [this.pos.x, this.pos.z], firewood: this.firewood, fireLitT: this.fireLitT,
        pendingDay: this.pendingDay,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      this.hasSave = true;
    } catch { /* quota — ignore */ }
  }
  private loadSaveMeta() {
    this.hasSave = !!localStorage.getItem(SAVE_KEY);
    try {
      const s = localStorage.getItem("chastota_settings");
      if (s) this.settings = { ...this.settings, ...JSON.parse(s) };
    } catch { /* ignore */ }
  }
  private loadSave(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      this.day = d.day; this.hour = d.hour; this.paranoia = d.paranoia ?? 0;
      this.fuel = d.fuel; this.battery = d.battery; this.stamina = d.stamina ?? 100;
      this.inventory = d.inventory ?? []; this.flags = { ...this.freshFlags(), ...d.flags };
      this.journal = d.journal ?? []; this.firewood = d.firewood ?? 0; this.fireLitT = d.fireLitT ?? 0;
      this.pos.set(d.pos?.[0] ?? 0, EYE, d.pos?.[1] ?? 9);
      this.pendingDay = d.pendingDay ?? 0;
      if (this.pendingDay > 0) {
        const sig = NIGHT_SIGNALS[this.pendingDay];
        const tl = buildMorseTimeline(sig.text);
        this.rxTimeline = tl.events; this.rxTotal = tl.total;
      }
      this.applyVisualState();
      return true;
    } catch { return false; }
  }
  private applyVisualState() {
    const W = this.world, f = this.flags;
    W.shovelMesh.visible = !f.shovelTaken;
    W.flashlightMesh.visible = !f.flashlightTaken;
    W.partsMesh.visible = !f.partsTaken && (f.antennaBroken || this.day >= 5);
    W.canisters[0].visible = f.canistersTakenToday < 1;
    W.canisters[1].visible = f.canistersTakenToday < 2;
    f.batteriesTaken.forEach((bid) => {
      const i = parseInt(bid.replace("bat", ""), 10);
      if (W.batteryMeshes[i]) W.batteryMeshes[i].visible = false;
    });
    for (let i = 0; i < Math.min(f.firewoodTaken, 6); i++) W.firewoodMeshes[i].visible = false;
    if (f.dug) W.holeMesh.visible = true;
    if (f.caveOpen) { W.hatchMesh.visible = false; W.caveLight.intensity = 5; }
    if (f.caveLooted) { /* cassette invisible anyway */ }
    if (f.crystalTaken) { W.crystalMesh.visible = false; W.crystalLight.intensity = 0; }
    if (f.antennaBroken && !f.antennaFixed) W.mast.rotation.z = 0.5;
    if (f.forestDark) { W.treeFoliageMat.color.setHex(0x0b130c); W.runeMats.forEach((m) => { m.emissiveIntensity = 1.4; }); }
    if (f.filterSpawned && !f.filterRemoved) W.filterMesh.visible = true;
    this.mapDirty = true;
  }

  // ============================================================
  //  ГЛАВНЫЙ ЦИКЛ
  // ============================================================
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.screen === "playing") this.update(dt);
    else if (this.screen === "menu") {
      // медленный облёт вышки за меню
      const t = this.clock.elapsedTime;
      this.camera.position.set(Math.sin(t * 0.06) * 34, 7 + Math.sin(t * 0.11) * 2.5, Math.cos(t * 0.06) * 34);
      this.camera.lookAt(0, 7, 0);
    }
    this.updateWorldVisuals(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number) {
    // ---------- время ----------
    const prevHour = this.hour;
    this.hour += dt * (24 / DAY_SECONDS);
    if (this.hour >= 24) this.hour -= 24;
    if (prevHour < 7 && this.hour >= 7 && prevHour < this.hour) this.newDay();
    else if (prevHour > this.hour && this.hour >= 7) this.newDay(); // wrap через полночь → рассвет

    // ---------- движение ----------
    const sprint = (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) && this.stamina > 2;
    let speed = sprint ? 6.4 : 3.4;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = new THREE.Vector3();
    if (this.keys.has("KeyW")) move.add(fwd);
    if (this.keys.has("KeyS")) move.sub(fwd);
    if (this.keys.has("KeyD")) move.add(right);
    if (this.keys.has("KeyA")) move.sub(right);
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize().multiplyScalar(speed * dt);
    const nx = this.pos.x + move.x, nz = this.pos.z + move.z;
    if (!this.collides(nx, this.pos.z)) this.pos.x = nx;
    if (!this.collides(this.pos.x, nz)) this.pos.z = nz;
    // границы мира
    const r = Math.hypot(this.pos.x, this.pos.z + 20);
    if (r > 148) { const k = 148 / r; this.pos.x = k * this.pos.x; this.pos.z = k * (this.pos.z + 20) - 20; }
    if (this.pos.z > 85.2 && !(this.pos.x > 35.2 && this.pos.x < 44.8)) this.pos.z = 85.2;
    if (this.pos.z > 105.4) this.pos.z = 105.4;
    if (this.pos.z > 90 && !(this.pos.x > 35.5 && this.pos.x < 44.5)) this.pos.z = Math.min(this.pos.z, 85.2);
    // этаж
    const inTower = Math.abs(this.pos.x) < 4.2 && Math.abs(this.pos.z) < 4.2;
    if (!inTower && this.floorLevel !== 0) { this.floorLevel = 0; }

    // выносливость + шаги + покачивание
    if (sprint && moving) this.stamina = clamp(this.stamina - 20 * dt, 0, 100);
    else this.stamina = clamp(this.stamina + 13 * dt, 0, 100);
    if (moving) {
      const f = sprint ? 11.5 : 7.6;
      this.bobT += dt * f;
      this.stepAcc += speed * dt;
      if (this.stepAcc > (sprint ? 3.4 : 2.4)) {
        this.stepAcc = 0;
        this.audio.footstep(this.surface(), sprint);
      }
    } else this.bobT *= 0.9;
    const bobY = Math.sin(this.bobT) * 0.05 * (moving ? 1 : 0);
    const tired = this.stamina < 25 ? (25 - this.stamina) / 25 : 0;
    this.camera.position.set(
      this.pos.x + (Math.random() - 0.5) * this.shake * 0.12,
      this.floorEye() + EYE + bobY + Math.sin(this.bobT * 0.5) * tired * 0.04 + (Math.random() - 0.5) * this.shake * 0.12,
      this.pos.z
    );
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bobT * 0.5) * 0.012 * (moving ? 1 : 0));
    this.shake = Math.max(0, this.shake - dt * 1.4);
    this.fovPunch = Math.max(0, this.fovPunch - dt);
    const targetFov = this.fovPunch > 0 ? 32 : 72;
    this.camera.fov = lerp(this.camera.fov, targetFov, dt * 8);
    this.camera.updateProjectionMatrix();

    // ---------- ресурсы ----------
    this.fuel = clamp(this.fuel - dt * (24 / DAY_SECONDS), 0, 100);
    if (this.flashOn) {
      this.battery = clamp(this.battery - dt * (100 / 165), 0, 100);
      if (this.battery <= 0) { this.flashOn = false; this.toast("Батарея фонарика села."); }
    }
    this.flash.intensity = this.flashOn ? 2400 * (0.55 + 0.45 * (this.battery / 100)) * (this.battery < 15 ? 0.6 + Math.random() * 0.5 : 1) : 0;
    if (this.fireLitT > 0) {
      this.fireLitT -= dt;
      const fl = this.world.fireGlow.children[this.world.fireGlow.children.length - 1];
      if (this.fireLitT <= 0) { fl.visible = false; this.toast("Костёр догорел."); }
    }
    this.wellCooldown = Math.max(0, this.wellCooldown - dt);

    // ---------- паранойя ----------
    const night = this.isNight();
    const inCave = this.pos.z > 90;
    const nearFire = this.fireLitT > 0 && Math.hypot(this.pos.x - 8, this.pos.z - 6) < 7;
    const nearStove = this.floorLevel === 0 && Math.hypot(this.pos.x - 2.9, this.pos.z - (-2.4)) < 3.4;
    const warm = nearFire || nearStove;
    const crystalMod = this.has("crystal") ? 0.6 : 1;
    let dp = 0;
    if (!night) dp -= 2.2;
    else {
      dp += 0.12;
      if (warm) dp -= 2.6;
      else if (inTower && this.powerOn()) dp -= 0.9;
      else if (!this.flashOn) dp += 1.25 * crystalMod;
      else dp += 0.3 * crystalMod;
      if (inCave) dp += 0.5 * crystalMod;
      if (!this.powerOn() && inTower) dp += 0.8 * crystalMod;
      if (this.day >= 7) dp += 0.4 * crystalMod;
    }
    this.paranoia = clamp(this.paranoia + dp * dt, 0, 100);
    if (this.paranoia >= 100) { this.die("Шёпот стал громче мыслей. Вы открыли дверь, которой здесь нет."); return; }

    // ---------- сигналы ----------
    const canReceive = this.powerOn() && this.antennaOK();
    if (this.pendingDay === 0 && (this.hour >= 20 || this.hour < 5)) {
      for (let d = 1; d <= 6; d++) {
        if (!this.flags.rx[d] && this.day >= d && !(d >= 5 && !this.antennaOK())) {
          this.startSignal(d);
          break;
        }
      }
    }
    // воспроизведение морзе
    this.rxLocked = false;
    let staticLvl = 0;
    if (this.pendingDay > 0 && canReceive) {
      const sig = NIGHT_SIGNALS[this.pendingDay];
      const nearRx = this.nearReceiver();
      const dist = Math.abs(this.freq - sig.freq);
      staticLvl = nearRx ? clamp(1 - dist / 220, 0, 1) * 0.55 : 0;
      if (dist <= 9) {
        this.rxLocked = true;
        this.rxPlayT += dt;
        if (this.rxPlayT > this.rxTotal) { this.rxPlayT = 0; this.rxAutoCommit(); }
        for (const ev of this.rxTimeline) {
          if (ev.t > this.rxPlayT - dt && ev.t <= this.rxPlayT) {
            this.audio.morseBeep(ev.dur, false);
            this.lampGlow = 1;
          }
        }
        staticLvl = 0.06;
        // авто-коммит буквы по паузе
        if (this.rxCode && this.rxPlayT - this.rxLastInput > 1.0) this.rxAutoCommit();
        else if (this.rxDecoded && this.rxPlayT - this.rxLastInput > 3.2) this.evaluateRx();
      }
    }
    this.lampGlow = Math.max(0, this.lampGlow - dt * 7);
    this.world.receiverLampMat.emissiveIntensity = 0.25 + this.lampGlow * 2.6;
    this.audio.setStatic(staticLvl + (this.pendingDay > 0 && !this.rxLocked && this.nearReceiver() && canReceive ? 0.25 : 0));

    // ---------- передача ----------
    this.computeTxTarget();
    if (this.txCode && performance.now() - this.txLastInput > 850) this.txCommitLetter();
    const leverTarget = this.txPressing ? -0.2 : 0;
    this.world.keyLever.rotation.z = lerp(this.world.keyLever.rotation.z, leverTarget, dt * 18);
    this.world.txLampMat.emissiveIntensity = lerp(this.world.txLampMat.emissiveIntensity, 0.35, dt * 3);

    // ---------- события по времени ----------
    this.storyEvents();

    // ---------- удержание E ----------
    const it = this.findInteractable();
    this.promptNow = it?.prompt() ?? "";
    this.altNow = it?.altPrompt?.() ?? "";
    if (this.holdTarget) {
      const stillOk = it === this.holdTarget && this.keys.has("KeyE");
      if (stillOk) {
        this.holdProgress += dt / (this.holdTarget.hold ?? 1);
        if (this.holdProgress >= 1) {
          const done = this.holdTarget;
          this.holdTarget = null; this.holdProgress = 0;
          done.action();
          this.emit();
        }
      } else {
        this.holdProgress = Math.max(0, this.holdProgress - dt * 3);
        if (this.holdProgress <= 0) this.holdTarget = null;
      }
    }

    // ---------- аудио-параметры ----------
    const cliffDist = clamp(1 - Math.abs(85 - this.pos.z) / 90, 0, 1);
    let windLvl = (night ? 0.45 : 0.28) + cliffDist * 0.4 + (this.day >= 7 ? 0.35 : 0);
    if (inTower) windLvl *= 0.45;
    this.audio.setWind(windLvl);
    this.audio.setSea(cliffDist * (inCave ? 0.2 : 1));
    this.audio.setGen(this.powerOn() ? (inTower ? 0.9 : 0.35) : 0);
    this.audio.setGenRough(this.fuel < 15 && this.powerOn());
    this.audio.setFire(this.fireLitT > 0 && Math.hypot(this.pos.x - 8, this.pos.z - 6) < 20);
    this.audio.setDrone((this.paranoia / 100) * (night ? 1 : 0.5));
    const sprintF = sprint && moving ? 0.4 : 0;
    this.audio.setHeart(clamp(this.paranoia / 100 * 0.9 + sprintF + (this.day >= 7 ? 0.25 : 0), 0, 1));
    this.audio.setBreath(clamp(tired * 0.9 + (this.paranoia > 65 ? 0.5 : 0), 0, 1));
    this.audio.update(dt);

    // скрипы вышки
    this.creakT -= dt;
    if (this.creakT <= 0) {
      this.creakT = 9 + Math.random() * 14;
      if (inTower) { this.audio.creak(); if (this.settings.subtitles && Math.random() < 0.4) this.toast("", "[скрип дерева]"); }
    }
    if (this.flags.filterSpawned && !this.flags.filterRemoved) {
      this.breatheT -= dt;
      if (this.breatheT <= 0 && this.floorLevel === 1) { this.breatheT = 5.2; this.audio.breathingTower(); }
    }

    // ---------- вспышка/статика ----------
    this.eventFlash = Math.max(0, this.eventFlash - dt * 0.8);

    // ---------- снапшот ----------
    this.snapT -= dt;
    if (this.snapT <= 0) { this.snapT = 0.12; this.emit(); }
  }

  private surface(): Surface {
    if (this.floorLevel > 0) return "wood";
    if (this.pos.z > 90) return "stone";
    if (Math.abs(this.pos.x) < 4.2 && Math.abs(this.pos.z) < 4.2) return "wood";
    return "dirt";
  }
  private collides(x: number, z: number): boolean {
    const yMin = this.floorEye(), yMax = yMin + EYE;
    const R = 0.42;
    for (const c of this.world.colliders) {
      if (c.maxY < yMin + 0.2 || c.minY > yMax) continue;
      if (x + R > c.minX && x - R < c.maxX && z + R > c.minZ && z - R < c.maxZ) {
        // разрешаем дверной проём уровня 1 (юг)
        if (this.floorLevel === 0 && c.minY < 2.3 && x > -0.9 && x < 0.9 && z > 3.6) continue;
        return true;
      }
    }
    return false;
  }

  private newDay() {
    this.day++;
    this.flags.canistersTakenToday = 0;
    this.world.canisters[0].visible = true;
    this.world.canisters[1].visible = true;
    this.audio.alarm();
    this.saveGame();
    // рассветные проверки
    if (this.day === 7) {
      if (this.flags.filterRemoved && this.flags.txDone.every(Boolean)) { this.win(); return; }
      this.journalPush(this.day, "День 7", "Рассвет не наступает, пока вышка не получит своё. Море встало стеной. Оно ждёт.");
      this.toast("День 7. Море не отпускает. Закончите начатое.");
    } else if (this.day === 8) {
      this.die("Катер не пришёл. Вахта продлена бессрочно. Вышка больше не отпускает смотрителей.");
      return;
    } else {
      const logs: Record<number, string> = {
        3: "Странные сигналы по ночам. Кажется, кто-то передаёт координаты...",
        5: "Нашёл ключ в скале. Внутри коридор, уходит глубоко. Слышу гул...",
        6: "Данные почти собраны. Голоса в эфире спорят обо мне. Как будто меня здесь нет.",
      };
      if (logs[this.day]) this.journalPush(this.day, `Журнал смотрителя`, logs[this.day]);
      this.toast(`День ${this.day}, 07:00. Будильник. Канистры снова на полке.`, "[будильник]");
    }
    // «молчал» — вышка злится на рассвете
    if (this.flags.molchiPending && !this.flags.molchiChoice) {
      this.flags.molchiChoice = "silent";
      this.flags.molchiPending = false;
      this.shake = 1.4; this.eventFlash = 0.9;
      this.audio.thunder(); this.audio.creak();
      this.paranoia = clamp(this.paranoia + 10, 0, 100);
      this.journalPush(this.day, "Она услышала молчание", "Вышка тряслась до рассвета. Лампы лопались одна за другой. В окне на миг кто-то стоял. Ростом с вышку.");
      this.toast("Вышка вздрогнула. Молчание — тоже ответ.", "[гром]");
    }
    this.emit();
  }

  private storyEvents() {
    const f = this.flags;
    // день 5: шторм ломает антенну перед рассветом
    if (this.day === 5 && this.hour >= 6.2 && this.hour < 7 && !f.antennaBroken) {
      f.antennaBroken = true;
      this.world.mast.rotation.z = 0.5;
      this.world.partsMesh.visible = !f.partsTaken;
      this.audio.thunder();
      this.shake = 1.6; this.eventFlash = 1;
      this.journalPush(this.day, "Шторм", "Удар в мачту. Антенна висит на одном растяжке. Без неё приёмник нем. Запчасти — на верстаке.");
      this.toast("ШТОРМ. Антенна повреждена — приём невозможен.", "[гром]");
    }
    // ночь 6: фильтр-плоть
    if (this.day === 6 && this.hour >= 22.5 && !f.filterSpawned) {
      f.filterSpawned = true;
      this.world.filterMesh.visible = true;
      this.audio.breathingTower();
      this.journalPush(this.day, "Генератор", "Генератор закашлял. В фильтре — не уголь. Кусок чего-то тёплого пульсирует в такт моему сердцу.");
      this.toast("Генератор хрипит. Загляните в фильтр.", "[дыхание]");
      this.emit();
    }
    // финал: день 7 — буря
    if (this.day >= 7) {
      this.lightningT -= 0.016;
      if (this.lightningT <= 0) {
        this.lightningT = 4 + Math.random() * 6;
        this.audio.thunder();
        this.eventFlash = Math.max(this.eventFlash, 0.7);
        this.shake = Math.max(this.shake, 0.5);
      }
      if (f.filterRemoved && f.txDone.every(Boolean) && this.hour >= 7 && this.hour < 8) this.win();
    }
  }

  private die(reason: string) {
    this.deathReason = reason;
    this.screen = "dead";
    this.audio.staticBurst(); this.audio.heartSpike();
    if (this.locked) document.exitPointerLock();
    localStorage.removeItem(SAVE_KEY);
    this.hasSave = false;
    this.emit();
  }
  private win() {
    this.screen = "won";
    this.audio.success(); this.audio.alarm();
    if (this.locked) document.exitPointerLock();
    localStorage.removeItem(SAVE_KEY);
    this.hasSave = false;
    this.emit();
  }

  // ============================================================
  //  ВИЗУАЛ МИРА (каждый кадр, даже в меню)
  // ============================================================
  private updateWorldVisuals(dt: number) {
    const t = this.clock.elapsedTime;
    const W = this.world;

    // небо / солнце / туман
    let k0 = SKY[0], k1 = SKY[SKY.length - 1];
    for (let i = 0; i < SKY.length - 1; i++) {
      if (this.hour >= SKY[i][0] && this.hour <= SKY[i + 1][0]) { k0 = SKY[i]; k1 = SKY[i + 1]; break; }
    }
    const tt = (this.hour - k0[0]) / Math.max(0.001, k1[0] - k0[0]);
    const fog = this.scene.fog as THREE.FogExp2;
    let density = lerp(k0[2], k1[2], tt);
    const storm = this.day >= 7 && this.screen !== "menu";
    if (storm) density += 0.014;
    fog.density = density;
    const sky = (fog.color as THREE.Color).lerp(new THREE.Color(k0[1]).lerp(new THREE.Color(k1[1]), tt), 0.06);
    (this.scene.background as THREE.Color).copy(sky);
    W.sun.intensity = lerp(k0[3], k1[3], tt) * (storm ? 0.25 : 1);
    W.sun.color.copy(new THREE.Color(k0[4]).lerp(new THREE.Color(k1[4]), tt));
    W.hemi.intensity = lerp(k0[5], k1[5], tt);

    // море
    const arr = this.seaPos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const x = W.seaBase[i], y = W.seaBase[i + 1];
      arr[i + 2] = Math.sin(x * 0.09 + t * 0.9) * Math.cos(y * 0.07 + t * 0.6) * 1.4 + Math.sin(x * 0.23 + t * 1.7) * 0.4;
    }
    this.seaPos.needsUpdate = true;

    // маяк
    const powered = this.powerOn();
    if (powered) W.beamGroup.rotation.y += dt * (this.day >= 7 ? 2.6 : 0.5);
    W.lensMat.emissiveIntensity = powered ? 2.2 + Math.sin(t * 2) * 0.5 : 0.15;
    W.beamLight.intensity = powered ? 2600 : 0;

    // печь мерцает
    W.stoveLight.intensity = 6.5 + Math.sin(t * 13) * 1.2 + Math.random() * 1.5;
    W.stoveGlowMat.emissiveIntensity = 1.4 + Math.sin(t * 11) * 0.4;
    W.edisonLight.intensity = powered ? 8.5 + Math.sin(t * 31) * 0.6 : 0;
    W.genBulbMat.emissiveIntensity = powered ? 1.3 : 0.05;
    W.genLampMat.emissiveIntensity = this.fuel < 15 ? (Math.sin(t * 8) > 0 ? 2.2 : 0.3) : 0.25;

    // костёр
    if (this.fireLitT > 0) {
      W.fireLight.intensity = 22 + Math.sin(t * 17) * 6 + Math.random() * 5;
      const flame = W.fireGlow.children[W.fireGlow.children.length - 1];
      flame.scale.setScalar(0.85 + Math.sin(t * 21) * 0.2);
      flame.visible = true;
    } else {
      W.fireLight.intensity = 0;
      W.fireGlow.children[W.fireGlow.children.length - 1].visible = false;
    }

    // серверы мигают
    W.bunkers.forEach((b, i) => {
      if (this.flags.bunkerLooted[i]) { b.lampMat.emissive.setHex(0x2aff5a); b.lampMat.emissiveIntensity = 0.9; }
      else { b.lampMat.emissive.setHex(this.flags.forestDark ? 0xff1010 : 0xff2018); b.lampMat.emissiveIntensity = 1.0 + Math.sin(t * 3 + i * 2) * 0.9; }
    });
    // руны
    const night = this.hour >= 19 || this.hour < 6;
    W.runeMats.forEach((m, i) => {
      const base = this.flags.forestDark ? 1.4 : night ? 0.8 : 0.2;
      m.emissiveIntensity = base + Math.sin(t * 2 + i * 2.2) * base * 0.4;
    });
    // раскоп мерцает ночью под фонариком
    const nearDig = Math.hypot(this.pos.x + 34, this.pos.z - 78) < 9;
    const digOn = this.flags.coordsKnown && !this.flags.dug && night && this.flashOn && nearDig;
    W.digGlowMat.emissiveIntensity = digOn ? 0.9 + Math.sin(t * 4) * 0.5 : 0;
    // кристалл дышит
    if (!this.flags.crystalTaken && this.flags.caveOpen) {
      W.crystalMat.emissiveIntensity = 1.6 + Math.sin(t * 2.4) * 0.8;
      W.crystalLight.intensity = 6 + Math.sin(t * 2.4) * 2;
      W.crystalMesh.rotation.y += dt * 0.6;
    }
    // фильтр пульсирует
    if (W.filterMesh.visible) {
      const s = 1 + Math.sin(t * 3.4) * 0.18;
      W.filterMesh.scale.setScalar(s);
      (W.filterMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + Math.sin(t * 3.4) * 0.5;
    }

    // canvas-текстуры ~10 Гц
    this.canvasT -= dt;
    if (this.canvasT <= 0) {
      this.canvasT = 0.1;
      this.drawReceiver();
      this.drawSheet();
      this.drawGenDial();
      if (this.mapDirty) {
        drawMap(W.mapTex.ctx, 512, 400, this.mapFlags());
        W.mapTex.tex.needsUpdate = true;
        this.mapDirty = false;
      }
    }
  }

  // ---------- табло приёмника ----------
  private drawReceiver() {
    const { ctx } = this.world.receiverDisplay;
    const w = 512, h = 224;
    ctx.fillStyle = "#0d1208"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#2c3a20"; ctx.lineWidth = 3; ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = "#5a7a4a"; ctx.font = "17px 'PT Mono'";
    ctx.fillText("ПРИЁМНИК Р-311 · СЕКТОР 9", 20, 30);
    ctx.fillStyle = "#8aff9d"; ctx.font = "44px 'PT Mono'";
    ctx.fillText(`${this.freq} кГц`, 20, 82);
    // шкала
    const bx = 20, bw = w - 40;
    ctx.fillStyle = "#1a2412"; ctx.fillRect(bx, 100, bw, 14);
    const nx = bx + ((this.freq - 500) / 1100) * bw;
    ctx.fillStyle = "#8aff9d"; ctx.fillRect(nx - 2, 96, 4, 22);
    // сила
    const sig = this.pendingDay > 0 ? NIGHT_SIGNALS[this.pendingDay] : null;
    const strength = sig && this.powerOn() && this.antennaOK() ? clamp(1 - Math.abs(this.freq - sig.freq) / 45, 0, 1) : 0;
    ctx.fillStyle = "#1a2412"; ctx.fillRect(bx, 128, bw, 10);
    ctx.fillStyle = strength > 0.8 ? "#c8ffb0" : "#5a8a4a";
    ctx.fillRect(bx, 128, bw * strength, 10);
    ctx.fillStyle = "#5a7a4a"; ctx.font = "15px 'PT Mono'";
    if (!this.powerOn()) ctx.fillText("НЕТ ПИТАНИЯ", 20, 165);
    else if (!this.antennaOK()) ctx.fillText("АНТЕННА ПОВРЕЖДЕНА", 20, 165);
    else if (this.rxLocked) {
      ctx.fillStyle = "#c8ffb0";
      ctx.fillText("СИГНАЛ: " + (this.rxDecoded + this.rxCode), 20, 165);
      if (this.rxFails >= 1 && sig) { ctx.fillStyle = "#3f5a34"; ctx.fillText(`образ: ${sig.text}`, 20, 190); }
      else ctx.fillText("Z — точка · X — тире · Пробел — слово", 20, 190);
    } else if (sig) ctx.fillText("ПОМЕХИ... ищите несущую", 20, 165);
    else ctx.fillText("эфир пуст — сигналы после 20:00", 20, 165);
    this.world.receiverDisplay.tex.needsUpdate = true;
  }

  // ---------- лист передачи ----------
  private drawSheet() {
    const { ctx } = this.world.sheet;
    const w = 384, h = 256;
    ctx.fillStyle = "#e6d9b8"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#8a6c3c"; ctx.lineWidth = 3; ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = "#4a3a20"; ctx.font = "15px 'PT Mono'";
    ctx.fillText("ЛИСТ ПЕРЕДАЧИ · Вышка-9", 16, 26);
    if (!this.txTarget) {
      ctx.font = "14px 'PT Mono'";
      ctx.fillStyle = "#6a5a3a";
      ctx.fillText("Нет исходящих. Данные приносят", 16, 60);
      ctx.fillText("кассеты серверов и ночной эфир.", 16, 80);
    } else {
      ctx.fillStyle = "#a03a24"; ctx.font = "34px 'PT Mono'";
      ctx.fillText(`«${this.txTarget}»`, 16, 66);
      // подсказка-код после ошибки или всегда понемногу
      if (this.txFails >= 1) {
        ctx.fillStyle = "#2c4a2c"; ctx.font = "17px 'PT Mono'";
        let x = 16;
        for (const ch of this.txTarget) {
          const code = MORSE_TABLE[ch.toUpperCase()] ?? "";
          ctx.fillText(`${ch}:${code}`, x, 96);
          x += ctx.measureText(`${ch}:${code}`).width + 12;
        }
      }
      // текущий набор
      ctx.fillStyle = "#2c2214"; ctx.font = "22px 'PT Mono'";
      ctx.fillText(`набрано: ${this.txDecoded}${this.txCode ? " [" + this.txCode + "]" : ""}`, 16, 130);
      // метроном-зоны
      ctx.fillStyle = "#6a5a3a"; ctx.font = "13px 'PT Mono'";
      ctx.fillText("ЛКМ: коротко (<0.2с) — точка · длинно — тире", 16, 158);
      ctx.fillStyle = "#2c4a2c"; ctx.fillRect(16, 170, 150, 12);
      ctx.fillStyle = "#a0642a"; ctx.fillRect(166, 170, 200, 12);
      ctx.fillStyle = "#2c2214"; ctx.fillText("точка", 70, 198); ctx.fillText("тире", 250, 198);
      if (this.txPressDur > 0) {
        const px = 16 + clamp(this.txPressDur / 0.5, 0, 1) * 350;
        ctx.fillStyle = "#a03a24"; ctx.fillRect(px - 2, 164, 4, 24);
      }
    }
    this.world.sheet.tex.needsUpdate = true;
  }

  // ---------- панель генератора ----------
  private drawGenDial() {
    const { ctx } = this.world.genDial;
    const w = 256, h = 128;
    ctx.fillStyle = "#151a1e"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#3a444c"; ctx.lineWidth = 2; ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = "#8a9aa4"; ctx.font = "13px 'PT Mono'";
    ctx.fillText("ГЕНЕРАТОР · ДИЗЕЛЬ", 12, 22);
    const pct = this.fuel / 100;
    ctx.fillStyle = "#232a30"; ctx.fillRect(12, 36, w - 24, 16);
    ctx.fillStyle = pct < 0.15 ? "#d92b1c" : pct < 0.4 ? "#f2a33c" : "#8a9a54";
    ctx.fillRect(12, 36, (w - 24) * pct, 16);
    ctx.fillStyle = pct < 0.15 ? "#ff6a5a" : "#c8d0d4";
    ctx.font = "15px 'PT Mono'";
    ctx.fillText(`ТОПЛИВО ${Math.round(this.fuel)}%`, 12, 74);
    ctx.fillStyle = this.powerOn() ? "#8aff9d" : "#ff6a5a";
    ctx.fillText(this.powerOn() ? "В РАБОТЕ" : "ОСТАНОВЛЕН", 12, 98);
    ctx.fillStyle = "#5a6a74"; ctx.font = "11px 'PT Mono'";
    ctx.fillText("заправка: канистра → [E]", 12, 116);
    this.world.genDial.tex.needsUpdate = true;
  }
}

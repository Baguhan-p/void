import { useEffect, useRef, useState } from "react";
import { Game } from "./game/engine";
import type { Snapshot } from "./game/engine";
import { MORSE_TABLE, MORSE_LETTERS_ORDER } from "./game/morse";
import { drawMap } from "./game/world";

const INITIAL: Snapshot = {
  screen: "menu", day: 1, timeLabel: "07:00", isNight: false,
  prompt: "", altPrompt: "", holdProgress: null, objective: "",
  paranoia: 0, battery: 100, flashOn: false, held: [], firewood: 0,
  notebookOpen: false, notebookTab: "journal", journal: [], toasts: [],
  hasSave: false, lockless: false, settings: { volume: 0.8, sens: 1.0, subtitles: true },
  eventFlash: 0,
  mapFlags: { coordsKnown: false, caveOpen: false, serversLooted: [false, false], dug: false },
  stats: { decoded: 0, transmitted: 0, cassettes: 0 },
  deathReason: "",
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [snap, setSnap] = useState<Snapshot>(INITIAL);

  useEffect(() => {
    if (!canvasRef.current) return;
    const g = new Game(canvasRef.current, setSnap);
    gameRef.current = g;
    return () => { g.dispose(); gameRef.current = null; };
  }, []);

  const g = () => gameRef.current;

  return (
    <div className="fixed inset-0 overflow-hidden select-none bg-[#05070a] text-[#e6d9b8]">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* атмосферные слои */}
      {(snap.screen === "playing" || snap.screen === "paused") && (
        <>
          <div className="vignette" style={{ ["--vig-base" as string]: 0.25 + (snap.paranoia / 100) * 0.7 }} />
          <div className="static-noise" style={{ opacity: Math.min(0.5, snap.eventFlash * 0.45 + snap.paranoia / 320), mixBlendMode: "screen" }} />
          {snap.paranoia > 65 && (
            <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: `inset 0 0 ${60 + snap.paranoia}px rgba(160,20,12,${(snap.paranoia - 65) / 90})` }} />
          )}
        </>
      )}

      {snap.screen === "playing" && !snap.notebookOpen && <Hud snap={snap} />}
      {snap.notebookOpen && snap.screen === "playing" && <Notebook snap={snap} g={g} />}
      {snap.screen === "menu" && <StartScreen snap={snap} g={g} />}
      {snap.screen === "paused" && <PauseScreen snap={snap} g={g} />}
      {snap.screen === "dead" && <EndScreen snap={snap} g={g} kind="dead" />}
      {snap.screen === "won" && <EndScreen snap={snap} g={g} kind="won" />}
    </div>
  );
}

type G = () => Game | null;

/* ================= HUD ================= */
function Hud({ snap }: { snap: Snapshot }) {
  const danger = snap.paranoia > 82;
  return (
    <div className="absolute inset-0 pointer-events-none font-[family-name:var(--font-mono)]">
      {/* прицел */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div
          className="rounded-full border transition-all duration-150"
          style={{
            width: snap.prompt ? 26 : 5, height: snap.prompt ? 26 : 5,
            borderColor: snap.prompt ? "rgba(242,163,60,0.9)" : "transparent",
            background: snap.prompt ? "transparent" : "rgba(230,217,184,0.85)",
            boxShadow: snap.prompt ? "0 0 12px rgba(242,163,60,0.5)" : "none",
          }}
        />
      </div>

      {/* часы */}
      <div className="absolute top-4 left-4 border border-[#e6d9b8]/25 bg-[#0c1013]/80 px-4 py-2.5">
        <div className="text-[11px] tracking-[0.25em] text-[#e6d9b8]/50">ВЫШКА-9 · СЕКТОР 9</div>
        <div className="flex items-baseline gap-3">
          <span className="font-[family-name:var(--font-disp)] text-2xl text-[#ffcf7d]">ДЕНЬ {snap.day}</span>
          <span className="text-xl text-[#e6d9b8]">{snap.timeLabel}</span>
          <span className={`text-[11px] tracking-widest ${snap.isNight ? "text-[#7fa3b8]" : "text-[#f2a33c]"}`}>
            {snap.isNight ? "● НОЧЬ" : "○ ДЕНЬ"}
          </span>
        </div>
      </div>

      {/* задача */}
      {snap.objective && (
        <div className="absolute top-4 right-4 max-w-sm text-right">
          <div className="text-[11px] tracking-[0.25em] text-[#a03a24]">ЗАДАЧА</div>
          <div className="mt-1 border border-[#a03a24]/40 bg-[#120b08]/85 px-4 py-2.5 text-[13px] leading-snug text-[#e6d9b8]">
            {snap.objective}
          </div>
        </div>
      )}

      {/* предупреждение */}
      {danger && (
        <div className="absolute left-1/2 top-[22%] -translate-x-1/2 text-center">
          <div className="death-glow font-[family-name:var(--font-disp)] text-3xl tracking-[0.3em] text-[#d92b1c]">
            ОН СЛЫШИТ ТЕБЯ
          </div>
          <div className="mt-1 text-[12px] text-[#ff8a7d]/80">найдите тепло: печь, костёр, свет генератора</div>
        </div>
      )}

      {/* подсказка действия */}
      {snap.prompt && (
        <div className="absolute bottom-[18%] left-1/2 -translate-x-1/2 text-center">
          <div className="border border-[#f2a33c]/50 bg-[#0c1013]/90 px-5 py-2 text-[14px] text-[#ffcf7d]">
            {snap.prompt}
          </div>
          {snap.holdProgress !== null && (
            <div className="hold-bar mt-2 mx-auto w-56">
              <div style={{ width: `${Math.round(snap.holdProgress * 100)}%` }} />
            </div>
          )}
          {snap.altPrompt && <div className="mt-1.5 text-[12px] text-[#7fa3b8]">{snap.altPrompt}</div>}
        </div>
      )}

      {/* тосты */}
      <div className="absolute bottom-[31%] left-1/2 flex w-full max-w-xl -translate-x-1/2 flex-col items-center gap-1.5 px-4">
        {snap.toasts.map((t) => (
          <div key={t.id} className="toast-in border border-[#e6d9b8]/20 bg-[#0c1013]/92 px-4 py-1.5 text-center text-[13px]">
            {t.text && <span className="text-[#e6d9b8]">{t.text}</span>}
            {t.tag && <span className={`ml-2 text-[11px] text-[#7fa3b8] ${t.text ? "" : "italic"}`}>{t.tag}</span>}
          </div>
        ))}
      </div>

      {/* снаряжение */}
      <div className="absolute bottom-4 right-4 text-right text-[12px] leading-relaxed text-[#e6d9b8]/75">
        {snap.held.map((h) => (
          <div key={h} className={h.includes("вкл") ? "text-[#ffcf7d]" : ""}>▸ {h}</div>
        ))}
        {snap.firewood > 0 && <div>▸ Поленья ×{snap.firewood}</div>}
        <div className="mt-1 flex items-center justify-end gap-2">
          {snap.held.some((h) => h.startsWith("Фонарик")) && (
            <>
              <span className="text-[10px] tracking-widest text-[#e6d9b8]/50">БАТАРЕЯ</span>
              <span className="inline-block h-2 w-16 border border-[#e6d9b8]/30">
                <span
                  className="block h-full"
                  style={{ width: `${snap.battery}%`, background: snap.battery < 20 ? "#d92b1c" : "#f2a33c" }}
                />
              </span>
            </>
          )}
        </div>
        <div className="mt-1 text-[10px] tracking-widest text-[#e6d9b8]/35">
          {snap.lockless
            ? <span className="text-[#f2a33c]/70">ОБЗОР — ЗАЖАТЬ ПРАВУЮ КНОПКУ МЫШИ · [ESC] ПАУЗА</span>
            : "[N] БЛОКНОТ · [F] ФОНАРЬ · [ESC] ПАУЗА"}
        </div>
      </div>
    </div>
  );
}

/* ================= БЛОКНОТ ================= */
function Notebook({ snap, g }: { snap: Snapshot; g: G }) {
  const mapRef = useRef<HTMLCanvasElement>(null);
  const tab = snap.notebookTab;

  useEffect(() => {
    if (tab !== "map" || !mapRef.current) return;
    const ctx = mapRef.current.getContext("2d");
    if (ctx) drawMap(ctx, 512, 400, snap.mapFlags);
  }, [tab, snap.mapFlags, snap.notebookOpen]);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4">
      <div className="paper-sheet relative w-full max-w-3xl px-8 py-6" style={{ maxHeight: "88vh" }}>
        <div className="flex items-baseline justify-between border-b-2 border-[#8a6c3c]/50 pb-3">
          <div className="font-[family-name:var(--font-disp)] text-xl tracking-wider text-[#3a2a12]">БЛОКНОТ СМОТРИТЕЛЯ</div>
          <button className="btn !py-1.5 !px-3 !text-[11px] !text-[#3a2a12] !border-[#8a6c3c]/60 hover:!bg-[#3a2a12] hover:!text-[#e6d9b8]" onClick={() => g()?.closeNotebook()}>
            закрыть [N]
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          {([["journal", "ЖУРНАЛ"], ["morse", "МОРЗЕ"], ["map", "КАРТА"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => g()?.setNotebookTab(id)}
              className={`px-4 py-1.5 text-[12px] tracking-[0.2em] border transition-colors ${
                tab === id
                  ? "border-[#a03a24] bg-[#a03a24] text-[#efe3c2]"
                  : "border-[#8a6c3c]/50 text-[#4a3a20] hover:bg-[#8a6c3c]/20"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 overflow-y-auto pr-2" style={{ maxHeight: "62vh" }}>
          {tab === "journal" && (
            <div className="space-y-5">
              {snap.journal.length === 0 && (
                <p className="font-[family-name:var(--font-hand)] text-2xl text-[#4a3a20]">Пока пусто. Эфир подскажет.</p>
              )}
              {[...snap.journal].reverse().map((e, i) => (
                <div key={i} className="border-l-4 border-[#a03a24]/60 pl-4">
                  <div className="flex items-baseline gap-3">
                    <span className="border border-[#8a6c3c]/60 px-1.5 text-[11px] text-[#6b5327]">ДЕНЬ {e.day}</span>
                    <span className="font-[family-name:var(--font-disp)] text-[13px] tracking-wider text-[#3a2a12]">{e.title}</span>
                  </div>
                  <p className="mt-1 font-[family-name:var(--font-hand)] text-[22px] leading-tight text-[#2c2214]">{e.text}</p>
                </div>
              ))}
            </div>
          )}

          {tab === "morse" && (
            <div>
              <p className="text-[12px] text-[#6b5327]">Кликните по символу — приёмник проиграет код. Точка — короткая, тире — длинная.</p>
              <div className="mt-3 grid grid-cols-3 gap-x-6 gap-y-1 sm:grid-cols-4 md:grid-cols-5">
                {MORSE_LETTERS_ORDER.map((ch) => (
                  <button
                    key={ch}
                    className="morse-row flex items-baseline justify-between border-b border-[#8a6c3c]/30 px-2 py-1 text-left"
                    onClick={() => g()?.playMorseLetter(ch)}
                  >
                    <span className="font-[family-name:var(--font-disp)] text-base text-[#3a2a12]">{ch}</span>
                    <span className="text-[14px] tracking-[0.18em] text-[#a03a24]">{MORSE_TABLE[ch]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "map" && (
            <div className="text-center">
              <canvas ref={mapRef} width={512} height={400} className="mx-auto w-full max-w-xl border border-[#8a6c3c]/60" />
              <p className="mt-2 text-[12px] text-[#6b5327]">Кресты — серверы. Вопросы не задавайте. Карта знает больше вас.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================= ОБЩИЕ БЛОКИ ================= */
function ControlsGrid() {
  const rows: [string, string][] = [
    ["W A S D", "движение"],
    ["МЫШЬ", "обзор"],
    ["ЛКМ (удерж.)", "телеграфный ключ: коротко — точка, длинно — тире"],
    ["E", "взаимодействие / держать — долгое действие"],
    ["Z / X", "запись сигнала: точка / тире (у приёмника)"],
    ["ПРОБЕЛ / ⌫", "раздел слов / стереть (у приёмника)"],
    ["КОЛЕСО / ← →", "настройка частоты приёмника"],
    ["N", "блокнот: журнал, таблица Морзе, карта"],
    ["F", "фонарик (садится батарея)"],
    ["SHIFT", "бег (тратит дыхание)"],
    ["ESC", "пауза"],
  ];
  return (
    <div className="grid gap-x-6 gap-y-1.5 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-3 border-b border-[#e6d9b8]/8 pb-1.5">
          <span className="kbd shrink-0">{k}</span>
          <span className="text-[#e6d9b8]/70">{v}</span>
        </div>
      ))}
    </div>
  );
}

function EtherCard() {
  const rows: [string, string, boolean][] = [
    ["617 кГц", "НОЧНОЙ ЭФИР", true],
    ["743 кГц", "НЕ ОТВЕЧАЕТ", false],
    ["891 кГц", "НЕ ОТВЕЧАЕТ", false],
    ["1337 кГц", "ЗАПРЕЩЕНО", false],
  ];
  return (
    <div className="relative border border-[#e6d9b8]/15 bg-[#0c1013]/80 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] tracking-[0.3em] text-[#e6d9b8]/50">ЭФИРНАЯ КАРТОЧКА</span>
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#d92b1c]" />
      </div>
      <div className="mt-4 space-y-2 text-[12px]">
        {rows.map(([f, s, hot]) => (
          <div key={f} className="flex justify-between border-b border-[#e6d9b8]/8 pb-1.5">
            <span className={hot ? "text-[#ffcf7d]" : "text-[#e6d9b8]/60"}>{f}</span>
            <span className={hot ? "text-[#d92b1c] flicker" : "text-[#e6d9b8]/40"}>{s}</span>
          </div>
        ))}
      </div>
      {/* циферблат */}
      <div className="relative mx-auto mt-6 h-36 w-36 rounded-full border-2 border-[#e6d9b8]/20">
        <div className="absolute inset-3 rounded-full border border-[#e6d9b8]/10" />
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="absolute left-1/2 top-1/2 h-1/2 w-px origin-bottom bg-[#e6d9b8]/15" style={{ transform: `rotate(${i * 30}deg) translateY(-50%)` }} />
        ))}
        <div className="absolute left-1/2 top-1/2 h-14 w-0.5 origin-bottom animate-[dialspin_9s_linear_infinite] bg-[#f2a33c]" style={{ marginLeft: -1 }} />
        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f2a33c]" />
      </div>
      <div className="mt-4 text-center text-[11px] tracking-[0.25em] text-[#7fa3b8]/70">
        <span className="cursor-blink">·−·· ··· ·−·</span> кто-то передаёт
      </div>
    </div>
  );
}

/* ================= ЭКРАНЫ ================= */
function StartScreen({ snap, g }: { snap: Snapshot; g: G }) {
  return (
    <div className="scanlines absolute inset-0 overflow-y-auto bg-[#05070a]/94">
      <div className="static-noise opacity-[0.05]" />
      <div className="relative mx-auto flex min-h-full max-w-6xl flex-col justify-center gap-10 px-6 py-10 lg:flex-row lg:items-center lg:gap-16">
        <div className="max-w-2xl">
          <div className="flex items-center gap-3 text-[11px] tracking-[0.35em] text-[#f2a33c]/80">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#f2a33c]" />
            ОБЪЕКТ 9 · МИНРАДИОПРОМ · ДОПУСК ПОДТВЕРЖДЁН
          </div>
          <h1 className="mt-5 font-[family-name:var(--font-disp)] leading-[0.95]">
            <span className="block text-5xl text-[#e6d9b8] sm:text-7xl">ЧАСТОТА</span>
            <span className="flicker block text-5xl text-[#f2a33c] sm:text-7xl" style={{ textShadow: "0 0 40px rgba(242,163,60,0.35)" }}>
              ЗАБВЕНИЯ
            </span>
          </h1>
          <p className="mt-4 text-[13px] tracking-[0.2em] text-[#7fa3b8]">
            ВАХТА СМОТРИТЕЛЯ · СЕКТОР 60.5 — 30.2 · ЗИМА 1986
          </p>
          <p className="mt-6 max-w-xl text-[14px] leading-relaxed text-[#e6d9b8]/75">
            Прежний смотритель не вернулся. Вышка стоит на обрыве, лес вокруг неё слишком тихий,
            а по ночам кто-то выходит в эфир на частотах, которых нет в реестре.
            Держите генератор заправленным, ловите ночные сигналы, отвечайте азбукой Морзе —
            и продержитесь <span className="text-[#ffcf7d]">семь дней</span>. Что бы ни отвечал вам эфир.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary text-[15px]" onClick={() => g()?.startNew()}>
              ▶ Начать вахту
            </button>
            {snap.hasSave && (
              <button className="btn" onClick={() => g()?.continueGame()}>
                Продолжить вахту
              </button>
            )}
          </div>
          <div className="mt-3 text-[11px] tracking-widest text-[#7fa3b8]/60">
            НАДЕНЬТЕ НАУШНИКИ — ВЕСЬ ЗВУК ПРОЦЕДУРНЫЙ И ЖИВЁТ В ЭФИРЕ
          </div>
          <div className="mt-8 max-w-xl">
            <div className="mb-2 text-[11px] tracking-[0.3em] text-[#a03a24]">ПАМЯТКА ПО ЭКСПЛУАТАЦИИ</div>
            <ControlsGrid />
          </div>
        </div>
        <div className="hidden w-72 shrink-0 lg:block">
          <EtherCard />
        </div>
      </div>
    </div>
  );
}

function PauseScreen({ snap, g }: { snap: Snapshot; g: G }) {
  return (
    <div className="scanlines absolute inset-0 flex items-center justify-center bg-[#05070a]/88 p-4">
      <div className="static-noise opacity-[0.04]" />
      <div className="relative w-full max-w-lg border border-[#e6d9b8]/20 bg-[#0c1013]/95 p-8">
        <div className="text-[11px] tracking-[0.35em] text-[#7fa3b8]">ДЕНЬ {snap.day} · {snap.timeLabel}</div>
        <h2 className="mt-2 font-[family-name:var(--font-disp)] text-3xl text-[#e6d9b8]">ВАХТА ПРИОСТАНОВЛЕНА</h2>
        <p className="mt-1 text-[12px] text-[#e6d9b8]/50">Вышка скрипит и ждёт. Эфир без вас не молчит.</p>

        <div className="mt-6 space-y-4">
          <label className="block">
            <div className="mb-1 flex justify-between text-[11px] tracking-[0.25em] text-[#e6d9b8]/60">
              <span>ГРОМКОСТЬ ЭФИРА</span><span>{Math.round(snap.settings.volume * 100)}%</span>
            </div>
            <input type="range" min={0} max={100} value={snap.settings.volume * 100}
              onChange={(e) => g()?.setSettings({ volume: Number(e.target.value) / 100 })} />
          </label>
          <label className="block">
            <div className="mb-1 flex justify-between text-[11px] tracking-[0.25em] text-[#e6d9b8]/60">
              <span>ЧУВСТВИТЕЛЬНОСТЬ МЫШИ</span><span>{snap.settings.sens.toFixed(1)}×</span>
            </div>
            <input type="range" min={30} max={200} value={snap.settings.sens * 100}
              onChange={(e) => g()?.setSettings({ sens: Number(e.target.value) / 100 })} />
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-[13px] text-[#e6d9b8]/80">
            <input type="checkbox" checked={snap.settings.subtitles} className="accent-[#f2a33c]"
              onChange={(e) => g()?.setSettings({ subtitles: e.target.checked })} />
            Субтитры звуковых событий
          </label>
        </div>

        <div className="mt-7 flex flex-wrap gap-3">
          <button className="btn btn-primary" onClick={() => g()?.resume()}>Продолжить</button>
          <button className="btn" onClick={() => g()?.quitToMenu()}>В меню</button>
          <button className="btn btn-danger" onClick={() => g()?.restart()}>Начать заново</button>
        </div>
        <div className="mt-6">
          <div className="mb-2 text-[11px] tracking-[0.3em] text-[#a03a24]">ПАМЯТКА</div>
          <ControlsGrid />
        </div>
      </div>
    </div>
  );
}

function EndScreen({ snap, g, kind }: { snap: Snapshot; g: G; kind: "dead" | "won" }) {
  const dead = kind === "dead";
  return (
    <div className={`scanlines absolute inset-0 flex items-center justify-center p-6 ${dead ? "bg-[#070303]/95" : "bg-[#0a0805]/95"}`}>
      <div className="static-noise" style={{ opacity: dead ? 0.14 : 0.04 }} />
      {!dead && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
          style={{ background: "linear-gradient(to top, rgba(242,163,60,0.22), rgba(217,120,40,0.06) 55%, transparent)" }} />
      )}
      <div className="relative w-full max-w-2xl text-center">
        <div className={`text-[11px] tracking-[0.4em] ${dead ? "text-[#7fa3b8]" : "text-[#f2a33c]"}`}>
          {dead ? `ДЕНЬ ${snap.day} · СВЯЗЬ ПРЕРВАНА` : "ДЕНЬ 7 · 07:00 · ВОСТОК"}
        </div>
        <h2 className={`mt-4 font-[family-name:var(--font-disp)] leading-none ${dead ? "death-glow text-6xl text-[#d92b1c] sm:text-7xl" : "dawn-rise text-6xl text-[#ffcf7d] sm:text-8xl"}`}
          style={!dead ? { textShadow: "0 0 60px rgba(242,163,60,0.5)" } : undefined}>
          {dead ? "СИГНАЛ ПОГЛОТИЛ ТЕБЯ" : "РАССВЕТ"}
        </h2>
        <p className={`mx-auto mt-6 max-w-xl text-[14px] leading-relaxed ${dead ? "text-[#e6d9b8]/60" : "text-[#e6d9b8]/80"}`}>
          {dead
            ? snap.deathReason || "Паранойя съела смотрителя."
            : "Катер режет серую воду — первый звук за неделю, которому можно верить. Все три кассеты ушли в эфир, вышка дышит ровно, как сытая. Вы не оборачиваетесь на неё. Вы знаете: она смотрит вам вслед и считает дни до следующей вахты."}
        </p>
        <div className="mx-auto mt-8 grid max-w-md grid-cols-3 gap-3 text-center">
          {([
            ["ДНЕЙ", String(snap.day)],
            ["СИГНАЛОВ", String(snap.stats.decoded)],
            ["ПЕРЕДАЧ", String(snap.stats.transmitted)],
          ] as const).map(([k, v]) => (
            <div key={k} className="border border-[#e6d9b8]/15 bg-[#0c1013]/70 px-3 py-3">
              <div className="font-[family-name:var(--font-disp)] text-3xl text-[#ffcf7d]">{v}</div>
              <div className="mt-1 text-[10px] tracking-[0.3em] text-[#e6d9b8]/50">{k}</div>
            </div>
          ))}
        </div>
        <div className="mt-9 flex justify-center gap-3">
          <button className={`btn ${dead ? "btn-danger" : "btn-primary"}`} onClick={() => g()?.restart()}>
            {dead ? "Заступить снова" : "Новая вахта"}
          </button>
          <button className="btn" onClick={() => g()?.quitToMenu()}>В меню</button>
        </div>
      </div>
    </div>
  );
}

// Pomodoro: o relógio roda no navegador (sobrevive a recarregar a página); cada bloco de foco
// vira uma linha na nota mensal do vault, de onde saem as estatísticas.
import { $, state, api, toast, esc, pad, dayKey, hm, fmtDur, shortDate, WDS, areaColor, candidates, pref } from "./core.js";

const KEY = "pomo";
const LABEL = { foco: "Foco", curta: "Pausa curta", longa: "Pausa longa" };
const fc = () => state.cfg?.foco || { minutos: 25, pausa_curta: 5, pausa_longa: 15, ciclos: 4, meta_diaria: 8, auto_pausa: true, auto_foco: false, som: true, aviso: true };
const durMin = (phase) => Math.max(1, Number({ foco: fc().minutos, curta: fc().pausa_curta, longa: fc().pausa_longa }[phase]) || 1);
const stamp = (d) => `${dayKey(d)}T${hm(d)}`;

let p = load();
let lastTitle = "";
let audio = null;

function load() {
  const s = pref(KEY);
  return s && s.phase ? { pending: [], ...s } : { phase: "foco", status: "idle", cycle: 0, task: "", area: "", pending: [] };
}
function persist() { pref(KEY, p); }

const planMs = () => (p.plan || durMin(p.phase)) * 60000;
function leftMs() {
  if (p.status === "run") return Math.max(0, p.endsAt - Date.now());
  if (p.status === "pause") return p.left;
  return durMin(p.phase) * 60000;
}
const elapsedMin = () => Math.floor((planMs() - leftMs()) / 60000);

/* ---------- transições ---------- */
function start() {
  unlockAudio();
  if (fc().aviso && "Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  if (p.status === "pause") { p.endsAt = Date.now() + p.left; p.status = "run"; persist(); return; }
  p.plan = durMin(p.phase);
  p.endsAt = Date.now() + p.plan * 60000;
  p.startedAt = stamp(new Date());
  p.status = "run";
  persist();
}
function pause() { p.left = Math.max(0, p.endsAt - Date.now()); p.status = "pause"; persist(); }
function toIdle(phase) { p.phase = phase; p.status = "idle"; p.plan = null; p.endsAt = null; p.left = null; p.startedAt = null; }

function stop() {
  if (p.phase === "foco") {
    const m = elapsedMin();
    if (m >= 1) record({ min: m, plano: p.plan });
    else toast("Menos de um minuto: não entrou nas estatísticas.");
  }
  toIdle("foco"); persist(); paint();
}
function skip() {
  if (p.phase === "longa") p.cycle = 0;
  toIdle("foco"); persist(); paint();
}

function finish() {
  const overdue = Date.now() - p.endsAt;
  const was = p.phase;
  if (was === "foco") {
    record({ min: p.plan, plano: p.plan });
    p.cycle += 1;
    toIdle(p.cycle >= fc().ciclos ? "longa" : "curta");
    notify(`Foco concluído. Hora da ${LABEL[p.phase].toLowerCase()} (${durMin(p.phase)} min).`);
    if (fc().auto_pausa && overdue < 60000) start();
  } else {
    if (was === "longa") p.cycle = 0;
    toIdle("foco");
    notify("Pausa acabou. Bora para o próximo foco.");
    if (fc().auto_foco && overdue < 60000) start();
  }
  persist(); paint();
}

/* ---------- registro no vault ---------- */
function record({ min, plano }) {
  p.pending.push({ inicio: p.startedAt || stamp(new Date(Date.now() - min * 60000)), min, plano, tarefa: p.task, area: p.area });
  persist();
  flush();
}
let flushing = false;
async function flush() {
  if (flushing || !p.pending.length) return;
  flushing = true;
  try {
    while (p.pending.length) {
      await api("/api/foco/registrar", p.pending[0]);
      p.pending.shift(); persist();
    }
    toast("Bloco anotado no vault.");
    await loadFoco();
  } catch (e) {
    toast(`Não consegui anotar no vault (tento de novo): ${e.message}`);
  } finally { flushing = false; }
}

/* ---------- avisos ---------- */
function unlockAudio() {
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { audio = null; }
}
function beep() {
  if (!fc().som || !audio) return;
  const t0 = audio.currentTime;
  [0, 0.28, 0.56].forEach((dt, i) => {
    const o = audio.createOscillator(); const g = audio.createGain();
    o.frequency.value = i === 2 ? 1046 : 784; o.type = "sine";
    g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.22);
    o.connect(g).connect(audio.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.25);
  });
}
function notify(msg) {
  beep(); toast(msg);
  if (fc().aviso && "Notification" in window && Notification.permission === "granted" && document.hidden) {
    try { new Notification("Hangar · Foco", { body: msg, tag: "hangar-pomo" }); } catch { /* sem aviso */ }
  }
}

/* ---------- relógio ---------- */
const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

function paint() {
  const left = leftMs();
  const active = p.status !== "idle";
  const title = active ? `${p.status === "pause" ? "⏸ " : ""}${mmss(left)} · ${LABEL[p.phase]}` : state.baseTitle || document.title;
  if (title !== lastTitle) { document.title = title; lastTitle = title; }
  if (state.view !== "foco") return;
  $("#pomo-time").textContent = mmss(left);
  $("#pomo-phase").textContent = LABEL[p.phase] + (p.status === "pause" ? " · pausado" : "");
  const frac = active ? 1 - left / planMs() : 0;
  $("#pomo-arc").style.strokeDashoffset = String(Math.round(1000 * (1 - frac)));
  $(".pomo").dataset.phase = p.phase;
  $(".pomo").dataset.status = p.status;
  const n = Math.max(1, fc().ciclos);
  $("#pomo-cycle").innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < p.cycle ? "on" : ""}"></i>`).join("");
  $("#pomo-cycle").setAttribute("aria-label", `${Math.min(p.cycle, n)} de ${n} focos até a pausa longa`);
  const main = $("#pomo-main");
  const lbl = p.status === "run" ? "Pausar" : p.status === "pause" ? "Retomar" : p.phase === "foco" ? "Começar" : "Começar a pausa";
  if (main.dataset.lbl !== lbl) { main.innerHTML = `${lbl} <kbd>Espaço</kbd>`; main.dataset.lbl = lbl; }
  $("#pomo-stop").hidden = !(active && p.phase === "foco");
  $("#pomo-skip").hidden = p.phase === "foco";
  $("#pomo-status").textContent = p.pending.length ? `${p.pending.length} bloco(s) esperando para ir ao vault.` : "";
}

function tick() {
  if (p.status === "run" && Date.now() >= p.endsAt) finish();
  else paint();
}

/* ---------- estatísticas ---------- */
export async function loadFoco() {
  if (!state.cfg?.foco?.ativo) return;
  try { state.foco = await api("/api/foco"); } catch (e) { state.foco = { error: e.message }; }
  if (state.view === "foco") renderFoco();
}

const areaName = (id) => (id ? state.cfg.areas.find((a) => a.id === id)?.nome || id : "Sem área");

function renderStats() {
  const s = state.foco;
  if (!s || s.error) { $("#fbars").innerHTML = `<p class="empty">${esc(s?.error || "Lendo…")}</p>`; return; }
  const meta = fc().meta_diaria;
  $("#fs-hoje").innerHTML = `${s.hoje.blocos}<small>${meta ? ` / ${meta}` : ""}</small>`;
  $("#fs-min").textContent = fmtDur(s.hoje.min);
  $("#fs-semana").textContent = fmtDur(s.semana);
  $("#fs-seq").textContent = `${s.sequencia} ${s.sequencia === 1 ? "dia" : "dias"}`;
  $("#foco-file").textContent = s.arquivo;

  const goal = meta * fc().minutos;
  const max = Math.max(goal, ...s.serie.map((d) => d.min), 30);
  const today = dayKey(new Date());
  $("#fbars").setAttribute("aria-label", `Minutos de foco nos últimos ${s.serie.length} dias; hoje ${s.hoje.min} min.`);
  $("#fbars").style.setProperty("--goal-n", String(goal / max));
  $("#fbars").innerHTML = (goal ? `<span class="fgoal" aria-hidden="true"><span>meta ${fmtDur(goal)}</span></span>` : "") + s.serie.map((d, i) => {
    const dt = new Date(d.date + "T12:00");
    const lab = d.date === today ? "hoje" : i % 7 === 0 ? shortDate(dt) : "";
    return `<div class="fcol${d.date === today ? " is-today" : ""}" data-i="${i}"><span class="fbar" style="--h:${(d.min / max) * 100}%"></span><span class="fx">${lab}</span></div>`;
  }).join("");
  $("#ftable").innerHTML = `<table><thead><tr><th>Dia</th><th>Minutos</th><th>Blocos</th></tr></thead><tbody>${[...s.serie].reverse().filter((d) => d.min).map((d) => {
    const dt = new Date(d.date + "T12:00"); return `<tr><td>${WDS[dt.getDay()]} ${shortDate(dt)}</td><td class="num">${d.min}</td><td class="num">${d.blocos}</td></tr>`;
  }).join("") || `<tr><td colspan="3" class="empty">Nenhum bloco ainda.</td></tr>`}</tbody></table>`;

  const amax = Math.max(1, ...s.areas.map((a) => a.min));
  $("#fareas").innerHTML = s.areas.length ? s.areas.map((a) => `<div class="hb"><span>${esc(areaName(a.area))}</span><span class="hb-track"><span class="hb-fill" style="width:${(a.min / amax) * 100}%;background:${a.area ? areaColor(a.area) : "var(--color-ink-2)"}"></span></span><span class="hb-v num">${fmtDur(a.min)}</span></div>`).join("")
    : `<p class="empty">Os blocos com área aparecem aqui.</p>`;

  $("#c-fhoje").textContent = s.hoje.itens.length || "";
  $("#fhoje").innerHTML = s.hoje.itens.length ? [...s.hoje.itens].reverse().map((e) => `<li class="row${e.done ? "" : " is-cut"}"><div><p class="row-title">${esc(e.text || "Foco sem nome")}</p>
    <p class="row-meta"><span class="num">${esc(e.at)}</span><span class="num">${e.done ? `${e.min} min` : `${e.min} de ${e.plan} min · interrompido`}</span>${e.area ? `<span class="tag" style="color:${areaColor(e.area)}">${esc(e.area)}</span>` : ""}</p></div></li>`).join("")
    : `<li class="empty">Nenhum bloco hoje ainda.</li>`;
}

function renderPicker() {
  const sel = $("#pomo-area");
  const opts = `<option value="">Sem área</option>` + (state.cfg?.areas || []).map((a) => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join("");
  if (sel.dataset.opts !== opts) { sel.innerHTML = opts; sel.dataset.opts = opts; }
  sel.value = p.area || "";
  const input = $("#pomo-task");
  if (document.activeElement !== input) input.value = p.task || "";
  const { now, late } = state.src.ticktick?.data ? candidates() : { now: [], late: [] };
  const soltas = (state.vault?.pendencias || []).filter((x) => !x.done).map((x) => x.text);
  const titles = [...new Set([...now, ...late].map((t) => t.title).concat(soltas))].slice(0, 40);
  $("#pomo-tasks").innerHTML = titles.map((t) => `<option value="${esc(t)}"></option>`).join("");
}

export function renderFoco() {
  renderPicker();
  renderStats();
  paint();
}

export function bindFoco() {
  $("#pomo-main").addEventListener("click", () => { if (p.status === "run") pause(); else start(); paint(); });
  $("#pomo-stop").addEventListener("click", stop);
  $("#pomo-skip").addEventListener("click", skip);
  $("#pomo-task").addEventListener("input", (e) => { p.task = e.target.value; persist(); });
  $("#pomo-area").addEventListener("change", (e) => { p.area = e.target.value; persist(); });
  $("#pomo-what").addEventListener("submit", (e) => { e.preventDefault(); $("#pomo-main").click(); });
  document.addEventListener("keydown", (e) => {
    if (state.view !== "foco" || e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, textarea, select, button, a")) return;
    e.preventDefault(); $("#pomo-main").click();
  });
  // outra aba mexeu no relógio
  window.addEventListener("storage", (e) => { if (e.key === "hangar:" + KEY) { p = load(); paint(); } });
  const tip = $("#tip");
  $("#fbars").addEventListener("pointermove", (e) => {
    const col = e.target.closest(".fcol"); const d = col && state.foco?.serie?.[Number(col.dataset.i)];
    if (!d) { tip.hidden = true; return; }
    const dt = new Date(d.date + "T12:00");
    tip.innerHTML = `<b>${WDS[dt.getDay()]} ${shortDate(dt)}</b><span>${fmtDur(d.min)} de foco</span><span>${d.blocos} ${d.blocos === 1 ? "bloco completo" : "blocos completos"}</span>`;
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.transform = `translate(${x}px, ${e.clientY + 14}px)`;
  });
  $("#fbars").addEventListener("pointerleave", () => { tip.hidden = true; });
  setInterval(tick, 500);
  setInterval(flush, 30000);
  tick(); flush();
}

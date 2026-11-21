// A noite em blocos até o horário de fim dos Ajustes.
import { $, state, api, toast, esc, icon, pad, hm, nowDate, todayKey, parseHM, fmtDur, shortDate, isLate, taskTime, projectInfo, taskById, candidates, tt, gc, eventsOn, eventSpan, eventTime, calInfo } from "./core.js";
import { parts, kind, badge, matTag, rel, ICON_NOTE, ICON_LIST, addDrawerExtra } from "./tarefa.js";

const ICON_PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
// Título com código e selo de prazo; vira botão que abre os detalhes quando é tarefa do TickTick.
function titleHTML(t, fallback, cls) {
  if (!t) return `<p class="${cls}">${esc(fallback)}</p>`;
  const { mat, title } = parts(t);
  return `<button type="button" class="${cls} task-open" data-open-task="${t.id}" aria-haspopup="dialog">${matTag(mat)}${badge(t)}<span>${esc(title)}</span></button>`;
}
const inds = (t) => [t.items ? `<span class="ag-ind num">${ICON_LIST}${t.itemsDone}/${t.items}</span>` : "", t.content ? `<span class="ag-ind" title="Tem notas">${ICON_NOTE}<span class="visually-hidden">tem notas</span></span>` : ""].join("");
/** Compromissos com hora do dia da sessão, em minutos (Google Agenda). */
const timedEvents = () => (gc() ? eventsOn(state.session.date).filter((e) => !e.allDay).map((e) => ({ ...e, ...eventSpan(e, state.session.date) })) : []);

const endMin = () => { const f = state.cfg?.noite?.fim || "23:00"; return /^\d{2}:\d{2}$/.test(f) ? parseHM(f) : 23 * 60; };
const DUR = [10, 15, 25, 30, 45, 60, 90];
const uid = () => Math.random().toString(36).slice(2, 10);
const minToDate = (key, m) => { const [y, mo, d] = key.split("-").map(Number); return new Date(y, mo - 1, d, 0, m); };
let saving = null;

const shortKey = (t) => { const d = new Date(t.due || t.start); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// No painel de detalhes: encaixar a tarefa na noite (com duração) ou tirar dela.
addDrawerExtra({
  html(t) {
    if (!state.session || !state.cfg?.noite?.ativo || t.done) return "";
    const tl = timeline(); const b = tl.blocks.find((x) => x.taskId === t.id);
    const titulo = esc(state.cfg?.noite?.titulo || "A noite");
    if (b) return `<section class="drawer-sec drawer-noite"><h3>${titulo}</h3><p>Encaixada às <b class="num">${hm(minToDate(state.session.date, b.from))}</b>, ${fmtDur(b.min)}. <button type="button" class="btn btn-text btn-sm" data-act="noite-remove">Tirar da noite</button></p></section>`;
    return `<section class="drawer-sec drawer-noite"><h3>${titulo}</h3><div class="drawer-later" role="group" aria-label="Encaixar na noite"><span>Encaixar</span>${[15, 25, 45, 60].map((m) => `<button type="button" class="btn btn-ghost btn-sm" data-act="noite-fit" data-min="${m}">${fmtDur(m)}</button>`).join("")}</div></section>`;
  },
  on: {
    "noite-fit": (t, btn) => { addTask(t, Number(btn.dataset.min)); save(); renderNoite(); toast("Encaixada na noite."); },
    "noite-remove": (t) => { state.session.blocks = state.session.blocks.filter((x) => x.taskId !== t.id); save(); renderNoite(); },
  },
});

export async function loadSession() {
  const key = todayKey();
  let s = {};
  try { s = await api(`/api/session?date=${key}`); } catch { /* sem sessão salva */ }
  state.session = s && s.date === key ? s : { date: key, start: null, blocks: [] };
}
function save() {
  clearTimeout(saving);
  saving = setTimeout(() => api("/api/session", state.session).catch((e) => toast(e.message)), 300);
}
// Dois momentos: planejando (sem start salvo, o início acompanha o relógio) e em andamento
// (start fixo no arquivo da sessão). Só "Começar agora", o campo de horário ou concluir um bloco fixam o início.
const nowM = () => { const n = nowDate(); return n.getHours() * 60 + n.getMinutes(); };
function defaultStart() { return Math.ceil(nowM() / 5) * 5; }
const startMin = () => (state.session.start != null ? state.session.start : defaultStart());
const started = () => state.session.start != null && state.session.start <= nowM();
function pinStart(m = nowM()) { if (state.session.start == null) state.session.start = m; }
function timeline() {
  let cur = startMin();
  const blocks = state.session.blocks.map((b) => { const o = { ...b, from: cur, to: cur + b.min }; cur += b.min; return o; });
  return { blocks, end: cur };
}
function addTask(t, min = 25) {
  if (state.session.blocks.some((b) => b.taskId === t.id)) return;
  state.session.blocks.push({ id: uid(), kind: "task", taskId: t.id, projectId: t.projectId, title: t.title, min });
}
function addHabit(h) {
  if (state.session.blocks.some((b) => b.habitId === h.id)) return;
  state.session.blocks.push({ id: uid(), kind: "habit", habitId: h.id, title: h.name, min: 30 });
}

function suggest() {
  const budget = endMin() - startMin() - 20;
  if (budget <= 0) { toast(`Não sobra tempo antes das ${state.cfg?.noite?.fim || "23:00"}.`); return; }
  const { late, now } = candidates();
  const used = () => state.session.blocks.reduce((a, b) => a + b.min, 0);
  const habits = (tt()?.habits || []).filter((h) => !h.done && h.reminder && parseHM(h.reminder) >= startMin());
  for (const t of [...now, ...late]) {
    if (used() + 25 > budget - habits.length * 30) break;
    addTask(t);
    if (state.session.blocks.filter((b) => b.kind === "task").length % 2 === 0 && used() + 10 < budget) state.session.blocks.push({ id: uid(), kind: "pause", title: "Pausa", min: 10 });
  }
  for (const h of habits) if (used() + 30 <= budget) addHabit(h);
  save(); renderNoite();
  toast("Noite montada. Ajuste a ordem e os tempos à vontade.");
}

// Concluir fecha o bloco no horário real: terminou antes, o resto sobe; passou do tempo, o resto desce.
function closeAtNow(b) {
  b.done = true;
  if (state.session.start == null) { pinStart(); return; }
  const tl = timeline(); const cur = tl.blocks.find((x) => x.id === b.id); const n = nowM();
  if (!cur || n <= cur.from || !started()) return; // feito fora de ordem, antes da vez: não mexe no horário
  const real = Math.max(5, n - cur.from);
  if (Math.abs(real - b.min) >= 3) b.min = real;
}

function move(id, dir) {
  const bs = state.session.blocks; const i = bs.findIndex((b) => b.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= bs.length) return;
  [bs[i], bs[j]] = [bs[j], bs[i]];
  save(); renderNoite();
  document.querySelector(`[data-block="${id}"] [data-act="${dir < 0 ? "up" : "down"}"]`)?.focus();
}

export function renderNoite() {
  if (!state.session) return;
  const now = nowDate(); const nowMin = now.getHours() * 60 + now.getMinutes(); const end = endMin();
  $("#left").textContent = end - nowMin > 0 ? fmtDur(end - nowMin) : "0 min";
  const sm = startMin(); const input = $("#start-at"); const run = started(); const pinned = state.session.start != null;
  if (document.activeElement !== input) input.value = `${pad(Math.floor(sm / 60) % 24)}:${pad(sm % 60)}`;
  const evs = timedEvents();
  $("#start-label").textContent = run ? "Começou às" : "Começa às";
  $("#start-now").hidden = run || !state.session.blocks.length;
  $("#suggest").className = `btn ${state.session.blocks.length ? "btn-ghost" : "btn-primary"}`;
  $("#plan-status").innerHTML = !state.session.blocks.length ? ""
    : run ? `<b>Em andamento.</b> Concluir um bloco fecha no horário real e o resto se ajusta. Precisa de mais tempo? Use <b>+10 min</b> no bloco atual.`
    : pinned ? `<b>Agendada</b> para começar às <span class="num">${hm(minToDate(state.session.date, sm))}</span>. Comece antes, se quiser.`
    : `<b>Planejando.</b> O início acompanha o relógio até você clicar em <b>Começar agora</b>.`;
  const tl = timeline(); const planned = tl.blocks.reduce((a, b) => a + b.min, 0); const slack = end - tl.end;
  $("#planned").textContent = fmtDur(planned);
  $("#slack").textContent = slack >= 0 ? fmtDur(slack) : `passou ${fmtDur(-slack)}`;
  $("#slack").classList.toggle("late", slack < 0);
  const over = nowMin >= end;
  $("#rail-over").hidden = !over;
  $("#rail-empty").hidden = over || tl.blocks.length > 0;
  const isDoneB = (x) => x.done || (x.taskId && taskById(x.taskId)?.done);
  const anyOver = run && tl.blocks.some((x) => !isDoneB(x) && nowMin >= x.to && nowMin - x.to < 180 && !tl.blocks.some((y) => y.from >= x.to && y.from <= nowMin && isDoneB(y)));
  const rows = tl.blocks.map((b) => {
    const t = b.taskId ? taskById(b.taskId) : null; const p = b.projectId ? projectInfo(b.projectId) : null;
    const cls = ["block", `is-${b.kind}`];
    if (b.done || (t && t.done) || (b.kind === "task" && !t && tt())) cls.push("is-done");
    if (nowMin >= b.from && nowMin - b.from < 8) cls.push("is-now-start");
    if (nowMin >= b.from && nowMin < b.to) cls.push("is-current");
    const overrun = run && !b.done && !(t && t.done) && b.kind !== "slack" && nowMin >= b.to && nowMin - b.to < 180
      && !tl.blocks.some((x) => x.from >= b.to && x.from <= nowMin && (x.done || (x.taskId && taskById(x.taskId)?.done))); // ninguém depois dele já foi feito
    if (overrun) cls.push("is-over");
    if (nowMin >= b.to) cls.push("is-past");
    const meta = [];
    if (p) meta.push(`<span style="color:${p.color}">${esc(p.name)}</span>`);
    if (b.kind === "habit") meta.push("<span>Hábito</span>");
    if (overrun) meta.push(`<span class="late">passou ${fmtDur(nowMin - b.to)} do previsto</span>`);
    if (t && isLate(t)) meta.push(`<span class="late">atrasada ${rel(shortKey(t))}</span>`);
    if (t) meta.push(inds(t));
    const clash = b.kind !== "pause" && evs.find((e) => e.from < b.to && b.from < e.to);
    if (clash) meta.push(`<span class="late">Bate com ${esc(hm(new Date(clash.start)))} ${esc(clash.title)}</span>`);
    const opts = [...new Set([...DUR, b.min])].sort((a, c) => a - c).map((m) => `<option value="${m}"${m === b.min ? " selected" : ""}>${fmtDur(m)}</option>`).join("");
    const done = cls.includes("is-done"); const at = hm(minToDate(state.session.date, b.from));
    const check = done ? `<span class="ag-check is-on" aria-hidden="true">${icon.check}</span>`
      : `<button type="button" class="ag-check" data-act="done" aria-label="${b.kind === "pause" ? "Marcar pausa como feita" : b.kind === "habit" ? `Marcar ${esc(b.title)} como feito` : `Concluir ${esc(b.title)} no TickTick`}" title="Concluir">${icon.check}</button>`;
    return `<li class="${cls.join(" ")}${t && kind(t) ? ` is-${kind(t)}` : ""}" data-block="${b.id}" style="--min:${b.min}">
      <time class="block-time num" datetime="${at}">${at}</time>
      ${check}
      <div class="block-body">${titleHTML(t, b.title, "block-title")}${meta.length ? `<p class="row-meta">${meta.join("")}</p>` : ""}</div>
      <div class="tools">
        ${!done && run && (overrun || (cls.includes("is-current") && !anyOver)) ? `<button type="button" class="btn btn-ghost btn-sm" data-act="more" title="Mais 10 minutos neste bloco; o resto desce">+10 min</button>` : ""}
        <select aria-label="Duração de ${esc(b.title)}" data-act="dur">${opts}</select>
        <span class="tools-more">
          <button type="button" class="btn btn-text btn-icon" data-act="up" aria-label="Subir ${esc(b.title)}" title="Subir">${icon.up}</button>
          <button type="button" class="btn btn-text btn-icon" data-act="down" aria-label="Descer ${esc(b.title)}" title="Descer">${icon.down}</button>
          <button type="button" class="btn btn-text btn-icon" data-act="remove" aria-label="Tirar ${esc(b.title)} da noite" title="Tirar da noite">${icon.x}</button>
        </span>
      </div></li>`;
  });
  if (tl.blocks.length && slack > 0) rows.push(`<li class="block is-slack" style="--min:${slack}" aria-label="Folga de ${fmtDur(slack)}"><time class="block-time num">${hm(minToDate(state.session.date, tl.end))}</time><p class="block-title">Folga</p></li>`);
  const rail = $("#rail");
  rail.innerHTML = rows.join("");
  rail.hidden = !tl.blocks.length;
  $(".rail-end").hidden = !tl.blocks.length;
  const line = $("#now-line"); const cur = tl.blocks.find((x) => nowMin >= x.from && nowMin < x.to);
  if (cur && !rail.hidden) {
    const el = document.querySelector(`[data-block="${cur.id}"]`);
    line.style.setProperty("--y", `${Math.round(el.offsetTop + el.offsetHeight * ((nowMin - cur.from) / cur.min))}px`);
    $("#now-label").textContent = hm(nowDate()); line.hidden = false;
  } else line.hidden = true;
  renderQueue();
}

function renderQueue() {
  const q = $("#queue");
  if (!tt()) return;
  const { late, now, next } = candidates();
  const inS = new Set(state.session.blocks.map((b) => b.taskId));
  const group = (title, list, late) => !list.length ? "" : `<h3>${title} <span class="count">${list.length}</span></h3><ul class="rows">${list.map((t) => {
    const p = projectInfo(t.projectId); const tm = taskTime(t); const inn = inS.has(t.id);
    return `<li class="row q-row${inn ? " is-in" : ""}${kind(t) ? ` is-${kind(t)}` : ""}" data-task="${t.id}"><div>${titleHTML(t, t.title, "row-title")}<p class="row-meta"><span style="color:${p.color}">${esc(p.name)}</span>${tm ? `<span class="num">${tm}</span>` : ""}${late ? `<span class="late">${shortDate(new Date(t.due))}</span>` : ""}${inds(t)}</p></div>
      <div class="tools">${inn ? `<span class="q-in">${icon.check} na noite</span>` : `<button type="button" class="btn btn-ghost btn-icon" data-act="fit" aria-label="Encaixar ${esc(t.title)} na noite" title="Encaixar na noite">${ICON_PLUS}</button>`}</div></li>`;
  }).join("")}</ul>`;
  const evs = timedEvents().filter((e) => e.to > startMin() && e.from < endMin());
  const agenda = !evs.length ? "" : `<h3>Compromissos <span class="count">${evs.length}</span></h3><ul class="rows">${evs.map((e) => {
    const c = calInfo(e.cal);
    return `<li class="row is-event" style="--lc:${c.color}"><div><p class="row-title">${esc(e.title)}</p><p class="row-meta"><span class="num">${esc(eventTime(e))}</span><span style="color:${c.color}">${esc(c.name)}</span></p></div></li>`;
  }).join("")}</ul>`;
  q.innerHTML = agenda + group("Vence hoje", now) + group("Ficou para trás", late, true) + group("Amanhã", next) || `<p class="empty">Nada vence hoje nem ficou para trás. Encaixe uma pausa ou um hábito, ou aproveite a folga.</p>`;
  const hs = tt().habits; const inH = new Set(state.session.blocks.map((b) => b.habitId));
  $("#habits").innerHTML = hs === null ? `<li class="empty">Não consegui ler os hábitos agora.</li>`
    : hs.length ? hs.map((h) => `<li class="row q-row h-row${h.done ? " is-done" : ""}" data-habit="${h.id}">${h.done ? `<span class="ag-check is-on" aria-hidden="true">${icon.check}</span>` : `<button type="button" class="ag-check" data-act="check-habit" aria-label="Marcar ${esc(h.name)} como feito" title="Marcar como feito">${icon.check}</button>`}<div><p class="row-title">${esc(h.name)}</p><p class="row-meta">${h.reminder ? `<span class="num">${h.reminder}</span>` : ""}<span>${h.done ? "feito hoje" : "pendente"}</span></p></div>
      <div class="tools">${h.done ? "" : inH.has(h.id) ? `<span class="q-in">${icon.check} na noite</span>` : `<button type="button" class="btn btn-ghost btn-icon" data-act="fit-habit" aria-label="Encaixar ${esc(h.name)} na noite" title="Encaixar na noite">${ICON_PLUS}</button>`}</div></li>`).join("")
      : `<li class="empty">Nenhum hábito ativo no TickTick.</li>`;
}

export function bindNoite({ complete, checkin, postpone }) {
  $("#suggest").addEventListener("click", suggest);
  $("#add-pause").addEventListener("click", () => { state.session.blocks.push({ id: uid(), kind: "pause", title: "Pausa", min: 10 }); save(); renderNoite(); });
  $("#clear").addEventListener("click", () => {
    const prev = state.session.blocks; const prevStart = state.session.start; if (!prev.length) return;
    state.session.blocks = []; state.session.start = null; save(); renderNoite();
    toast("Noite limpa. Ctrl+Z desfaz por 5 segundos.");
    const undo = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "z") { state.session.blocks = prev; state.session.start = prevStart; save(); renderNoite(); toast("Desfeito."); } };
    document.addEventListener("keydown", undo); setTimeout(() => document.removeEventListener("keydown", undo), 5000);
  });
  $("#start-now").addEventListener("click", () => { state.session.start = nowM(); save(); renderNoite(); toast("Começou. O horário ficou fixo; feche os blocos conforme for terminando."); });
  $("#start-at").addEventListener("change", (e) => { if (e.target.value) { state.session.start = parseHM(e.target.value); save(); renderNoite(); } });
  $("#rail").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const id = btn.closest("[data-block]").dataset.block; const b = state.session.blocks.find((x) => x.id === id);
    const act = btn.dataset.act;
    if (act === "up") move(id, -1);
    if (act === "down") move(id, 1);
    if (act === "remove") { state.session.blocks = state.session.blocks.filter((x) => x.id !== id); save(); renderNoite(); }
    if (act === "more") { b.min += 10; save(); renderNoite(); toast("Mais 10 min. O resto da noite desceu junto."); }
    if (act === "done") {
      const ok = b.kind === "pause" ? true : b.kind === "task" ? await complete({ id: b.taskId, projectId: b.projectId }, btn) : await checkin(b.habitId, btn);
      if (ok) { closeAtNow(b); save(); renderNoite(); }
    }
  });
  $("#rail").addEventListener("change", (e) => {
    if (e.target.dataset.act !== "dur") return;
    const b = state.session.blocks.find((x) => x.id === e.target.closest("[data-block]").dataset.block);
    b.min = Number(e.target.value); save(); renderNoite();
  });
  $(".queue").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const tr = btn.closest("[data-task]"); const hr = btn.closest("[data-habit]");
    if (btn.dataset.act === "fit") { addTask(taskById(tr.dataset.task)); save(); renderNoite(); }
    const h = hr && tt().habits.find((x) => x.id === hr.dataset.habit);
    if (btn.dataset.act === "fit-habit") { addHabit(h); save(); renderNoite(); }
    if (btn.dataset.act === "check-habit") checkin(h.id, btn);
  });
}

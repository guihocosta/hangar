// A noite em blocos até o horário de fim dos Ajustes.
import { $, state, api, toast, esc, icon, pad, hm, nowDate, todayKey, parseHM, fmtDur, shortDate, isLate, taskTime, projectInfo, taskById, candidates, tt, gc, eventsOn, eventSpan, eventTime, calInfo } from "./core.js";

/** Compromissos com hora do dia da sessão, em minutos (Google Agenda). */
const timedEvents = () => (gc() ? eventsOn(state.session.date).filter((e) => !e.allDay).map((e) => ({ ...e, ...eventSpan(e, state.session.date) })) : []);

const endMin = () => { const f = state.cfg?.noite?.fim || "23:00"; return /^\d{2}:\d{2}$/.test(f) ? parseHM(f) : 23 * 60; };
const DUR = [10, 15, 25, 30, 45, 60, 90];
const uid = () => Math.random().toString(36).slice(2, 10);
const minToDate = (key, m) => { const [y, mo, d] = key.split("-").map(Number); return new Date(y, mo - 1, d, 0, m); };
let saving = null;

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
function defaultStart() { const n = nowDate(); return Math.ceil((n.getHours() * 60 + n.getMinutes()) / 5) * 5; }
const startMin = () => (state.session.start != null ? state.session.start : defaultStart());
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
  const sm = startMin(); const input = $("#start-at");
  if (document.activeElement !== input) input.value = `${pad(Math.floor(sm / 60) % 24)}:${pad(sm % 60)}`;
  const evs = timedEvents();
  const tl = timeline(); const planned = tl.blocks.reduce((a, b) => a + b.min, 0); const slack = end - tl.end;
  $("#planned").textContent = fmtDur(planned);
  $("#slack").textContent = slack >= 0 ? fmtDur(slack) : `passou ${fmtDur(-slack)}`;
  $("#slack").classList.toggle("late", slack < 0);
  const over = nowMin >= end;
  $("#rail-over").hidden = !over;
  $("#rail-empty").hidden = over || tl.blocks.length > 0;
  const rows = tl.blocks.map((b) => {
    const t = b.taskId ? taskById(b.taskId) : null; const p = b.projectId ? projectInfo(b.projectId) : null;
    const cls = ["block", `is-${b.kind}`];
    if (b.done || (t && t.done) || (b.kind === "task" && !t && tt())) cls.push("is-done");
    if (nowMin >= b.from && nowMin - b.from < 8) cls.push("is-now-start");
    if (nowMin >= b.from && nowMin < b.to) cls.push("is-current");
    if (nowMin >= b.to) cls.push("is-past");
    const meta = [];
    if (p) meta.push(`<span style="color:${p.color}">${esc(p.name)}</span>`);
    if (b.kind === "habit") meta.push("<span>Hábito</span>");
    if (t && isLate(t)) meta.push(`<span class="late">Atrasada desde ${shortDate(new Date(t.due))}</span>`);
    if (t && t.items) meta.push(`<span>${t.itemsDone} de ${t.items} itens</span>`);
    const clash = b.kind !== "pause" && evs.find((e) => e.from < b.to && b.from < e.to);
    if (clash) meta.push(`<span class="late">Bate com ${esc(hm(new Date(clash.start)))} ${esc(clash.title)}</span>`);
    const opts = [...new Set([...DUR, b.min])].sort((a, c) => a - c).map((m) => `<option value="${m}"${m === b.min ? " selected" : ""}>${fmtDur(m)}</option>`).join("");
    const done = cls.includes("is-done"); const at = hm(minToDate(state.session.date, b.from));
    return `<li class="${cls.join(" ")}" data-block="${b.id}" style="--min:${b.min}">
      <time class="block-time num" datetime="${at}">${at}</time>
      <div><p class="block-title">${esc(t ? t.title : b.title)}</p>${meta.length ? `<p class="row-meta">${meta.join("")}</p>` : ""}</div>
      <div class="tools">
        <select aria-label="Duração de ${esc(b.title)}" data-act="dur">${opts}</select>
        <button type="button" class="btn btn-text btn-icon" data-act="up" aria-label="Subir">${icon.up}</button>
        <button type="button" class="btn btn-text btn-icon" data-act="down" aria-label="Descer">${icon.down}</button>
        ${done ? "" : `<button type="button" class="btn btn-ghost btn-icon" data-act="done" aria-label="${b.kind === "pause" ? "Marcar pausa como feita" : "Concluir no TickTick"}">${icon.check}</button>`}
        <button type="button" class="btn btn-text btn-icon" data-act="remove" aria-label="Tirar da noite">${icon.x}</button>
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
    return `<li class="row${inn ? " is-in" : ""}" data-task="${t.id}"><div><p class="row-title">${esc(t.title)}</p><p class="row-meta"><span style="color:${p.color}">${esc(p.name)}</span>${tm ? `<span class="num">${tm}</span>` : ""}${late ? `<span class="late">${shortDate(new Date(t.due))}</span>` : ""}</p></div>
      <div class="tools">${late ? `<button type="button" class="btn btn-text btn-icon" data-act="postpone" aria-label="Empurrar ${esc(t.title)} para amanhã" title="Empurrar para amanhã">${icon.later}</button>` : ""}
      <button type="button" class="btn btn-ghost btn-sm" data-act="fit" ${inn ? "disabled" : ""}>${inn ? "Na noite" : "Encaixar"}</button></div></li>`;
  }).join("")}</ul>`;
  const evs = timedEvents().filter((e) => e.to > startMin() && e.from < endMin());
  const agenda = !evs.length ? "" : `<h3>Compromissos <span class="count">${evs.length}</span></h3><ul class="rows">${evs.map((e) => {
    const c = calInfo(e.cal);
    return `<li class="row is-event" style="--lc:${c.color}"><div><p class="row-title">${esc(e.title)}</p><p class="row-meta"><span class="num">${esc(eventTime(e))}</span><span style="color:${c.color}">${esc(c.name)}</span></p></div></li>`;
  }).join("")}</ul>`;
  q.innerHTML = agenda + group("Vence hoje", now) + group("Ficou para trás", late, true) + group("Amanhã", next) || `<p class="empty">Nada vence hoje nem ficou para trás. Encaixe uma pausa ou um hábito, ou aproveite a folga.</p>`;
  const hs = tt().habits; const inH = new Set(state.session.blocks.map((b) => b.habitId));
  $("#habits").innerHTML = hs === null ? `<li class="empty">Não consegui ler os hábitos agora.</li>`
    : hs.length ? hs.map((h) => `<li class="row${h.done ? " is-done" : ""}" data-habit="${h.id}"><div><p class="row-title">${esc(h.name)}</p><p class="row-meta">${h.reminder ? `<span class="num">${h.reminder}</span>` : ""}<span>${h.done ? "Feito hoje" : "Pendente"}</span></p></div>
      <div class="tools">${h.done ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-act="fit-habit" ${inH.has(h.id) ? "disabled" : ""}>${inH.has(h.id) ? "Na noite" : "Encaixar"}</button>
      <button type="button" class="btn btn-ghost btn-icon" data-act="check-habit" aria-label="Marcar ${esc(h.name)} como feito">${icon.check}</button>`}</div></li>`).join("")
      : `<li class="empty">Nenhum hábito ativo no TickTick.</li>`;
}

export function bindNoite({ complete, checkin, postpone }) {
  $("#suggest").addEventListener("click", suggest);
  $("#add-pause").addEventListener("click", () => { state.session.blocks.push({ id: uid(), kind: "pause", title: "Pausa", min: 10 }); save(); renderNoite(); });
  $("#clear").addEventListener("click", () => {
    const prev = state.session.blocks; if (!prev.length) return;
    state.session.blocks = []; save(); renderNoite();
    toast("Noite limpa. Ctrl+Z desfaz por 5 segundos.");
    const undo = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "z") { state.session.blocks = prev; save(); renderNoite(); toast("Desfeito."); } };
    document.addEventListener("keydown", undo); setTimeout(() => document.removeEventListener("keydown", undo), 5000);
  });
  $("#start-at").addEventListener("change", (e) => { if (e.target.value) { state.session.start = parseHM(e.target.value); save(); renderNoite(); } });
  $("#rail").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const id = btn.closest("[data-block]").dataset.block; const b = state.session.blocks.find((x) => x.id === id);
    const act = btn.dataset.act;
    if (act === "up") move(id, -1);
    if (act === "down") move(id, 1);
    if (act === "remove") { state.session.blocks = state.session.blocks.filter((x) => x.id !== id); save(); renderNoite(); }
    if (act === "done") {
      if (b.kind === "pause") { b.done = true; save(); renderNoite(); return; }
      const ok = b.kind === "task" ? await complete({ id: b.taskId, projectId: b.projectId }, btn) : await checkin(b.habitId, btn);
      if (ok) { b.done = true; save(); renderNoite(); }
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
    if (btn.dataset.act === "postpone") postpone(taskById(tr.dataset.task), btn);
    const h = hr && tt().habits.find((x) => x.id === hr.dataset.habit);
    if (btn.dataset.act === "fit-habit") { addHabit(h); save(); renderNoite(); }
    if (btn.dataset.act === "check-habit") checkin(h.id, btn);
  });
}

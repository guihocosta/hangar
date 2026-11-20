import { $, $$, state, esc, WDS, WD, MONTHS, pad, dayKey, todayKey, addDays, startOfWeek, shortDate, taskDay, isLate, taskTime, projectInfo, tt, gc, eventsOn, eventTime, calInfo, pref } from "./core.js";

function tasksOn(key) {
  return (tt()?.tasks || []).filter((t) => taskDay(t) === key)
    .sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : a.allDay === b.allDay ? (a.start || "").localeCompare(b.start || "") : a.allDay ? -1 : 1));
}
function itemHTML(t) {
  const p = projectInfo(t.projectId); const tm = taskTime(t); const late = isLate(t);
  return `<div class="item${late ? " is-late" : ""}${t.done ? " is-done" : ""}" style="--lc:${p.color}">${tm && !t.done ? `<time class="num">${tm}</time>` : ""}<span>${esc(t.title)}</span><small>${t.done ? "Feita" : late ? "Atrasada" : esc(p.name)}${t.repeat ? " · repete" : ""}</small></div>`;
}
function eventHTML(e) {
  const c = calInfo(e.cal); const tm = eventTime(e);
  return `<div class="item is-event" style="--lc:${c.color}">${tm ? `<time class="num">${tm}</time>` : ""}<span>${esc(e.title)}</span><small>${e.allDay ? "Dia inteiro · " : ""}${esc(c.name)}${e.location ? ` · ${esc(e.location)}` : ""}</small></div>`;
}
const dayHTML = (k) => [...eventsOn(k).map(eventHTML), ...tasksOn(k).map(itemHTML)];

function renderWeek() {
  const s = startOfWeek(state.agenda.ref); const e = addDays(s, 6); const tk = todayKey();
  $("#agenda-h").innerHTML = s.getMonth() === e.getMonth()
    ? `<b class="num">${s.getDate()} a ${e.getDate()}</b> de ${MONTHS[s.getMonth()]}` : `<b class="num">${shortDate(s)} a ${shortDate(e)}</b>`;
  if (!tt() && !gc()) { $("#week").innerHTML = `<div class="skeleton"><span></span><span></span><span></span></div>`; return; }
  $("#week").innerHTML = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(s, i); const k = dayKey(d); const list = dayHTML(k);
    return `<div class="wday${k === tk ? " is-today" : ""}${k < tk ? " is-past" : ""}"><p class="wday-h"><span>${WDS[d.getDay()]}</span><b class="num">${d.getDate()}</b></p>
      ${list.length ? list.join("") : `<p class="empty">${k < tk ? "Nada pendente" : "Livre"}</p>`}</div>`;
  }).join("");
}

function renderMonth() {
  const ref = state.agenda.ref; const y = ref.getFullYear(); const m = ref.getMonth();
  $("#agenda-h").innerHTML = `<b>${MONTHS[m]}</b> <span class="num">${y}</span>`;
  const first = new Date(y, m, 1); const s = startOfWeek(first); const tk = todayKey();
  const weeks = Math.ceil(((first.getDay() + 6) % 7 + new Date(y, m + 1, 0).getDate()) / 7);
  const heads = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => `<div class="mhead" role="columnheader">${d}</div>`).join("");
  const a = state.agenda;
  if (!a.selDay || new Date(a.selDay + "T12:00").getMonth() !== m) a.selDay = tk.startsWith(`${y}-${pad(m + 1)}`) ? tk : dayKey(first);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => {
    const d = addDays(s, i); const k = dayKey(d);
    const list = [...eventsOn(k).map((e) => ({ title: e.title, color: calInfo(e.cal).color, ev: true })),
      ...tasksOn(k).map((t) => ({ title: t.title, color: projectInfo(t.projectId).color, done: t.done }))];
    const cls = ["mcell"]; if (d.getMonth() !== m) cls.push("is-out"); if (k === tk) cls.push("is-today");
    const shown = list.slice(0, 3).map((x) => `<span class="mitem${x.done ? " is-done" : ""}${x.ev ? " is-event" : ""}" style="--lc:${x.color}">${esc(x.title)}</span>`).join("");
    const more = list.length > 3 ? `<span class="mmore">mais ${list.length - 3}</span>` : "";
    return `<button type="button" role="gridcell" class="${cls.join(" ")}" data-day="${k}" aria-selected="${k === a.selDay}" aria-label="${d.getDate()} de ${MONTHS[d.getMonth()]}, ${list.length} itens"><span class="mcell-n num">${d.getDate()}</span>${shown}${more}<span class="mcount num">${list.length || ""}</span></button>`;
  }).join("");
  $("#month").innerHTML = heads + cells;
  renderDay();
}
function renderDay() {
  const k = state.agenda.selDay; if (!k) return;
  const d = new Date(k + "T12:00"); const list = dayHTML(k);
  $("#day-panel").innerHTML = `<h2>${WD[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}</h2>${list.length ? list.join("") : `<p class="empty">Nada marcado neste dia.</p>`}`;
}

export function renderAgenda() {
  const sc = state.agenda.scale;
  $$("[data-scale]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scale === sc)));
  $("#week").hidden = sc !== "semana"; $("#month-wrap").hidden = sc !== "mes";
  if (sc === "semana") renderWeek(); else renderMonth();
}

export function bindAgenda() {
  state.agenda.scale = pref("agendaScale") || "semana";
  $$("[data-scale]").forEach((b) => b.addEventListener("click", () => { state.agenda.scale = pref("agendaScale", b.dataset.scale); state.agenda.ref = new Date(); renderAgenda(); }));
  $(".cal-nav").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-step]"); if (!btn) return; const step = Number(btn.dataset.step); const a = state.agenda;
    if (a.scale === "semana") a.ref = step ? addDays(a.ref, step * 7) : new Date();
    else { a.ref = step ? new Date(a.ref.getFullYear(), a.ref.getMonth() + step, 1) : new Date(); a.selDay = null; }
    renderAgenda();
  });
  $("#month").addEventListener("click", (e) => {
    const c = e.target.closest("[data-day]"); if (!c) return;
    state.agenda.selDay = c.dataset.day;
    $$(".mcell").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.day === state.agenda.selDay)));
    renderDay();
  });
}

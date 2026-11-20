// Peças de tarefa compartilhadas pelas abas: leitura do título (código, prova/entrega) e o painel de detalhes.
import { $, state, esc, md, WD, MONTHS, todayKey, taskDay, isLate, taskTime, projectInfo, tt, icon } from "./core.js";

/* ---------- regras (Ajustes → Agenda) ---------- */
// Tudo o que decide "o que é prazo" vem da config; o servidor manda os padrões quando falta algo.
export const MABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const norm = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const words = (list) => { const l = (list || []).map((w) => norm(w).trim()).filter(Boolean); return l.length ? new RegExp(`(^|[^a-z0-9])(${l.map(reEsc).join("|")})`) : null; };
const label = (v, fb) => { const [one, many] = String(v || fb).split("/").map((x) => x.trim()); return { one: one || fb, many: many || `${one || fb}s` }; };
let R = null; let Rsrc = null;
export function rules() {
  const c = state.cfg?.agenda || {};
  if (R && Rsrc === c) return R;
  cacheParts.clear();
  let code = null;
  try { code = c.regex_codigo === "" ? null : new RegExp(c.regex_codigo ?? "^\\[([^\\]]{1,12})\\]\\s*"); } catch { console.warn("Hangar: regex_codigo inválida, códigos desligados"); }
  Rsrc = c;
  R = {
    code, codeLabel: c.rotulo_codigo || "Códigos",
    prova: words(c.palavras_prova ?? ["prova"]), naoProva: words(c.nao_prova ?? []),
    entrega: words(c.palavras_entrega ?? []), ignorar: (c.ignorar || []).map(norm).filter(Boolean),
    prio: Number(c.prioridade_entrega ?? 3) || 0,
    lp: label(c.rotulo_prova, "prova"), le: label(c.rotulo_entrega, "entrega"),
    semanas: Math.max(1, Number(c.semanas_lista) || 4), radar: Math.max(1, Number(c.dias_radar) || 21),
  };
  return R;
}
export const janela = (d) => (d % 7 === 0 ? `${d / 7} ${d === 7 ? "semana" : "semanas"}` : `${d} dias`);

/* ---------- leitura das tarefas ---------- */
// Com o padrão, "[CALC] 7.4: 20, 36" vira código CALC e título "7.4: 20, 36".
const cacheParts = new Map();
export function parts(t) {
  const key = t.title; if (cacheParts.has(key)) return cacheParts.get(key);
  const re = rules().code; const m = re ? t.title.match(re) : null;
  const v = m && m[1] ? { mat: m[1].trim().toUpperCase(), title: t.title.slice(m[0].length) || t.title } : { mat: null, title: t.title };
  cacheParts.set(key, v); return v;
}
// Peso do item: prova (prazo forte) > entrega (prazo comum) > nada.
export function kind(t) {
  const r = rules(); const s = norm(parts(t).title);
  if (r.ignorar.some((w) => s.includes(w))) return null;
  if (r.prova?.test(s) && !r.naoProva?.test(s)) return "prova";
  if (r.entrega?.test(s) || (r.prio && t.priority >= r.prio)) return "entrega";
  return null;
}
export const diffDays = (k) => Math.round((new Date(k + "T12:00") - new Date(todayKey() + "T12:00")) / 86400000);
export function rel(k) {
  const n = diffDays(k);
  return n === 0 ? "hoje" : n === 1 ? "amanhã" : n === -1 ? "ontem" : n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}

export function badge(t) {
  const k = kind(t);
  return k === "prova" ? `<span class="ag-kind is-prova">${esc(rules().lp.one)}</span>` : k === "entrega" ? `<span class="ag-kind">${esc(rules().le.one)}</span>` : "";
}
export function matTag(mat) { return mat ? `<span class="ag-mat" data-mat="${esc(mat)}">${esc(mat)}</span>` : ""; }
export const ICON_NOTE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h10M3 6.5h10M3 9.5h6"/></svg>';
export const ICON_LIST = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m2.5 4 1.2 1.2L6 3M2.5 9l1.2 1.2L6 8M8.5 4.2H14M8.5 9.2H14"/></svg>';

/* ---------- detalhes ---------- */
const PRIO = { 5: "alta", 3: "média", 1: "baixa" };
function taskUrl(t) {
  const tpl = state.cfg?.ticktick?.url_tarefa || "https://ticktick.com/webapp/#p/{projeto}/tasks/{id}";
  return tpl.replace("{id}", encodeURIComponent(t.id)).replace("{projeto}", encodeURIComponent(t.projectId));
}
function whenText(t) {
  const k = taskDay(t); if (!k) return "Sem data";
  const d = new Date(k + "T12:00"); const tm = taskTime(t);
  return `${WD[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}${tm ? ` às ${tm}` : ""}`;
}
// Outras abas penduram uma seção no painel (ex.: a Noite oferece "Encaixar na noite").
const extras = [];
export function addDrawerExtra(x) { extras.push(x); }
let openId = null;
const dlg = () => $("#task-detail");
function renderDetail() {
  const d = dlg(); const t = (tt()?.tasks || []).find((x) => x.id === openId);
  if (!t) { openId = null; if (d.open) d.close(); return; }
  const p = projectInfo(t.projectId); const { mat, title } = parts(t); const late = isLate(t); const k = taskDay(t);
  const chips = [matTag(mat), badge(t), PRIO[t.priority] ? `<span class="tag">prioridade ${PRIO[t.priority]}</span>` : "",
    t.repeat ? `<span class="tag">repete</span>` : "", ...(t.tags || []).map((g) => `<span class="tag">#${esc(g)}</span>`)].filter(Boolean).join("");
  const cl = t.checklist || [];
  const extra = extras.map((x) => x.html(t)).filter(Boolean).join("");
  d.innerHTML = `<div class="drawer-in" style="--lc:${p.color}">
    <header class="drawer-h"><p class="eyebrow"><span class="ag-dot" aria-hidden="true"></span>${esc(p.name)}</p>
      <button type="button" class="btn btn-text btn-icon" data-close aria-label="Fechar detalhes">${icon.x}</button></header>
    <h2 id="agd-h" class="drawer-t${t.done ? " is-done" : ""}">${esc(title)}</h2>
    ${chips ? `<div class="drawer-chips">${chips}</div>` : ""}
    <p class="drawer-when${late ? " late" : ""}"><b>${esc(whenText(t))}</b>${k ? ` · ${t.done ? "feita" : late ? `atrasada ${rel(k)}` : rel(k)}` : ""}</p>
    ${cl.length ? `<section class="drawer-sec"><h3>Checklist <span class="count num">${t.itemsDone}/${t.items}</span></h3><ul class="drawer-cl">${cl.map((i) => `<li class="${i.done ? "is-on" : ""}">${i.done ? icon.check : "<i></i>"}<span>${esc(i.title)}</span></li>`).join("")}</ul></section>` : ""}
    ${t.content ? `<section class="drawer-sec"><h3>Notas</h3><div class="drawer-md">${md(t.content)}</div></section>` : ""}
    ${extra}
    <footer class="drawer-f">
      ${t.done ? "" : `<button type="button" class="btn btn-primary" data-act="done">${icon.check} Concluir</button>
      ${k ? `<div class="drawer-later" role="group" aria-label="Adiar"><span>Adiar</span><button type="button" class="btn btn-ghost btn-sm" data-act="later" data-days="1">1 dia</button><button type="button" class="btn btn-ghost btn-sm" data-act="later" data-days="7">1 semana</button></div>` : ""}`}
      <a class="btn btn-text" href="${esc(taskUrl(t))}" target="_blank" rel="noopener">Abrir no TickTick ${icon.ext}</a>
    </footer></div>`;
  d.dataset.task = t.id;
}
export function openTask(id) {
  openId = id; renderDetail();
  const d = dlg(); if (!openId) return; if (!d.open) d.showModal();
  d.querySelector("[data-close]")?.focus();
}
export const taskOpen = () => dlg()?.open;
/** Redesenha o painel aberto depois que os dados voltam do TickTick. */
export function refreshTask() { if (openId && dlg()?.open) renderDetail(); }

/** Liga o painel: concluir, adiar, fechar, ações extras e qualquer [data-open-task] da página. */
export function bindTarefa({ complete, postpone }) {
  const d = dlg();
  d.addEventListener("close", () => { const back = document.querySelector(`[data-open-task="${openId}"]`); openId = null; back?.focus(); });
  d.addEventListener("click", async (e) => {
    if (e.target === d || e.target.closest("[data-close]")) { d.close(); return; } // fundo ou X
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const t = (tt()?.tasks || []).find((x) => x.id === openId); if (!t) return;
    const act = btn.dataset.act;
    const custom = extras.find((x) => x.on?.[act]);
    if (custom) { await custom.on[act](t, btn); renderDetail(); return; }
    const ok = act === "done" ? await complete({ id: t.id, projectId: t.projectId }, btn) : act === "later" ? await postpone(t, btn, Number(btn.dataset.days)) : false;
    if (ok) d.close();
  });
  document.addEventListener("click", (e) => {
    const o = e.target.closest("[data-open-task]"); if (!o || o.closest("#task-detail")) return;
    e.preventDefault(); openTask(o.dataset.openTask);
  });
}


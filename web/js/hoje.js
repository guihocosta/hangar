import { $, state, isCobrar, WD, MONTHS, esc, md, ago, candidates, projectInfo, taskTime, shortDate, icon, daysSince, hm, areaColor, shortRepo, gc, eventsOn, eventTime, eventSpan, calInfo, todayKey, holidayOn } from "./core.js";

export function eventRows(list, key) {
  const now = new Date(); const nm = now.getHours() * 60 + now.getMinutes();
  return list.map((e) => {
    const c = calInfo(e.cal); const sp = e.allDay ? null : eventSpan(e, key);
    const cls = ["row", "is-event"];
    if (sp && nm >= sp.to) cls.push("is-past");
    if (sp && nm >= sp.from && nm < sp.to) cls.push("is-current");
    const when = e.allDay ? "dia inteiro" : eventTime(e);
    const left = sp && nm < sp.from ? sp.from - nm : null;
    return `<li class="${cls.join(" ")}" style="--lc:${c.color}"><div><p class="row-title">${esc(e.title)}</p>
      <p class="row-meta"><span class="num">${esc(when)}</span><span style="color:${c.color}">${esc(c.name)}</span>${e.location ? `<span>${esc(e.location)}</span>` : ""}${cls.includes("is-current") ? "<span>agora</span>" : left != null && left <= 120 ? `<span>em ${left < 60 ? left + " min" : Math.floor(left / 60) + "h" + (left % 60 ? String(left % 60).padStart(2, "0") : "")}</span>` : ""}</p></div>
      ${e.url ? `<a class="btn btn-text btn-icon" href="${esc(e.url)}" target="_blank" rel="noopener" aria-label="Abrir ${esc(e.title)} no Google Agenda">${icon.ext}</a>` : ""}</li>`;
  }).join("");
}

export function soltasRows(list, { showTag = true } = {}) {
  if (!list.length) return `<li class="empty">Nada solto por aqui.</li>`;
  return list.map((p) => `<li class="row check${p.done ? " is-done" : ""}" data-pend="${p.id}">
    <label><input type="checkbox" data-act="pend-toggle"${p.done ? " checked" : ""}><span class="row-title">${esc(p.text)}</span></label>
    <p class="row-meta">${showTag && p.tags.length ? p.tags.map((t) => `<span class="tag" style="color:${areaColor(t)}">${esc(t)}</span>`).join("") : ""}${p.done ? `<span>feito ${esc(p.doneAt || "")}</span>` : p.since ? `<span>desde ${esc(p.since)}</span>` : ""}</p></li>`).join("");
}

export function visibleSoltas(filterTag) {
  const all = state.vault?.pendencias || [];
  const today = shortDate(new Date());
  return all
    .filter((p) => !filterTag || p.tags.includes(filterTag))
    .filter((p) => !p.done || p.doneAt === today)
    .sort((a, b) => a.done - b.done);
}

export function cardRow(c) {
  const st = (c.status || "Sem status").toLowerCase().replace(/\s+/g, "-");
  return `<li class="row card-row" data-card="${c.number}">
    <div><p class="row-title"><span class="tagcode">${esc(c.tag || "#" + c.number)}</span> ${esc(c.title)}</p>
    <p class="row-meta"><span class="status st-${esc(st)}">${esc(c.status || "Sem status")}</span>${c.sprint ? `<span>${esc(c.sprint)}</span>` : ""}<span>#${c.number}</span></p></div>
    <a class="btn btn-text btn-icon" href="${esc(c.url)}" target="_blank" rel="noopener" aria-label="Abrir ${esc(c.tag || c.number)} no GitHub">${icon.ext}</a></li>`;
}

export function prRow(p) {
  const age = daysSince(p.createdAt);
  const checks = { SUCCESS: ["ok", "checks ok"], FAILURE: ["bad", "checks falhando"], ERROR: ["bad", "checks com erro"], PENDING: ["wait", "checks rodando"] }[p.checks];
  return `<li class="row">
    <div><p class="row-title"><span class="tagcode">${esc(shortRepo(p.repo))}#${p.number}</span> ${esc(p.title)}</p>
    <p class="row-meta">${p.author ? `<span>${esc(p.author)}</span>` : ""}<span class="${age >= 2 ? "warn" : ""}">${age === 0 ? "aberto hoje" : `há ${age} d`}</span>${checks ? `<span class="dot-${checks[0]}">${checks[1]}</span>` : ""}${p.draft ? "<span>rascunho</span>" : ""}${p.decision === "CHANGES_REQUESTED" ? '<span class="warn">mudanças pedidas</span>' : p.decision === "APPROVED" ? "<span>aprovado</span>" : ""}</p></div>
    <a class="btn btn-text btn-icon" href="${esc(p.url)}" target="_blank" rel="noopener" aria-label="Abrir PR ${p.number}">${icon.ext}</a></li>`;
}

export const hiddenCards = () => new Set(JSON.parse((() => { try { return localStorage.getItem("hangar:hiddenCards") || "[]"; } catch { return "[]"; } })()));

export function renderHoje() {
  const d = new Date();
  const hol = holidayOn(todayKey()); const folga = !!hol && !hol.parcial;
  $("#hoje-wd").textContent = WD[d.getDay()] + (hol ? ` · feriado: ${hol.title}${hol.parcial ? " (meio expediente)" : ", sem trabalho"}` : "");
  $("#h-trabnow").closest("section").hidden = !state.cfg?.trabalho?.ativo || folga;
  $("#hoje-h").textContent = `${d.getDate()} de ${MONTHS[d.getMonth()]}`;

  // pauta
  const v = state.vault; const job = v?.jobs?.pauta;
  const pa = $("#pauta");
  const gen = $("#pauta-gerar");
  if (job?.state === "running") {
    $("#pauta-meta").textContent = "O Claude está montando a pauta…";
    gen.setAttribute("aria-busy", "true"); gen.disabled = true;
  } else {
    gen.removeAttribute("aria-busy"); gen.disabled = false;
  }
  if (v) {
    const p = v.pauta;
    if (p.auto) {
      if (job?.state !== "running") $("#pauta-meta").textContent = `Pauta das ${p.auto.at.slice(11, 16)}`;
      gen.textContent = "Regerar pauta";
      pa.innerHTML = md(p.auto.markdown.replace(/^# .*\n+/, ""), { checkable: true })
        + p.extra.map((x) => `<details class="extra"><summary>${esc(x.name.slice(13))}</summary>${md(x.markdown.replace(/^# .*\n+/, ""))}</details>`).join("");
    } else {
      if (job?.state !== "running") $("#pauta-meta").textContent = job?.state === "error" ? `A pauta falhou: ${job.msg}` : `A pauta de hoje ainda não foi gerada (o timer roda às ${state.cfg?.claude?.horario_pauta || "07:30"}).`;
      gen.textContent = "Gerar pauta";
      pa.innerHTML = `<div class="note"><p>Sem pauta ainda hoje. Gere agora: o Claude junta as suas fontes e as pendências e escreve a nota no vault.</p></div>`
        + p.extra.map((x) => `<details class="extra" open><summary>${esc(x.name.slice(13))}</summary>${md(x.markdown.replace(/^# .*\n+/, ""))}</details>`).join("");
    }
  }

  // compromissos de hoje (Google Agenda)
  if (gc()) {
    const k = todayKey(); const list = eventsOn(k);
    $("#c-agenda-hoje").textContent = list.length || "";
    $("#hoje-agenda").innerHTML = list.length ? eventRows(list, k) : `<li class="empty">Nada marcado hoje.</li>`;
  }

  // vence hoje (TickTick)
  if (state.src.ticktick?.data) {
    const { late, now } = candidates();
    const list = [...now, ...late];
    $("#c-vence").textContent = list.length || "";
    $("#hoje-vence").innerHTML = list.length ? list.slice(0, 12).map((t) => {
      const p = projectInfo(t.projectId); const tm = taskTime(t); const lt = late.includes(t);
      return `<li class="row" data-task="${t.id}"><div><p class="row-title">${esc(t.title)}</p>
        <p class="row-meta"><span style="color:${p.color}">${esc(p.name)}</span>${tm ? `<span class="num">${tm}</span>` : ""}${lt ? `<span class="late">desde ${shortDate(new Date(t.due))}</span>` : ""}</p></div>
        <button type="button" class="btn btn-ghost btn-icon" data-act="complete" aria-label="Concluir ${esc(t.title)} no TickTick">${icon.check}</button></li>`;
    }).join("") + (list.length > 12 ? `<li class="empty">mais ${list.length - 12} na aba Noite</li>` : "")
      : `<li class="empty">Nada vence hoje.</li>`;
  }

  // trabalho agora
  const gh = state.src.github?.data;
  if (gh) {
    const hid = hiddenCards();
    const cards = gh.cards.filter((c) => !hid.has(String(c.number)) && !/done|closed/i.test(c.status || "") && !isCobrar(c));
    const rows = [...gh.reviews.map(prRow), ...cards.map(cardRow)];
    $("#hoje-trab").innerHTML = rows.join("") || `<li class="empty">Nenhum card ou review pendente.</li>`;
  }

  // soltas
  if (v) {
    const list = visibleSoltas();
    $("#c-soltas").textContent = list.filter((p) => !p.done).length || "";
    $("#hoje-soltas").innerHTML = soltasRows(list);
  }
}

export function pautaAt() { return state.vault?.pauta?.auto?.at ? hm(new Date(state.vault.pauta.auto.at)) : null; }
export { ago };

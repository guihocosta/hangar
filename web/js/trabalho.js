import { $, state, esc, ago, icon, shortDate, daysSince, isCobrar } from "./core.js";

const grupo = () => state.cfg?.glpi?.rotulo_grupo || "grupo";
import { cardRow, prRow, soltasRows, visibleSoltas, hiddenCards } from "./hoje.js";

const ORDER = ["In progress", "Blocked", "Review", "In review", "Todo", "Backlog", "Homologation"];

function setHidden(set) { try { localStorage.setItem("hangar:hiddenCards", JSON.stringify([...set])); } catch { /* sem storage */ } }

function renderCards(gh) {
  const hid = hiddenCards();
  const open = gh.cards.filter((c) => !/done|closed/i.test(c.status || ""));
  renderCobrar(open.filter(isCobrar));
  const cards = open.filter((c) => !isCobrar(c));
  const shown = cards.filter((c) => !hid.has(String(c.number)));
  const off = cards.filter((c) => hid.has(String(c.number)));
  $("#c-cards").textContent = shown.length || "";
  const groups = {};
  for (const c of shown) (groups[c.status || "Sem status"] ||= []).push(c);
  const keys = Object.keys(groups).sort((a, b) => (ORDER.indexOf(a) + 99) % 99 - (ORDER.indexOf(b) + 99) % 99);
  const withHide = (c) => cardRow(c).replace("</li>", `<button type="button" class="btn btn-text btn-icon" data-act="hide-card" aria-label="Tirar ${esc(c.tag || c.number)} da minha visão (é de outra pessoa)" title="Não é meu: esconder">${icon.x}</button></li>`);
  $("#trab-cards").innerHTML = (keys.length ? keys.map((k) => `<h3>${esc(k)} <span class="count">${groups[k].length}</span></h3><ul class="rows">${groups[k].map(withHide).join("")}</ul>`).join("") : `<p class="empty">Nenhum card aberto com você.</p>`)
    + (off.length ? `<details class="off"><summary>Escondidos (${off.length})</summary><ul class="rows">${off.map((c) => cardRow(c).replace("</li>", `<button type="button" class="btn btn-text btn-icon" data-act="show-card" aria-label="Mostrar ${esc(c.tag || c.number)} de novo">${icon.eye}</button></li>`)).join("")}</ul></details>` : "");
  const sp = shown.find((c) => c.sprintStart) || cards.find((c) => c.sprintStart);
  if (!sp) $("#trab-sprint").textContent = state.cfg?.trabalho?.subtitulo || "";
  if (sp) {
    const day = Math.floor((Date.now() - new Date(sp.sprintStart + "T00:00").getTime()) / 86400000) + 1;
    const len = sp.sprintDays || 14;
    $("#trab-sprint").textContent = `${sp.sprint} · dia ${Math.min(Math.max(day, 1), len)} de ${len}`;
  }
}

function renderCobrar(list) {
  const sorted = [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
  $("#c-cobrar").textContent = sorted.length || "";
  $("#trab-cobrar").innerHTML = sorted.length ? sorted.map((c) => {
    const d = daysSince(c.updatedAt);
    return cardRow(c).replace(`<span>#${c.number}</span>`, `<span>#${c.number}</span><span class="${d >= 7 ? "warn" : ""}">${d === 0 ? "mexido hoje" : `parado há ${d} d`}</span>`);
  }).join("") : `<li class="empty">Nada esperando o pessoal.</li>`;
}

function renderPrs(gh) {
  $("#trab-prs").innerHTML = `<h3>Para revisar <span class="count">${gh.reviews.length}</span></h3><ul class="rows">${gh.reviews.map(prRow).join("") || '<li class="empty">Nenhuma review pedida.</li>'}</ul>
    <h3>Meus abertos <span class="count">${gh.mine.length}</span></h3><ul class="rows">${gh.mine.map(prRow).join("") || '<li class="empty">Nenhum PR seu aberto.</li>'}</ul>`;
}

/* ---------- GLPI ---------- */
function tile(label, value, sub, warn) {
  return `<div class="tile${warn ? " is-warn" : ""}"><p class="tile-l">${label}</p><p class="tile-v num">${value}</p>${sub ? `<p class="tile-s">${sub}</p>` : ""}</div>`;
}

function weeklyChart(series) {
  const W = 560, H = 200, padL = 28, padB = 26, padT = 10;
  const max = Math.max(4, ...series.flatMap((s) => [s.opened, s.solved]));
  const step = Math.ceil(max / 4); const top = step * 4;
  const colW = (W - padL) / series.length; const bw = Math.min(16, (colW - 14) / 2);
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const grid = [0, 1, 2, 3, 4].map((i) => `<line x1="${padL}" x2="${W}" y1="${y(i * step)}" y2="${y(i * step)}" class="gl${i === 0 ? " base" : ""}"/><text x="${padL - 6}" y="${y(i * step) + 4}" class="ax" text-anchor="end">${i * step}</text>`).join("");
  const bar = (x, v, cls) => {
    if (!v) return "";
    const h = y(0) - y(v); const r = Math.min(4, h, bw / 2);
    return `<path class="${cls}" d="M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z"/>`;
  };
  const cols = series.map((s, i) => {
    const cx = padL + colW * i + colW / 2; const d = new Date(s.week + "T12:00");
    return `<g class="col" data-i="${i}">
      <rect class="hit" x="${padL + colW * i}" y="${padT}" width="${colW}" height="${H - padT}" />
      ${bar(cx - bw - 1, s.opened, "b-open")}${bar(cx + 1, s.solved, "b-solved")}
      <text x="${cx}" y="${H - 8}" class="ax" text-anchor="middle">${shortDate(d)}</text></g>`;
  }).join("");
  return `<figure class="chart" data-series='${esc(JSON.stringify(series))}'>
    <figcaption><span class="chart-t">Abertos e solucionados por semana</span>
      <span class="legend"><span class="lg lg-open"></span>Abertos <span class="lg lg-solved"></span>Solucionados</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Barras por semana: abertos e solucionados nas últimas 8 semanas">${grid}${cols}</svg>
    <details class="tbl"><summary>Ver em tabela</summary><table><thead><tr><th>Semana</th><th class="num">Abertos</th><th class="num">Solucionados</th></tr></thead>
      <tbody>${series.map((s) => `<tr><td>${shortDate(new Date(s.week + "T12:00"))}</td><td class="num">${s.opened}</td><td class="num">${s.solved}</td></tr>`).join("")}</tbody></table></details>
  </figure>`;
}

function areaBars(byArea, open) {
  const max = Math.max(...Object.values(byArea), 1);
  return `<div class="hbars"><p class="chart-t">Abertos por ${esc(grupo())}</p>${Object.entries(byArea).map(([k, v]) => `<div class="hb${!k ? " is-warn" : ""}"><span class="hb-l">${esc(k || "Sem " + grupo())}</span><span class="hb-track"><span class="hb-fill" style="width:${(v / max) * 100}%"></span></span><span class="hb-v num">${v}</span></div>`).join("")}
    <p class="muted small">${open} abertos no total</p></div>`;
}

function renderGlpi() {
  const g = state.src.glpi; const el = $("#glpi");
  if (!g?.data) { el.innerHTML = g?.error ? `<p class="note">${esc(g.error)}</p>` : `<div class="skeleton"><span></span><span></span></div>`; return; }
  const d = g.data; const sd = d.solveDays;
  $("#glpi-meta").textContent = `Só leitura · ${ago(g.fetchedAt)}${g.error ? " · última leitura falhou" : ""}`;
  el.innerHTML = `<div class="tiles">
      ${tile("Abertos", d.open, Object.entries(d.byStatus).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · "))}
      ${tile("Sem " + esc(grupo()), d.noSquad, "nem atribuído nem observador", d.noSquad > 0)}
      ${tile("Sem técnico", d.noTech, "abertos sem ninguém atribuído", d.noTech > 0)}
      ${tile("Até a solução", sd ? `${String(sd.median).replace(".", ",")} d` : "—", sd ? `mediana · p80 ${String(sd.p80).replace(".", ",")} d · ${sd.n} chamados em 30 dias` : "sem soluções nos últimos 30 dias")}
      ${tile("Últimos 7 dias", `${d.opened7} / ${d.solved7}`, "abertos / solucionados")}
    </div>
    <div class="glpi-charts">${weeklyChart(d.series)}${areaBars(d.byArea, d.open)}</div>
    <div class="oldest"><h3>Abertos há mais tempo</h3><ul class="rows">${d.oldest.map((t) => `<li class="row"><div><p class="row-title"><span class="tagcode">#${t.id}</span> ${esc(t.name)}</p>
      <p class="row-meta"><span class="${t.ageDays > 30 ? "warn" : ""}">${t.ageDays} dias</span><span>${esc(t.status)}</span><span>${esc(t.squad || "sem " + grupo())}</span>${t.imported ? "<span>importado</span>" : ""}</p></div>
      <a class="btn btn-text btn-icon" href="${esc(t.url)}" target="_blank" rel="noopener" aria-label="Abrir chamado ${t.id} no GLPI">${icon.ext}</a></li>`).join("")}</ul>
      ${state.cfg?.glpi?.nota_importados ? `<p class="muted small">${esc(state.cfg.glpi.nota_importados)}</p>` : ""}</div>`;
}

export function renderTrabalho() {
  const gh = state.src.github;
  if (gh?.data) { renderCards(gh.data); renderPrs(gh.data); $("#trab-meta").textContent = `GitHub ${ago(gh.fetchedAt)}${gh.error ? " · última leitura falhou" : ""}`; }
  else if (gh?.error) $("#trab-cards").innerHTML = `<p class="note">${esc(gh.error)}</p>`;
  if (state.vault) {
    const list = visibleSoltas(state.cfg?.trabalho?.area);
    $("#c-lsoltas").textContent = list.filter((p) => !p.done).length || "";
    $("#trab-soltas").innerHTML = soltasRows(list, { showTag: false });
  }
  if (state.src.glpi !== undefined) renderGlpi();
}

export function bindTrabalho() {
  $("#trab-cards").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const n = btn.closest("[data-card]").dataset.card; const set = hiddenCards();
    if (btn.dataset.act === "hide-card") set.add(n); else set.delete(n);
    setHidden(set); renderTrabalho();
  });
  // tooltip do gráfico semanal
  const tip = $("#tip");
  $("#glpi").addEventListener("pointermove", (e) => {
    const col = e.target.closest(".col"); const fig = e.target.closest(".chart");
    if (!col || !fig) { tip.hidden = true; return; }
    const s = JSON.parse(fig.dataset.series)[Number(col.dataset.i)];
    tip.innerHTML = `<b>Semana de ${shortDate(new Date(s.week + "T12:00"))}</b><span><i class="lg lg-open"></i>Abertos <b class="num">${s.opened}</b></span><span><i class="lg lg-solved"></i>Solucionados <b class="num">${s.solved}</b></span>`;
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.transform = `translate(${x}px, ${e.clientY + 14}px)`;
    fig.querySelectorAll(".col").forEach((c) => c.classList.toggle("is-hot", c === col));
  });
  $("#glpi").addEventListener("pointerleave", () => { tip.hidden = true; document.querySelectorAll(".col.is-hot").forEach((c) => c.classList.remove("is-hot")); });
}

import { $, state, esc, md, icon } from "./core.js";

const NEXT = { "Ideia": "Explorando", "Explorando": "Proposta", "Proposta": "Virou card" };

export function renderIdeias() {
  const v = state.vault; if (!v) return;
  const { stages, items } = v.ideias;
  const job = v.jobs?.ideias; const btn = $("#ask-btn");
  if (job?.state === "running") { btn.setAttribute("aria-busy", "true"); btn.disabled = true; $("#ask-status").textContent = "O Claude está pensando em caminhos… (uns 20 segundos)"; }
  else {
    btn.removeAttribute("aria-busy"); btn.disabled = false;
    if (job?.state === "done") $("#ask-status").textContent = `Pronto: ${job.msg} na coluna Ideia.`;
    if (job?.state === "error") $("#ask-status").textContent = `Não deu certo: ${job.msg}`;
  }
  $("#board").innerHTML = stages.map((st, si) => {
    const list = items.filter((i) => i.stage === st);
    return `<section class="lane${st === "Descartada" ? " is-muted" : ""}" aria-label="${esc(st)}"><h2>${esc(st)} <span class="count">${list.length}</span></h2>
      ${list.map((i) => `<article class="idea" data-idea="${i.id}">
        <h3>${esc(i.title)}</h3>
        <p class="chips-s">${i.area ? `<span class="tag">${esc(i.area)}</span>` : ""}${i.impact ? `<span>impacto ${esc(i.impact)}</span>` : ""}${i.effort ? `<span>esforço ${esc(i.effort)}</span>` : ""}</p>
        ${i.text ? `<details><summary>Detalhes</summary><div class="idea-body">${md(i.text)}</div>${i.origin ? `<p class="muted small">Origem: ${esc(i.origin)}</p>` : ""}</details>` : ""}
        <div class="idea-tools">
          ${si > 0 ? `<button type="button" class="btn btn-text btn-icon" data-move="${esc(stages[si - 1])}" aria-label="Voltar para ${esc(stages[si - 1])}">${icon.left}</button>` : ""}
          ${NEXT[st] ? `<button type="button" class="btn btn-ghost btn-sm" data-move="${esc(NEXT[st])}">${esc(NEXT[st])} ${icon.right}</button>` : ""}
          ${st !== "Descartada" ? `<button type="button" class="btn btn-text btn-sm" data-move="Descartada">Descartar</button>` : ""}
        </div></article>`).join("") || `<p class="empty">${st === "Ideia" ? "Peça sugestões acima ou anote uma ideia sua." : "Vazio."}</p>`}
    </section>`;
  }).join("");
}

export function bindIdeias({ move, ask }) {
  $("#board").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-move]"); if (!b) return;
    move(b.closest("[data-idea]").dataset.idea, b.dataset.move, b);
  });
  $(".chips").addEventListener("click", (e) => { const c = e.target.closest(".chip[data-foco]"); if (!c) return; $("#foco").value = c.dataset.foco; $("#foco").focus(); });
  $("#ask").addEventListener("submit", (e) => { e.preventDefault(); ask($("#foco").value, $("#ask-btn")); });
}

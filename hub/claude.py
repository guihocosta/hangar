"""Pauta do dia e sugestões de caminhos, geradas pelo `claude -p` sem ferramentas.

O servidor monta o contexto (TickTick, cards, PRs, GLPI, pendências, ideias e notas extras) e o
Claude só raciocina sobre ele: não lê arquivos, não roda comandos e não escreve em lugar nenhum.
Quem grava no vault é o hub. Perfil, regras e seções vêm da configuração (aba Ajustes).
"""
import json
import re
import shutil
import subprocess
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from . import config, paths, vault
from .sources import enabled

WD = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]

jobs = {}  # nome -> {"state": running|done|error, "at": ts, "msg": str}
_jobs_lock = threading.Lock()


def _cfg():
    return config.get()["claude"]


def _nome():
    return config.get()["usuario"]["nome"].strip() or "a pessoa"


def _claude_bin():
    b = _cfg()["binario"].strip()
    if b:
        return str(config.path(b))
    return shutil.which("claude") or str(Path.home() / ".local/bin/claude")


def run_claude(prompt, timeout=300):
    if not _cfg()["ativo"]:
        raise RuntimeError("O Claude está desligado em Ajustes.")
    cmd = [_claude_bin(), "-p", "--model", _cfg()["modelo"], "--tools", "", "--no-session-persistence",
           "--setting-sources", "", "--output-format", "json"]
    paths.DATA.mkdir(parents=True, exist_ok=True)
    try:
        out = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
                             cwd=str(paths.DATA))
    except FileNotFoundError as e:
        raise RuntimeError("Não achei o comando claude (Claude Code). Instale ou aponte o caminho em Ajustes.") from e
    if out.returncode != 0:
        raise RuntimeError((out.stderr or out.stdout or "claude falhou").strip()[-300:])
    res = json.loads(out.stdout)
    if res.get("is_error"):
        raise RuntimeError(str(res.get("result"))[:300])
    return res["result"]


# ---------- contexto ----------

def _d(v):
    return datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone() if v else None


def _ticktick_ctx(tt):
    if not tt:
        return "(TickTick indisponível)"
    names = {p["id"]: p["name"] for p in tt["projects"]}
    today = date.today()
    late, now, soon = [], [], []
    for t in tt["tasks"]:
        if t["done"]:
            continue
        d = _d(t.get("start") or t.get("due"))
        due = _d(t.get("due"))
        if not d:
            continue
        line = f"- {t['title']} [{names.get(t['projectId'], '?')}]"
        if not t["allDay"] and t.get("start"):
            line += f" às {d:%H:%M}"
        if due and due.date() < today:
            late.append(line + f" (atrasada desde {due:%d/%m})")
        elif d.date() == today:
            now.append(line)
        elif d.date() <= today + timedelta(days=7):
            soon.append(line + f" ({WD[d.weekday()]} {d:%d/%m})")
    habits = tt.get("habits") or []
    hab = ", ".join(f"{h['name']}{' (feito)' if h['done'] else ''}" for h in habits) or "nenhum"
    return ("Hoje:\n" + ("\n".join(now) or "- nada") + "\n\nAtrasadas:\n" + ("\n".join(late) or "- nada")
            + "\n\nPróximos 7 dias:\n" + ("\n".join(soon[:30]) or "- nada") + f"\n\nHábitos de hoje: {hab}")


def _github_ctx(gh):
    if not gh:
        return "(GitHub indisponível)"
    cards = "\n".join(f"- {c['tag'] or '#'+str(c['number'])} (#{c['number']}): {c['title']} — {c['status'] or 'sem status'}"
                      f"{', ' + c['sprint'] if c.get('sprint') else ''}" for c in gh["cards"]) or "- nenhum"
    rev = "\n".join(f"- {p['repo']}#{p['number']} de {p['author']}: {p['title']} (aberto {p['createdAt'][:10]})"
                    for p in gh["reviews"]) or "- nenhuma"
    mine = "\n".join(f"- {p['repo']}#{p['number']}: {p['title']} (decisão: {p['decision'] or 'sem review'})"
                     for p in gh["mine"]) or "- nenhum"
    n = _nome()
    proj = config.get()["trabalho"]["projeto"]
    return (f"Cards atribuídos a {n}{f' (Project {proj})' if proj else ''}:\n{cards}\n\n"
            f"Reviews pedidas a {n}:\n{rev}\n\nPRs abertos de {n}:\n{mine}")


def _grupo():
    return config.get()["glpi"]["rotulo_grupo"] or "grupo"


def _glpi_ctx(g):
    if not g:
        return "(GLPI indisponível)"
    sd = g.get("solveDays")
    old = "\n".join(f"- #{t['id']} {t['name'][:80]} — {t['ageDays']} dias, {t['status']}, squad {t['squad'] or 'nenhum'}"
                    f"{' (importado)' if t['imported'] else ''}" for t in g["oldest"][:5])
    return (f"Abertos: {g['open']} de {g['total']} (por status: {g['byStatus']}); por {_grupo()}: {g['byArea']}; "
            f"sem {_grupo()}: {g['noSquad']}; sem técnico: {g['noTech']}. Últimos 7 dias: {g['opened7']} abertos, "
            f"{g['solved7']} solucionados. Tempo até solução (30 dias): "
            f"{'mediana ' + str(sd['median']) + ' d, p80 ' + str(sd['p80']) + ' d, n=' + str(sd['n']) if sd else 'sem dados'}.\n"
            f"Mais antigos abertos:\n{old}")


def context(include_glpi=True):
    cfg = config.get()
    src = enabled()
    data = {k: s.get()["data"] for k, s in src.items() if include_glpi or k != "glpi"}
    pend = [p for p in vault.pendencias() if not p["done"]]
    pend_txt = "\n".join(f"- {p['text']}{' #' + ' #'.join(p['tags']) if p['tags'] else ''}"
                         f"{' (desde ' + p['since'] + ')' if p['since'] else ''}" for p in pend) or "- nenhuma"
    notes = "\n\n".join(f"[{n}]\n{t}" for n, t in vault.extra_notes()) or "(nenhuma)"
    conv = paths.conversas()
    prev = sorted(conv.glob("*- Pauta do dia.md")) if conv.exists() else []
    prev = [p for p in prev if not p.name.startswith(date.today().isoformat())][-1:]
    prev_txt = "\n\n".join(f"[{p.stem}]\n{vault.read_note(p, 2500)}" for p in prev) or "(nenhuma)"
    cur = vault.pauta_path()
    if cur.exists():
        prev_txt += ("\n\n[Pauta de HOJE que vai ser substituída: o que está marcado [x] já foi feito; "
                     f"mantenha marcado se ainda fizer sentido listar]\n{vault.read_note(cur, 3000)}")
    recent = sorted((p for p in conv.glob("20*.md")
                     if p.name[:10] >= (date.today() - timedelta(days=3)).isoformat()), reverse=True)[:12] if conv.exists() else []
    today = date.today()
    parts = [f"Hoje é {WD[today.weekday()]}, {today:%d/%m/%Y}. Agora são {datetime.now():%H:%M}."]
    if "ticktick" in src:
        parts.append(f"## TickTick\n{_ticktick_ctx(data.get('ticktick'))}")
    if "github" in src:
        parts.append(f"## {cfg['trabalho']['nome']} no GitHub\n{_github_ctx(data.get('github'))}")
    if "glpi" in src:
        parts.append(f"## {cfg['glpi']['nome']}\n" + (_glpi_ctx(data.get('glpi')) if include_glpi else "(não incluído)"))
    parts += [f"## Pendências soltas (não viraram card)\n{pend_txt}",
              f"## Lembretes e notas extras\n{notes}",
              f"## Pauta anterior\n{prev_txt}",
              "## Notas dos últimos 3 dias no vault\n" + ("\n".join("- " + p.stem for p in recent) or "- nenhuma")]
    return "\n\n".join(parts) + "\n"


# ---------- pauta ----------

def pauta_prompt():
    cfg = config.get()
    n = _nome()
    perfil = cfg["usuario"]["perfil"].strip()
    regras = [
        'Português do Brasil, tratando a pessoa por "você".',
        f"Só o que é de {n}. Trabalho de outras pessoas vai numa linha final \"Em espera / de outros\", sem virar tarefa.",
        "Não invente nada fora do contexto. Datas no formato dd/mm.",
        "Cada coisa a fazer é um checkbox `- [ ]`, curto e acionável, com o número do card/PR quando houver.",
        "Priorize: atrasados e prazos de hoje, reviews pedidas paradas, cards bloqueados que dependem da pessoa, depois o resto.",
        "Aproveite a pauta anterior: o que ficou sem marcar e ainda vale entra de novo; o que já foi feito, não.",
        "Seja enxuto: no máximo 3 itens na primeira seção e uns 12 checkboxes no total.",
    ] + [r for r in _cfg()["regras_pauta"] if str(r).strip()]
    secoes = [s for s in _cfg()["secoes_pauta"] if str(s).strip()] or ["Foco de hoje"]
    fmt = "\n".join(f"## {s}" for s in secoes)
    return (f"Você monta a pauta do dia de {n}." + (f" {perfil}" if perfil else "") + "\n\nRegras:\n"
            + "\n".join(f"- {r}" for r in regras)
            + "\n\nFormato (markdown, sem título de nível 1, sem texto antes da primeira seção):\n" + fmt
            + f"\n\nOmita uma seção se não houver nada nela, menos \"{secoes[0]}\". Uma seção de ideia, se houver, "
            "é um parágrafo curto com uma melhoria concreta apoiada nos dados do contexto.\n\nContexto:\n")


def gerar_pauta():
    md = run_claude(pauta_prompt() + context())
    md = re.sub(r"^```(?:markdown)?\s*|\s*```$", "", md.strip())
    return vault.save_pauta(md, _cfg()["modelo"])


# ---------- ideias ----------

def ideias_prompt(foco, existentes):
    cfg = config.get()
    n = _nome()
    extra = _cfg()["contexto_ideias"].strip()
    areas = ", ".join(cfg["ideias"]["areas"]) or "Geral"
    perfil = cfg["usuario"]["perfil"].strip()
    return f"""Parte do trabalho de {n} é pensar em melhorias e inovações.{(' ' + perfil) if perfil else ''} Sugira caminhos novos, concretos e viáveis para o foco abaixo.

Foco: {foco}

Regras:
- Apoie cada sugestão nos dados do contexto (números, cards, PRs, pendências) quando eles existirem; diga de onde veio a evidência.
- Prefira o que a pessoa consegue começar sozinha em poucos dias, sem depender de outras equipes.
- Não repita ideias que já estão na lista existente.
- Português do Brasil, tratando por "você".{chr(10) + '- ' + extra if extra else ''}

Responda SÓ com um JSON (sem cercas de código): uma lista de 3 a 5 objetos com as chaves
"title" (curto), "area" ({areas}), "impact" (alto/médio/baixo),
"effort" (alto/médio/baixo), "problem" (1-2 frases), "proposal" (2-3 frases), "firstStep" (1 frase acionável).

Ideias que já existem (não repetir):
{existentes}

Contexto:
"""


def gerar_ideias(foco):
    foco = " ".join(str(foco or "").split())[:300] or config.get()["ideias"]["foco_padrao"] or "melhorias gerais"
    existentes = "\n".join(f"- [{i['stage']}] {i['title']}" for i in vault.ideias()["items"]) or "- nenhuma"
    notes = "\n\n".join(f"[{n}]\n{t}" for n, t in vault.extra_notes("notas_ideias"))
    raw = run_claude(ideias_prompt(foco, existentes) + context()
                     + (f"\n## Notas de referência\n{notes}" if notes else ""))
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    m = re.search(r"\[.*\]", raw, re.S)
    items = json.loads(m.group(0) if m else raw)
    if not isinstance(items, list):
        raise RuntimeError("o Claude não devolveu uma lista")
    return vault.ideias_add(items, f"Claude ({_cfg()['modelo']}), {date.today():%d/%m}, foco: {foco}")


# ---------- jobs em segundo plano ----------

def start(name, fn, *args):
    with _jobs_lock:
        cur = jobs.get(name)
        if cur and cur["state"] == "running":
            return False
        jobs[name] = {"state": "running", "at": time.time(), "msg": ""}

    def work():
        try:
            r = fn(*args)
            msg = f"{r} ideias novas" if isinstance(r, int) else "ok"
            jobs[name] = {"state": "done", "at": time.time(), "msg": msg}
        except Exception as e:  # noqa: BLE001
            jobs[name] = {"state": "error", "at": time.time(), "msg": f"{type(e).__name__}: {e}"[:300]}

    threading.Thread(target=work, daemon=True, name=f"job-{name}").start()
    return True

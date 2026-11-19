"""Notas do vault que o hub lê e escreve: pendências soltas, ideias e a pauta do dia.

Formato pensado para continuar legível e editável no Obsidian. Toda escrita relê o arquivo,
muda só o trecho certo e grava de forma atômica.
"""
import hashlib
import re
import subprocess
import sys
import threading
from datetime import date, datetime

import glob

from . import config, paths
from .store import SourceError

_lock = threading.Lock()
STAGES = ["Ideia", "Explorando", "Proposta", "Virou card", "Descartada"]


def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.replace(path)


def _hid(*parts):
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:10]


def _ddmm(d=None):
    return (d or date.today()).strftime("%d/%m")


# ---------- pendências soltas ----------

def _tags():
    return [a["id"] for a in config.get()["areas"] if a.get("id")]


def _pend_head():
    tags = ", ".join(f"`#{t}`" for t in _tags())
    return f"""---
tipo: conhecimento
status: ativo
tags: [pendencias]
---

# Pendências soltas

Coisas pequenas que não viram card: avisar alguém, conferir algo, lembrar de um detalhe.
O hub Hangar lê e escreve aqui; editar à mão também vale (uma linha por item, {tags} para a área).

"""
_PEND = re.compile(r"^- \[( |x)\] (.+)$")


def _pend_lines():
    try:
        return paths.pendencias().read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return _pend_head().splitlines()


def pendencias():
    out = []
    for i, line in enumerate(_pend_lines()):
        m = _PEND.match(line)
        if not m:
            continue
        text = m.group(2)
        tags = [t for t in re.findall(r"#([\wÀ-ú-]+)", text)]
        since = re.search(r"\(desde (\d{2}/\d{2})\)", text)
        doneat = re.search(r"\(feito (\d{2}/\d{2})\)", text)
        clean = re.sub(r"\s*\((desde|feito) \d{2}/\d{2}\)", "", text)
        clean = re.sub(r"\s*#[\wÀ-ú-]+", "", clean).strip()
        out.append({"id": _hid(str(i), text), "line": i, "done": m.group(1) == "x", "text": clean,
                    "tags": tags, "since": since and since.group(1), "doneAt": doneat and doneat.group(1)})
    return out


def pend_add(body):
    text = " ".join(str(body.get("text", "")).split())[:300]
    if not text:
        raise ValueError("texto vazio")
    tag = body.get("tag")
    if tag in _tags() and f"#{tag}" not in text:
        text += f" #{tag}"
    with _lock:
        lines = _pend_lines()
        while lines and not lines[-1].strip():
            lines.pop()
        lines.append(f"- [ ] {text} (desde {_ddmm()})")
        _write(paths.pendencias(), "\n".join(lines) + "\n")


def pend_toggle(body):
    with _lock:
        lines = _pend_lines()
        for item in pendencias():
            if item["id"] != body.get("id"):
                continue
            line = lines[item["line"]]
            if item["done"]:
                line = re.sub(r"\s*\(feito \d{2}/\d{2}\)", "", line.replace("- [x] ", "- [ ] ", 1))
            else:
                line = line.replace("- [ ] ", "- [x] ", 1) + f" (feito {_ddmm()})"
            lines[item["line"]] = line
            _write(paths.pendencias(), "\n".join(lines) + "\n")
            return
    raise ValueError("essa pendência mudou no arquivo; recarregue")


# ---------- ideias e melhorias ----------

IDEIAS_HEAD = """---
tipo: conhecimento
status: ativo
tags: [ideias, melhorias]
---

# Ideias e melhorias

Caminhos para melhorar e inovar no trabalho.
O hub Hangar organiza por estágio; cada ideia é um `###` dentro do estágio. Mover no hub só troca a seção.

"""


def _ideias_text():
    try:
        return paths.ideias().read_text(encoding="utf-8")
    except FileNotFoundError:
        return IDEIAS_HEAD + "".join(f"## {s}\n\n" for s in STAGES)


def _parse_ideias(text):
    """Devolve (cabeçalho, {estágio: [blocos]}) onde bloco = {'title', 'body'}."""
    head, sections, cur, block = [], {s: [] for s in STAGES}, None, None
    for line in text.splitlines():
        if line.startswith("## "):
            cur, block = line[3:].strip(), None
            sections.setdefault(cur, [])
            continue
        if line.startswith("### ") and cur is not None:
            block = {"title": line[4:].strip(), "body": []}
            sections[cur].append(block)
            continue
        if block is not None:
            block["body"].append(line)
        elif cur is None:
            head.append(line)
    return "\n".join(head).rstrip() + "\n\n", sections


def _render_ideias(head, sections):
    out = [head]
    for stage, blocks in sections.items():
        out.append(f"## {stage}\n\n")
        for b in blocks:
            body = "\n".join(b["body"]).strip("\n")
            out.append(f"### {b['title']}\n{body}\n\n" if body else f"### {b['title']}\n\n")
    return "".join(out).rstrip() + "\n"


def _meta(body_lines):
    meta, rest = {}, []
    for line in body_lines:
        m = re.match(r"^- \*\*(área|impacto|esforço|origem|card)\*\*: (.+)$", line.strip())
        if m:
            meta[m.group(1)] = m.group(2).strip()
        else:
            rest.append(line)
    return meta, "\n".join(rest).strip()


def ideias():
    _, sections = _parse_ideias(_ideias_text())
    out = []
    for stage, blocks in sections.items():
        for b in blocks:
            meta, text = _meta(b["body"])
            out.append({"id": _hid(b["title"]), "stage": stage, "title": b["title"], "text": text,
                        "area": meta.get("área"), "impact": meta.get("impacto"), "effort": meta.get("esforço"),
                        "origin": meta.get("origem"), "card": meta.get("card")})
    return {"stages": list(sections.keys()), "items": out}


def _idea_block(it, origin):
    lines = []
    for key, label in (("area", "área"), ("impact", "impacto"), ("effort", "esforço")):
        if it.get(key):
            lines.append(f"- **{label}**: {it[key]}")
    lines.append(f"- **origem**: {origin}")
    lines.append("")
    for key, label in (("problem", "Problema"), ("proposal", "Proposta"), ("firstStep", "Primeiro passo")):
        if it.get(key):
            lines.append(f"**{label}:** {' '.join(str(it[key]).split())}")
            lines.append("")
    if it.get("text"):
        lines.append(str(it["text"]).strip())
    return {"title": " ".join(str(it["title"]).split())[:140], "body": lines}


def ideias_add(items, origin):
    with _lock:
        head, sections = _parse_ideias(_ideias_text())
        taken = {b["title"].lower() for bs in sections.values() for b in bs}
        added = 0
        for it in items:
            if not it.get("title") or it["title"].strip().lower() in taken:
                continue
            sections.setdefault("Ideia", []).append(_idea_block(it, origin))
            taken.add(it["title"].strip().lower())
            added += 1
        _write(paths.ideias(), _render_ideias(head, sections))
        return added


def ideia_add(body):
    if not str(body.get("title", "")).strip():
        raise ValueError("título vazio")
    return ideias_add([body], f"{config.get()['usuario']['nome'] or 'eu'}, {_ddmm()}")


def ideia_move(body):
    to = body.get("stage")
    with _lock:
        head, sections = _parse_ideias(_ideias_text())
        if to not in sections:
            raise ValueError("estágio desconhecido")
        for stage, blocks in sections.items():
            for b in blocks:
                if _hid(b["title"]) == body.get("id"):
                    blocks.remove(b)
                    sections[to].append(b)
                    _write(paths.ideias(), _render_ideias(head, sections))
                    return
    raise ValueError("essa ideia mudou no arquivo; recarregue")


# ---------- pauta do dia ----------

def pauta_path(d=None):
    return paths.conversas() / f"{(d or date.today()).isoformat()} - Pauta do dia.md"


def _strip_front(text):
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end > 0:
            return text[end + 4:].lstrip("\n")
    return text


def pauta():
    """A pauta de hoje (gerada pelo Claude) e, se houver, outras notas de pauta escritas hoje."""
    today = date.today().isoformat()
    out = {"date": today, "auto": None, "extra": []}
    f = pauta_path()
    if f.exists():
        st = f.stat()
        out["auto"] = {"name": f.stem, "markdown": _strip_front(f.read_text(encoding="utf-8")),
                       "at": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="minutes")}
    for g in sorted(paths.conversas().glob(f"{today} - *auta*.md")):
        if g != f:
            out["extra"].append({"name": g.stem, "markdown": _strip_front(g.read_text(encoding="utf-8"))})
    if not out["auto"]:
        prev = sorted(paths.conversas().glob("*- Pauta do dia.md"))
        if prev:
            out["last"] = prev[-1].stem
    return out


def pauta_toggle(body):
    """Marca/desmarca um `- [ ]` da pauta de hoje pelo índice do checkbox."""
    f = pauta_path()
    with _lock:
        if not f.exists():
            raise ValueError("ainda não há pauta hoje")
        lines, n = f.read_text(encoding="utf-8").splitlines(), -1
        for i, line in enumerate(lines):
            m = re.match(r"^(\s*- )\[( |x)\] ", line)
            if not m:
                continue
            n += 1
            if n == int(body.get("index", -1)):
                mark = " " if m.group(2) == "x" else "x"
                lines[i] = f"{m.group(1)}[{mark}] " + line[m.end():]
                _write(f, "\n".join(lines) + "\n")
                return
    raise ValueError("item da pauta não encontrado")


def save_pauta(markdown, model):
    f = pauta_path()
    today = date.today()
    front = (f"---\ntipo: conversa\ndata: {today.isoformat()}\ntags: [conversa, pauta, automatica]\n"
             f"gerada: {datetime.now().isoformat(timespec='minutes')} pelo hub Hangar ({model})\n---\n\n")
    title = f"# Pauta do dia ({_ddmm(today)})\n\n"
    body = markdown.strip()
    if body.startswith("# "):
        body = body.split("\n", 1)[1].lstrip() if "\n" in body else ""
    with _lock:
        new = not f.exists()
        _write(f, front + title + body + "\n")
        changed = [f]
        reg_path = paths.registro()
        if new and reg_path and reg_path.exists():
            reg = reg_path.read_text(encoding="utf-8").rstrip("\n")
            line = f"- [[{f.stem}]] — gerada automaticamente pelo hub Hangar"
            if line not in reg:
                _write(reg_path, reg + "\n" + line + "\n")
                changed.append(reg_path)
        _git_commit(changed, f"chore(hangar): pauta de {_ddmm(today)}")
    return f


def _git_commit(files, message):
    """Commita só esses arquivos se o vault for um repositório git. Falha não impede a gravação."""
    def run(*args):
        return subprocess.run(["git", "-C", str(paths.vault()), *args], capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=30,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    names = [str(x) for x in files]
    try:
        if run("rev-parse", "--is-inside-work-tree").returncode != 0:
            return
        run("add", "--", *names)
        if run("diff", "--cached", "--quiet", "--", *names).returncode == 0:
            return
        out = run("commit", "--only", "-m", message, "--", *names)
        if out.returncode != 0:
            print(f"Hangar: não commitei a pauta no vault: {(out.stderr or out.stdout).strip()[-200:]}", file=sys.stderr)
    except (OSError, subprocess.SubprocessError) as e:
        print(f"Hangar: não commitei a pauta no vault: {e}", file=sys.stderr)


def extra_notes(key="notas_contexto"):
    """Notas extras da configuração (globs; relativos ao vault), só o texto."""
    out, seen = [], set()
    for pattern in config.get()["claude"][key]:
        p = config.path(pattern)
        if not p.is_absolute():
            p = paths.vault() / p
        for name in sorted(glob.glob(str(p))):
            if name in seen:
                continue
            seen.add(name)
            name = paths.Path(name)
            try:
                out.append((name.stem, _strip_front(name.read_text(encoding="utf-8"))[:3500]))
            except OSError:
                continue
    return out


def read_note(path, limit=4000):
    try:
        return _strip_front(path.read_text(encoding="utf-8"))[:limit]
    except OSError:
        return ""


def require_vault():
    if not paths.vault().exists():
        raise SourceError(f"O vault não está em {paths.vault()}.")

"""Pomodoro: cada bloco de foco vira uma linha numa nota mensal do vault; as estatísticas saem dela.

Uma nota por mês (`<pasta>/AAAA-MM.md`), uma linha por bloco, legível e editável no Obsidian:

    - 2026-11-19 14:05 · 25 min · #trabalho · Revisar o PR #123
    - 2026-11-19 14:35 · 12 de 25 min · #estudo · Capítulo 3
    - 2026-11-19 15:10 · 60 min (+10) · #trabalho · Passou do tempo

"12 de 25 min" é um bloco interrompido; "60 min (+10)" é um bloco de 50 que seguiu por mais 10.
Área e texto são opcionais.
"""
import re
import threading
from collections import defaultdict
from datetime import date, datetime, timedelta

from . import config, paths
from .vault import _write

_lock = threading.Lock()
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro",
         "outubro", "novembro", "dezembro"]
_LINE = re.compile(r"^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) · (\d+)(?: de (\d+))? min(?: \(\+(\d+)\))?(?: · (.*))?$")
_TAG = re.compile(r"^#([\wÀ-ú-]+)$")


def _file(d):
    return paths.foco() / f"{d:%Y-%m}.md"


def _head(d):
    return f"""---
tipo: registro
tags: [foco, pomodoro]
---

# Foco · {MESES[d.month - 1]} de {d.year}

O hub Hangar anota aqui cada bloco de foco, uma linha por bloco. Editar à mão também vale:
`- AAAA-MM-DD HH:MM · 25 min · #area · no que foi` (`12 de 25 min` = interrompido,
`60 min (+10)` = passou 10 do tempo).

"""


def _lines(d):
    try:
        return _file(d).read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return []


def _entries(d):
    out = []
    for line in _lines(d):
        m = _LINE.match(line.strip())
        if not m:
            continue
        day, at, mins, plan, extra, rest = m.groups()
        mins, extra = int(mins), int(extra or 0)
        parts = [p.strip() for p in (rest or "").split(" · ") if p.strip()]
        area = None
        if parts and _TAG.match(parts[0]):
            area = parts.pop(0)[1:]
        out.append({"date": day, "at": at, "min": mins, "plan": int(plan) if plan else mins - extra, "extra": extra,
                    "done": plan is None or mins >= int(plan), "area": area, "text": " · ".join(parts)})
    return out


def _areas():
    return [a["id"] for a in config.get()["areas"] if a.get("id")]


def registrar(body):
    """Anota um bloco. Devolve False se já havia um bloco começando no mesmo minuto (duas abas abertas)."""
    start = datetime.fromisoformat(str(body["inicio"]))
    mins = max(1, min(240, int(body["min"])))
    plan = max(1, min(240, int(body.get("plano") or mins)))
    area = body.get("area") if body.get("area") in _areas() else None
    text = " ".join(str(body.get("tarefa") or "").split())[:200].replace(" · ", " - ")
    stamp = f"- {start:%Y-%m-%d %H:%M} ·"
    if mins > plan:  # passou do tempo e seguiu focado: conta tudo, anota o extra
        line = f"{stamp} {mins} min (+{mins - plan})"
    else:
        line = f"{stamp} {mins} min" if mins == plan else f"{stamp} {mins} de {plan} min"
    if area:
        line += f" · #{area}"
    if text:
        line += f" · {text}"
    with _lock:
        lines = _lines(start.date()) or _head(start.date()).splitlines()
        if any(x.startswith(stamp) for x in lines):
            return False
        while lines and not lines[-1].strip():
            lines.pop()
        if lines and not lines[-1].startswith("- "):
            lines.append("")
        lines.append(line)
        _write(_file(start.date()), "\n".join(lines) + "\n")
    return True


def _months_back(today, n):
    y, m = today.year, today.month
    for _ in range(n):
        yield date(y, m, 1)
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)


def stats(days=28):
    today = date.today()
    entries = [e for d in _months_back(today, 13) for e in _entries(d)]
    by_day = defaultdict(lambda: {"min": 0, "blocos": 0})
    for e in entries:
        by_day[e["date"]]["min"] += e["min"]
        by_day[e["date"]]["blocos"] += e["done"]

    serie = [{"date": (today - timedelta(days=i)).isoformat(), **by_day[(today - timedelta(days=i)).isoformat()]}
             for i in range(days - 1, -1, -1)]
    monday = today - timedelta(days=today.weekday())
    semana = sum(v["min"] for k, v in by_day.items() if monday.isoformat() <= k <= today.isoformat())

    streak, d = 0, today if by_day[today.isoformat()]["blocos"] else today - timedelta(days=1)
    while by_day[d.isoformat()]["blocos"]:
        streak, d = streak + 1, d - timedelta(days=1)

    since = (today - timedelta(days=days - 1)).isoformat()
    areas = defaultdict(int)
    for e in entries:
        if e["date"] >= since:
            areas[e["area"] or ""] += e["min"]

    hoje = [e for e in entries if e["date"] == today.isoformat()]
    return {
        "hoje": {"min": by_day[today.isoformat()]["min"], "blocos": by_day[today.isoformat()]["blocos"], "itens": hoje},
        "semana": semana,
        "sequencia": streak,
        "serie": serie,
        "areas": sorted(({"area": k or None, "min": v} for k, v in areas.items()), key=lambda x: -x["min"]),
        "arquivo": str(_file(today)),
    }

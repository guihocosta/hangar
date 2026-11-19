"""TickTick com a sessão do app desktop (caminho em ticktick.sessao na configuração).

O token nunca sai do servidor. As leituras independentes rodam em paralelo.
"""
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from . import config
from .store import SourceError

API = "https://api.ticktick.com/api/v2"


def _session():
    try:
        cfg = json.loads(config.path(config.get()["ticktick"]["sessao"]).read_text())
    except (OSError, ValueError) as e:
        raise SourceError("Não achei a sessão do app do TickTick. Abra o app e faça login.") from e
    if not cfg.get("token"):
        raise SourceError("O app do TickTick está deslogado. Faça login nele e sincronize de novo.")
    return cfg


def _headers(cfg, json_body=False):
    device = {"platform": "electron", "os": "linux", "device": "Linux x64", "name": "hangar",
              "version": "8000", "id": cfg.get("deviceId", ""), "channel": "website",
              "campaign": "", "websocket": ""}
    h = {"Cookie": "t=" + cfg["token"], "X-Device": json.dumps(device),
         "traceid": secrets.token_hex(12), "x-tz": config.get()["fuso"], "hl": "pt_BR",
         "User-Agent": "Mozilla/5.0 hangar-local"}
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def tt(method, path, body=None):
    cfg = _session()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers=_headers(cfg, body is not None))
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise SourceError("O TickTick recusou a sessão. Abra o app, confira o login e sincronize.") from e
        raise SourceError(f"O TickTick respondeu {e.code}. Tente sincronizar de novo em instantes.") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise SourceError("Sem conexão com o TickTick. Confira a internet e sincronize.") from e
    return json.loads(raw) if raw else {}


def iso(v):
    """TickTick manda +0000; o navegador lê melhor com Z."""
    return v.replace("+0000", "Z") if isinstance(v, str) else None


def tt_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000+0000")


def _open_tasks():
    d = tt("GET", "/batch/check/0")
    projects = [{"id": p["id"], "name": p["name"]} for p in d.get("projectProfiles") or []
                if not p.get("closed")]
    projects.insert(0, {"id": d.get("inboxId"), "name": "Entrada"})
    tasks = []
    for t in d.get("syncTaskBean", {}).get("update", []):
        if t.get("deleted") or t.get("status", 0) != 0:
            continue
        items = t.get("items") or []
        tasks.append({"done": False, "id": t["id"], "projectId": t["projectId"], "title": t.get("title", ""),
                      "priority": t.get("priority", 0), "tags": t.get("tags") or [],
                      "allDay": bool(t.get("isAllDay")), "start": iso(t.get("startDate")),
                      "due": iso(t.get("dueDate")), "repeat": bool(t.get("repeatFlag")),
                      "items": len(items), "itemsDone": sum(1 for i in items if i.get("status"))})
    return projects, tasks


def _completed():
    q = urllib.parse.urlencode({"from": (date.today() - timedelta(days=42)).strftime("%Y-%m-%d 00:00:00"),
                                "to": (date.today() + timedelta(days=1)).strftime("%Y-%m-%d 00:00:00"),
                                "limit": 300})
    try:
        rows = tt("GET", "/project/all/completed/?" + q)
    except SourceError:
        return []
    return [{"done": True, "id": t["id"], "projectId": t["projectId"], "title": t.get("title", ""),
             "priority": t.get("priority", 0), "tags": t.get("tags") or [],
             "allDay": bool(t.get("isAllDay")), "start": iso(t.get("startDate") or t.get("completedTime")),
             "due": iso(t.get("dueDate")), "repeat": False, "items": 0, "itemsDone": 0,
             "completedAt": iso(t.get("completedTime"))}
            for t in rows if not t.get("deleted")]


def _habits():
    try:
        raw_h = [h for h in tt("GET", "/habits") if h.get("status", 0) == 0]
        today = int(date.today().strftime("%Y%m%d"))
        ck = tt("POST", "/habitCheckins/query",
                {"habitIds": [h["id"] for h in raw_h], "afterStamp": today - 1}).get("checkins", {})
    except SourceError:
        return None
    return [{"id": h["id"], "name": h["name"], "reminder": (h.get("reminders") or [None])[0],
             "done": any(c.get("checkinStamp") == today and c.get("status") == 2 for c in ck.get(h["id"], []))}
            for h in raw_h]


def fetch():
    with ThreadPoolExecutor(3) as ex:
        f_open, f_done, f_hab = ex.submit(_open_tasks), ex.submit(_completed), ex.submit(_habits)
        projects, tasks = f_open.result()
        return {"projects": projects, "tasks": tasks + f_done.result(), "habits": f_hab.result()}


def _full_task(task_id, project_id):
    return tt("GET", f"/task/{task_id}?projectId={project_id}")


def _save_task(obj):
    r = tt("POST", "/batch/task", {"add": [], "update": [obj], "delete": []})
    err = (r or {}).get("id2error") or {}
    if err:
        raise SourceError("O TickTick não aceitou a mudança: " + json.dumps(err)[:200])


def complete_task(body):
    obj = _full_task(body["id"], body["projectId"])
    obj["status"] = 2
    obj["completedTime"] = tt_now()
    _save_task(obj)


def postpone_task(body):
    """Empurra início e prazo em N dias, mandando o objeto inteiro (update parcial apaga datas)."""
    days = int(body.get("days", 1))
    obj = _full_task(body["id"], body["projectId"])
    for k in ("startDate", "dueDate"):
        v = obj.get(k)
        if v:
            dt = datetime.strptime(v, "%Y-%m-%dT%H:%M:%S.%f%z") + timedelta(days=days)
            obj[k] = dt.strftime("%Y-%m-%dT%H:%M:%S.000+0000")
    if not obj.get("dueDate"):
        raise SourceError("Essa tarefa não tem data para empurrar.")
    _save_task(obj)


def checkin_habit(body):
    now = tt_now()
    stamp = int(date.today().strftime("%Y%m%d"))
    tt("POST", "/habitCheckins/batch", {"add": [{
        "id": secrets.token_hex(12), "habitId": body["habitId"], "checkinStamp": stamp,
        "checkinTime": now, "opTime": now, "value": 1.0, "goal": 1.0, "status": 2}],
        "update": [], "delete": []})

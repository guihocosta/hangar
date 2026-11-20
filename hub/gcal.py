"""Google Calendar pela API oficial (v3), só leitura (`calendar.readonly`).

O login é OAuth de app para computador, feito pela aba Ajustes: o Google devolve um refresh token, que
fica no hangar.env (`HANGAR_GOOGLE_REFRESH_TOKEN`). O access token dura uma hora e vive só na memória do
servidor; quando vence, sai outro do refresh token. Nada disso vai para o navegador.

A leitura traz a lista de calendários e os eventos de uma janela (uma semana para trás e
`google.dias` para frente), com as repetições já abertas pelo próprio Google (`singleEvents`).
`google.calendarios` escolhe de quais calendários; vazio = os que estão marcados no Google Agenda.
"""
import base64
import hashlib
import json
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from . import config
from .store import SourceError

AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/calendar/v3"
SCOPE = "https://www.googleapis.com/auth/calendar.readonly"

_access = {"token": "", "exp": 0.0}
_access_lock = threading.Lock()


def _post_form(url, form):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode(), method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read() or b"{}").get("error", "")
        except ValueError:
            err = ""
        if err == "invalid_grant":
            raise SourceError("O Google não aceita mais o login (revogado ou vencido). "
                              "Clique em Conectar Google Agenda nos Ajustes de novo.") from e
        raise SourceError(f"O login do Google respondeu {e.code}{': ' + err if err else ''}.") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise SourceError("Sem conexão com o Google. Confira a internet e sincronize.") from e


def _client():
    cid = config.secret("HANGAR_GOOGLE_CLIENT_ID")
    sec = config.secret("HANGAR_GOOGLE_CLIENT_SECRET")
    if not cid or not sec:
        raise SourceError("Preencha o Client ID e o Client Secret do Google em Ajustes e salve antes.")
    return cid, sec


def _token():
    with _access_lock:
        if _access["token"] and time.time() < _access["exp"] - 60:
            return _access["token"]
        refresh = config.secret("HANGAR_GOOGLE_REFRESH_TOKEN")
        if not refresh:
            raise SourceError("Google Agenda sem login: clique em Conectar Google Agenda nos Ajustes.")
        cid, sec = _client()
        r = _post_form(TOKEN, {"client_id": cid, "client_secret": sec, "refresh_token": refresh,
                               "grant_type": "refresh_token"})
        if not r.get("access_token"):
            raise SourceError("O Google não devolveu o token de acesso.")
        _access.update(token=r["access_token"], exp=time.time() + int(r.get("expires_in", 3600)))
        return _access["token"]


def _get(path, params=None):
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + _token(), "User-Agent": "hangar-local"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        if e.code == 401:
            _access["token"] = ""
            raise SourceError("O Google recusou o acesso. Sincronize de novo; se continuar, reconecte nos Ajustes.") from e
        if e.code == 403:
            raise SourceError("O Google negou a leitura da agenda (403). Confira se a Google Calendar API "
                              "está ativada no projeto do Google Cloud.") from e
        raise SourceError(f"O Google Agenda respondeu {e.code}. Tente sincronizar de novo em instantes.") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise SourceError("Sem conexão com o Google. Confira a internet e sincronize.") from e


# ---------- leitura ----------

def _when(v):
    """(início ou fim, dia inteiro?) no formato que a página entende: AAAA-MM-DD ou ISO com fuso."""
    if "date" in v:
        return v["date"], True
    return v.get("dateTime"), False


def _declined(e):
    return any(a.get("self") and a.get("responseStatus") == "declined" for a in e.get("attendees") or [])


def _event(e, cal_id):
    start, all_day = _when(e.get("start") or {})
    end, _ = _when(e.get("end") or {})
    return {"id": e["id"], "cal": cal_id, "title": e.get("summary") or "(sem título)", "allDay": all_day,
            "start": start, "end": end, "location": e.get("location") or "", "url": e.get("htmlLink") or ""}


def _events(cal_id, t0, t1):
    out, page = [], None
    path = f"/calendars/{urllib.parse.quote(cal_id, safe='')}/events"
    while True:
        params = {"timeMin": t0, "timeMax": t1, "singleEvents": "true", "orderBy": "startTime",
                  "maxResults": 250, "timeZone": config.get()["fuso"]}
        if page:
            params["pageToken"] = page
        r = _get(path, params)
        for e in r.get("items") or []:
            if e.get("status") == "cancelled" or _declined(e) or e.get("eventType") == "workingLocation":
                continue
            out.append(_event(e, cal_id))
        page = r.get("nextPageToken")
        if not page or len(out) > 2000:
            return out


def fetch():
    cfg = config.get()["google"]
    chosen = {str(c) for c in cfg["calendarios"] if str(c).strip()}
    items = []
    page = None
    while True:
        r = _get("/users/me/calendarList", {"maxResults": 250, **({"pageToken": page} if page else {})})
        items += r.get("items") or []
        page = r.get("nextPageToken")
        if not page:
            break
    cals = [{"id": c["id"], "name": c.get("summaryOverride") or c.get("summary") or c["id"],
             "primary": bool(c.get("primary")),
             "on": c["id"] in chosen if chosen else bool(c.get("selected") or c.get("primary"))}
            for c in items if not c.get("deleted")]
    cals.sort(key=lambda c: (not c["primary"], c["name"].lower()))
    now = datetime.now().astimezone()
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    t0 = (day0 - timedelta(days=7)).isoformat()
    t1 = (day0 + timedelta(days=max(1, int(cfg["dias"])) + 1)).isoformat()
    on = [c["id"] for c in cals if c["on"]]
    with ThreadPoolExecutor(6) as ex:
        lists = list(ex.map(lambda cid: _events(cid, t0, t1), on))
    events = sorted((e for ls in lists for e in ls), key=lambda e: (e["start"] or "", not e["allDay"]))
    return {"calendars": cals, "events": events}


# ---------- login OAuth (aba Ajustes) ----------

_states = {}  # state -> code_verifier (PKCE)


def redirect_uri(host):
    return f"http://{host}/oauth/google"


def authorize_url(host):
    cid, _ = _client()
    st = secrets.token_urlsafe(16)
    verifier = secrets.token_urlsafe(48)
    _states[st] = verifier
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return AUTH + "?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": redirect_uri(host), "response_type": "code", "scope": SCOPE,
        "state": st, "access_type": "offline", "prompt": "consent",
        "code_challenge": challenge, "code_challenge_method": "S256"})


def finish_login(host, code, state):
    verifier = _states.pop(state, None)
    if not verifier:
        raise SourceError("O login do Google expirou ou não começou aqui. Tente de novo pelos Ajustes.")
    cid, sec = _client()
    r = _post_form(TOKEN, {"code": code, "client_id": cid, "client_secret": sec, "redirect_uri": redirect_uri(host),
                           "grant_type": "authorization_code", "code_verifier": verifier})
    if not r.get("refresh_token"):
        raise SourceError("O Google não devolveu o refresh token. Remova o acesso do Hangar em "
                          "myaccount.google.com/permissions e conecte de novo.")
    config.save_secrets({"HANGAR_GOOGLE_REFRESH_TOKEN": r["refresh_token"]})
    with _access_lock:
        _access.update(token=r.get("access_token", ""), exp=time.time() + int(r.get("expires_in", 0)))

"""Cache das fontes: memória + snapshot em disco, servido na hora e atualizado em segundo plano.

A página nunca espera a rede para pintar: ela recebe o último snapshot (mesmo que velho) e o
servidor busca de novo em outra thread. Só a primeira leitura de todas, sem snapshot nenhum,
espera a fonte responder.
"""
import json
import threading
import time
from datetime import datetime, timezone

from . import paths


class SourceError(Exception):
    """Erro com mensagem pronta para mostrar na página."""


class Source:
    def __init__(self, name, fetch, ttl):
        self.name, self.fetch, self.ttl = name, fetch, ttl
        self.file = paths.CACHE / f"{name}.json"
        self.data, self.at, self.error = None, 0.0, None
        self._lock = threading.Lock()
        self._refreshing = threading.Event()
        try:
            snap = json.loads(self.file.read_text(encoding="utf-8"))
            self.data, self.at = snap["data"], snap["at"]
        except (OSError, ValueError, KeyError):
            pass

    def _refresh(self):
        try:
            data = self.fetch()
            with self._lock:
                self.data, self.at, self.error = data, time.time(), None
            paths.CACHE.mkdir(parents=True, exist_ok=True)
            tmp = self.file.with_suffix(".tmp")
            tmp.write_text(json.dumps({"at": self.at, "data": data}, ensure_ascii=False), encoding="utf-8", newline="\n")
            tmp.replace(self.file)
        except SourceError as e:
            self.error = str(e)
        except Exception as e:  # noqa: BLE001 - qualquer falha vira aviso na página, não 500
            self.error = f"{self.name}: {type(e).__name__}: {e}"[:300]
        finally:
            self._refreshing.clear()

    def refresh_async(self):
        if self._refreshing.is_set():
            return
        self._refreshing.set()
        threading.Thread(target=self._refresh, daemon=True, name=f"refresh-{self.name}").start()

    def refresh_now(self, timeout=60):
        if self._refreshing.is_set():
            self._wait(timeout)
            return
        self._refreshing.set()
        self._refresh()

    def _wait(self, timeout):
        end = time.time() + timeout
        while self._refreshing.is_set() and time.time() < end:
            time.sleep(0.05)

    def invalidate(self):
        self.at = 0.0

    def get(self, force=False):
        if force:
            self.refresh_now()
        elif self.data is None:
            self.refresh_now()
        elif time.time() - self.at > self.ttl:
            self.refresh_async()
        return self.payload()

    def payload(self):
        return {
            "source": self.name,
            "data": self.data,
            "fetchedAt": datetime.fromtimestamp(self.at, timezone.utc).isoformat() if self.at else None,
            "stale": time.time() - self.at > self.ttl,
            "refreshing": self._refreshing.is_set(),
            "error": self.error,
        }

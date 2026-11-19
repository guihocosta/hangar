"""Caminhos do Hangar. Os do vault saem da configuração (hub/config.py) a cada chamada."""
import os
from pathlib import Path

from . import config

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

_data = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
_state = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state"))
DATA = _data / "hangar"
CACHE = DATA / "cache"
LOG_DIR = _state / "hangar"
_LEGACY_SESSIONS = _data / "rota23" / "sessions"
SESSIONS = DATA / "sessions" if not _LEGACY_SESSIONS.exists() or (DATA / "sessions").exists() else _LEGACY_SESSIONS


def port():
    return int(config.get()["servidor"]["porta"])


def vault():
    return config.vault_root()


def pendencias():
    return config.vault_path(config.get()["vault"]["pendencias"])


def ideias():
    return config.vault_path(config.get()["vault"]["ideias"])


def conversas():
    return config.vault_path(config.get()["vault"]["conversas"])


def registro():
    return config.vault_path(config.get()["vault"]["registro"])

"""Registro das fontes com o tempo de validade de cada uma."""
from . import config, github, glpi, ticktick
from .store import Source

TICKTICK = Source("ticktick", ticktick.fetch, ttl=90)
GITHUB = Source("github", github.fetch, ttl=300)
GLPI = Source("glpi", glpi.fetch, ttl=900)
ALL = {"ticktick": TICKTICK, "github": GITHUB, "glpi": GLPI}
_SWITCH = {"ticktick": ("ticktick", "ativo"), "github": ("trabalho", "ativo"), "glpi": ("glpi", "ativo")}


def enabled():
    cfg = config.get()
    return {k: s for k, s in ALL.items() if cfg[_SWITCH[k][0]][_SWITCH[k][1]]}

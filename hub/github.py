"""GitHub pelo gh CLI, só leitura: cards atribuídos a mim (com os campos do Project) e PRs."""
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor

from . import config
from .store import SourceError

_ISSUES = """query($q:String!){search(query:$q,type:ISSUE,first:60){nodes{... on Issue{
  number title url updatedAt repository{name}
  labels(first:6){nodes{name}}
  projectItems(first:4){nodes{project{number}
    fieldValues(first:16){nodes{
      ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}}
      ... on ProjectV2ItemFieldIterationValue{title startDate duration field{... on ProjectV2IterationField{name}}}
    }}}}}}}}"""

_PRS = """query($q:String!){search(query:$q,type:ISSUE,first:40){nodes{... on PullRequest{
  number title url isDraft createdAt updatedAt author{login} repository{name}
  reviewDecision
  commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}"""


def _gql(query, q):
    try:
        out = subprocess.run(["gh", "api", "graphql", "-f", f"q={q}", "-f", f"query={query}"],
                             capture_output=True, text=True, timeout=40)
    except FileNotFoundError as e:
        raise SourceError("O gh não está instalado.") from e
    except subprocess.TimeoutExpired as e:
        raise SourceError("O GitHub demorou demais para responder.") from e
    if out.returncode != 0:
        msg = (out.stderr or "").strip().splitlines()[-1:] or ["erro desconhecido"]
        if "auth" in msg[0].lower() or "401" in msg[0]:
            raise SourceError("O gh está deslogado. Rode `gh auth login`.")
        raise SourceError("O GitHub recusou a leitura: " + msg[0][:200])
    return json.loads(out.stdout)["data"]["search"]["nodes"]


def _card(n, project):
    fields = {}
    for item in n.get("projectItems", {}).get("nodes", []):
        if project and (item.get("project") or {}).get("number") != project:
            continue
        if fields:
            break
        for f in item["fieldValues"]["nodes"]:
            if not f or not f.get("field"):
                continue
            name = f["field"].get("name")
            if "title" in f:  # iteração: vira a sprint, qualquer que seja o nome do campo
                fields["Sprint"] = f["title"]
                fields["SprintStart"] = f.get("startDate")
                fields["SprintDays"] = f.get("duration")
            else:
                fields[name] = f.get("name")
    title = n["title"]
    tag = None
    if "—" in title:
        head, title = title.split("—", 1)
        tag = head.replace("[TASK]", "").replace("[BUG]", "").strip() or None
        title = title.strip()
    return {"number": n["number"], "repo": n["repository"]["name"], "url": n["url"], "tag": tag,
            "title": title, "updatedAt": n["updatedAt"], "status": fields.get("Status"),
            "sprint": fields.get("Sprint"), "sprintStart": fields.get("SprintStart"),
            "sprintDays": fields.get("SprintDays"),
            "priority": fields.get("Priority"), "product": fields.get("Product"),
            "labels": [x["name"] for x in n.get("labels", {}).get("nodes", [])]}


def _pr(n):
    roll = ((n.get("commits") or {}).get("nodes") or [{}])[0]
    checks = (((roll.get("commit") or {}).get("statusCheckRollup")) or {}).get("state")
    return {"number": n["number"], "repo": n["repository"]["name"], "url": n["url"], "title": n["title"],
            "author": (n.get("author") or {}).get("login"), "draft": n.get("isDraft"),
            "createdAt": n["createdAt"], "updatedAt": n["updatedAt"],
            "decision": n.get("reviewDecision"), "checks": checks}


def fetch():
    cfg = config.get()["trabalho"]
    org = cfg["github_org"].strip()
    base = (f"org:{org} " if org else "") + "is:open"
    project = int(cfg["projeto"] or 0)
    with ThreadPoolExecutor(3) as ex:
        cards = ex.submit(_gql, _ISSUES, f"{base} is:issue assignee:@me")
        review = ex.submit(_gql, _PRS, f"{base} is:pr review-requested:@me")
        mine = ex.submit(_gql, _PRS, f"{base} is:pr author:@me")
        return {"cards": [_card(n, project) for n in cards.result() if n],
                "reviews": [_pr(n) for n in review.result() if n],
                "mine": [_pr(n) for n in mine.result() if n]}

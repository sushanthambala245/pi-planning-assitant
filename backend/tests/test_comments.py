from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

import app.config as config

RTE = {"X-Demo-User": "rte.presenter"}
EM = {"X-Demo-User": "em.demo"}
VIEWER = {"X-Demo-User": "viewer.demo"}


@pytest.fixture
def client(monkeypatch, tmp_path, data_dir):
    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("LLM_PROVIDER", "none")
    monkeypatch.setattr(config, "_settings", None)
    from app.main import app

    with TestClient(app) as c:
        yield c
    monkeypatch.setattr(config, "_settings", None)


@pytest.fixture
def run_id(client):
    rid = client.post("/api/runs", json={"initiative_ids": ["INI-1", "INI-2", "INI-3"]}).json()["run_id"]
    deadline = time.time() + 60
    while time.time() < deadline:
        if client.get(f"/api/runs/{rid}").json()["status"] in ("awaiting_review", "approved", "failed"):
            return rid
        time.sleep(0.2)
    raise AssertionError("run did not finish")


def post(client, rid, text="Needs a decision", initiative="INI-1", ctype="concern", headers=RTE):
    return client.post(f"/api/runs/{rid}/comments", json={"initiative_id": initiative, "type": ctype, "text": text},
                       headers=headers)


def test_the_analysis_carries_a_schedule_with_a_size_for_every_initiative(client, run_id):
    a = client.get(f"/api/runs/{run_id}/analysis").json()["analysis"]
    rows = {r["initiativeId"]: r for r in a["schedule"]["rows"]}
    assert set(rows) == {"INI-1", "INI-2", "INI-3"}
    assert all(r["size"] in ("S", "M", "L", "XL") and 1 <= r["start"] <= r["end"] for r in rows.values())
    steps = {i: s["step"] for s in a["steps"] for i in s["initiativeIds"]}
    assert all(rows[i]["start"] >= 1 for i in rows)
    # A later step never starts before an earlier one it waits for has ended.
    for r in rows.values():
        for p in r["waitsFor"]:
            assert r["start"] > rows[p]["end"] and steps[r["initiativeId"]] > steps[p]


def test_post_list_and_poll_by_revision(client, run_id):
    assert client.get(f"/api/runs/{run_id}/comments").json() == {"rev": 0, "unchanged": False, "comments": []}
    r = post(client, run_id, "  Ledger slip pushes this past the PI.  ")
    assert r.status_code == 200
    c = r.json()["comment"]
    assert c["text"] == "Ledger slip pushes this past the PI."
    # Author and role come from the server-side identity.
    assert (c["author"], c["role"], c["authorId"], c["resolved"]) == ("Presenter", "RTE", "rte.presenter", False)

    got = client.get(f"/api/runs/{run_id}/comments").json()
    assert got["rev"] == 1 and [x["id"] for x in got["comments"]] == [c["id"]]
    assert client.get(f"/api/runs/{run_id}/comments?rev=1").json() == {"rev": 1, "unchanged": True, "comments": []}
    assert client.get(f"/api/runs/{run_id}/comments?rev=0").json()["unchanged"] is False


def test_the_body_cannot_set_the_author(client, run_id):
    body = {"initiative_id": "INI-1", "type": "question", "text": "Who owns this?", "author": "Mallory", "role": "RTE"}
    c = client.post(f"/api/runs/{run_id}/comments", json=body, headers=VIEWER).json()["comment"]
    assert (c["author"], c["role"]) == ("Demo Viewer", "Viewer")
    anon = client.post(f"/api/runs/{run_id}/comments", json=body).json()["comment"]
    assert (anon["author"], anon["role"]) == ("Anonymous", "Viewer")


def test_validation(client, run_id):
    assert post(client, run_id, "x" * 1001).status_code == 422
    assert post(client, run_id, "").status_code == 422
    assert post(client, run_id, "   ").status_code == 400
    assert post(client, run_id, ctype="rant").status_code == 422
    assert post(client, run_id, initiative="INI-4").status_code == 400  # exists, but is not in this run
    assert post(client, "run-nope").status_code == 404
    assert client.get("/api/runs/run-nope/comments").status_code == 404
    assert client.get(f"/api/runs/{run_id}/comments").json()["rev"] == 0  # nothing was stored


def test_resolve_needs_the_author_or_a_reviewer(client, run_id):
    cid = post(client, run_id, headers=VIEWER).json()["comment"]["id"]
    url = f"/api/runs/{run_id}/comments/{cid}/resolve"
    other = {"X-Demo-User": "nobody"}  # anonymous viewer, not the author
    assert client.post(url, json={}, headers=other).status_code == 403
    assert client.post(url, json={}, headers=EM).status_code == 200  # a reviewer can
    c = client.get(f"/api/runs/{run_id}/comments").json()["comments"][0]
    assert c["resolved"] and c["resolvedBy"] == "Demo Engineering Manager" and c["resolvedAt"]
    assert client.post(url, json={"resolved": False}, headers=VIEWER).status_code == 200  # the author reopens
    assert client.get(f"/api/runs/{run_id}/comments").json()["comments"][0]["resolved"] is False
    assert client.post(f"/api/runs/{run_id}/comments/c-nope/resolve", json={}, headers=EM).status_code == 404


def test_comments_survive_a_restart_and_export_safely(client, run_id):
    post(client, run_id, "=HYPERLINK(\"http://evil\",\"click\")", ctype="action")
    post(client, run_id, "Fine, thanks", initiative="INI-2", ctype="decision")
    import app.main as main

    main.S.runs.runs.clear()  # as after a restart: the run is only on disk now
    assert len(client.get(f"/api/runs/{run_id}/comments").json()["comments"]) == 2
    assert post(client, run_id, "still works").status_code == 200

    r = client.get(f"/api/runs/{run_id}/comments/export")
    assert r.headers["content-type"].startswith("text/csv")
    assert "'=HYPERLINK" in r.text and "\n=HYPERLINK" not in r.text  # no formula in the spreadsheet
    assert r.text.splitlines()[0].startswith("initiative_id,initiative,type,status")
    assert "Customer returns enhancement" in r.text


def test_the_comment_limit(client, run_id, monkeypatch):
    import app.comments as comments

    monkeypatch.setattr(comments, "MAX_COMMENTS", 2)
    assert post(client, run_id).status_code == 200 and post(client, run_id).status_code == 200
    assert post(client, run_id).status_code == 409

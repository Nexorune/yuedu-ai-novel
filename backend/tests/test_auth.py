"""登录（演示码）、未登录拦截、按账号隔离数据。"""
from novel_learning import config, db

from conftest import TEST_PHONE, login


def _body(phone, **kw):
    return {"phone": phone, "code": config.DEMO_LOGIN_CODE, "agreed": True, **kw}


def test_send_code_checks_phone_format(anon_client):
    assert anon_client.post("/api/auth/code", json={"phone": "13800000000"}).json()["sent"] is True
    bad = anon_client.post("/api/auth/code", json={"phone": "12345"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "INVALID_PHONE"


def test_demo_autofill_is_explicit_and_never_cached(anon_client, monkeypatch):
    monkeypatch.setattr(config, "DEMO_LOGIN_AUTOFILL", True)
    monkeypatch.setattr(config, "DEMO_LOGIN_CODE", "123456")
    assert anon_client.get("/api/auth/me").json()["demo_autofill"] is True
    response = anon_client.post("/api/auth/code", json={"phone": TEST_PHONE, "demo_autofill": True})
    assert response.json() == {"sent": True, "cooldown": 0, "demo_code": "123456"}
    assert response.headers["cache-control"] == "no-store"
    assert anon_client.get("/api/auth/me").json()["user"] is None


def test_disabled_autofill_does_not_expose_code_or_send_from_stale_clients(anon_client, monkeypatch):
    monkeypatch.setattr(config, "DEMO_LOGIN_AUTOFILL", False)
    assert anon_client.get("/api/auth/me").json()["demo_autofill"] is False
    manual = anon_client.post("/api/auth/code", json={"phone": TEST_PHONE})
    assert manual.json() == {"sent": True, "cooldown": 60}
    automatic = anon_client.post("/api/auth/code", json={"phone": TEST_PHONE, "demo_autofill": True})
    assert automatic.status_code == 403
    assert automatic.json()["error"]["code"] == "DEMO_DISABLED"
    assert "demo_code" not in automatic.json()


def test_login_rejects_wrong_code_and_missing_consent(anon_client):
    wrong = anon_client.post("/api/auth/login", json=_body(TEST_PHONE, code="000000"))
    assert wrong.json()["error"]["code"] == "INVALID_CODE"
    no_agree = anon_client.post("/api/auth/login", json=_body(TEST_PHONE, agreed=False))
    assert no_agree.json()["error"]["code"] == "AGREEMENT_REQUIRED"
    assert anon_client.get("/api/auth/me").json()["user"] is None


def test_login_registers_once_and_masks_phone(anon_client):
    first = login(anon_client)
    assert first.status_code == 200 and first.json()["created"] is True
    assert first.json()["user"]["phone_masked"] == "138****0000"
    assert "phone" not in first.json()["user"]
    again = login(anon_client)
    assert again.json()["created"] is False
    assert anon_client.get("/api/auth/me").json()["user"]["nickname"] == "悦读用户0000"


def test_api_requires_login_and_logout_ends_session(anon_client):
    assert anon_client.get("/api/books").status_code == 401
    login(anon_client)
    assert anon_client.get("/api/books").status_code == 200
    anon_client.post("/api/auth/logout")
    assert anon_client.get("/api/books").status_code == 401


def test_users_only_see_their_own_books(anon_client, book_factory):
    mine = book_factory()
    task_id = db.create_task(mine, "outline")
    login(anon_client, "13900000000")
    assert all(book["id"] != mine for book in anon_client.get("/api/books").json()["books"])
    for path in (f"/api/books/{mine}", f"/api/books/{mine}/chapters/1",
                 f"/api/books/{mine}/recap", f"/api/tasks/{task_id}"):
        r = anon_client.get(path)
        assert r.status_code == 404, path
    assert anon_client.post(f"/api/books/{mine}/finalize").status_code == 404


def test_first_account_takes_over_existing_books():
    legacy = db.create_book("爽文", "复利", 3, 1500, 2500)   # 接入账号前的书
    first, _ = db.get_or_create_user("13700000000")
    second, _ = db.get_or_create_user("13600000000")
    assert db.get_book(legacy)["user_id"] == str(first["id"])
    later = db.create_book("爽文", "英语", 3, 1500, 2500)
    db.get_or_create_user("13500000000")
    assert db.get_book(later)["user_id"] == db.UNCLAIMED_OWNER
    assert second["id"] != first["id"]


def test_stats_count_only_my_books(client, book_factory):
    book_factory()
    book_factory(user_id="999")
    stats = client.get("/api/me/stats").json()["stats"]
    assert stats["books"] == 1


def test_login_needs_agreement_but_no_age_declaration(anon_client):
    response = anon_client.post("/api/auth/login", json=_body(TEST_PHONE))
    assert response.status_code == 200
    assert anon_client.get("/api/auth/me").json()["user"] is not None


def test_legacy_age_field_does_not_block_login(anon_client):
    response = anon_client.post("/api/auth/login", json=_body(TEST_PHONE, adult_confirmed=False))
    assert response.status_code == 200

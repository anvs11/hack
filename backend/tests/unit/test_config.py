from backend.app import config


def test_secret_value_prefers_direct_environment(monkeypatch, tmp_path) -> None:
    secret_file = tmp_path / "secret"
    secret_file.write_text("file-secret\n", encoding="utf-8")
    monkeypatch.setenv("DIRECT_SECRET", " direct-secret ")
    monkeypatch.setenv("FILE_SECRET", str(secret_file))

    assert config._secret_value("DIRECT_SECRET", "FILE_SECRET") == "direct-secret"


def test_secret_value_reads_docker_secret_file(monkeypatch, tmp_path) -> None:
    secret_file = tmp_path / "secret"
    secret_file.write_text("file-secret\n", encoding="utf-8")
    monkeypatch.delenv("DIRECT_SECRET", raising=False)
    monkeypatch.setenv("FILE_SECRET", str(secret_file))

    assert config._secret_value("DIRECT_SECRET", "FILE_SECRET") == "file-secret"


def test_secret_value_returns_none_for_missing_file(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("DIRECT_SECRET", raising=False)
    monkeypatch.setenv("FILE_SECRET", str(tmp_path / "missing"))

    assert config._secret_value("DIRECT_SECRET", "FILE_SECRET") is None

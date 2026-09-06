import pytest

from backend.app.errors import ApiError
from backend.app.modules.auth.telegram_delivery import _message_chunks


def test_message_chunks_preserve_full_report_with_safe_limits() -> None:
    content = ("Раздел отчёта\n" * 800).strip()

    chunks = _message_chunks(content)

    assert len(chunks) > 1
    assert all(0 < len(chunk) <= 3900 for chunk in chunks)
    assert "".join(chunks).replace("\n", "") == content.replace("\n", "")


def test_message_chunks_reject_empty_report() -> None:
    with pytest.raises(ApiError) as error:
        _message_chunks("  ")

    assert error.value.code == "empty_report"

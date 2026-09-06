from scripts.run_collection_worker import DEFAULT_COLLECTION_INTERVAL_SECONDS


def test_periodic_collection_defaults_to_fifteen_minutes() -> None:
    assert DEFAULT_COLLECTION_INTERVAL_SECONDS == 15 * 60

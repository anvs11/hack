# Runtime metrics smoke

## API response time

- `feed`: median 0.125092 s, p95 0.133124 s, max 0.133239 s; 30 successful, 0 failed.
- `search`: median 0.127241 s, p95 0.131711 s, max 0.135468 s; 30 successful, 0 failed.
- `filters`: median 0.123992 s, p95 0.126616 s, max 0.13482 s; 30 successful, 0 failed.

## Publication-to-collection lag

- `regulator`: median 3668027.119457 s, p95 3668027.119457 s, within orientation 0/1.
- `rss`: median 779070.36993 s, p95 4097582.007716 s, within orientation 0/243.
- `telegram`: median 306597.606022 s, p95 7395036.609293 s, within orientation 1/141.

Historical backfill is included, so collection lag is diagnostic only. This run is
also sequential and local. It does not establish a production SLA.

## Reproduce

```bash
.venv/bin/python scripts/measure_runtime_metrics.py --api-base-url http://127.0.0.1:8000 --database .local/live.sqlite3 --requests 30 --warmup 3 --output-dir data/eval/results/runtime-smoke-v1
```

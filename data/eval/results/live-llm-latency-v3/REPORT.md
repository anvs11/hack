# Live LLM plumbing smoke

- Model: `qwen/qwen3.8-flash`
- Attempted: 5
- Successful: 3
- Timed out: 0
- Failed: 2
- Mean latency, successful only: 7.433
- Median latency, successful only: 6.244
- P95 latency, successful only: 11.408
- Successful analyses within 15 seconds: 3/3
- Mean summary/input character ratio: 0.5455

This run validates wiring and runtime behavior only. `quality_claim_allowed=false`;
there are no independent human labels for factuality, category or priority.

Reproduce from the repository root:

```bash
.venv/bin/python scripts/evaluate_live_analysis.py
```

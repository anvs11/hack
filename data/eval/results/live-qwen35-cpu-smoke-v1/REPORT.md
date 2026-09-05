# Live LLM plumbing smoke

- Model: `Qwen/Qwen3.5-0.8B`
- Attempted: 1
- Successful: 0
- Timed out: 1
- Failed: 0
- Mean latency, successful only: None
- Mean summary/input character ratio: None

This run validates wiring and runtime behavior only. `quality_claim_allowed=false`;
there are no independent human labels for factuality, category or priority.

Reproduce from the repository root:

```bash
.venv/bin/python scripts/evaluate_live_analysis.py
```

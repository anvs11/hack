# Semantic dedup plumbing smoke

- Model: `Qwen/Qwen3-Embedding-0.6B`
- Pairs: 6
- Embedding time: 8.577 seconds
- Exploratory threshold: 0.789222
- Exploratory F1: 1.0
- Production threshold: not selected

The dataset is synthetic and not independently labelled. The result validates the
embedding, cosine-similarity and threshold-evaluation plumbing only; it must not be
used as a production quality claim.

Reproduce from the repository root:

```bash
.venv/bin/python scripts/evaluate_dedup.py
```

# CloudCompute Qwen live-analysis smoke v1

Дата: 2026-09-05
Quality claim: запрещён — измерена связность на одной публикации без независимой
разметки специалиста.

## Конфигурация

- provider: CloudCompute OpenAI-compatible inference;
- base URL: `https://app.cloudcompute.ru/api/v1`;
- model: `qwen/qwen3.8-flash`;
- reasoning effort: `none`;
- секрет прочитан из локального permission-restricted token file и не записан в Git.

## Результат

`POST /api/publications/publication-ca349ada4e1e4f92a3d9e113a93185bf/analyses`
вернул `201` за 13.163086 секунды и создал immutable
`analysis-d42bb1a9bd80452e9e1d7bdbc6e7f412`.

- summary: 4 предложения;
- evidence: 3 из 3 цитат найдены в исходном тексте;
- `importance_score`: 13 из 18;
- `proposed_priority`: `high`;
- `needs_review`: `true`.

Первый полный ответ был отклонён строгой проверкой недословной цитаты. Evidence-
проверка добавлена внутрь одного разрешённого retry, при этом окончательная backend-
проверка сохранена. Повторный запуск создал валидную версию.

**Вывод:** live LLM transport, structured JSON, retry, evidence grounding, scoring и
запись версии работают вместе. Один успешный пример не подтверждает качество модели
или SLA на всей выборке.

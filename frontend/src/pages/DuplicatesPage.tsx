import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../shared/api/client'
import type {
  DuplicateCandidate,
  DuplicateCandidateList,
  DuplicateReviewCreate,
  DuplicateStatus,
  DuplicateVerdict,
} from '../shared/api/types'
import { formatDate } from '../shared/format'
import { PageState } from '../shared/PageState'
import { getCurrentActorId } from '../shared/telegram/adapter'

const filters: Array<{ value: DuplicateStatus | 'all'; label: string }> = [
  { value: 'unreviewed', label: 'Ждут решения' },
  { value: 'duplicate', label: 'Дубликаты' },
  { value: 'related', label: 'Связанные' },
  { value: 'different', label: 'Разные' },
  { value: 'all', label: 'Все' },
]

export function DuplicatesPage() {
  const [filter, setFilter] = useState<DuplicateStatus | 'all'>('unreviewed')
  const [result, setResult] = useState<{
    filter: DuplicateStatus | 'all'
    items: DuplicateCandidate[]
    total: number
    error: Error | null
  } | null>(null)
  const isCurrent = result?.filter === filter
  const items = isCurrent ? result.items : null
  const error = isCurrent ? result.error : null

  useEffect(() => {
    const controller = new AbortController()
    api.listDuplicateCandidates(filter, 0, controller.signal).then(
      (response) => setResult({
        filter,
        items: response.items,
        total: response.total,
        error: null,
      }),
      (reason: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            filter,
            items: [],
            total: 0,
            error: reason instanceof Error ? reason : new Error('Неизвестная ошибка'),
          })
        }
      },
    )
    return () => controller.abort()
  }, [filter])

  function updateCandidate(candidate: DuplicateCandidate) {
    setResult((current) => {
      if (!current || current.filter !== filter) return current
      if (filter !== 'all' && candidate.status !== filter) {
        return {
          ...current,
          items: current.items.filter((item) => item.id !== candidate.id),
          total: Math.max(0, current.total - 1),
        }
      }
      return {
        ...current,
        items: current.items.map((item) => item.id === candidate.id ? candidate : item),
      }
    })
  }

  return (
    <section className="duplicates-page">
      <header className="section-heading">
        <div>
          <p className="eyebrow">Human-in-the-loop</p>
          <h1>Проверка похожих публикаций</h1>
          <p className="section-lead">
            Модель только предлагает пару. Удаление и объединение происходят не автоматически.
          </p>
        </div>
        <label className="filter-field duplicate-filter">
          <span>Статус</span>
          <select
            aria-label="Статус кандидатов"
            value={filter}
            onChange={(event) => setFilter(event.target.value as DuplicateStatus | 'all')}
          >
            {filters.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
      </header>

      {error && <PageState kind="error" title="Кандидаты не загрузились" message={error.message} />}
      {!error && items === null && (
        <PageState kind="loading" title="Загружаем пары" message="Сравниваем кандидатов." />
      )}
      {!error && items?.length === 0 && (
        <PageState kind="empty" title="Очередь пуста" message="Для этого статуса пар пока нет." />
      )}
      {items && items.length > 0 && (
        <>
          <div className="duplicate-list">
            {items.map((candidate) => (
              <DuplicateCard
                candidate={candidate}
                key={candidate.id}
                onReviewed={updateCandidate}
              />
            ))}
          </div>
          {result && items.length < result.total && (
            <LoadMoreCandidates
              filter={filter}
              offset={items.length}
              onLoaded={(response) => setResult((current) => current && current.filter === filter
                ? {
                    ...current,
                    items: [...current.items, ...response.items],
                    total: response.total,
                  }
                : current)}
            />
          )}
        </>
      )}
    </section>
  )
}

function LoadMoreCandidates({
  filter,
  offset,
  onLoaded,
}: {
  filter: DuplicateStatus | 'all'
  offset: number
  onLoaded: (response: DuplicateCandidateList) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadMore() {
    setBusy(true)
    setError('')
    try {
      onLoaded(await api.listDuplicateCandidates(filter, offset))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить пары')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="duplicate-load-more">
      <button disabled={busy} onClick={loadMore} type="button">
        {busy ? 'Загружаем…' : 'Показать ещё'}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}

function DuplicateCard({
  candidate,
  onReviewed,
}: {
  candidate: DuplicateCandidate
  onReviewed: (candidate: DuplicateCandidate) => void
}) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<DuplicateVerdict | null>(null)
  const [error, setError] = useState('')
  const left = candidate.publication.publication
  const right = candidate.candidate_publication.publication

  async function review(verdict: DuplicateVerdict) {
    setBusy(verdict)
    setError('')
    const payload = {
      verdict,
      reviewer_id: getCurrentActorId(),
      comment: comment.trim() || null,
    } satisfies DuplicateReviewCreate
    try {
      onReviewed(await api.createDuplicateReview(candidate.id, payload))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить решение')
    } finally {
      setBusy(null)
    }
  }

  return (
    <article className="duplicate-card">
      <header className="duplicate-card-heading">
        <div>
          <p className="eyebrow">Cosine similarity</p>
          <strong>{Math.round(candidate.similarity * 100)}%</strong>
        </div>
        <span className={`review-status ${candidate.status === 'unreviewed' ? 'needs-review' : 'reviewed'}`}>
          {candidate.status}
        </span>
      </header>
      <div className="duplicate-columns">
        {[left, right].map((publication) => (
          <section key={publication.id}>
            <p>{formatDate(publication.published_at)}</p>
            <h2>{publication.title}</h2>
            <p className="duplicate-snippet">{publication.content}</p>
            <Link to={`/publications/${publication.id}`}>Открыть карточку →</Link>
          </section>
        ))}
      </div>
      <label className="field-stack">
        <span>Комментарий · необязательно</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
        />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="duplicate-actions">
        <button disabled={busy !== null} onClick={() => review('duplicate')} type="button">
          {busy === 'duplicate' ? 'Сохраняем…' : 'Это дубликат'}
        </button>
        <button disabled={busy !== null} onClick={() => review('related')} type="button">
          {busy === 'related' ? 'Сохраняем…' : 'Связанные темы'}
        </button>
        <button disabled={busy !== null} onClick={() => review('different')} type="button">
          {busy === 'different' ? 'Сохраняем…' : 'Разные публикации'}
        </button>
      </div>
      <small>{candidate.model} · {candidate.reviews.length} решений в истории</small>
    </article>
  )
}

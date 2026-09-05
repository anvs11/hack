import { useState, useRef, useCallback, type FormEvent } from 'react'
import { useDialogFocus } from './useDialogFocus'
import { api } from './api/client'
import type { Source, PublicationCreate } from './api/types'
import { getCurrentActorId } from './telegram/adapter'

export function ManualPublicationDialog({
  sources,
  onCreated,
}: {
  sources: Source[]
  onCreated: (title: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const close = useCallback(() => setIsOpen(false), [])
  useDialogFocus(isOpen, dialogRef, close)
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [publishedAt, setPublishedAt] = useState(
    new Date().toISOString().slice(0, 16),
  )
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    setIsSubmitting(true)
    setError('')
    const payload: PublicationCreate = {
      source_id: sourceId,
      title: title.trim(),
      original_url: url.trim(),
      published_at: new Date(publishedAt).toISOString(),
      content: content.trim(),
      tags: [
        ...new Set(
          tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ],
      author_id: getCurrentActorId(),
    }
    try {
      const detail = await api.createPublication(payload)
      setIsOpen(false)
      onCreated(detail.publication.title)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось добавить публикацию',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <button
        className="primary-action"
        type="button"
        onClick={() => setIsOpen(true)}
      >
        Добавить публикацию
      </button>
      {isOpen && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false)
          }}
        >
          <section
            ref={dialogRef}
            className="case-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-publication-title"
          >
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">Ручной ввод</p>
                <h2 id="manual-publication-title">Новая публикация</h2>
              </div>
              <button
                type="button"
                className="dialog-close"
                onClick={() => setIsOpen(false)}
                aria-label="Закрыть диалог"
              >
                ×
              </button>
            </div>
            <form className="decision-form" onSubmit={submit}>
              <label className="form-field">
                <span>Источник</span>
                <select
                  value={sourceId}
                  required
                  onChange={(event) => setSourceId(event.target.value)}
                >
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Дата публикации</span>
                <input
                  type="datetime-local"
                  value={publishedAt}
                  required
                  onChange={(event) => setPublishedAt(event.target.value)}
                />
              </label>
              <label className="form-field form-field-wide">
                <span>Заголовок</span>
                <input
                  value={title}
                  required
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="form-field form-field-wide">
                <span>Ссылка на оригинал</span>
                <input
                  type="url"
                  value={url}
                  required
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
              <label className="form-field form-field-wide">
                <span>Текст</span>
                <textarea
                  value={content}
                  required
                  rows={7}
                  onChange={(event) => setContent(event.target.value)}
                />
              </label>
              <label className="form-field form-field-wide">
                <span>Теги через запятую</span>
                <input
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                />
              </label>
              {error && (
                <p className="form-error form-field-wide" role="alert">
                  {error}
                </p>
              )}
              <div className="dialog-actions form-field-wide">
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => setIsOpen(false)}
                >
                  Отмена
                </button>
                <button
                  className="primary-action"
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Добавляем…' : 'Добавить'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  )
}

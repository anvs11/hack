import { useEffect, useState } from 'react'

type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: null; error: Error }

export function useApiResource<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<AsyncState<T>>({
    status: 'loading',
    data: null,
    error: null,
  })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', data: null, error: null })

    load(controller.signal).then(
      (data) => setState({ status: 'success', data, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            data: null,
            error: error instanceof Error ? error : new Error('Неизвестная ошибка'),
          })
        }
      },
    )

    return () => controller.abort()
  }, [load])

  return state
}

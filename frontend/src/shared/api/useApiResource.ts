import { useEffect, useState } from 'react'

type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: null; error: Error }

export function useApiResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
): AsyncState<T> {
  const [result, setResult] = useState<{
    load: typeof load
    state: AsyncState<T>
  }>({
    load,
    state: { status: 'loading', data: null, error: null },
  })
  useEffect(() => {
    const controller = new AbortController()
    setResult({ load, state: { status: 'loading', data: null, error: null } })
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted)
          setResult({ load, state: { status: 'success', data, error: null } })
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            load,
            state: {
              status: 'error',
              data: null,
              error:
                error instanceof Error
                  ? error
                  : new Error('Неизвестная ошибка'),
            },
          })
      },
    )
    return () => controller.abort()
  }, [load])
  // Never render the preceding query's results under a newly changed URL.
  return result.load === load
    ? result.state
    : ({ status: 'loading', data: null, error: null } as const)
}

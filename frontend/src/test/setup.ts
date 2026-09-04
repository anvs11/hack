import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers } from '../mocks/handlers'

const nativeFetch = globalThis.fetch
const NativeRequest = globalThis.Request

globalThis.Request = class TestRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init?.signal ? { ...init, signal: undefined } : init)
  }
} as typeof Request

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const normalizedInput =
    typeof input === 'string' && input.startsWith('/')
      ? new URL(input, 'http://localhost').toString()
      : input
  const normalizedInit = init?.signal
    ? { ...init, signal: undefined }
    : init

  // jsdom and Node expose AbortSignal from different realms. The application
  // still tests request results; cancellation itself is outside these MSW tests.
  return nativeFetch(normalizedInput, normalizedInit)
}) as typeof fetch

export const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => {
  server.close()
  globalThis.fetch = nativeFetch
  globalThis.Request = NativeRequest
})

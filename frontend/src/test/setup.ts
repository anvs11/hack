import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers } from '../mocks/handlers'

const nativeFetch = globalThis.fetch

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const normalizedInput =
    typeof input === 'string' && input.startsWith('/')
      ? new URL(input, 'http://localhost').toString()
      : input

  return nativeFetch(normalizedInput, init)
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
})

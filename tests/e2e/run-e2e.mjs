import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const frontendRoot = path.join(repositoryRoot, 'frontend')
const pythonPath = path.join(repositoryRoot, '.venv', 'bin', 'python')
const playwrightPath = path.join(frontendRoot, 'node_modules', '.bin', 'playwright')
const configPath = path.join(frontendRoot, 'playwright.config.ts')
const host = '127.0.0.1'
const backendPort = 8000
const frontendPort = 5173
const children = []
let temporaryRoot
let cleaningUp = false

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit',
      ...options,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} завершён сигналом ${signal}`))
      else resolve(code ?? 1)
    })
  })
}

function start(command, args, options) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    ...options,
  })
  children.push(child)
  return child
}

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (error) => {
      const message = error.code === 'EADDRINUSE'
        ? `Порт ${host}:${port} уже занят. E2E не переиспользует существующие серверы.`
        : `Не удалось проверить порт ${host}:${port}: ${error.code ?? error.message}`
      reject(new Error(message))
    })
    server.listen({ host, port, exclusive: true }, () => server.close(resolve))
  })
}

async function waitForHttp(url, child, validate) {
  const deadline = Date.now() + 30_000
  let lastError = new Error(`Сервис ${url} ещё не готов`)

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Сервис ${url} завершился с кодом ${child.exitCode}`)
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok && await validate(response)) return
      lastError = new Error(`Сервис ${url} вернул HTTP ${response.status}`)
    } catch (error) {
      lastError = error instanceof Error ? error : lastError
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Сервис ${url} не запустился за 30 секунд: ${lastError.message}`)
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return

  const exited = new Promise((resolve) => child.once('exit', resolve))
  try {
    if (process.platform === 'win32') child.kill('SIGTERM')
    else process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }

  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ])
  if (stopped) return

  try {
    if (process.platform === 'win32') child.kill('SIGKILL')
    else process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
  await exited
}

async function cleanup() {
  if (cleaningUp) return
  cleaningUp = true
  await Promise.allSettled([...children].reverse().map(stopChild))
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await cleanup()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })
}

let exitCode = 1

try {
  await access(pythonPath, constants.X_OK)
  await access(playwrightPath, constants.X_OK)
  await Promise.all([assertPortAvailable(backendPort), assertPortAvailable(frontendPort)])

  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hack-b8-e2e-'))
  const databasePath = path.join(temporaryRoot, 'demo.sqlite3')
  const databaseUrl = `sqlite:///${databasePath}`

  const seedCode = await run(pythonPath, [
    path.join(repositoryRoot, 'scripts', 'seed_demo.py'),
    '--db',
    databasePath,
  ])
  if (seedCode !== 0) throw new Error(`Seed завершился с кодом ${seedCode}`)

  const backend = start(pythonPath, [
    '-m',
    'uvicorn',
    'backend.app.main:app',
    '--host',
    host,
    '--port',
    String(backendPort),
  ], {
    cwd: repositoryRoot,
    env: { ...process.env, HACK_DATABASE_URL: databaseUrl },
  })
  await waitForHttp(
    `http://${host}:${backendPort}/api/health`,
    backend,
    async (response) => JSON.stringify(await response.json()) === '{"status":"ok"}',
  )

  const frontend = start('npm', [
    'run',
    'dev',
    '--',
    '--host',
    host,
    '--port',
    String(frontendPort),
    '--strictPort',
  ], {
    cwd: frontendRoot,
    env: {
      ...process.env,
      VITE_API_BASE_URL: `http://${host}:${backendPort}`,
    },
  })
  await waitForHttp(
    `http://${host}:${frontendPort}/feed`,
    frontend,
    async (response) => (await response.text()).includes('<div id="root"></div>'),
  )

  const playwrightArgs = ['test', '--config', configPath]
  if (process.argv.includes('--headed')) playwrightArgs.push('--headed')
  exitCode = await run(playwrightPath, playwrightArgs, {
    cwd: frontendRoot,
    env: {
      ...process.env,
      NODE_PATH: [path.join(frontendRoot, 'node_modules'), process.env.NODE_PATH]
        .filter(Boolean)
        .join(path.delimiter),
      PLAYWRIGHT_E2E_TMP_DIR: temporaryRoot,
    },
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
} finally {
  await cleanup()
}

process.exitCode = exitCode

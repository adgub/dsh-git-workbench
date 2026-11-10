/**
 * Green Windows package. Listens on 127.0.0.1 only, reads workspaces.txt in the
 * package folder, and stores panel settings in data/state.json. Nothing is written
 * to the registry or to the user profile by this process.
 *
 * Dev:    node portable/server.mjs --open
 * Packed: runtime/node.exe app/server.mjs --open
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PORT = 47321
const ROUTE = '/dsh-git-workbench'
const HEALTH_NAME = 'dsh-git-workbench-portable'
const STATE_LIMIT = 512 * 1024
const here = path.dirname(fileURLToPath(import.meta.url))
const packed = existsSync(path.join(here, 'host', 'ops.js'))
const layout = packed
  ? {
      root: path.resolve(here, '..'),
      www: path.join(here, 'www'),
      clientJs: path.join(here, 'www', 'client.js'),
      hostFile: path.join(here, 'host', 'ops.js'),
    }
  : {
      root: here,
      www: path.join(here, 'www'),
      clientJs: path.resolve(here, '..', 'client.js'),
      hostFile: path.resolve(here, '..', 'host', 'ops.js'),
    }

const hostDir = path.dirname(layout.hostFile)
const { DEFAULTS } = await import(pathToFileURL(path.join(hostDir, 'constants.js')).href)
const { handleOp } = await import(pathToFileURL(layout.hostFile).href)
const openBrowser = process.argv.includes('--open')
const stateFile = path.join(layout.root, 'data', 'state.json')

useBundledGit(layout.root)

const staticFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/theme.css', 'theme.css'],
  ['/vendor/react.production.min.js', path.join('vendor', 'react.production.min.js')],
  ['/vendor/react-dom.production.min.js', path.join('vendor', 'react-dom.production.min.js')],
])

function useBundledGit(root) {
  const gitRoot = path.join(root, 'git')
  const dirs = ['cmd', 'bin', 'usr/bin', 'mingw64/bin'].map((part) => path.join(gitRoot, part))
  const cmd = dirs.find((dir) => existsSync(path.join(dir, 'git.exe')))
  if (!cmd) return
  const present = dirs.filter((dir) => existsSync(dir))
  process.env.PATH = `${present.join(path.delimiter)}${path.delimiter}${process.env.PATH || ''}`
}

function readWorkspaceFile() {
  const file = path.join(layout.root, 'workspaces.txt')
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const dirs = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    dirs.push(path.isAbsolute(trimmed) ? trimmed : path.resolve(layout.root, trimmed))
  }
  return dirs
}

function readState() {
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof value === 'string') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

function writeState(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: '状态必须是 JSON 对象' }
  }
  const out = {}
  for (const [key, value] of Object.entries(payload)) {
    if (typeof key !== 'string' || typeof value !== 'string') return { error: '状态只保存字符串' }
    if (key.length > 200 || value.length > STATE_LIMIT) return { error: '状态过大' }
    out[key] = value
  }
  const body = JSON.stringify(out)
  if (Buffer.byteLength(body) > STATE_LIMIT) return { error: '状态过大' }
  mkdirSync(path.dirname(stateFile), { recursive: true })
  const temp = `${stateFile}.${process.pid}.tmp`
  writeFileSync(temp, body)
  renameSync(temp, stateFile)
  return { ok: true }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        fail(new Error('请求体过大'))
        try { req.destroy() } catch { /* ignore */ }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('请求体必须是 JSON 对象'))
          return
        }
        resolve(parsed)
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', fail)
  })
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
  return 'application/octet-stream'
}

async function sendFile(res, filePath) {
  let body
  try {
    body = await readFile(filePath)
  } catch {
    sendJson(res, 404, { error: '找不到页面文件' })
    return
  }
  res.writeHead(200, {
    'content-type': contentType(filePath),
    'cache-control': 'no-store',
    'content-length': body.length,
  })
  res.end(body)
}

function launchBrowser(port) {
  if (process.platform !== 'win32') return
  const url = `http://127.0.0.1:${port}/`
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  })
  child.unref()
}

async function onRequest(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const pathname = url.pathname

  if (pathname === '/portable/health') {
    sendJson(res, 200, { ok: true, name: HEALTH_NAME })
    return
  }

  if (pathname === '/portable/state') {
    if (req.method === 'GET' || req.method === 'HEAD') {
      sendJson(res, 200, readState())
      return
    }
    if (req.method === 'PUT') {
      let body
      try {
        body = await readJsonBody(req, STATE_LIMIT)
      } catch (error) {
        sendJson(res, 400, { error: String((error && error.message) || error) })
        return
      }
      const saved = writeState(body)
      sendJson(res, saved.error ? 400 : 200, saved)
      return
    }
    sendJson(res, 405, { error: '只支持 GET 和 PUT' })
    return
  }

  if (pathname === '/client.js') {
    await sendFile(res, layout.clientJs)
    return
  }

  const relative = staticFiles.get(pathname)
  if (relative && (req.method === 'GET' || req.method === 'HEAD')) {
    await sendFile(res, path.join(layout.www, relative))
    return
  }

  if (pathname === ROUTE || pathname.startsWith(`${ROUTE}/`)) {
    try {
      const params = Object.fromEntries(url.searchParams.entries())
      if (req.method === 'POST') {
        let body
        try {
          body = await readJsonBody(req, 32768)
        } catch (error) {
          sendJson(res, 400, { error: String((error && error.message) || error) })
          return
        }
        Object.assign(params, body)
      } else if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: '只支持 GET 和 POST' })
        return
      }
      const op = params.op || 'status'
      const config = {
        ...DEFAULTS,
        route: ROUTE,
        portable: true,
        scanDepth: 2,
        workspaces: readWorkspaceFile(),
      }
      const result = await handleOp(op, params, { config, headers: req.headers })
      sendJson(res, result.status, result.body)
      return
    } catch (error) {
      if (!res.writableEnded) sendJson(res, 500, { error: String((error && error.message) || error) })
      return
    }
  }

  sendJson(res, 404, { error: '没有这个地址' })
}

function alreadyRunning() {
  return fetch(`http://127.0.0.1:${PORT}/portable/health`)
    .then((res) => res.ok ? res.json() : null)
    .then((body) => !!(body && body.name === HEALTH_NAME))
    .catch(() => false)
}

const server = createServer((req, res) => {
  onRequest(req, res).catch((error) => {
    if (!res.writableEnded) sendJson(res, 500, { error: String((error && error.message) || error) })
  })
})

server.on('error', async (error) => {
  if (error && error.code === 'EADDRINUSE' && await alreadyRunning()) {
    console.log(`已经在运行：http://127.0.0.1:${PORT}/`)
    if (openBrowser) launchBrowser(PORT)
    process.exit(0)
  }
  if (error && error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被其它程序占用。关掉占用它的程序后再打开。`)
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${PORT}/`)
  console.log('只监听本机。关闭这个窗口就会退出，不会留在后台，也不会写注册表。')
  if (openBrowser) launchBrowser(PORT)
})

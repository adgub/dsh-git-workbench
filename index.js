/**
 * dsh-git-workbench — Host half.
 *
 * Serves the Git API the browser half's tool window uses over one prefix route:
 * repository discovery, status, log, graph, branches, one file diff, one file
 * body, the tracked-file list, a lazy directory listing for the project tree,
 * the local Git Bash path, one commit patch, plus the local actions the panel
 * offers: switching, creating and renaming a branch, pull --ff-only, push, and
 * revealing the repository in the OS file manager.
 *
 * Repository discovery:
 * - Workspaces come from `ctx.workspaceRegistry` when the host composes it,
 *   otherwise from `$DSH_HOME/storages/workspace.json`.
 * - A workspace that is itself a Git work tree contributes one repository; a
 *   workspace that is only a parent directory contributes its Git children
 *   (depth limited by `scanDepth`, probes by `probeBudget`).
 * - A workspace the host cannot read is reported as an entry with `error`
 *   instead of disappearing, so the browser can offer the manual-path fallback.
 *
 * Safety notes:
 * - `spawn('git', args, { shell: false })` — arguments are an array, so a branch
 *   name or path can never be interpreted by a shell.
 * - `GIT_TERMINAL_PROMPT=0` so a credential prompt can never hang the route.
 * - Every op has a timeout; output is capped.
 * - Reads are open. Mutations (`switch`, `branchCreate`, `branchRename`, `pull`,
 *   `push`, `reveal`) require the panel's `x-dsh-git-workbench: 1` header, so a
 *   cross-origin page cannot trigger them. There is no add, commit, reset, or
 *   `--force` path. Pull is `--ff-only`. Push never uses `--force`.
 */
import { spawn } from 'node:child_process'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const GIT_TIMEOUT_MS = 12000
const GIT_NETWORK_TIMEOUT_MS = 60000
const MAX_STDOUT = 8 * 1024 * 1024
const MAX_FILE_PREVIEW = 200 * 1024
const MAX_LISTED_FILES = 5000
const MAX_DIR_ENTRIES = 5000
const REPO_CACHE_MS = 8000
const PROBE_BUDGET = 80
const DEFAULTS = { route: '/dsh-git-workbench', repo: '', historyLimit: 80, scanDepth: 1, workspaces: [] }
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', '.venv', 'venv',
  '.next', '.nuxt', '.output', '.turbo', '.cache', 'coverage',
])

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** Log length from config, and the graph length the panel shows beside it (1.5×, same cap). */
function viewLimits(config) {
  const historyLimit = clampInt(config && config.historyLimit, 5, 300, DEFAULTS.historyLimit)
  const graphLimit = clampInt(Math.round(historyLimit * 1.5), 5, 300, 120)
  return { historyLimit, graphLimit }
}

function normalizeRoute(value) {
  const route = typeof value === 'string' && value.startsWith('/') ? value : DEFAULTS.route
  return route.replace(/\/+$/, '')
}

/** Split a comma/semicolon/newline separated config value into trimmed paths. */
function splitPathList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
  if (typeof value !== 'string') return []
  return value.split(/[\n;,]/).map((item) => item.trim()).filter(Boolean)
}

function git(args, cwd, timeoutMs = GIT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    let child
    try {
      child = spawn('git', args, {
        cwd,
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_PAGER: 'cat',
          LC_ALL: 'C',
        },
      })
    } catch (error) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String((error && error.message) || error) })
      return
    }
    let stdout = ''
    let stderr = ''
    let bytes = 0
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      done({ ok: false, code: -1, stdout, stderr: 'timeout' })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes <= MAX_STDOUT) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 65536) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      done({ ok: false, code: -1, stdout, stderr: String((error && error.message) || error) })
    })
    child.on('close', (code) => {
      done({ ok: code === 0, code, stdout, stderr })
    })
  })
}

/**
 * Local write actions must come from the panel: the custom header forces a CORS
 * preflight for cross-origin callers, which this route never answers.
 */
function mutationAllowed(host) {
  const headers = host && host.headers
  if (!headers) return true // direct calls from the test hook
  return headers['x-dsh-git-workbench'] === '1'
}

/** Reject anything git would read as an option before asking check-ref-format. */
function branchNameCandidate(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > 200) return ''
  if (name.startsWith('-')) return ''
  if (/[\0\r\n]/.test(name)) return ''
  return name
}

/** Validate a branch name the same way `switch` does, before git sees it. */
async function acceptBranchName(repo, value) {
  const branch = branchNameCandidate(value)
  if (!branch) return { error: { status: 400, body: { error: '分支名为空或不是合法的分支名' } } }
  const check = await git(['check-ref-format', '--branch', branch], repo)
  if (!check.ok) return { error: { status: 400, body: { error: `分支名不合法：${branch}` } } }
  return { branch }
}

async function currentBranchName(repo) {
  const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)
  const name = head.ok ? head.stdout.trim() : ''
  if (!name || name === 'HEAD') return ''
  return name
}

async function localBranchExists(repo, branch) {
  const exists = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repo)
  return exists.ok
}

/**
 * Open a directory in Explorer / Finder / the desktop's file manager.
 * On Windows, `spawn('explorer.exe', { windowsHide: true })` sets SW_HIDE, so
 * the folder window never appears. `cmd /c start` hides only the console;
 * Explorer itself is a separate process and stays visible.
 */
function revealDirectory(target) {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `start "" "${String(target).replace(/"/g, '')}"`]
    : [target]
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
      child.once('error', (error) => done({ ok: false, error: String((error && error.message) || error) }))
      child.once('spawn', () => done({ ok: true }))
      child.unref()
      const timer = setTimeout(() => done({ ok: true }), 1500)
      if (timer && typeof timer.unref === 'function') timer.unref()
    } catch (error) {
      done({ ok: false, error: String((error && error.message) || error) })
    }
  })
}

/** Split an XY porcelain v2 code into the two sides that Git tracks. */
function classify(xy) {
  if (xy === '??') return { untracked: true, staged: false, unstaged: false, ignored: false }
  if (xy === '!!') return { untracked: false, staged: false, unstaged: false, ignored: true }
  const x = xy[0]
  const y = xy[1]
  return {
    untracked: false,
    ignored: false,
    staged: x !== '.' && x !== ' ',
    unstaged: y !== '.' && y !== ' ',
  }
}

function takePrefix(line, prefix) {
  return line.startsWith(prefix) ? line.slice(prefix.length).trim() : null
}

function parseStatus(out) {
  const status = { branch: null, oid: null, unborn: false, upstream: null, ahead: 0, behind: 0, files: [] }
  for (const line of out.split('\n')) {
    if (!line) continue
    const head = takePrefix(line, '# branch.head ')
    if (head !== null) {
      status.branch = head
      continue
    }
    const oid = takePrefix(line, '# branch.oid ')
    if (oid !== null) {
      status.oid = oid
      if (oid === '(initial)') status.unborn = true
      continue
    }
    const upstream = takePrefix(line, '# branch.upstream ')
    if (upstream !== null) {
      status.upstream = upstream
      continue
    }
    const aheadBehind = takePrefix(line, '# branch.ab ')
    if (aheadBehind !== null) {
      const match = aheadBehind.match(/\+(\d+)\s+-(\d+)/)
      if (match) {
        status.ahead = Number(match[1])
        status.behind = Number(match[2])
      }
      continue
    }
    let match = line.match(/^1 (\S\S) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/)
    if (match) {
      status.files.push({ path: match[8], xy: match[1], kind: 'changed', ...classify(match[1]) })
      continue
    }
    match = line.match(/^2 (\S\S) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/)
    if (match) {
      const rest = match[9]
      const tab = rest.indexOf('\t')
      status.files.push({
        path: tab === -1 ? rest : rest.slice(0, tab),
        from: tab === -1 ? '' : rest.slice(tab + 1),
        xy: match[1],
        kind: 'renamed',
        ...classify(match[1]),
      })
      continue
    }
    match = line.match(/^u (\S\S) (.*)$/)
    if (match) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const parts = match[2].split(' ')
      status.files.push({ path: parts.slice(9).join(' '), xy: match[1], kind: 'conflict', staged: true, unstaged: true })
      continue
    }
    if (line.startsWith('? ')) {
      status.files.push({ path: line.slice(2), xy: '??', kind: 'untracked', ...classify('??') })
      continue
    }
    if (line.startsWith('! ')) {
      status.files.push({ path: line.slice(2), xy: '!!', kind: 'ignored', ...classify('!!') })
    }
  }
  return status
}

/** Compact per-repository counters derived from a porcelain v2 status. */
function summarizeStatus(status) {
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const file of status.files) {
    if (file.ignored) continue
    if (file.untracked) { untracked += 1; continue }
    if (file.staged) staged += 1
    if (file.unstaged) unstaged += 1
  }
  return { staged, unstaged, untracked, files: staged + unstaged + untracked }
}

function parseLog(out) {
  return out
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, short, author, date, subject] = record.split('\x1f')
      return { sha, short, author, date, subject }
    })
}

function parseBranches(out) {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, sha, date, upstream, head] = line.split('\t')
      return { name, sha, date, upstream, current: head === '*' }
    })
}

/**
 * `git log --graph` lines look like `* | abc1234 (HEAD -> main) subject`.
 * Split the drawing prefix from the commit so the browser can colour the
 * graph and still make the row clickable.
 */
function parseGraph(out) {
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/^([^0-9a-f]*?)([0-9a-f]{4,40})(.*)$/)
      if (!match) return { graph: line, sha: null, text: '' }
      return { graph: match[1], sha: match[2], text: match[3] }
    })
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value) return null
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null
  if (normalized.split('/').includes('..')) return null
  return normalized
}

/** Case-insensitive path identity on Windows, exact elsewhere. */
function pathKey(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function samePath(a, b) {
  return pathKey(a) === pathKey(b)
}

function describeFsError(error) {
  const code = error && error.code
  if (code === 'EACCES' || code === 'EPERM') return '没有读取权限（EACCES），可以手动添加有权限的路径'
  if (code === 'ENOENT') return '目录不存在'
  if (code === 'ENOTDIR') return '不是目录'
  return String((error && error.message) || error)
}

function describeRepo(entry) {
  return { path: entry.path, name: entry.name, workspace: entry.workspace || '', manual: !!entry.manual }
}

async function probeRepo(dir) {
  const probe = await git(['rev-parse', '--show-toplevel'], dir)
  if (!probe.ok) return null
  const root = probe.stdout.trim()
  return root ? root : null
}

async function hasCommits(repo) {
  const probe = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], repo)
  return probe.ok
}

/**
 * Locate the Git for Windows Bash executable. The terminal controller only
 * accepts shells returned by its own discovery, so the browser starts the
 * default shell and runs this executable inside it.
 */
async function detectGitBash() {
  if (process.platform !== 'win32') return { gitBash: '' }
  const candidates = []
  if (typeof process.env.DSH_GIT_BASH === 'string' && process.env.DSH_GIT_BASH) {
    candidates.push(process.env.DSH_GIT_BASH)
  }
  const execPath = await git(['--exec-path'], process.cwd())
  if (execPath.ok) {
    const base = execPath.stdout.trim()
    if (base) {
      candidates.push(
        path.resolve(base, '../../../bin/bash.exe'),
        path.resolve(base, '../../bin/bash.exe'),
        path.resolve(base, '../../../usr/bin/bash.exe'),
      )
    }
  }
  candidates.push(
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs\\Git\\bin\\bash.exe'),
  )
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const info = await stat(candidate)
      if (info.isFile()) return { gitBash: candidate }
    } catch {
      /* try the next candidate */
    }
  }
  return { gitBash: '' }
}

async function resolveRepo(candidate) {
  const repo = typeof candidate === 'string' ? candidate.trim() : ''
  if (!repo) return { error: 'repo 参数为空：请填写仓库的绝对路径' }
  if (!path.isAbsolute(repo)) return { error: '仓库路径必须是绝对路径' }
  let info
  try {
    info = await stat(repo)
  } catch (error) {
    return { error: describeFsError(error) + `：${repo}` }
  }
  if (!info.isDirectory()) return { error: `不是目录：${repo}` }
  const probe = await git(['rev-parse', '--is-inside-work-tree'], repo)
  if (!probe.ok || probe.stdout.trim() !== 'true') {
    return { error: '这个目录不是 Git 工作区（找不到 .git）' }
  }
  const top = await git(['rev-parse', '--show-toplevel'], repo)
  const root = top.ok ? top.stdout.trim() : repo
  return { root: root || repo }
}

async function readUntracked(repo, relPath) {
  const full = path.join(repo, relPath)
  const buffer = await readFile(full)
  const text = buffer.subarray(0, MAX_FILE_PREVIEW).toString('utf8')
  const truncated = buffer.length > MAX_FILE_PREVIEW
  const body = text.split('\n').map((line) => `+${line}`).join('\n')
  return `# 未跟踪文件（全文预览${truncated ? '，已截断' : ''}）\n--- /dev/null\n+++ b/${relPath}\n${body}`
}

/**
 * DSH workspaces from the live registry. Returns null when this host
 * composition has no workspace service, so the caller can fall back to the
 * persisted storage document.
 */
function workspaceRecordsFromRegistry(ctx) {
  try {
    const registry = ctx && ctx.workspaceRegistry
    if (!registry || typeof registry.list !== 'function') return null
    const records = registry.list()
    if (!Array.isArray(records) || records.length === 0) return null
    return records
      .map((workspace) => ({
        id: String(workspace.id ?? ''),
        title: typeof workspace.title === 'string' ? workspace.title : '',
        path: typeof workspace.path === 'string' ? workspace.path : '',
      }))
      .filter((workspace) => workspace.path)
  } catch {
    return null
  }
}

/** Workspace records from `$DSH_HOME/storages/workspace.json` (canonical order). */
async function workspaceRecordsFromStorage() {
  try {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    const document = JSON.parse(await readFile(path.join(home, 'storages', 'workspace.json'), 'utf8'))
    const table = document && document.tables && document.tables.workspaces
    if (!table || typeof table !== 'object') return null
    const order = document.global && Array.isArray(document.global.workspaceIds)
      ? document.global.workspaceIds
      : Object.keys(table)
    const records = []
    for (const id of order) {
      const record = table[id]
      if (!record || typeof record.path !== 'string' || !record.path) continue
      records.push({ id: String(id), title: typeof record.title === 'string' ? record.title : '', path: record.path })
    }
    return records.length ? records : null
  } catch {
    return null
  }
}

async function resolveWorkspaces(ctx) {
  const registry = workspaceRecordsFromRegistry(ctx)
  if (registry) return { source: 'registry', list: registry }
  const stored = await workspaceRecordsFromStorage()
  if (stored) return { source: 'storage', list: stored }
  return { source: 'none', list: [] }
}

/**
 * Walk one workspace: the directory itself when it is a Git work tree,
 * otherwise Git children up to `depth` (never descending into a repository,
 * never entering dependency/build directories).
 */
async function findReposUnder(dir, depth, budget, out) {
  if (depth <= 0 || budget.left <= 0) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (budget.left <= 0) return
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const child = path.join(dir, entry.name)
    budget.left -= 1
    const top = await probeRepo(child)
    if (top && samePath(top, child)) {
      out.push(child)
      continue
    }
    if (depth > 1) await findReposUnder(child, depth - 1, budget, out)
  }
}

async function inspectWorkspace(workspace, scanDepth) {
  const dir = typeof workspace.path === 'string' ? workspace.path : ''
  const name = (workspace.title && String(workspace.title)) || (dir ? path.basename(dir) : '未命名工作区')
  if (!dir) return { failure: { path: '', name, workspace: name, error: '工作区没有记录路径' }, repos: [] }
  let info
  try {
    info = await stat(dir)
  } catch (error) {
    return { failure: { path: dir, name, workspace: name, error: describeFsError(error) }, repos: [] }
  }
  if (!info.isDirectory()) return { failure: { path: dir, name, workspace: name, error: '不是目录' }, repos: [] }
  try {
    await readdir(dir)
  } catch (error) {
    return { failure: { path: dir, name, workspace: name, error: describeFsError(error) }, repos: [] }
  }
  const top = await probeRepo(dir)
  if (top) return { repos: [{ path: top, name: path.basename(top), workspace: name }] }
  const found = []
  await findReposUnder(dir, Math.max(0, scanDepth), { left: PROBE_BUDGET }, found)
  return { repos: found.map((repoPath) => ({ path: repoPath, name: path.basename(repoPath), workspace: name })) }
}

const repoCache = new Map()

async function describeRepoCached(root, refresh) {
  const key = pathKey(root)
  const cached = repoCache.get(key)
  if (!refresh && cached && Date.now() - cached.at < REPO_CACHE_MS) return cached.detail
  const status = await git(['status', '--porcelain=v2', '--branch', '--untracked-files=normal'], root)
  const parsed = status.ok ? parseStatus(status.stdout) : { branch: null, unborn: false, ahead: 0, behind: 0, files: [] }
  const summary = summarizeStatus(parsed)
  const head = await git(['rev-parse', '--short', 'HEAD'], root)
  const detail = {
    path: root,
    name: path.basename(root),
    branch: parsed.branch || null,
    ahead: parsed.ahead || 0,
    behind: parsed.behind || 0,
    unborn: !!parsed.unborn,
    head: head.ok ? head.stdout.trim() : '',
    staged: summary.staged,
    unstaged: summary.unstaged,
    untracked: summary.untracked,
    changed: summary.files,
  }
  if (!status.ok) detail.error = status.stderr.trim() || 'git status 失败'
  repoCache.set(key, { at: Date.now(), detail })
  return detail
}

/**
 * Combine DSH workspaces, workspace-derived repositories and the configured
 * extra paths into one repository list. Entries that cannot be read keep their
 * `error` so the browser can show the permission problem next to them.
 */
async function discoverRepositories({ workspaces, extraPaths, scanDepth, refresh }) {
  const startedAt = Date.now()
  const found = new Map()
  const failures = []
  const workspaceSummary = []

  const inspected = await Promise.all(workspaces.map((workspace) => inspectWorkspace(workspace, scanDepth)))
  for (let index = 0; index < workspaces.length; index += 1) {
    const workspace = workspaces[index]
    const result = inspected[index]
    if (result.failure) failures.push(result.failure)
    for (const repo of result.repos) {
      const key = pathKey(repo.path)
      if (!found.has(key)) found.set(key, { ...repo, source: 'workspace' })
    }
    workspaceSummary.push({
      id: workspace.id || '',
      title: workspace.title || '',
      path: workspace.path || '',
      repos: result.repos.length,
      error: result.failure ? result.failure.error : '',
    })
  }

  for (const extra of extraPaths) {
    const resolved = await resolveRepo(extra)
    if (resolved.error) {
      failures.push({ path: extra, name: path.basename(extra), error: resolved.error })
      continue
    }
    const key = pathKey(resolved.root)
    if (!found.has(key)) found.set(key, { path: resolved.root, name: path.basename(resolved.root), workspace: '', source: 'manual', manual: true })
  }

  const described = await Promise.all([...found.values()].map(async (repo) => {
    const detail = await describeRepoCached(repo.path, refresh)
    return { ...describeRepo(repo), ...detail, source: repo.source }
  }))
  const repos = described
  for (const failure of failures) {
    repos.push({ ...failure, branch: null, changed: 0, staged: 0, unstaged: 0, untracked: 0, source: 'workspace' })
  }
  repos.sort((a, b) => {
    const aFailed = a.error ? 1 : 0
    const bFailed = b.error ? 1 : 0
    if (aFailed !== bFailed) return aFailed - bFailed
    return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN')
  })

  return {
    repos,
    workspaces: workspaceSummary,
    scanned: workspaceSummary.length,
    durationMs: Date.now() - startedAt,
  }
}

async function handleOp(op, params, host = {}) {
  const ctx = host.ctx
  const config = host.config || {}
  const defaultRepo = typeof config.repo === 'string' ? config.repo : ''

  if (op === 'gitBash') {
    return { status: 200, body: await detectGitBash() }
  }

  if (op === 'repos') {
    const gitProbe = await git(['--version'], process.cwd())
    if (!gitProbe.ok) {
      return {
        status: 500,
        body: { error: '找不到可用的 git 命令：自动检测工作区仓库需要本机安装 Git，并能在 PATH 里找到。' },
      }
    }
    const workspaces = await resolveWorkspaces(ctx)
    const extraPaths = splitPathList(config.workspaces)
    const scanDepth = clampInt(params.depth, 0, 3, clampInt(config.scanDepth, 0, 3, DEFAULTS.scanDepth))
    const discovered = await discoverRepositories({
      workspaces: workspaces.list,
      extraPaths,
      scanDepth,
      refresh: params.refresh === '1',
    })
    return {
      status: 200,
      body: {
        ...discovered,
        source: workspaces.source,
        defaultRepo,
        route: normalizeRoute(config.route),
        ...viewLimits(config),
      },
    }
  }

  if (op === 'repoInfo') {
    const resolved = await resolveRepo(params.repo)
    if (resolved.error) return { status: 400, body: { error: resolved.error } }
    const detail = await describeRepoCached(resolved.root, true)
    return { status: 200, body: { repo: resolved.root, ...detail, source: 'manual' } }
  }

  const resolved = await resolveRepo(params.repo)
  if (resolved.error) return { status: 400, body: { error: resolved.error } }
  const repo = resolved.root
  const limit = clampInt(params.limit, 5, 300, clampInt(config.historyLimit, 5, 300, DEFAULTS.historyLimit))

  if (op === 'status') {
    const result = await git(['status', '--porcelain=v2', '--branch', '--untracked-files=all'], repo)
    if (!result.ok) return { status: 500, body: { error: result.stderr || 'git status 失败' } }
    return { status: 200, body: { repo, ...parseStatus(result.stdout) } }
  }

  if (op === 'log') {
    if (!(await hasCommits(repo))) return { status: 200, body: { repo, unborn: true, commits: [] } }
    const result = await git(
      ['log', `-n${limit}`, '--date=short', '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e'],
      repo,
    )
    if (!result.ok) return { status: 500, body: { error: result.stderr || 'git log 失败' } }
    return { status: 200, body: { repo, unborn: false, commits: parseLog(result.stdout) } }
  }

  if (op === 'graph') {
    if (!(await hasCommits(repo))) return { status: 200, body: { repo, unborn: true, lines: [] } }
    const result = await git(
      ['log', '--graph', '--oneline', '--decorate=short', '--all', `-n${limit}`],
      repo,
    )
    if (!result.ok) return { status: 500, body: { error: result.stderr || 'git log --graph 失败' } }
    return { status: 200, body: { repo, unborn: false, lines: parseGraph(result.stdout) } }
  }

  if (op === 'branches') {
    const result = await git(
      // for-each-ref has no %x1f escape, so fields are separated by a literal tab
      // (ref names cannot contain control characters).
      [
        'for-each-ref',
        '--sort=-committerdate',
        '--format=%(refname:short)\t%(objectname:short)\t%(committerdate:short)\t%(upstream:short)\t%(HEAD)',
        'refs/heads',
      ],
      repo,
    )
    if (!result.ok) return { status: 500, body: { error: result.stderr || 'git for-each-ref 失败' } }
    return { status: 200, body: { repo, branches: parseBranches(result.stdout) } }
  }

  if (op === 'files') {
    const result = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], repo)
    if (!result.ok) return { status: 500, body: { error: result.stderr || 'git ls-files 失败' } }
    const all = result.stdout.split('\0').filter(Boolean)
    const truncated = all.length > MAX_LISTED_FILES
    return { status: 200, body: { repo, files: truncated ? all.slice(0, MAX_LISTED_FILES) : all, truncated } }
  }

  if (op === 'dir') {
    // Root is ''; every other path is repository-relative and validated.
    const rawPath = typeof params.path === 'string' ? params.path.trim() : ''
    const relPath = rawPath ? safeRelativePath(rawPath) : ''
    if (relPath === null) return { status: 400, body: { error: '非法目录路径' } }
    const target = relPath ? path.join(repo, relPath) : repo
    try {
      if (relPath) {
        const info = await lstat(target)
        // The tree lists symlinks as files and never follows them; reject a
        // hand-crafted request that asks for a symlinked directory directly.
        if (info.isSymbolicLink()) return { status: 400, body: { error: '不跟随符号链接目录' } }
        if (!info.isDirectory()) return { status: 400, body: { error: '不是目录' } }
      }
      const entries = await readdir(target, { withFileTypes: true })
      const all = []
      for (const entry of entries) {
        if (entry.name === '.git') continue // VCS metadata is not project content
        const childPath = relPath ? `${relPath}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          all.push({ path: childPath, name: entry.name, type: 'dir' })
        } else {
          all.push({ path: childPath, name: entry.name, type: entry.isSymbolicLink() ? 'link' : 'file' })
        }
      }
      all.sort((a, b) => {
        if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
      })
      const truncated = all.length > MAX_DIR_ENTRIES
      const listed = truncated ? all.slice(0, MAX_DIR_ENTRIES) : all
      return {
        status: 200,
        body: {
          repo,
          path: relPath,
          dirs: listed.filter((entry) => entry.type === 'dir'),
          files: listed.filter((entry) => entry.type !== 'dir'),
          truncated,
        },
      }
    } catch (error) {
      const status = error && (error.code === 'ENOENT' || error.code === 'ENOTDIR') ? 404 : 500
      return { status, body: { error: describeFsError(error) } }
    }
  }

  if (op === 'file') {
    const relPath = safeRelativePath(params.path)
    if (!relPath) return { status: 400, body: { error: '非法文件路径' } }
    let info
    try {
      info = await stat(path.join(repo, relPath))
    } catch (error) {
      return { status: 404, body: { error: describeFsError(error) } }
    }
    if (!info.isFile()) return { status: 400, body: { error: '不是文件' } }
    try {
      const buffer = await readFile(path.join(repo, relPath))
      const head = buffer.subarray(0, Math.min(buffer.length, 8000))
      if (head.includes(0)) {
        return { status: 200, body: { repo, path: relPath, binary: true, size: buffer.length, text: '' } }
      }
      const truncated = buffer.length > MAX_FILE_PREVIEW
      const text = buffer.subarray(0, MAX_FILE_PREVIEW).toString('utf8')
      return { status: 200, body: { repo, path: relPath, binary: false, size: buffer.length, truncated, text } }
    } catch (error) {
      return { status: 500, body: { error: describeFsError(error) } }
    }
  }

  if (op === 'diff') {
    const relPath = safeRelativePath(params.path)
    if (!relPath) return { status: 400, body: { error: '非法文件路径' } }
    const scope = params.scope === 'staged' ? 'staged' : params.scope === 'all' ? 'all' : 'worktree'
    const status = await git(['status', '--porcelain=v2', '--branch'], repo)
    const parsed = status.ok ? parseStatus(status.stdout) : { files: [] }
    const entry = parsed.files.find((item) => item.path === relPath)
    if (entry && entry.kind === 'untracked') {
      try {
        return { status: 200, body: { repo, path: relPath, scope: 'file', text: await readUntracked(repo, relPath) } }
      } catch (error) {
        return { status: 500, body: { error: String((error && error.message) || error) } }
      }
    }
    const unstaged = scope === 'staged'
      ? null
      : await git(['diff', '--no-color', '--no-ext-diff', '--', relPath], repo)
    const staged = scope === 'worktree'
      ? null
      : await git(['diff', '--cached', '--no-color', '--no-ext-diff', '--', relPath], repo)
    if (unstaged && !unstaged.ok && (!staged || !staged.ok)) {
      return { status: 500, body: { error: unstaged.stderr || 'git diff 失败' } }
    }
    const parts = []
    if (staged && staged.stdout.trim()) parts.push('# 已暂存\n' + staged.stdout)
    if (unstaged && unstaged.stdout.trim()) parts.push('# 未暂存\n' + unstaged.stdout)
    return { status: 200, body: { repo, path: relPath, scope, text: parts.join('\n\n') || '（没有文本差异）' } }
  }

  if (op === 'commit') {
    const rev = typeof params.rev === 'string' && /^[0-9a-fA-F]{4,40}$/.test(params.rev) ? params.rev : null
    if (!rev) return { status: 400, body: { error: '非法提交号' } }
    const result = await git(['show', '--no-color', '--no-ext-diff', '--date=short', '--stat=140', '--patch', rev], repo)
    if (!result.ok) return { status: 500, body: { error: result.stderr || 'git show 失败' } }
    return { status: 200, body: { repo, rev, text: result.stdout } }
  }

  if (op === 'switch') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '切换分支只能从 Git 面板发起' } }
    const branch = branchNameCandidate(params.branch)
    if (!branch) return { status: 400, body: { error: 'branch 参数为空或不是合法的分支名' } }
    const check = await git(['check-ref-format', '--branch', branch], repo)
    if (!check.ok) return { status: 400, body: { error: `分支名不合法：${branch}` } }
    const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)
    const previous = head.ok ? head.stdout.trim() : ''
    if (previous === branch) {
      return { status: 200, body: { repo, branch, previous, unchanged: true } }
    }
    const exists = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repo)
    if (!exists.ok) return { status: 404, body: { error: `本地没有分支 ${branch}` } }
    let result = await git(['switch', branch], repo)
    let command = 'switch'
    if (!result.ok && /not a git command|unknown option|unknown switch/i.test(result.stderr)) {
      command = 'checkout'
      result = await git(['checkout', branch], repo)
    }
    if (!result.ok) {
      const detail = String(result.stderr || '').trim() || 'git 拒绝切换分支'
      return { status: 409, body: { error: detail, repo, branch } }
    }
    // The cached repository summary still describes the old branch.
    repoCache.delete(pathKey(repo))
    return { status: 200, body: { repo, branch, previous, command } }
  }

  if (op === 'reveal') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '打开目录只能从 Git 面板发起' } }
    const target = path.resolve(repo)
    let info
    try {
      info = await stat(target)
    } catch (error) {
      return { status: 404, body: { error: describeFsError(error) } }
    }
    if (!info.isDirectory()) return { status: 400, body: { error: '项目路径不是目录' } }
    const opened = await revealDirectory(target)
    if (!opened.ok) return { status: 500, body: { error: `打不开文件管理器：${opened.error}` } }
    return { status: 200, body: { repo: target, opened: true } }
  }

  if (op === 'branchCreate') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '新建分支只能从 Git 面板发起' } }
    const accepted = await acceptBranchName(repo, params.branch)
    if (accepted.error) return accepted.error
    const branch = accepted.branch
    if (await localBranchExists(repo, branch)) {
      return { status: 409, body: { error: `本地已有分支 ${branch}`, repo, branch } }
    }
    let result = await git(['switch', '-c', branch], repo)
    let command = 'switch -c'
    if (!result.ok && /not a git command|unknown option|unknown switch/i.test(result.stderr)) {
      command = 'checkout -b'
      result = await git(['checkout', '-b', branch], repo)
    }
    if (!result.ok) {
      const detail = String(result.stderr || '').trim() || 'git 拒绝新建分支'
      return { status: 409, body: { error: detail, repo, branch } }
    }
    repoCache.delete(pathKey(repo))
    return { status: 200, body: { repo, branch, command } }
  }

  if (op === 'branchRename') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '改分支名只能从 Git 面板发起' } }
    const accepted = await acceptBranchName(repo, params.branch)
    if (accepted.error) return accepted.error
    const branch = accepted.branch
    const previous = await currentBranchName(repo)
    if (!previous) return { status: 409, body: { error: '当前不在分支上（分离 HEAD），不能改名', repo } }
    if (previous === branch) return { status: 200, body: { repo, branch, previous, unchanged: true } }
    if (await localBranchExists(repo, branch)) {
      return { status: 409, body: { error: `本地已有分支 ${branch}`, repo, branch } }
    }
    const result = await git(['branch', '-m', previous, branch], repo)
    if (!result.ok) {
      const detail = String(result.stderr || '').trim() || 'git 拒绝修改分支名'
      return { status: 409, body: { error: detail, repo, branch } }
    }
    repoCache.delete(pathKey(repo))
    return { status: 200, body: { repo, branch, previous, command: 'branch -m' } }
  }

  if (op === 'pull') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '拉取只能从 Git 面板发起' } }
    const result = await git(['pull', '--ff-only'], repo, GIT_NETWORK_TIMEOUT_MS)
    if (!result.ok) {
      const detail = String(result.stderr || result.stdout || '').trim() || 'git pull 失败'
      return { status: 409, body: { error: detail, repo } }
    }
    repoCache.delete(pathKey(repo))
    return { status: 200, body: { repo, text: String(result.stdout || '').trim() } }
  }

  if (op === 'push') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '推送只能从 Git 面板发起' } }
    const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repo)
    const hasUpstream = upstream.ok && !!upstream.stdout.trim()
    let result
    let command = 'push'
    if (hasUpstream) {
      result = await git(['push'], repo, GIT_NETWORK_TIMEOUT_MS)
    } else {
      const branch = await currentBranchName(repo)
      if (!branch) return { status: 409, body: { error: '当前不在分支上，不能推送', repo } }
      command = 'push -u origin'
      result = await git(['push', '-u', 'origin', branch], repo, GIT_NETWORK_TIMEOUT_MS)
    }
    if (!result.ok) {
      const detail = String(result.stderr || result.stdout || '').trim() || 'git push 失败'
      return { status: 409, body: { error: detail, repo } }
    }
    repoCache.delete(pathKey(repo))
    return { status: 200, body: { repo, command, text: String(result.stderr || result.stdout || '').trim() } }
  }

  return { status: 400, body: { error: `未知操作：${op}` } }
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

export const inject = ['webServer']

export function apply(ctx, config) {
  const route = normalizeRoute(config && config.route)
  const defaultRepo = (config && typeof config.repo === 'string' && config.repo) || ''
  const effective = {
    ...DEFAULTS,
    ...(config && typeof config === 'object' ? config : {}),
    route,
    repo: defaultRepo,
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: route,
        handler: async (req, res) => {
          try {
            const url = new URL(req.url || '/', 'http://127.0.0.1')
            const params = Object.fromEntries(url.searchParams.entries())
            if (!params.repo) params.repo = defaultRepo
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              sendJson(res, 405, { error: '只支持 GET' })
              return
            }
            const op = params.op || 'status'
            const result = await handleOp(op, params, { ctx, config: effective, headers: req.headers })
            sendJson(res, result.status, result.body)
          } catch (error) {
            if (!res.writableEnded) {
              sendJson(res, 500, { error: String((error && error.message) || error) })
            }
          }
        },
      }),
    'dsh-git-workbench: git api route',
  )
}

/** Test hook: lets a plain Node script exercise the op dispatcher without HTTP. */
export { handleOp, discoverRepositories, resolveWorkspaces }

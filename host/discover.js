/** Find Git repositories under DSH workspaces and describe each one. */
import { readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MAX_FILE_PREVIEW, PROBE_BUDGET, REPO_CACHE_MS, SKIP_DIRS } from './constants.js'
import { git } from './git.js'
import { parseStatus, summarizeStatus } from './parse.js'
import { describeFsError, pathKey, samePath } from './paths.js'

function describeRepo(entry) {
  return { path: entry.path, name: entry.name, workspace: entry.workspace || '', manual: !!entry.manual }
}

async function probeRepo(dir) {
  const probe = await git(['rev-parse', '--show-toplevel'], dir)
  if (!probe.ok) return null
  const root = probe.stdout.trim()
  return root ? root : null
}

export async function resolveRepo(candidate) {
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

export async function readUntracked(repo, relPath) {
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

export async function resolveWorkspaces(ctx) {
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

export async function describeRepoCached(root, refresh) {
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
export async function discoverRepositories({ workspaces, extraPaths, scanDepth, refresh }) {
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

export function invalidateRepoCache(repo) {
  repoCache.delete(pathKey(repo))
}

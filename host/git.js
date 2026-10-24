/**
 * Spawn git with an argument array (`shell: false`), one command at a time per
 * repository. A timed-out git is killed, then lock files that command left under `.git` are removed.
 */
import { spawn } from 'node:child_process'
import { lstat, readdir, readFile, stat, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { GIT_TIMEOUT_MS, MAX_STDOUT } from './constants.js'
import { pathKey } from './paths.js'

/** Drop inherited git-dir overrides so a command cannot attach to some other repository. */
function gitEnv() {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
    LC_ALL: 'C',
  }
  const blocked = new Set([
    'git_dir', 'git_work_tree', 'git_index_file', 'git_object_directory',
    'git_common_dir', 'git_prefix', 'git_namespace',
  ])
  for (const key of Object.keys(env)) {
    if (blocked.has(key.toLowerCase())) delete env[key]
  }
  return env
}

const repoChains = new Map()

/** One git at a time per repository, so parallel panel requests do not pile onto `.git`. */
function withRepoLock(repo, task) {
  const key = pathKey(repo)
  const previous = repoChains.get(key) || Promise.resolve()
  const run = previous.then(task, task)
  const tail = run.then(() => {}, () => {})
  repoChains.set(key, tail)
  tail.then(() => {
    if (repoChains.get(key) === tail) repoChains.delete(key)
  })
  return run
}

function killGitTree(child) {
  if (!child || child.pid == null) return
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.unref()
    } catch { /* the process may already be gone */ }
    return
  }
  try { child.kill('SIGKILL') } catch { /* the process may already be gone */ }
}

/**
 * After a killed git exits, remove lock files under `.git` that it created.
 * A lock still held open by another process fails to unlink and is left alone.
 * Locks older than this command are left alone too.
 */
async function releaseStaleLocks(repo, sinceMs) {
  const dotGit = path.join(repo, '.git')
  let info
  try {
    info = await lstat(dotGit)
  } catch {
    return
  }
  if (info.isSymbolicLink()) return
  if (info.isDirectory()) {
    await removeFreshLocks(dotGit, sinceMs, 0)
    return
  }
  if (!info.isFile()) return
  let text = ''
  try {
    text = await readFile(dotGit, 'utf8')
  } catch {
    return
  }
  const match = /^gitdir:\s*(.+)$/im.exec(text)
  if (!match) return
  await removeFreshLocks(path.resolve(path.dirname(dotGit), match[1].trim()), sinceMs, 0)
}

async function removeFreshLocks(dir, sinceMs, depth) {
  if (depth > 5) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const childPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Pack files are not lock files; walking them on a large repo is pure delay.
      if (depth === 0 && entry.name === 'objects') continue
      await removeFreshLocks(childPath, sinceMs, depth + 1)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.lock')) continue
    try {
      const st = await lstat(childPath)
      if (!st.isFile() || st.mtimeMs < sinceMs - 500) continue
      await unlink(childPath)
    } catch {
      /* still held, or already removed */
    }
  }
}

export function git(args, cwd, timeoutMs = GIT_TIMEOUT_MS) {
  const repo = path.resolve(cwd)
  const releaseLocks = args[0] !== '--version' && args[0] !== '--exec-path'
  return withRepoLock(repo, () => runGit(args, repo, timeoutMs, releaseLocks))
}

function runGit(args, repo, timeoutMs, releaseLocks) {
  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    let timer
    const startedAt = Date.now()
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    let child
    try {
      // Working directory is the temp dir, not the project. `-C` selects the
      // repository, and the handle on `.git` lasts only for this process.
      child = spawn('git', ['-C', repo, ...args], {
        cwd: os.tmpdir(),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: gitEnv(),
      })
    } catch (error) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String((error && error.message) || error) })
      return
    }
    let stdout = ''
    let stderr = ''
    let bytes = 0
    const finishTimeout = () => {
      const detail = stderr.trim() ? `${stderr.trim()}\ntimeout` : 'timeout'
      const done = () => finish({ ok: false, code: -1, stdout, stderr: detail })
      if (!releaseLocks) {
        done()
        return
      }
      releaseStaleLocks(repo, startedAt).then(done, done)
    }
    timer = setTimeout(() => {
      timedOut = true
      killGitTree(child)
      const force = setTimeout(finishTimeout, 2000)
      child.once('close', () => {
        clearTimeout(force)
        finishTimeout()
      })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes <= MAX_STDOUT) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 65536) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (timedOut) return
      finish({ ok: false, code: -1, stdout, stderr: String((error && error.message) || error) })
    })
    child.on('close', (code) => {
      if (timedOut) return
      finish({ ok: code === 0, code, stdout, stderr })
    })
  })
}

/**
 * Local write actions must come from the panel: the custom header forces a CORS
 * preflight for cross-origin callers, which this route never answers.
 */
export function mutationAllowed(host) {
  const headers = host && host.headers
  if (!headers) return true // direct calls from the test hook
  return headers['x-dsh-git-workbench'] === '1'
}

/** Reject anything git would read as an option before asking check-ref-format. */
export function branchNameCandidate(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > 200) return ''
  if (name.startsWith('-')) return ''
  if (/[\0\r\n]/.test(name)) return ''
  return name
}

/** Validate a branch name the same way `switch` does, before git sees it. */
export async function acceptBranchName(repo, value) {
  const branch = branchNameCandidate(value)
  if (!branch) return { error: { status: 400, body: { error: '分支名为空或不是合法的分支名' } } }
  const check = await git(['check-ref-format', '--branch', branch], repo)
  if (!check.ok) return { error: { status: 400, body: { error: `分支名不合法：${branch}` } } }
  return { branch }
}

export async function currentBranchName(repo) {
  const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)
  const name = head.ok ? head.stdout.trim() : ''
  if (name && name !== 'HEAD') return name
  // An unborn branch has no commit yet, so rev-parse refuses HEAD. symbolic-ref
  // still reports the branch name, and stays quiet when HEAD is detached.
  const symbolic = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], repo)
  const fallback = symbolic.ok ? symbolic.stdout.trim() : ''
  if (!fallback || fallback === 'HEAD') return ''
  return fallback
}

/** Stage, commit and rollback only run on the branch the panel has checked out. */
export async function requireCheckedOutBranch(repo, requested) {
  const current = await currentBranchName(repo)
  if (!current) return { error: { status: 409, body: { error: '当前不在分支上，不能操作', repo } } }
  const wanted = typeof requested === 'string' ? requested.trim() : ''
  if (!wanted || wanted.startsWith('-') || /[\0\r\n]/.test(wanted)) {
    return { error: { status: 400, body: { error: '要指定当前分支', repo, branch: current } } }
  }
  if (wanted !== current) {
    return { error: { status: 409, body: { error: `当前检出的是 ${current}，不能在 ${wanted} 上操作`, repo, branch: current } } }
  }
  return { branch: current }
}

export async function localBranchExists(repo, branch) {
  const exists = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repo)
  return exists.ok
}

/**
 * Open a directory in Explorer / Finder / the desktop's file manager.
 * On Windows, `spawn('explorer.exe', { windowsHide: true })` sets SW_HIDE, so
 * the folder window never appears. `cmd /c start` hides only the console;
 * Explorer itself is a separate process and stays visible.
 */
export function revealDirectory(target) {
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

export async function hasCommits(repo) {
  const probe = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], repo)
  return probe.ok
}

export function gitError(result, fallback) {
  return String((result && (result.stderr || result.stdout)) || '').trim() || fallback
}

export async function detectGitBash() {
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

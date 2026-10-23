/**
 * Smoke test for the host half: exercises the op dispatcher without HTTP.
 *
 * Usage: node smoke.mjs [repo-path]
 */
import { handleOp } from './index.js'

const repo = process.argv[2] || process.cwd()
const config = { route: '/dsh-git-workbench', repo: '', historyLimit: 80, scanDepth: 1, workspaces: [] }
const ctx = {} // no workspaceRegistry → the storage fallback runs

function head(body, width = 400) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return text.length > width ? `${text.slice(0, width)}…` : text
}

const gitBash = await handleOp('gitBash', {}, { ctx, config })
console.log('gitBash:', gitBash.status, head(gitBash.body.gitBash || '(not found)'))

const repos = await handleOp('repos', {}, { ctx, config })
console.log('repos:', repos.status, 'source=' + repos.body.source, 'workspaces=' + repos.body.workspaces.length)
console.log('       ', head(repos.body.repos.map((item) => `${item.name}${item.error ? ' [ERROR] ' + item.error : ' (' + (item.branch || '?') + ')'}`), 600))

const status = await handleOp('status', { repo }, { ctx, config })
console.log('status:', status.status, 'branch=' + status.body.branch, 'files=' + (status.body.files ? status.body.files.length : 0))

const first = status.body.files && status.body.files[0]
if (first) {
  const diff = await handleOp('diff', { repo, path: first.path }, { ctx, config })
  console.log('diff:', diff.status, 'bytes=' + String(diff.body.text || '').length, 'path=' + first.path)
  const file = await handleOp('file', { repo, path: first.path }, { ctx, config })
  console.log('file:', file.status, 'bytes=' + String(file.body.text || '').length, 'binary=' + file.body.binary)
} else {
  const files = await handleOp('files', { repo }, { ctx, config })
  console.log('files:', files.status, 'count=' + (files.body.files ? files.body.files.length : 0))
}

const dir = await handleOp('dir', { repo, path: '' }, { ctx, config })
console.log('dir:', dir.status, 'dirs=' + (dir.body.dirs ? dir.body.dirs.length : 0), 'files=' + (dir.body.files ? dir.body.files.length : 0))
const dirGuard = await handleOp('dir', { repo, path: '../..' }, { ctx, config })
console.log('dir guard:', dirGuard.status, head(dirGuard.body.error))

const log = await handleOp('log', { repo }, { ctx, config })
console.log('log:', log.status, 'commits=' + (log.body.commits ? log.body.commits.length : 0))
if (log.body.commits && log.body.commits[0]) {
  const commit = await handleOp('commit', { repo, rev: log.body.commits[0].sha }, { ctx, config })
  console.log('commit:', commit.status, 'bytes=' + String(commit.body.text || '').length)
}

const graph = await handleOp('graph', { repo }, { ctx, config })
console.log('graph:', graph.status, 'lines=' + (graph.body.lines ? graph.body.lines.length : 0))
const branches = await handleOp('branches', { repo }, { ctx, config })
console.log('branches:', branches.status, 'count=' + (branches.body.branches ? branches.body.branches.length : 0))

const traversal = await handleOp('diff', { repo, path: '../../etc/passwd' }, { ctx, config })
console.log('traversal guard:', traversal.status, head(traversal.body.error))
const manual = await handleOp('repoInfo', { repo }, { ctx, config })
console.log('repoInfo:', manual.status, 'name=' + manual.body.name, 'changed=' + manual.body.changed)

// Branch switching: the same branch is a no-op, unknown names are rejected and
// the custom header is required (cross-origin pages cannot call it).
const panel = { ctx, config, headers: { 'x-dsh-git-workbench': '1' } }
if (status.body.branch) {
  const same = await handleOp('switch', { repo, branch: status.body.branch }, panel)
  console.log('switch (same branch):', same.status, 'unchanged=' + same.body.unchanged)
}
const missing = await handleOp('switch', { repo, branch: 'definitely-no-such-branch-dsh' }, panel)
console.log('switch (missing branch):', missing.status, head(missing.body.error))
const option = await handleOp('switch', { repo, branch: '--force' }, panel)
console.log('switch (option guard):', option.status, head(option.body.error))
const noHeader = await handleOp('switch', { repo, branch: 'master' }, { ctx, config, headers: {} })
console.log('switch (no header):', noHeader.status, head(noHeader.body.error))
const revealGuard = await handleOp('reveal', { repo }, { ctx, config, headers: {} })
console.log('reveal (no header):', revealGuard.status, head(revealGuard.body.error))
if (status.body.branch) {
  const exists = await handleOp('branchCreate', { repo, branch: status.body.branch }, panel)
  console.log('branchCreate (exists):', exists.status, head(exists.body.error))
}
const badCreate = await handleOp('branchCreate', { repo, branch: '--force' }, panel)
console.log('branchCreate (option guard):', badCreate.status, head(badCreate.body.error))
const noHeaderCreate = await handleOp('branchCreate', { repo, branch: 'new-branch' }, { ctx, config, headers: {} })
console.log('branchCreate (no header):', noHeaderCreate.status, head(noHeaderCreate.body.error))
const badRename = await handleOp('branchRename', { repo, branch: '--force' }, panel)
console.log('branchRename (option guard):', badRename.status, head(badRename.body.error))
const noHeaderPull = await handleOp('pull', { repo }, { ctx, config, headers: {} })
console.log('pull (no header):', noHeaderPull.status, head(noHeaderPull.body.error))
const noHeaderPush = await handleOp('push', { repo }, { ctx, config, headers: {} })
console.log('push (no header):', noHeaderPush.status, head(noHeaderPush.body.error))

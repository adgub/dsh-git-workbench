/** Stage, resolve one conflict, commit, and soft-reset an unpushed tip. */
import { invalidateRepoCache } from './discover.js'
import { git, gitError, hasCommits, mutationAllowed, requireCheckedOutBranch } from './git.js'
import { safeRelativePath } from './paths.js'
import { conflictPaths, mergeInProgress } from './remote.js'

/** One path, or a `paths` array from the change-tree checkboxes. */
function collectPaths(params) {
  const raw = Array.isArray(params.paths)
    ? params.paths
    : (typeof params.path === 'string' && params.path ? [params.path] : [])
  if (!raw.length) return { error: { status: 400, body: { error: '要先选择文件' } } }
  if (raw.length > 100) return { error: { status: 400, body: { error: '一次最多选择 100 个文件' } } }
  const paths = []
  const seen = new Set()
  for (const item of raw) {
    const relPath = safeRelativePath(typeof item === 'string' ? item : '')
    if (!relPath) return { error: { status: 400, body: { error: '非法文件路径' } } }
    if (seen.has(relPath)) continue
    seen.add(relPath)
    paths.push(relPath)
  }
  return { paths }
}

async function stagedPathSet(repo) {
  const listed = await git(['diff', '--cached', '--name-only', '-z'], repo)
  if (!listed.ok) return null
  return new Set(listed.stdout.split('\0').filter(Boolean))
}

export async function handleCommitOp(op, { repo, params, host }) {
  if (op === 'takeSide') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '解决冲突只能从 Git 面板发起' } }
    const side = params.side === 'ours' ? '--ours' : params.side === 'theirs' ? '--theirs' : ''
    if (!side) return { status: 400, body: { error: 'side 只能是 ours 或 theirs' } }
    const relPath = safeRelativePath(params.path)
    if (!relPath) return { status: 400, body: { error: '非法文件路径' } }
    const onBranch = await requireCheckedOutBranch(repo, params.branch)
    if (onBranch.error) return onBranch.error
    if (!(await mergeInProgress(repo))) return { status: 409, body: { error: '当前没有进行中的合并', repo } }
    let result = await git(['checkout', side, '--', relPath], repo)
    if (!result.ok && /does not exist|did not match/i.test(result.stderr || '')) {
      result = await git(['rm', '-f', '--', relPath], repo)
    }
    if (!result.ok) return { status: 409, body: { error: gitError(result, '无法保留这一边的文件'), repo, path: relPath } }
    if (result.ok && side) {
      const added = await git(['add', '--', relPath], repo)
      if (!added.ok && !/did not match any files/i.test(added.stderr || '')) {
        return { status: 409, body: { error: gitError(added, 'git add 失败'), repo, path: relPath } }
      }
    }
    invalidateRepoCache(repo)
    return { status: 200, body: { repo, path: relPath, side: params.side } }
  }

  if (op === 'stage') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '暂存文件只能从 Git 面板发起' } }
    const listed = collectPaths(params)
    if (listed.error) return listed.error
    const onBranch = await requireCheckedOutBranch(repo, params.branch)
    if (onBranch.error) return onBranch.error
    const result = await git(['add', '--', ...listed.paths], repo)
    if (!result.ok) return { status: 409, body: { error: gitError(result, 'git add 失败'), repo, paths: listed.paths } }
    invalidateRepoCache(repo)
    return { status: 200, body: { repo, paths: listed.paths } }
  }

  if (op === 'commitCreate') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '提交只能从 Git 面板发起' } }
    const message = typeof params.message === 'string' ? params.message.replace(/\r\n/g, '\n').trim() : ''
    if (!message) return { status: 400, body: { error: '提交日志不能为空' } }
    if (message.length > 10000) return { status: 400, body: { error: '提交日志过长' } }
    const onBranch = await requireCheckedOutBranch(repo, params.branch)
    if (onBranch.error) return onBranch.error
    let paths = null
    if (Array.isArray(params.paths)) {
      const listed = collectPaths(params)
      if (listed.error) return listed.error
      paths = listed.paths
    }
    const conflicts = await conflictPaths(repo)
    if (conflicts.length) {
      return { status: 409, body: { error: `还有 ${conflicts.length} 个冲突文件，先选择用本地或用远端`, repo } }
    }
    const staged = await git(['diff', '--cached', '--quiet'], repo)
    if (staged.code !== 0 && staged.code !== 1) {
      return { status: 500, body: { error: gitError(staged, '无法检查暂存区') } }
    }
    const merging = await mergeInProgress(repo)
    if (staged.code === 0 && !merging) {
      return { status: 400, body: { error: '没有已暂存的文件' } }
    }
    if (paths) {
      const stagedNames = await stagedPathSet(repo)
      if (!stagedNames) return { status: 500, body: { error: '无法检查暂存区' } }
      const missing = paths.filter((item) => !stagedNames.has(item))
      if (missing.length) return { status: 400, body: { error: '这些文件还没 add，不能提交', paths: missing } }
      if (merging && [...stagedNames].some((item) => !paths.includes(item))) {
        return { status: 409, body: { error: '正在合并，这次提交要包含全部已暂存的文件', repo } }
      }
    }
    const args = paths ? ['commit', '-m', message, '--', ...paths] : ['commit', '-m', message]
    const result = await git(args, repo)
    if (!result.ok) return { status: 409, body: { error: gitError(result, 'git commit 失败'), repo } }
    invalidateRepoCache(repo)
    return { status: 200, body: { repo, text: String(result.stdout || '').trim() } }
  }

  if (op === 'uncommit') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '回退提交只能从 Git 面板发起' } }
    const onBranch = await requireCheckedOutBranch(repo, params.branch)
    if (onBranch.error) return onBranch.error
    const branch = onBranch.branch
    if (await mergeInProgress(repo)) return { status: 409, body: { error: '正在合并，先完成这次提交后再回退', repo } }
    if (!(await hasCommits(repo))) return { status: 409, body: { error: '没有可回退的提交', repo } }
    const parent = await git(['rev-parse', '--verify', '--quiet', 'HEAD~1'], repo)
    if (!parent.ok) return { status: 409, body: { error: '这是第一次提交，没有更早的提交可以回退', repo } }
    const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repo)
    const hasUpstream = upstream.ok && !!upstream.stdout.trim()
    if (hasUpstream) {
      const pushed = await git(['merge-base', '--is-ancestor', 'HEAD', '@{upstream}'], repo)
      if (pushed.ok) return { status: 409, body: { error: '这次提交已经推送，不能回退', repo } }
    }
    const result = await git(['reset', '--soft', 'HEAD~1'], repo)
    if (!result.ok) return { status: 409, body: { error: gitError(result, 'git reset 失败'), repo } }
    invalidateRepoCache(repo)
    return { status: 200, body: { repo, branch, parent: parent.stdout.trim(), unpushed: !hasUpstream } }
  }
  return null
}

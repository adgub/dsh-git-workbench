/** Read-only ops: status, history, trees, file text, and diffs. */
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { MAX_DIR_ENTRIES, MAX_FILE_PREVIEW, MAX_LISTED_FILES } from './constants.js'
import { readUntracked } from './discover.js'
import { git, hasCommits } from './git.js'
import { parseBranches, parseGraph, parseLog, parseStatus } from './parse.js'
import { describeFsError, safeRelativePath } from './paths.js'
import { mergeInProgress } from './remote.js'

export async function handleReadOp(op, { repo, limit, params }) {
  if (op === 'status') {
    const result = await git(['status', '--porcelain=v2', '--branch', '--untracked-files=all'], repo)
    if (!result.ok) return { status: 500, body: { error: result.stderr || 'git status 失败' } }
    const parsed = parseStatus(result.stdout)
    parsed.merging = await mergeInProgress(repo)
    return { status: 200, body: { repo, ...parsed } }
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
  return null
}

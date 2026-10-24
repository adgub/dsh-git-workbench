/** Check out, create, or rename a local branch, and open the repo folder. */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { invalidateRepoCache } from './discover.js'
import {
  acceptBranchName,
  branchNameCandidate,
  currentBranchName,
  git,
  localBranchExists,
  mutationAllowed,
  revealDirectory,
} from './git.js'
import { describeFsError } from './paths.js'

export async function handleBranchOp(op, { repo, params, host }) {
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
    invalidateRepoCache(repo)
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
    invalidateRepoCache(repo)
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
    invalidateRepoCache(repo)
    return { status: 200, body: { repo, branch, previous, command: 'branch -m' } }
  }
  return null
}

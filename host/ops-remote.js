/** Fetch, push, and merge origin without `--force`. */
import { GIT_NETWORK_TIMEOUT_MS } from './constants.js'
import { invalidateRepoCache } from './discover.js'
import { acceptBranchName, branchNameCandidate, currentBranchName, git, gitError, mutationAllowed } from './git.js'
import {
  classifyAgainstOrigin,
  conflictPaths,
  describeOrigin,
  mergeInProgress,
  originBranches,
  originUrl,
  remoteUrlCandidate,
} from './remote.js'

export async function handleRemoteOp(op, { repo, params, host }) {
  if (op === 'pull') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '拉取只能从 Git 面板发起' } }
    const result = await git(['pull', '--ff-only'], repo, GIT_NETWORK_TIMEOUT_MS)
    if (!result.ok) {
      const detail = String(result.stderr || result.stdout || '').trim() || 'git pull 失败'
      return { status: 409, body: { error: detail, repo } }
    }
    invalidateRepoCache(repo)
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
    invalidateRepoCache(repo)
    return { status: 200, body: { repo, command, text: String(result.stderr || result.stdout || '').trim() } }
  }

  if (op === 'remote') {
    const url = await originUrl(repo)
    return { status: 200, body: { repo, origin: url || null } }
  }

  if (op === 'remotePlan') {
    const requested = branchNameCandidate(params.branch)
    if (!requested) return { status: 400, body: { error: '要先选择远端分支' } }
    const accepted = await acceptBranchName(repo, requested)
    if (accepted.error) return accepted.error
    const names = await originBranches(repo)
    if (!names.includes(accepted.branch)) {
      return { status: 404, body: { error: `远端没有分支 ${accepted.branch}`, branches: names } }
    }
    const classified = await classifyAgainstOrigin(repo, accepted.branch)
    return { status: 200, body: { repo, ...classified, branches: names, origin: (await originUrl(repo)) || null } }
  }

  if (op === 'remoteBind') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '绑定仓库只能从 Git 面板发起' } }
    const url = remoteUrlCandidate(params.url)
    if (!url) return { status: 400, body: { error: '仓库地址无效。使用 https://、http://、ssh:// 或 git@host:path' } }
    const replace = params.replace === '1' || params.replace === true
    const current = await originUrl(repo)
    let command = 'unchanged'
    if (current && current !== url && !replace) {
      return { status: 409, body: { error: '已经绑定了 origin', origin: current, repo } }
    }
    if (!current) {
      const added = await git(['remote', 'add', 'origin', url], repo)
      if (!added.ok) return { status: 409, body: { error: gitError(added, 'git remote add 失败'), repo } }
      command = 'add'
    } else if (current !== url) {
      const updated = await git(['remote', 'set-url', 'origin', url], repo)
      if (!updated.ok) return { status: 409, body: { error: gitError(updated, 'git remote set-url 失败'), repo } }
      command = 'set-url'
    }
    const fetched = await git(['fetch', 'origin'], repo, GIT_NETWORK_TIMEOUT_MS)
    if (!fetched.ok) {
      invalidateRepoCache(repo)
      return { status: 409, body: { error: gitError(fetched, 'git fetch 失败'), origin: url, command, repo } }
    }
    const described = await describeOrigin(repo, true)
    invalidateRepoCache(repo)
    return {
      status: 200,
      body: {
        repo,
        origin: url,
        command,
        ...described,
        text: String(fetched.stderr || fetched.stdout || '').trim(),
      },
    }
  }

  if (op === 'integrate') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '合并只能从 Git 面板发起' } }
    if (await mergeInProgress(repo)) {
      return { status: 409, body: { error: '已经有一次合并还没完成。先处理冲突并提交，或在变更树里选择保留哪一边。', repo } }
    }
    const requested = branchNameCandidate(params.branch)
    if (!requested) return { status: 400, body: { error: '要先选择远端分支' } }
    const accepted = await acceptBranchName(repo, requested)
    if (accepted.error) return accepted.error
    const branch = accepted.branch
    const names = await originBranches(repo)
    if (!names.includes(branch)) return { status: 404, body: { error: `远端没有分支 ${branch}`, repo } }
    const classified = await classifyAgainstOrigin(repo, branch)
    if (classified.relation === 'push' || classified.relation === 'same' || classified.relation === 'empty') {
      return { status: 200, body: { repo, ...classified, branches: names, merged: false, pending: false, conflicts: [], hint: 'push' } }
    }
    let result
    if (classified.relation === 'ff') {
      result = await git(['merge', '--ff-only', classified.remoteRef], repo, GIT_NETWORK_TIMEOUT_MS)
    } else if (classified.relation === 'local-unborn') {
      const staged = await git(['diff', '--cached', '--quiet'], repo)
      if (staged.code === 1) {
        return { status: 409, body: { error: '本地还有已暂存、尚未提交的文件。先提交一次，再合并远端。', repo, ...classified } }
      }
      const localBranch = await currentBranchName(repo)
      if (!localBranch) return { status: 409, body: { error: '当前不在分支上，不能取下远端历史', repo } }
      result = await git(['checkout', '-B', localBranch, classified.remoteRef], repo, GIT_NETWORK_TIMEOUT_MS)
    } else if (classified.relation === 'merge') {
      result = await git(['merge', '--no-commit', classified.remoteRef], repo, GIT_NETWORK_TIMEOUT_MS)
    } else if (classified.relation === 'unrelated') {
      result = await git(['merge', '--allow-unrelated-histories', '--no-commit', classified.remoteRef], repo, GIT_NETWORK_TIMEOUT_MS)
    } else {
      return { status: 409, body: { error: '还不能合并这个远端分支', repo, ...classified } }
    }
    const conflicts = await conflictPaths(repo)
    const pending = await mergeInProgress(repo)
    invalidateRepoCache(repo)
    if (!result.ok && conflicts.length === 0 && !pending) {
      return { status: 409, body: { error: gitError(result, 'git merge 失败'), repo, ...classified } }
    }
    return {
      status: 200,
      body: {
        repo,
        ...classified,
        branches: names,
        merged: result.ok && !pending,
        pending,
        conflicts,
        text: String((result && (result.stdout || result.stderr)) || '').trim(),
      },
    }
  }
  return null
}

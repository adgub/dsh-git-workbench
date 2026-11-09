/** Merge a local branch into HEAD, abort it, and read both sides of a conflict. */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { GIT_NETWORK_TIMEOUT_MS, MAX_FILE_PREVIEW } from './constants.js'
import { invalidateRepoCache } from './discover.js'
import {
  acceptBranchName,
  branchNameCandidate,
  currentBranchName,
  git,
  gitError,
  hasCommits,
  localBranchExists,
  mutationAllowed,
  requireCheckedOutBranch,
} from './git.js'
import { describeFsError, safeRelativePath } from './paths.js'
import { classifyAgainstOrigin, conflictPaths, mergeInProgress, originBranches } from './remote.js'

async function readTip(repo, rev) {
  const result = await git(['log', '-1', '--format=%H%x1f%h%x1f%s', rev], repo)
  if (!result.ok) return null
  const line = String(result.stdout || '').split('\n')[0]
  const [sha, short, subject] = line.split('\x1f')
  if (!sha) return null
  return { sha, short: short || sha.slice(0, 7), subject: subject || '' }
}

async function oursSide(repo) {
  const branch = await currentBranchName(repo)
  const tip = await readTip(repo, 'HEAD')
  if (!tip) return { branch, sha: '', short: '', subject: '还没有任何提交' }
  return { branch, ...tip }
}

/** Prefer the branch the panel asked for when it still points at this commit. */
async function branchPointingAt(repo, rev, prefer) {
  const tip = await git(['rev-parse', '-q', '--verify', rev], repo)
  const oid = tip.ok ? tip.stdout.trim() : ''
  const wanted = branchNameCandidate(prefer)
  if (wanted && oid) {
    const local = await git(['rev-parse', '-q', '--verify', `refs/heads/${wanted}`], repo)
    if (local.ok && local.stdout.trim() === oid) return wanted
    const remote = await git(['rev-parse', '-q', '--verify', `refs/remotes/origin/${wanted}`], repo)
    if (remote.ok && remote.stdout.trim() === oid) return wanted
  }
  const listed = await git(['for-each-ref', '--points-at', rev, '--format=%(refname:short)', 'refs/heads'], repo)
  const names = listed.ok ? listed.stdout.split('\n').map((item) => item.trim()).filter((item) => item && item !== 'HEAD') : []
  const current = await currentBranchName(repo)
  return names.find((item) => item !== current) || names[0] || ''
}

async function theirsSide(repo, ref, branch) {
  const tip = await readTip(repo, ref)
  const name = branch || await branchPointingAt(repo, ref, '')
  if (!tip) return { branch: name, sha: '', short: '', subject: '没有这次提交' }
  return { branch: name, ...tip }
}

/** How HEAD relates to a local or remote-tracking ref. `contained` means nothing to merge. */
async function classifyRef(repo, ref) {
  const other = await git(['rev-parse', '--verify', '--quiet', ref], repo)
  const local = await hasCommits(repo)
  if (!other.ok || !other.stdout.trim()) return { relation: 'missing' }
  if (!local) return { relation: 'local-unborn' }
  const base = await git(['merge-base', 'HEAD', ref], repo)
  if (!base.ok) return { relation: 'unrelated' }
  const baseOid = base.stdout.trim()
  const head = await git(['rev-parse', 'HEAD'], repo)
  const headOid = head.ok ? head.stdout.trim() : ''
  const otherOid = other.stdout.trim()
  if (baseOid === headOid && baseOid === otherOid) return { relation: 'same' }
  if (baseOid === otherOid) return { relation: 'contained' }
  if (baseOid === headOid) return { relation: 'ff' }
  return { relation: 'merge' }
}

function presentGit(result) {
  if (!result || !result.ok) return { missing: true, binary: false, truncated: false, text: '' }
  if (String(result.stdout || '').includes('\0')) return { missing: false, binary: true, truncated: false, text: '' }
  const size = Buffer.byteLength(result.stdout || '')
  const truncated = size > MAX_FILE_PREVIEW
  const text = truncated ? String(result.stdout).slice(0, MAX_FILE_PREVIEW) : String(result.stdout || '')
  return { missing: false, binary: false, truncated, text }
}

function presentBuffer(buffer) {
  const head = buffer.subarray(0, Math.min(buffer.length, 8000))
  if (head.includes(0)) return { missing: false, binary: true, truncated: false, text: '' }
  const truncated = buffer.length > MAX_FILE_PREVIEW
  const text = buffer.subarray(0, MAX_FILE_PREVIEW).toString('utf8')
  return { missing: false, binary: false, truncated, text }
}

async function blobSide(repo, stage, relPath) {
  const result = await git(['show', '--no-color', '--no-ext-diff', `:${stage}:${relPath}`], repo)
  return presentGit(result)
}

async function worktreeSide(repo, relPath) {
  try {
    const buffer = await readFile(path.join(repo, relPath))
    return presentBuffer(buffer)
  } catch (error) {
    if (error && error.code === 'ENOENT') return { missing: true, binary: false, truncated: false, text: '' }
    return { missing: true, binary: false, truncated: false, text: '', error: describeFsError(error) }
  }
}

async function resolveIncoming(repo, params) {
  const source = params.source === 'origin' ? 'origin' : 'local'
  const requested = branchNameCandidate(params.branch)
  if (!requested) return { error: { status: 400, body: { error: '要先选择要合并的分支' } } }
  const accepted = await acceptBranchName(repo, requested)
  if (accepted.error) return { error: accepted.error }
  const branch = accepted.branch
  const current = await currentBranchName(repo)
  if (source === 'local' && current && branch === current) {
    return { error: { status: 409, body: { error: '不能把当前分支合并到自己', repo, branch } } }
  }
  if (source === 'local') {
    if (!(await localBranchExists(repo, branch))) {
      return { error: { status: 404, body: { error: `本地没有分支 ${branch}`, repo } } }
    }
    const ref = `refs/heads/${branch}`
    const classified = await classifyRef(repo, ref)
    if (classified.relation === 'missing') return { error: { status: 404, body: { error: `本地没有分支 ${branch}`, repo } } }
    return { source, branch, ref, current, ...classified }
  }
  const names = await originBranches(repo)
  if (!names.includes(branch)) return { error: { status: 404, body: { error: `远端没有分支 ${branch}`, repo } } }
  const classified = await classifyAgainstOrigin(repo, branch)
  return { source, branch, ref: classified.remoteRef, current, relation: classified.relation }
}

async function snapshot(repo, preferBranch) {
  const merging = await mergeInProgress(repo)
  const conflicts = merging ? await conflictPaths(repo) : []
  const ours = await oursSide(repo)
  const theirs = merging
    ? await theirsSide(repo, 'MERGE_HEAD', await branchPointingAt(repo, 'MERGE_HEAD', preferBranch))
    : null
  return { merging, pending: merging, conflicts, ours, theirs }
}

async function runMerge(repo, incoming) {
  const { relation, ref, branch } = incoming
  if (relation === 'same' || relation === 'contained' || relation === 'push' || relation === 'empty') {
    return { ok: true, skipped: true }
  }
  if (relation === 'ff') return git(['merge', '--ff-only', ref], repo, GIT_NETWORK_TIMEOUT_MS)
  if (relation === 'local-unborn') {
    const staged = await git(['diff', '--cached', '--quiet'], repo)
    if (staged.code === 1) {
      return { refused: { status: 409, body: { error: '本地还有已暂存、尚未提交的文件。先提交一次，再合并。', repo, relation, branch } } }
    }
    const localBranch = await currentBranchName(repo)
    if (!localBranch) return { refused: { status: 409, body: { error: '当前不在分支上，不能取下这段历史', repo } } }
    return git(['checkout', '-B', localBranch, ref], repo, GIT_NETWORK_TIMEOUT_MS)
  }
  if (relation === 'merge') return git(['merge', '--no-commit', ref], repo, GIT_NETWORK_TIMEOUT_MS)
  if (relation === 'unrelated') {
    return git(['merge', '--allow-unrelated-histories', '--no-commit', ref], repo, GIT_NETWORK_TIMEOUT_MS)
  }
  return { refused: { status: 409, body: { error: '还不能合并这个分支', repo, relation, branch } } }
}

export async function handleMergeOp(op, { repo, params, host }) {
  if (op === 'mergePlan') {
    if (await mergeInProgress(repo)) {
      const current = await snapshot(repo, params.branch)
      return {
        status: 200,
        body: { repo, ...current, relation: current.conflicts.length ? 'merge' : 'pending', blocked: true, hint: 'busy' },
      }
    }
    const incoming = await resolveIncoming(repo, params)
    if (incoming.error) return incoming.error
    const ours = await oursSide(repo)
    const theirs = await theirsSide(repo, incoming.ref, incoming.branch)
    return {
      status: 200,
      body: {
        repo,
        source: incoming.source,
        branch: incoming.branch,
        relation: incoming.relation,
        merging: false,
        pending: false,
        blocked: false,
        conflicts: [],
        ours,
        theirs,
      },
    }
  }

  if (op === 'mergeView') {
    if (!(await mergeInProgress(repo))) return { status: 409, body: { error: '当前没有进行中的合并', repo } }
    const current = await snapshot(repo, params.branch)
    const body = { repo, ...current, relation: current.conflicts.length ? 'merge' : 'pending' }
    const rawPath = typeof params.path === 'string' ? params.path.trim() : ''
    if (!rawPath) return { status: 200, body }
    const relPath = safeRelativePath(rawPath)
    if (!relPath) return { status: 400, body: { error: '非法文件路径' } }
    if (!current.conflicts.includes(relPath)) return { status: 404, body: { error: '这个文件没有冲突', repo, path: relPath } }
    body.file = {
      path: relPath,
      ours: await blobSide(repo, 2, relPath),
      theirs: await blobSide(repo, 3, relPath),
      result: await worktreeSide(repo, relPath),
    }
    return { status: 200, body }
  }

  if (op === 'mergeAbort') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '放弃合并只能从 Git 面板发起' } }
    const onBranch = await requireCheckedOutBranch(repo, params.branch)
    if (onBranch.error) return onBranch.error
    if (!(await mergeInProgress(repo))) return { status: 409, body: { error: '当前没有进行中的合并', repo } }
    const result = await git(['merge', '--abort'], repo)
    if (!result.ok) return { status: 409, body: { error: gitError(result, 'git merge --abort 失败'), repo } }
    invalidateRepoCache(repo)
    return { status: 200, body: { repo, branch: onBranch.branch, aborted: true } }
  }

  if (op === 'mergeBranch') {
    if (!mutationAllowed(host)) return { status: 403, body: { error: '合并只能从 Git 面板发起' } }
    if (await mergeInProgress(repo)) {
      return { status: 409, body: { error: '已经有一次合并还没完成。先处理冲突并提交，或放弃这次合并。', repo } }
    }
    const incoming = await resolveIncoming(repo, { ...params, source: 'local' })
    if (incoming.error) return incoming.error
    const result = await runMerge(repo, incoming)
    if (result && result.refused) return result.refused
    const conflicts = await conflictPaths(repo)
    const pending = await mergeInProgress(repo)
    invalidateRepoCache(repo)
    if (result && !result.skipped && !result.ok && conflicts.length === 0 && !pending) {
      return { status: 409, body: { error: gitError(result, 'git merge 失败'), repo, relation: incoming.relation, branch: incoming.branch } }
    }
    const sides = await snapshot(repo, incoming.branch)
    if (!sides.theirs) sides.theirs = await theirsSide(repo, incoming.ref, incoming.branch)
    return {
      status: 200,
      body: {
        repo,
        source: 'local',
        branch: incoming.branch,
        relation: incoming.relation,
        ...sides,
        merged: !!(result && result.ok && !pending && !result.skipped),
        skipped: !!(result && result.skipped),
        conflicts,
        pending,
      },
    }
  }

  return null
}

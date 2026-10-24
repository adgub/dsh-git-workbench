/** origin URL, the fetched remote branches, and how HEAD relates to one of them. */
import { branchNameCandidate, currentBranchName, git, hasCommits } from './git.js'
import { parseStatus } from './parse.js'

/** Remote URLs the panel may store as `origin`. Options and local paths are rejected. */
export function remoteUrlCandidate(value) {
  const url = typeof value === 'string' ? value.trim() : ''
  if (!url || url.length > 2000) return ''
  if (url.startsWith('-') || /[\0\r\n\s]/.test(url)) return ''
  if (/^(https?:\/\/|ssh:\/\/)/i.test(url)) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') return ''
      if (!parsed.hostname) return ''
      return url
    } catch {
      return ''
    }
  }
  if (/^git@[A-Za-z0-9][A-Za-z0-9._-]*:[A-Za-z0-9._~/-]+$/.test(url)) return url
  return ''
}

function looseBranch(name) {
  return !!branchNameCandidate(name) && !name.includes('..') && !name.includes('@{') && !name.endsWith('/')
}

export async function originUrl(repo) {
  const result = await git(['remote', 'get-url', 'origin'], repo)
  if (!result.ok) return ''
  return result.stdout.trim()
}

export async function originBranches(repo) {
  const listed = await git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], repo)
  if (!listed.ok) return []
  const names = []
  for (const line of listed.stdout.split('\n')) {
    const short = line.trim().replace(/^origin\//, '')
    if (!looseBranch(short) || short === 'HEAD') continue
    names.push(short)
  }
  return names
}

/**
 * Prefer the remote HEAD, then the current local branch, then main/master,
 * then the only remote branch. `network` asks the remote which branch HEAD is.
 */
async function pickOriginBranch(repo, prefer, network) {
  const names = await originBranches(repo)
  let chosen = ''
  if (network && names.length) {
    const sym = await git(['ls-remote', '--symref', 'origin', 'HEAD'], repo, 20000)
    if (sym.ok) {
      const match = sym.stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m)
      if (match && names.includes(match[1])) chosen = match[1]
    }
  }
  if (!chosen && prefer && names.includes(prefer)) chosen = prefer
  if (!chosen && names.includes('main')) chosen = 'main'
  if (!chosen && names.includes('master')) chosen = 'master'
  if (!chosen && names.length === 1) chosen = names[0]
  return { branch: chosen, branches: names }
}

export async function classifyAgainstOrigin(repo, branch) {
  const remoteRef = `refs/remotes/origin/${branch}`
  const remote = await git(['rev-parse', '--verify', '--quiet', remoteRef], repo)
  const local = await hasCommits(repo)
  if (!remote.ok || !remote.stdout.trim()) {
    return { relation: local ? 'push' : 'empty', branch, remoteRef }
  }
  if (!local) return { relation: 'local-unborn', branch, remoteRef }
  const base = await git(['merge-base', 'HEAD', remoteRef], repo)
  if (!base.ok) return { relation: 'unrelated', branch, remoteRef }
  const baseOid = base.stdout.trim()
  const head = await git(['rev-parse', 'HEAD'], repo)
  const headOid = head.ok ? head.stdout.trim() : ''
  const remoteOid = remote.stdout.trim()
  if (baseOid === headOid && baseOid === remoteOid) return { relation: 'same', branch, remoteRef }
  if (baseOid === remoteOid) return { relation: 'push', branch, remoteRef }
  if (baseOid === headOid) return { relation: 'ff', branch, remoteRef }
  return { relation: 'merge', branch, remoteRef }
}

export async function describeOrigin(repo, network) {
  const prefer = await currentBranchName(repo)
  const picked = await pickOriginBranch(repo, prefer, network)
  if (!picked.branch) {
    if (picked.branches.length > 1) return { ...picked, relation: 'choose', remoteRef: '' }
    const local = await hasCommits(repo)
    return { ...picked, relation: local ? 'push' : 'empty', remoteRef: '' }
  }
  const classified = await classifyAgainstOrigin(repo, picked.branch)
  return { ...classified, branches: picked.branches }
}

export async function conflictPaths(repo) {
  const status = await git(['status', '--porcelain=v2', '--untracked-files=no'], repo)
  if (!status.ok) return []
  return parseStatus(status.stdout).files.filter((file) => file.kind === 'conflict').map((file) => file.path).filter(Boolean)
}

export async function mergeInProgress(repo) {
  const merging = await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], repo)
  return merging.ok
}

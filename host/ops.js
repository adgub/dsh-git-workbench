/** Dispatch one panel operation. Writes require the panel request header. */
import { clampInt, DEFAULTS, normalizeRoute, splitPathList, viewLimits } from './constants.js'
import { describeRepoCached, discoverRepositories, resolveRepo, resolveWorkspaces } from './discover.js'
import { detectGitBash, git } from './git.js'
import { handleBranchOp } from './ops-branch.js'
import { handleCommitOp } from './ops-commit.js'
import { handleReadOp } from './ops-read.js'
import { handleRemoteOp } from './ops-remote.js'

export async function handleOp(op, params, host = {}) {
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
  const frame = { op, repo, limit, params, host }
  return (await handleReadOp(op, frame))
    || (await handleBranchOp(op, frame))
    || (await handleRemoteOp(op, frame))
    || (await handleCommitOp(op, frame))
    || { status: 400, body: { error: `未知操作：${op}` } }
}

/**
 * dsh-git-workbench — Host half.
 *
 * The HTTP route and the op dispatcher live under `host/`. This file is the
 * plugin entry Cordis loads: it re-exports `apply` and the test hook.
 *
 * Repository discovery:
 * - Workspaces come from `ctx.workspaceRegistry` when the host composes it,
 *   otherwise from `$DSH_HOME/storages/workspace.json`.
 * - A workspace that is itself a Git work tree contributes one repository; a
 *   workspace that is only a parent directory contributes its Git children
 *   (depth limited by `scanDepth`, probes by `probeBudget`).
 * - A workspace the host cannot read is reported as an entry with `error`
 *   instead of disappearing, so the browser can offer the manual-path fallback.
 *
 * Safety notes:
 * - `spawn('git', ['-C', repo, ...args], { cwd: tmpdir, shell: false })`. The git
 *   process does not use the project as its working directory, so it does not
 *   keep a handle on that folder after the command exits. Arguments stay an
 *   array and are never interpreted by a shell.
 * - Commands for one repository run one at a time. `GIT_OPTIONAL_LOCKS=0` keeps
 *   status and diff from taking the index lock. Ambient `GIT_DIR` is cleared.
 * - `GIT_TERMINAL_PROMPT=0` so a credential prompt can never hang the route.
 * - Every op has a timeout; output is capped. A timed-out git has its process
 *   tree killed, then lock files that command left under `.git` are removed.
 * - Reads are open. Mutations (`switch`, `branchCreate`, `branchRename`, `pull`,
 *   `push`, `reveal`, `remoteBind`, `integrate`, `stage`, `commitCreate`,
 *   `uncommit`, `takeSide`) require the panel's `x-dsh-git-workbench: 1` header,
 *   so a cross-origin page cannot trigger them. Pull is `--ff-only`. Push,
 *   reset and merge never use `--force`. Uncommit is `reset --soft` of the tip
 *   and only when that commit is not on the upstream.
 */
export { inject, apply } from './host/http.js'
export { handleOp } from './host/ops.js'
export { discoverRepositories, resolveWorkspaces } from './host/discover.js'

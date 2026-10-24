// @part 01-boot.js
/**
 * dsh-git-workbench — Browser half.
 *
 * A JetBrains-style Git tool window:
 * - Top: the file tab strip (project chip, a quick file search box, one tab per
 *   open file, ⋯ for more) with the branch chip and the refresh button on its right.
 * - Under it: the full path of the active tab and the changed-file summary.
 * - Left: a changed-file TREE (module → folder → file) plus graph / log / branches tabs.
 *   Files are coloured the way SVN / IntelliJ / git bash colour them.
 * - Middle right: the read-only diff / file body.
 * - Far right: a Git Bash terminal column backed by DSH's own terminal plugin
 *   (real PTY + xterm), not a shell emulation implemented here.
 * - Project switcher: the repositories auto-detected from the DSH workspaces plus
 *   any path the user adds by hand; several projects can be switched freely and
 *   each project has an editable accent colour.
 *
 * Git access goes through the host route. This module never spawns a process.
 * Branch create/rename, pull, push, binding origin, merging, staging, committing,
 * soft-resetting an unpushed commit, and opening the folder run only when a
 * panel button asks the host to do it.
 *
 * Source of this bundle is `client/parts/`. After editing a part, run
 * `node scripts/build-client.mjs` so DSH loads the assembled `client.js`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // First request uses this prefix. It must match `route` in cordis.patch.yml.
    // After `repos` returns, later requests follow the route the host reported.
    const ROUTE = '/dsh-git-workbench'
    let apiRoute = ROUTE
    const STORE_KEY = 'dsh-git-workbench.state.v3'
    const GIT_BASH_STARTED_KEY = 'dsh-git-workbench.bash.v1'
    const DEFAULT_HISTORY_LIMIT = 80
    const DEFAULT_GRAPH_LIMIT = 120
    const MAX_SEARCH_ROWS = 40
    const SIDEBAR_DEFAULT_WIDTH = 340
    const SIDEBAR_MIN_WIDTH = 240
    const SIDEBAR_MAX_WIDTH = 720
    const MAIN_MIN_WIDTH = 320
    const TERMINAL_DEFAULT_WIDTH = 380
    const TERMINAL_MIN_WIDTH = 280
    const TERMINAL_MAX_WIDTH = 720
    const SPLITTER_WIDTH = 8
    const TERMINAL_KEY = 'git-workbench-bash'
    const TERMINAL_CONTENT_ID = 'dsh-git-workbench-bash'
    const TERMINAL_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-terminal'
    const TERMINAL_FONT = 'Consolas, "Cascadia Mono", "Courier New", monospace'
    const TERMINAL_BACKGROUND = '#000000'
    const TERMINAL_FOREGROUND = '#BFBFBF'

    // Git Bash (mintty) default palette, the one `git-bash.exe` opens with.
    const GIT_BASH_PALETTE = [
      '#000000', '#BF0000', '#00BF00', '#BFBF00', '#0000BF', '#BF00BF', '#00BFBF', '#BFBFBF',
      '#404040', '#FF4040', '#40FF40', '#FFFF40', '#6060FF', '#FF40FF', '#40FFFF', '#FFFFFF',
    ]

    // Distinct accents a project can wear; the first one is also the fallback.
    const PROJECT_COLORS = [
      '#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#39c5cf',
      '#db61a2', '#f0883e', '#7ee787', '#8b949e', '#6e7cff', '#e3b341',
    ]

    const monospace = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    const FLOAT_SHADOW = '0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.08)'
    const PANE_SHADOW = '0 8px 28px rgba(0, 0, 0, 0.35)'
    const CODE_BG = '#0e1116'
    const CODE_FG = '#e8eef7'
    const GRAPH_LANE_COLORS = ['#79c0ff', '#7ee787', '#e3b341', '#ff7b72', '#d2a8ff', '#56d4dd', '#ff9bce', '#ffa657']

    /** Created by the plugin apply, consumed by the panel registered there. */
    let terminalBridge = null

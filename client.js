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
// @part 02-styles-shell.js
    const styles = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        fontSize: 13,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
        position: 'relative',
      },
      button: {
        boxSizing: 'border-box',
        minHeight: 32,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 4,
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.16)',
        whiteSpace: 'nowrap',
      },
      buttonQuiet: {
        boxSizing: 'border-box',
        minHeight: 32,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 4,
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.16)',
        whiteSpace: 'nowrap',
      },
      banner: {
        margin: '8px 10px',
        padding: '4px 8px',
        borderRadius: 4,
        fontSize: 12,
        color: 'var(--dsw-alias-state-error-primary)',
        border: '1px solid var(--dsw-alias-state-error-primary)',
      },
      infoBanner: {
        margin: '8px 10px',
        padding: '8px 10px',
        borderRadius: 4,
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
      },
      rowButton: {
        boxSizing: 'border-box',
        minHeight: 24,
        padding: '2px 8px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 4,
        whiteSpace: 'nowrap',
      },
      commitBox: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 52,
        padding: '6px 8px',
        fontSize: 12,
        fontFamily: 'inherit',
        lineHeight: 1.45,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 4,
        resize: 'vertical',
      },
      fileActions: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 0 auto' },
      body: {
        display: 'flex',
        flex: '1 1 auto',
        minHeight: 0,
        padding: 0,
        background: 'var(--dsw-alias-bg-base)',
      },
      card: {
        boxSizing: 'border-box',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: 'none',
        borderRight: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 0,
        overflow: 'hidden',
        boxShadow: PANE_SHADOW,
      },
      sidebar: {
        minWidth: SIDEBAR_MIN_WIDTH,
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      },
      splitter: {
        flex: '0 0 auto',
        width: SPLITTER_WIDTH,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        cursor: 'col-resize',
        touchAction: 'none',
        position: 'relative',
        zIndex: 2,
        outline: 'none',
      },
      splitterLine: { width: 1, background: 'transparent' },
      splitterGrip: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: 3,
        height: 38,
        marginTop: -19,
        marginLeft: -1.5,
        borderRadius: 2,
        pointerEvents: 'none',
      },
      tabs: {
        display: 'flex',
        gap: 0,
        padding: '0 8px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        flex: '0 0 auto',
        overflowX: 'auto',
      },
      tab: {
        boxSizing: 'border-box',
        minHeight: 32,
        padding: '8px 12px',
        fontSize: 12,
        fontWeight: 400,
        cursor: 'pointer',
        borderRadius: 0,
        border: 'none',
        borderBottomWidth: 2,
        borderBottomStyle: 'solid',
        borderBottomColor: 'transparent',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
      },
      tabActive: {
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontWeight: 600,
      },
      list: { flex: '1 1 auto', overflow: 'auto', minHeight: 0, background: 'var(--dsw-alias-bg-layer-1)' },
      sectionHead: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '8px 10px',
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        position: 'sticky',
        top: 0,
        zIndex: 1,
      },
      main: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 },
      terminal: {
        boxSizing: 'border-box',
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        background: TERMINAL_BACKGROUND,
        color: TERMINAL_FOREGROUND,
        border: 'none',
        borderRadius: 0,
        overflow: 'hidden',
        boxShadow: PANE_SHADOW,
      },
      terminalHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flex: '0 0 auto',
        minHeight: 40,
        padding: '4px 8px',
        fontSize: 12,
        color: '#9e9e9e',
        background: '#141414',
        borderBottom: '1px solid #2a2a2a',
      },
      terminalTitle: {
        flex: '1 1 auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: '#e8e8e8',
        fontWeight: 600,
        fontSize: 12,
      },
      terminalDarkButton: {
        boxSizing: 'border-box',
        minHeight: 32,
        minWidth: 32,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        color: '#cfcfcf',
        background: '#1f1f1f',
        border: '1px solid #4a4a4a',
        borderRadius: 4,
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
        whiteSpace: 'nowrap',
      },
      terminalBody: {
        flex: '1 1 auto',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        background: TERMINAL_BACKGROUND,
        color: TERMINAL_FOREGROUND,
        '--dsw-alias-bg-base': TERMINAL_BACKGROUND,
        '--dsw-alias-label-primary': TERMINAL_FOREGROUND,
        '--dsw-alias-label-secondary': '#9e9e9e',
        '--dsw-alias-label-tertiary': '#7a7a7a',
        '--dsw-alias-bg-l2': '#141414',
        '--dsw-alias-border-l3': '#2a2a2a',
      },
      terminalInner: {
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 auto',
        minWidth: 0,
        minHeight: 0,
        height: '100%',
      },
      tabStrip: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        padding: '8px 10px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        flex: '0 0 auto',
        position: 'relative',
        minWidth: 0,
        minHeight: 48,
        background: 'var(--dsw-alias-bg-layer-2)',
        zIndex: 3,
      },
      repoButton: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        boxSizing: 'border-box',
        minHeight: 32,
        padding: '6px 12px',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'transparent',
        border: 'none',
        borderBottomWidth: 2,
        borderBottomStyle: 'solid',
        borderBottomColor: 'transparent',
        borderRadius: 0,
        whiteSpace: 'nowrap',
        maxWidth: 260,
      },
      repoName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 },
      tabScroll: { display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 auto', minWidth: 0, overflowX: 'auto' },
      fileTab: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        boxSizing: 'border-box',
        minHeight: 32,
        padding: '4px 8px',
        fontSize: 12,
        fontWeight: 400,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
        border: 'none',
        borderBottomWidth: 2,
        borderBottomStyle: 'solid',
        borderBottomColor: 'transparent',
        borderRadius: 0,
        whiteSpace: 'nowrap',
        maxWidth: 220,
        flex: '0 0 auto',
      },
      fileTabActive: {
        color: 'var(--dsw-alias-label-primary)',
        fontWeight: 600,
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      tabBadge: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        minWidth: 18,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: monospace,
      },
      tabName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      tabClose: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        width: 28,
        height: 28,
        borderRadius: 4,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        fontSize: 14,
        lineHeight: 1,
        color: 'var(--dsw-alias-label-primary)',
      },
      pathBar: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flex: '0 0 auto',
        padding: '4px 10px',
        fontSize: 12,
        fontFamily: monospace,
        color: 'var(--dsw-alias-label-secondary)',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        minHeight: 28,
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      pathText: { flex: '0 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
      pathSummary: {
        flex: '0 0 auto',
        marginLeft: 'auto',
        fontSize: 12,
        fontFamily: 'inherit',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
      },
      contentHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
        flex: '0 0 auto',
        minHeight: 48,
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      segment: { display: 'inline-flex', gap: 0, background: 'transparent', borderRadius: 4, padding: 0, border: '1px solid var(--dsw-alias-border-l1)' },
      segmentItem: {
        boxSizing: 'border-box',
        minHeight: 32,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        border: 'none',
        borderRadius: 0,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
      },
      segmentActive: { background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', fontWeight: 600 },
// @part 03-styles-chrome.js
      scroll: { flex: '1 1 auto', overflow: 'auto', minHeight: 0, background: 'var(--dsw-alias-bg-layer-1)', fontFamily: monospace, fontSize: 12, lineHeight: 1.55 },
      codeSurface: {
        background: CODE_BG,
        color: CODE_FG,
        fontFamily: monospace,
        fontSize: 14,
        lineHeight: 1.65,
      },
      codeRow: { display: 'flex', whiteSpace: 'pre', minHeight: 23 },
      lineNo: {
        flex: '0 0 auto',
        width: 64,
        padding: '0 10px 0 8px',
        textAlign: 'right',
        color: '#7d8794',
        userSelect: 'none',
      },
      codeText: { flex: '1 1 auto', paddingRight: 16, color: CODE_FG },
      empty: { padding: 16, color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.5 },
      overlay: { position: 'fixed', inset: 0, zIndex: 30, background: 'transparent' },
      popover: {
        position: 'absolute',
        zIndex: 31,
        width: 430,
        maxHeight: 460,
        overflow: 'auto',
        padding: 6,
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        boxShadow: FLOAT_SHADOW,
      },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '4px 8px',
        fontSize: 12,
        fontFamily: monospace,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 4,
      },
      popHead: { padding: '4px 8px', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      repoRow: { display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box', minHeight: 32, padding: '8px 10px', borderRadius: 0, borderBottom: '1px solid var(--dsw-alias-border-l1)', cursor: 'pointer' },
      repoRowActive: { background: 'var(--dsw-alias-bg-layer-1)' },
      repoRowMain: { flex: '1 1 auto', minWidth: 0 },
      repoRowName: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, lineHeight: 1.4 },
      repoNameText: {
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      repoMeta: { fontSize: 12, fontWeight: 400, fontFamily: monospace, color: 'var(--dsw-alias-label-secondary)' },
      repoRowPath: {
        marginTop: 2,
        fontSize: 12,
        fontWeight: 400,
        fontFamily: monospace,
        color: 'var(--dsw-alias-label-secondary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      repoActions: { display: 'flex', alignItems: 'center', gap: 2, flex: '0 0 auto' },
      iconButton: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 4,
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.16)',
      },
      branchButton: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        boxSizing: 'border-box',
        minHeight: 32,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 4,
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.16)',
        whiteSpace: 'nowrap',
        maxWidth: 230,
      },
      branchMenu: {
        position: 'absolute',
        top: 40,
        left: 0,
        zIndex: 31,
        width: 380,
        maxHeight: 430,
        overflow: 'auto',
        padding: 6,
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        boxShadow: FLOAT_SHADOW,
      },
      moreMenu: {
        position: 'absolute',
        top: '100%',
        left: 0,
        zIndex: 40,
        minWidth: 168,
        marginTop: 0,
        padding: 6,
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        boxShadow: FLOAT_SHADOW,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      },
      moreItem: {
        boxSizing: 'border-box',
        width: '100%',
        minHeight: 32,
        padding: '6px 10px',
        fontSize: 12,
        fontWeight: 600,
        textAlign: 'left',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 4,
        whiteSpace: 'nowrap',
      },
      divider: { height: 1, margin: '6px 2px', background: 'var(--dsw-alias-border-l1)' },
      treeRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', cursor: 'pointer', lineHeight: 1.5 },
      moduleRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxSizing: 'border-box',
        minHeight: 32,
        padding: '8px 10px',
        cursor: 'pointer',
        lineHeight: 1.4,
        fontWeight: 600,
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      dirRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxSizing: 'border-box',
        minHeight: 32,
        padding: '8px 10px',
        cursor: 'pointer',
        lineHeight: 1.5,
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      fileRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxSizing: 'border-box',
        minHeight: 32,
        padding: '8px 10px',
        cursor: 'pointer',
        lineHeight: 1.5,
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      treeRowHover: { background: 'var(--dsw-alias-bg-layer-2)' },
      caret: { width: 12, flex: '0 0 auto', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      dirName: { flex: '1 1 auto', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      count: { flex: '0 0 auto', fontSize: 12, fontWeight: 400, color: 'var(--dsw-alias-label-secondary)', fontFamily: monospace },
      dots: { display: 'inline-flex', gap: 3, flex: '0 0 auto', width: 28, justifyContent: 'flex-end' },
      dot: { width: 6, height: 6, borderRadius: 999, display: 'inline-block' },
      fileName: { flex: '1 1 auto', fontSize: 13, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      xy: { flex: '0 0 auto', width: 24, fontSize: 12, fontFamily: monospace, fontWeight: 600 },
      legend: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '4px 8px',
        marginTop: 4,
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
      },
      legendItem: { display: 'inline-flex', alignItems: 'center', gap: 3 },
      legendDot: { width: 6, height: 6, borderRadius: 999, display: 'inline-block', flex: '0 0 auto' },
      treeSummary: {
        padding: '8px 10px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-secondary)',
      },
      graphRow: {
        display: 'block',
        padding: '2px 10px',
        cursor: 'pointer',
        fontFamily: monospace,
        fontSize: 13,
        lineHeight: 1.45,
        whiteSpace: 'pre',
      },
      logRow: { display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box', minHeight: 32, padding: '8px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1)', cursor: 'pointer' },
      branchRow: { display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box', minHeight: 32, padding: '8px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      pickerRow: { display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box', minHeight: 32, padding: '8px 10px', borderRadius: 0, borderBottom: '1px solid var(--dsw-alias-border-l1)', cursor: 'pointer' },
      searchWrap: { position: 'relative', display: 'flex', alignItems: 'center', flex: '0 1 240px', minWidth: 120 },
      searchIcon: {
        position: 'absolute',
        left: 7,
        fontSize: 12,
        lineHeight: 1,
        color: 'var(--dsw-alias-label-secondary)',
        pointerEvents: 'none',
      },
      searchInput: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 32,
        padding: '6px 8px 6px 28px',
        fontSize: 12,
        fontFamily: 'inherit',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 4,
        outline: 'none',
      },
      searchPop: {
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        zIndex: 31,
        width: 440,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 420,
        overflow: 'auto',
        padding: 6,
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        boxShadow: FLOAT_SHADOW,
      },
      resultRow: { display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box', minHeight: 32, padding: '8px 10px', borderRadius: 0, borderBottom: '1px solid var(--dsw-alias-border-l1)', cursor: 'pointer' },
      resultActive: { background: 'var(--dsw-alias-bg-layer-1)' },
      colorDot: {
        width: 11,
        height: 11,
        borderRadius: 999,
        display: 'inline-block',
        flex: '0 0 auto',
        border: '1px solid rgba(127, 127, 127, 0.45)',
      },
      colorDotButton: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        width: 28,
        height: 28,
        padding: 0,
        cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 4,
        background: 'var(--dsw-alias-bg-layer-1)',
        flex: '0 0 auto',
      },
      paletteGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, padding: '6px 4px' },
      swatch: {
        width: 28,
        height: 28,
        borderRadius: 4,
        cursor: 'pointer',
        border: '1px solid rgba(127, 127, 127, 0.4)',
        padding: 0,
      },
      paletteReset: { width: '100%', marginTop: 4 },
      notice: {
        position: 'absolute',
        right: 14,
        bottom: 12,
        zIndex: 40,
        padding: '4px 8px',
        borderRadius: 4,
        fontSize: 12,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        boxShadow: FLOAT_SHADOW,
      },
    }
// @part 04-helpers.js

    function readStore() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function writeStore(patch) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...readStore(), ...patch }))
      } catch {
        /* localStorage may be unavailable; the panel still works without persistence */
      }
    }

    function normalizeKey(value) {
      const text = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')
      return /^[a-zA-Z]:/.test(text) ? text.toLowerCase() : text
    }

    function baseName(value) {
      const parts = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean)
      return parts.length ? parts[parts.length - 1] : String(value || '')
    }

    function absolutePath(repo, rel) {
      const windows = /^[a-zA-Z]:/.test(String(repo || ''))
      const base = String(repo || '').replace(/[\\/]+$/, '')
      const tail = String(rel || '').replace(/^[\\/]+/, '')
      if (!tail) return windows ? base.replace(/\//g, '\\') : base
      const joined = `${base}/${tail}`
      return windows ? joined.replace(/\//g, '\\') : joined
    }

    function extensionOf(value) {
      const name = baseName(value)
      const dot = name.lastIndexOf('.')
      return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
    }

    function extLabel(value) {
      const ext = extensionOf(value)
      return ext ? ext.slice(0, 2).toUpperCase() : '·'
    }

    function extColor(value) {
      const ext = extensionOf(value)
      if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'var(--dsw-alias-brand-primary)'
      if (['json', 'yml', 'yaml', 'toml'].includes(ext)) return 'var(--dsw-alias-state-warn-primary)'
      if (['css', 'scss', 'less', 'html'].includes(ext)) return 'var(--dsw-alias-state-success-primary)'
      return 'var(--dsw-alias-label-secondary)'
    }

    /**
     * SVN / IntelliJ / git-bash style status colours:
     * untracked (not added yet) red, added green, modified blue, deleted grey,
     * renamed purple, conflict orange.
     */
    function colorForStatus(xy) {
      const code = String(xy || '')
      if (!code) return 'var(--dsw-alias-label-secondary)'
      if (code === '??') return 'var(--dsw-alias-state-error-primary)'
      if (code.includes('U')) return '#d29922'
      if (code.includes('R') || code.includes('C')) return '#a371f7'
      if (code.includes('D')) return 'var(--dsw-alias-label-secondary)'
      if (code.includes('A')) return 'var(--dsw-alias-state-success-primary)'
      if (code.includes('M')) return 'var(--dsw-alias-brand-primary)'
      return 'var(--dsw-alias-state-warn-primary)'
    }

    function statusLabel(xy) {
      const code = String(xy || '')
      if (code === '??') return '未跟踪（还没 add）'
      if (code.includes('U')) return '冲突'
      if (code.includes('R')) return '重命名'
      if (code.includes('C')) return '复制'
      if (code.includes('D')) return '删除'
      if (code.includes('A')) return '已暂存的新增'
      if (code.includes('T')) return '类型变更'
      if (code.includes('M')) return '修改'
      return '改动'
    }

    function isDeleted(entry) {
      return !!entry && String(entry.xy || '').includes('D')
    }

    /** Porcelain v2 uses `.` for "unchanged"; the tree only needs the letter. */
    function displayXY(entry) {
      const code = String((entry && entry.xy) || '')
      if (!code) return '·'
      if (code === '??' || code === '!!') return code
      if (code.includes('U')) return 'UU'
      const compact = code.replace(/\./g, '').trim()
      return compact || code
    }

    /** Stable hash so a project keeps its colour between sessions. */
    function hashString(value) {
      const text = String(value || '')
      let hash = 0
      for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0
      return hash
    }

    function projectColorFor(path, overrides) {
      const key = normalizeKey(path)
      if (overrides && typeof overrides[key] === 'string' && overrides[key]) return overrides[key]
      if (!key) return PROJECT_COLORS[0]
      return PROJECT_COLORS[hashString(key) % PROJECT_COLORS.length]
    }

    function emptyCounts() {
      return { staged: 0, unstaged: 0, untracked: 0, total: 0 }
    }

    /** Build the module/folder tree the sidebar shows for the changed files. */
    function buildTree(entries) {
      const root = { key: '', name: '', dirs: [], files: [], counts: emptyCounts() }
      const index = new Map([['', root]])
      for (const entry of entries) {
        const parts = String(entry.path || '').split('/').filter(Boolean)
        if (!parts.length) continue
        let node = root
        let prefix = ''
        for (let i = 0; i < parts.length - 1; i += 1) {
          prefix = prefix ? `${prefix}/${parts[i]}` : parts[i]
          let child = index.get(prefix)
          if (!child) {
            child = { key: prefix, name: parts[i], dirs: [], files: [], counts: emptyCounts() }
            index.set(prefix, child)
            node.dirs.push(child)
          }
          node = child
        }
        node.files.push(entry)
      }
      const aggregate = (node) => {
        const counts = emptyCounts()
        for (const file of node.files) {
          if (file.untracked) counts.untracked += 1
          if (file.staged) counts.staged += 1
          if (file.unstaged) counts.unstaged += 1
          counts.total += 1
        }
        for (const dir of node.dirs) {
          const child = aggregate(dir)
          counts.staged += child.staged
          counts.unstaged += child.unstaged
          counts.untracked += child.untracked
          counts.total += child.total
        }
        node.counts = counts
        dirsSort(node.dirs)
        node.files.sort((a, b) => String(a.path).localeCompare(String(b.path), 'zh-Hans-CN'))
        return counts
      }
      aggregate(root)
      return root
    }

    function dirsSort(dirs) {
      dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    }

    function dirsOf(node) {
      return node.dirs || []
    }

    function statusDots(counts) {
      const dots = []
      if (counts.staged > 0) dots.push(h('span', { key: 's', style: { ...styles.dot, background: 'var(--dsw-alias-state-success-primary)' }, title: `${counts.staged} 个已暂存` }))
      if (counts.unstaged > 0) dots.push(h('span', { key: 'u', style: { ...styles.dot, background: 'var(--dsw-alias-brand-primary)' }, title: `${counts.unstaged} 个未暂存` }))
      if (counts.untracked > 0) dots.push(h('span', { key: 'n', style: { ...styles.dot, background: 'var(--dsw-alias-state-error-primary)' }, title: `${counts.untracked} 个未跟踪` }))
      return dots
    }

    /** The colour key the tree shows under its summary. */
    function statusLegend() {
      const items = [
        ['??', '未跟踪'],
        ['A', '新增'],
        ['M', '修改'],
        ['D', '删除'],
        ['R', '重命名'],
        ['U', '冲突'],
      ]
      return h('div', { style: styles.legend },
        items.map(([code, label]) => h('span', { key: code, style: styles.legendItem },
          h('span', { style: { ...styles.legendDot, background: colorForStatus(code) } }),
          label,
        )),
      )
    }

    const SOURCE_KEYWORDS = new Set(
      'const let var function return if else for while class import export from async await new this try catch throw switch case break continue default typeof instanceof of in null undefined true false interface type extends implements package func struct map range defer select go chan public private protected static void int string bool elif fi then do done esac'.split(' '),
    )

    function sourceLang(ext) {
      if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'java', 'go', 'rs', 'c', 'h', 'cpp', 'cc', 'cs', 'kt'].includes(ext)) return 'c'
      if (['py', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'rb', 'toml'].includes(ext)) return 'hash'
      if (['css', 'scss', 'less'].includes(ext)) return 'css'
      if (ext === 'json') return 'json'
      if (['md', 'markdown'].includes(ext)) return 'md'
      if (['html', 'htm', 'xml', 'svg', 'vue'].includes(ext)) return 'html'
      if (ext === 'sql') return 'sql'
      return ''
    }

    /** One-line scan: comments, strings, numbers, keywords. No nested languages. */
    function highlightParts(line, lang) {
      const text = String(line || '')
      if (!lang || !text) return [{ text: text || ' ', color: '' }]
      if (lang === 'md' && /^#{1,6}\s/.test(text)) return [{ text, color: '#79c0ff' }]
      const parts = []
      let i = 0
      const push = (slice, color) => {
        if (slice) parts.push({ text: slice, color: color || '' })
      }
      while (i < text.length) {
        if ((lang === 'c' || lang === 'css' || lang === 'sql') && text.startsWith('//', i)) {
          push(text.slice(i), '#8b98a8')
          break
        }
        if (lang === 'hash' && text[i] === '#') {
          push(text.slice(i), '#8b98a8')
          break
        }
        if ((lang === 'c' || lang === 'css' || lang === 'sql') && text.startsWith('/*', i)) {
          const end = text.indexOf('*/', i + 2)
          const stop = end === -1 ? text.length : end + 2
          push(text.slice(i, stop), '#8b98a8')
          i = stop
          continue
        }
        if (lang === 'html' && text.startsWith('<!--', i)) {
          const end = text.indexOf('-->', i + 4)
          const stop = end === -1 ? text.length : end + 3
          push(text.slice(i, stop), '#8b98a8')
          i = stop
          continue
        }
        const quote = text[i]
        if (quote === '"' || quote === "'" || quote === '`') {
          let j = i + 1
          while (j < text.length) {
            if (text[j] === '\\') { j += 2; continue }
            if (text[j] === quote) { j += 1; break }
            j += 1
          }
          push(text.slice(i, j), '#a5d6ff')
          i = j
          continue
        }
        if (/[0-9]/.test(text[i]) && (i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]))) {
          let j = i + 1
          while (j < text.length && /[0-9.xXa-fA-F_]/.test(text[j])) j += 1
          push(text.slice(i, j), '#79c0ff')
          i = j
          continue
        }
        if (/[A-Za-z_]/.test(text[i])) {
          let j = i + 1
          while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j += 1
          const word = text.slice(i, j)
          const keyword = lang !== 'md' && SOURCE_KEYWORDS.has(word)
          push(word, keyword ? '#ff8b82' : '')
          i = j
          continue
        }
        push(text[i], '')
        i += 1
      }
      return parts.length ? parts : [{ text: ' ', color: '' }]
    }
// @part 05-highlight.js
    function renderHighlighted(line, lang) {
      return highlightParts(line, lang).map((part, index) => h('span', {
        key: index,
        style: part.color ? { color: part.color } : null,
      }, part.text))
    }

    /**
     * New-file line numbers touched by a unified diff.
     * `added` is a green row; `near` is the line that sits where content was removed.
     */
    function parseChangedLines(text) {
      const added = []
      const near = []
      const lines = String(text || '').split('\n')
      let index = 0
      while (index < lines.length) {
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[index])
        if (!hunk) {
          index += 1
          continue
        }
        let newLine = Number(hunk[1])
        let pending = false
        index += 1
        while (index < lines.length && !lines[index].startsWith('@@') && !lines[index].startsWith('diff ')) {
          const line = lines[index]
          if (line.startsWith('+')) {
            added.push(newLine)
            newLine += 1
            pending = false
          } else if (line.startsWith('-')) {
            pending = true
          } else if (line.startsWith('\\')) {
            /* "\ No newline at end of file" */
          } else {
            if (pending) near.push(newLine)
            pending = false
            newLine += 1
          }
          index += 1
        }
        if (pending && newLine > 1) near.push(newLine - 1)
      }
      return { added, near }
    }

    function decorateDiff(text) {
      const rows = []
      const lines = String(text || '').split('\n')
      let newLine = 0
      let inHunk = false
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
        if (hunk) {
          inHunk = true
          newLine = Number(hunk[1])
          rows.push({ kind: 'hunk', text: line, marker: '', no: '' })
          continue
        }
        if (!inHunk || line.startsWith('diff ') || line.startsWith('# ')) {
          if (line.startsWith('diff ') || line.startsWith('# ')) inHunk = false
          rows.push({ kind: 'meta', text: line, marker: '', no: '' })
          continue
        }
        if (line.startsWith('+')) {
          rows.push({ kind: 'add', text: line.slice(1), marker: '+', no: String(newLine) })
          newLine += 1
        } else if (line.startsWith('-')) {
          rows.push({ kind: 'del', text: line.slice(1), marker: '-', no: '' })
        } else if (line.startsWith('\\')) {
          rows.push({ kind: 'meta', text: line, marker: '', no: '' })
        } else {
          rows.push({ kind: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line, marker: '', no: String(newLine) })
          newLine += 1
        }
      }
      return rows
    }

    const DIFF_ROW = {
      add: { background: 'rgba(63, 185, 80, 0.22)', color: '#7ee787', marker: '#7ee787' },
      del: { background: 'rgba(248, 81, 73, 0.20)', color: '#ff9b94', marker: '#ff9b94' },
      hunk: { background: 'rgba(88, 166, 255, 0.14)', color: '#9ecbff', marker: '#9ecbff' },
      ctx: { background: 'transparent', color: CODE_FG, marker: '#7d8794' },
      meta: { background: 'transparent', color: '#8b98a8', marker: '#7d8794' },
    }

    function DiffBody({ text, lang }) {
      const rows = React.useMemo(() => decorateDiff(text), [text])
      const shown = rows.slice(0, 6000)
      return h('div', { style: { padding: '8px 0 16px' } },
        shown.map((row, index) => {
          const tone = DIFF_ROW[row.kind] || DIFF_ROW.meta
          const body = row.kind === 'add' || row.kind === 'del' || row.kind === 'ctx'
            ? renderHighlighted(row.text || ' ', lang)
            : row.text || ' '
          return h('div', {
            key: index,
            style: { ...styles.codeRow, background: tone.background, color: tone.color },
          },
            h('span', { style: { ...styles.lineNo, color: tone.marker } }, `${row.marker} ${row.no}`.trim() || ' '),
            h('span', { style: { ...styles.codeText, color: tone.color } }, body),
          )
        }),
        rows.length > shown.length
          ? h('div', { style: { ...styles.empty, padding: '8px 12px', color: '#8b98a8' } }, `差异较大，只显示前 ${shown.length} 行（共 ${rows.length} 行）。`)
          : null,
      )
    }

    function FileBody({ text, truncated, size, lang, added, near }) {
      const lines = React.useMemo(() => String(text || '').split('\n'), [text])
      const addedSet = React.useMemo(() => new Set(added || []), [added])
      const nearSet = React.useMemo(() => new Set(near || []), [near])
      const shown = lines.slice(0, 6000)
      return h('div', { style: { padding: '8px 0 16px' } },
        shown.map((line, index) => {
          const lineNo = index + 1
          const isAdd = addedSet.has(lineNo)
          const isNear = !isAdd && nearSet.has(lineNo)
          const background = isAdd ? 'rgba(63, 185, 80, 0.22)' : isNear ? 'rgba(248, 81, 73, 0.18)' : 'transparent'
          const marker = isAdd ? '+' : isNear ? '·' : ''
          return h('div', { key: index, style: { ...styles.codeRow, background } },
            h('span', { style: { ...styles.lineNo, color: isAdd ? '#7ee787' : isNear ? '#ff9b94' : '#7d8794' } }, `${marker} ${lineNo}`.trim()),
            h('span', { style: styles.codeText }, renderHighlighted(line === '' ? ' ' : line, lang)),
          )
        }),
        truncated || lines.length > shown.length
          ? h('div', { style: { ...styles.empty, padding: '8px 12px', color: '#8b98a8' } },
              `文件较大，只显示前 ${Math.min(shown.length, 6000)} 行${size ? `（共 ${Math.round(size / 1024)} KB）` : ''}。`)
          : null,
      )
    }

    /** Colour each graph column so a branch reads as its own line. */
    function graphGlyphs(text) {
      const glyphs = []
      const source = String(text || '')
      for (let index = 0; index < source.length; index += 1) {
        const ch = source[index]
        if (ch === ' ' || ch === '\t') {
          glyphs.push({ ch, color: '', bold: false })
          continue
        }
        const lane = Math.floor(index / 2) % GRAPH_LANE_COLORS.length
        glyphs.push({ ch, color: GRAPH_LANE_COLORS[lane], bold: ch === '*' })
      }
      return glyphs
    }

    /**
     * One draggable vertical divider. The owner supplies clamping and persists
     * the committed width; this component owns only pointer/keyboard gesture.
     */
    function PaneSplitter({ value, min, max, defaultValue, clamp, onResize, onCommit, color, label, title }) {
      const [drag, setDrag] = React.useState(null)
      const [hover, setHover] = React.useState(false)
      const valueRef = React.useRef(value)
      React.useEffect(() => { valueRef.current = value }, [value])
      React.useEffect(() => {
        if (!drag) return undefined
        const onMove = (event) => onResize(clamp(drag.width + event.clientX - drag.x))
        const finish = () => {
          setDrag(null)
          onCommit()
        }
        const previousCursor = document.body.style.cursor
        const previousSelect = document.body.style.userSelect
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', finish)
        window.addEventListener('blur', finish)
        return () => {
          document.body.style.cursor = previousCursor
          document.body.style.userSelect = previousSelect
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          window.removeEventListener('blur', finish)
        }
      }, [drag, clamp, onResize, onCommit])
      const active = !!drag || hover
      return h('div', {
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-label': label,
        'aria-valuemin': min,
        'aria-valuemax': max,
        'aria-valuenow': value,
        tabIndex: 0,
        title,
        style: styles.splitter,
        onPointerDown: (event) => {
          if (event.button !== 0) return
          event.preventDefault()
          try { event.currentTarget.focus({ preventScroll: true }) } catch { /* older engines */ }
          try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* optional */ }
          setDrag({ x: event.clientX, width: valueRef.current })
        },
        onDoubleClick: () => {
          onResize(clamp(defaultValue))
          onCommit()
        },
        onKeyDown: (event) => {
          const step = event.shiftKey ? 48 : 16
          let next
          if (event.key === 'ArrowLeft') next = valueRef.current - step
          else if (event.key === 'ArrowRight') next = valueRef.current + step
          else if (event.key === 'Home') next = defaultValue
          else if (event.key === 'End') next = max
          else return
          event.preventDefault()
          onResize(clamp(next))
          onCommit()
        },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onFocus: () => setHover(true),
        onBlur: () => setHover(false),
      },
        h('div', { style: { ...styles.splitterLine, ...(active ? { width: 2, background: color } : {}) } }),
        active ? h('div', { style: { ...styles.splitterGrip, background: color } }) : null,
      )
    }
// @part 06-api-terminal.js
    function apiUrl(params) {
      const query = typeof params === 'string' ? params : params.toString()
      return `${apiRoute}/api?${query}`
    }

    /** Keep the prefix and the log/graph lengths the host just reported. */
    function rememberServerConfig(payload) {
      if (payload && typeof payload.route === 'string' && payload.route.startsWith('/')) {
        apiRoute = payload.route.replace(/\/+$/, '') || ROUTE
      }
      const history = Number(payload && payload.historyLimit)
      const graph = Number(payload && payload.graphLimit)
      return {
        history: Number.isFinite(history) ? history : DEFAULT_HISTORY_LIMIT,
        graph: Number.isFinite(graph) ? graph : DEFAULT_GRAPH_LIMIT,
      }
    }

    function toBashPath(value) {
      const text = String(value || '').replace(/\\/g, '/')
      const drive = /^([A-Za-z]):\//.exec(text)
      return drive ? `/${drive[1].toLowerCase()}${text.slice(2)}` : text
    }

    function readStartedTerminals() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(GIT_BASH_STARTED_KEY) || '{}')
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function rememberStartedTerminal(id, repo) {
      if (!id) return
      try {
        const current = readStartedTerminals()
        current[id] = { repo, at: Date.now() }
        const kept = Object.entries(current)
          .sort((left, right) => (right[1].at || 0) - (left[1].at || 0))
          .slice(0, 24)
        window.localStorage.setItem(GIT_BASH_STARTED_KEY, JSON.stringify(Object.fromEntries(kept)))
      } catch {
        /* localStorage may be unavailable; duplicate launch is harmless */
      }
    }

    function forgetStartedTerminal(id) {
      if (!id) return
      try {
        const current = readStartedTerminals()
        if (!current[id]) return
        delete current[id]
        window.localStorage.setItem(GIT_BASH_STARTED_KEY, JSON.stringify(current))
      } catch {
        /* the next launch will send the command again if this write failed */
      }
    }

    /**
     * Start Git Bash inside the shell the terminal controller discovered.
     * HISTCONTROL keeps the palette command (sent next, with a leading space)
     * out of the shell history. GIT_OPTIONAL_LOCKS stops the bash prompt from
     * taking the index lock every time it asks git for the branch name.
     */
    function buildGitBashLaunch(shellPath, repo, gitBash) {
      if (!gitBash) return ''
      const shell = String(shellPath || '')
      const winRepo = String(repo || '').replace(/\//g, '\\')
      const posixRepo = toBashPath(repo)
      if (/cmd\.exe$/i.test(shell)) {
        return `set "GIT_OPTIONAL_LOCKS=0" && set "HISTCONTROL=ignorespace" && ${repo ? `cd /d "${winRepo}" && ` : ''}"${gitBash}" --login -i\r`
      }
      if (/(pwsh|powershell)(\.exe)?$/i.test(shell)) {
        return `$env:GIT_OPTIONAL_LOCKS='0'; $env:HISTCONTROL='ignorespace'; ${repo ? `Set-Location -LiteralPath '${winRepo.replace(/'/g, "''")}'; ` : ''}& '${gitBash}' --login -i\r`
      }
      return `export GIT_OPTIONAL_LOCKS=0 HISTCONTROL=ignorespace; ${repo ? `cd "${posixRepo}"; ` : ''}"${toBashPath(gitBash)}" --login -i\r`
    }

    /**
     * DSH's xterm does not accept a palette prop, but its TerminalTheme watches
     * OSC 4/10/11/12 and keeps those overrides across theme switches. Emitting
     * mintty's default colours once after Git Bash starts makes the terminal look
     * like the real `git-bash.exe`. `clear` hides the one-off command line.
     */
    function buildGitBashPaletteCommand() {
      // One `%b` argument per colour: gluing two escapes into one format string
      // makes bash printf swallow the backslash that starts the next sequence.
      const args = GIT_BASH_PALETTE.map((color, index) => `'\\033]4;${index};${color}\\033\\\\'`)
      args.push(`'\\033]10;${TERMINAL_FOREGROUND}\\033\\\\'`)
      args.push(`'\\033]11;${TERMINAL_BACKGROUND}\\033\\\\'`)
      args.push(`'\\033]12;${TERMINAL_FOREGROUND}\\033\\\\'`)
      return ` printf '%b' ${args.join(' ')} ; clear\r`
    }

    /**
     * Bridge to the built-in terminal plugin: it owns the PTY model and the
     * xterm screen. We only supply a fake tab occurrence and the Git Bash launch
     * command, so the third column uses DSH's real terminal rather than a shell
     * emulation made by this plugin.
     */
    function createTerminalBridge(ctx) {
      const getService = (name) => (ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined)
      let sessions = getService('sessions')
      let webTerminals = getService('webTerminals')
      let locale = getService('locale')
      let theme = getService('theme')
      const serviceListeners = new Set()
      const notifyServices = () => {
        for (const listener of serviceListeners) listener()
      }
      if (ctx && typeof ctx.inject === 'function') {
        try {
          ctx.inject(['sessions', 'webTerminals', 'locale', 'theme'], (scope) => {
            sessions = scope.sessions || sessions
            webTerminals = scope.webTerminals || webTerminals
            locale = scope.locale || locale
            theme = scope.theme || theme
            notifyServices()
          })
        } catch {
          /* optional terminal services may be absent */
        }
      }
      let component = null
      const componentListeners = new Set()
      let gitBashPromise = null
      // Bumped when this panel drops its PTY, so a retain timer that already
      // fired cannot put the closed terminal back and keep holding the project.
      let holdGeneration = 0

      const notifyComponent = () => {
        for (const listener of componentListeners) listener()
      }
      const updateComponent = () => {
        let next = null
        try {
          if (!ctx || !ctx.slots || typeof ctx.slots.entriesOfSlot !== 'function') throw new Error('no slots')
          const entry = ctx.slots.entriesOfSlot('sidebar.right.pane.tab')
            .find((item) => item && item.options && item.options.key === TERMINAL_BODY_ID)
          next = entry && entry.component ? entry.component : null
        } catch {
          next = null
        }
        if (next !== component) {
          component = next
          notifyComponent()
        }
      }
      try {
        if (ctx && ctx.slots && typeof ctx.slots.inject === 'function') {
          ctx.slots.inject('sidebar.right.pane.tab', () => {
            updateComponent()
            let dispose = () => {}
            try { dispose = ctx.slots.subscribe('sidebar.right.pane.tab', updateComponent) } catch { /* fall back to polling */ }
            return dispose
          })
        }
      } catch {
        /* the slot may not be declared yet */
      }
      updateComponent()
      if (typeof window !== 'undefined' && !component) {
        let tries = 0
        const timer = window.setInterval(() => {
          updateComponent()
          if (component || (tries += 1) > 80) window.clearInterval(timer)
        }, 250)
        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(() => () => window.clearInterval(timer), 'git-workbench: terminal component poll')
        }
      }

      const fallback = {
        new: '新建终端',
        loading: '正在连接…',
        creating: '正在创建…',
        connecting: '连接中…',
        disconnected: '连接断开',
        reconnect: '重新连接',
        retry: '重试',
        readonly: '只读',
        control: '接管输入',
        exited: '进程已退出（{code}）',
        unavailable: '终端不可用',
        closed: '终端已关闭',
        title: '终端',
        failed: '终端错误：{message}',
        missingTerminal: '终端已不存在，请新建。',
        attachmentEnded: '连接已结束',
        invalidOutput: '屏幕数据无效',
        terminalLimit: '终端数量已达上限',
      }
      let boundT = null
      const refreshT = () => {
        if (!boundT && locale && typeof locale.bind === 'function') {
          try { boundT = locale.bind('sidebarTerminal') } catch { boundT = null }
        }
      }
      refreshT()
      const t = (key, params) => {
        refreshT()
        if (boundT) {
          try {
            const value = boundT(key, params)
            if (typeof value === 'string' && value && value !== key) return value
          } catch {
            /* fall through */
          }
        }
        const template = fallback[key] || key
        if (!params || typeof template !== 'string') return template
        return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? `{${name}}` : String(params[name])))
      }

      const themeSource = {
        getSnapshot: () => (theme && typeof theme.getTheme === 'function' ? theme.getTheme() : null),
        subscribe: (listener) => {
          if (!theme) return () => {}
          if (ctx && typeof ctx.on === 'function') return ctx.on('theme/change', listener)
          if (typeof theme.subscribe === 'function') return theme.subscribe(listener)
          return () => {}
        },
      }

      const getSessionId = () => {
        if (!sessions || !sessions.list) return null
        const list = sessions.list.getSnapshot()
        const rows = list && list.byId ? Object.values(list.byId) : []
        for (const row of rows) {
          if (row && (row.retainedBy && row.retainedBy.mainView || 0) > 0 && row.id) return row.id
        }
        return null
      }

      return {
        getTerminalComponent: () => component,
        subscribeTerminalComponent: (listener) => {
          componentListeners.add(listener)
          return () => componentListeners.delete(listener)
        },
        isReady: () => !!(sessions && webTerminals),
        subscribeServices: (listener) => {
          serviceListeners.add(listener)
          return () => serviceListeners.delete(listener)
        },
        getSessionId,
        subscribeSessions: (listener) => (sessions && sessions.list ? sessions.list.subscribe(listener) : () => {}),
        theme: themeSource,
        getTheme: themeSource.getSnapshot,
        t,
        getGitBash: () => {
          if (!gitBashPromise) {
            gitBashPromise = fetch(apiUrl('op=gitBash'), {
              headers: { accept: 'application/json', 'x-dsh-git-workbench': '1' },
            })
              .then((response) => response.json().catch(() => ({})))
              .then((payload) => (payload && typeof payload.gitBash === 'string' ? payload.gitBash : ''))
              .catch(() => '')
          }
          return gitBashPromise
        },
        loadShells: (sessionId, signal) => {
          if (!webTerminals) return Promise.reject(new Error('DSH 终端服务不可用'))
          return webTerminals.launchShells(sessionId, signal)
        },
        createView: (sessionId, key, contentId, shellPath) => {
          if (!webTerminals) throw new Error('DSH 终端服务不可用')
          return webTerminals.view(sessionId, key, contentId, undefined, shellPath)
        },
        /**
         * Keep this window's terminal processes alive without dropping the tabs
         * the DSH sidebar owns: retainTabs is a single global list.
         */
        currentHoldGeneration: () => holdGeneration,
        holdTerminal: (sessionId, key, contentId) => {
          if (!webTerminals || typeof webTerminals.retainTabs !== 'function') return
          const current = Array.isArray(webTerminals.openTabs) ? webTerminals.openTabs : []
          const others = current.filter((tab) => tab
            && !(tab.sessionId === sessionId && String(tab.contentId || '').startsWith(TERMINAL_CONTENT_ID)))
          webTerminals.retainTabs([
            ...others,
            { sessionId, tabId: key, contentId, kind: 'git-bash' },
          ])
        },
        /** Drop our retained PTY so a hidden terminal cannot keep the project directory open. */
        releaseTerminal: (sessionId) => {
          holdGeneration += 1
          if (!webTerminals || typeof webTerminals.retainTabs !== 'function') return
          const current = Array.isArray(webTerminals.openTabs) ? webTerminals.openTabs : []
          webTerminals.retainTabs(current.filter((tab) => tab
            && !(tab.sessionId === sessionId && String(tab.contentId || '').startsWith(TERMINAL_CONTENT_ID))))
        },
        closeView: (sessionId, key, contentId) => {
          if (!webTerminals) return
          try { webTerminals.close(sessionId, key, contentId) } catch { /* already gone */ }
        },
      }
    }

    class TerminalErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error) {
        console.warn('git-workbench terminal:', error)
      }
      render() {
        return this.state.error
          ? h('div', { style: styles.empty }, '内置终端加载失败：', String((this.state.error && this.state.error.message) || this.state.error))
          : this.props.children
      }
    }
// @part 07-terminal-pane.js
    function terminalFailureDetail(value) {
      if (!value || typeof value !== 'object') return ''
      const info = value.info && typeof value.info === 'object' ? value.info : {}
      const candidates = [info.message, info.error, info.reason, info.detail, value.error, value.message]
      for (const item of candidates) {
        if (typeof item === 'string' && item.trim()) return item.trim()
        if (item && typeof item === 'object' && typeof item.message === 'string' && item.message.trim()) return item.message.trim()
      }
      return ''
    }

    function GitTerminalPane({ bridge, repo, onClose }) {
      const servicesReady = React.useSyncExternalStore(bridge.subscribeServices, bridge.isReady)
      const terminalComponent = React.useSyncExternalStore(bridge.subscribeTerminalComponent, bridge.getTerminalComponent)
      const [sessionId, setSessionId] = React.useState(null)
      const [shellState, setShellState] = React.useState(null)
      const [shellError, setShellError] = React.useState('')
      const [gitBash, setGitBash] = React.useState(null)
      const [epoch, setEpoch] = React.useState(0)
      const [view, setView] = React.useState(null)
      const viewRef = React.useRef(null)
      const paneRef = React.useRef(null)
      const bashRetryRef = React.useRef(0)

      // One terminal per project: a project switch (or the 新建 button) gets a
      // fresh content identity, so DSH allocates a new PTY instead of re-adopting
      // the previous (possibly closed or read-only) terminal binding.
      const repoKey = normalizeKey(repo)
      const viewKey = `${TERMINAL_KEY}:${repoKey}:${epoch}`
      const contentId = `${TERMINAL_CONTENT_ID}:${repoKey}:${epoch}`

      React.useEffect(() => {
        if (!servicesReady) {
          setSessionId(null)
          return undefined
        }
        const read = () => setSessionId(bridge.getSessionId())
        read()
        return bridge.subscribeSessions(read)
      }, [servicesReady, bridge])

      React.useEffect(() => {
        let alive = true
        bridge.getGitBash().then((value) => { if (alive) setGitBash(value) })
        return () => { alive = false }
      }, [bridge])

      React.useEffect(() => {
        if (!servicesReady || !sessionId) {
          setShellState(null)
          setShellError('')
          return undefined
        }
        const controller = new AbortController()
        setShellState(null)
        setShellError('')
        bridge.loadShells(sessionId, controller.signal).then((result) => {
          if (controller.signal.aborted) return
          const list = result && Array.isArray(result.shells) ? result.shells : []
          // cmd / PowerShell can host Git Bash reliably; WSL's bash cannot run a
          // Windows .exe, so it stays the last resort.
          const picked = list.find((item) => /cmd\.exe$/i.test(item.path))
            || list.find((item) => /(pwsh|powershell)(\.exe)?$/i.test(item.path))
            || list.find((item) => item.path === result.selectedShell)
            || list[0]
            || null
          setShellState({ list, picked })
        }).catch((failure) => {
          if (!controller.signal.aborted) setShellError(String((failure && failure.message) || failure))
        })
        return () => controller.abort()
      }, [servicesReady, sessionId, bridge])

      React.useEffect(() => {
        if (!servicesReady || !sessionId || !shellState || !shellState.picked) {
          const orphan = viewRef.current
          if (orphan) {
            const orphanId = orphan.view && orphan.view.id ? String(orphan.view.id) : ''
            forgetStartedTerminal(orphanId)
            bridge.releaseTerminal(orphan.sessionId)
            bridge.closeView(orphan.sessionId, orphan.key, orphan.contentId)
            viewRef.current = null
            setView(null)
          }
          return undefined
        }
        const previous = viewRef.current
        if (previous && previous.key === viewKey && previous.contentId === contentId && previous.sessionId === sessionId) {
          return undefined
        }
        if (previous) {
          // Close the old identity before creating the new one; otherwise the
          // content binding would point the new view at a dead terminal.
          const previousId = previous.view && previous.view.id ? String(previous.view.id) : ''
          forgetStartedTerminal(previousId)
          bridge.closeView(previous.sessionId, previous.key, previous.contentId)
          viewRef.current = null
        }
        try {
          const next = bridge.createView(sessionId, viewKey, contentId, shellState.picked.path)
          bridge.holdTerminal(sessionId, viewKey, contentId)
          viewRef.current = { sessionId, key: viewKey, contentId, view: next }
          setView(next)
        } catch (failure) {
          setShellError(String((failure && failure.message) || failure))
          setView(null)
        }
        return undefined
      }, [servicesReady, sessionId, shellState, viewKey, contentId, bridge])

      // Collapsing the terminal or leaving the Git panel unmounts this pane.
      // End the PTY here; otherwise retainTabs keeps bash in the project and
      // Windows will not release the directory.
      React.useEffect(() => () => {
        const current = viewRef.current
        if (!current) return
        const id = current.view && current.view.id ? String(current.view.id) : ''
        forgetStartedTerminal(id)
        bridge.releaseTerminal(current.sessionId)
        bridge.closeView(current.sessionId, current.key, current.contentId)
        viewRef.current = null
      }, [bridge])

      const subscribeState = React.useCallback((listener) => (view ? view.state.subscribe(listener) : () => {}), [view])
      const getStateSnapshot = React.useCallback(() => (view ? view.state.getSnapshot() : null), [view])
      const getStatusKey = React.useCallback(() => {
        if (!view) return ''
        const value = view.state.getSnapshot()
        const detail = (value.phase === 'failed' || value.phase === 'closed')
          ? terminalFailureDetail(value).replace(/\u001f/g, ' ')
          : ''
        return `${value.phase || ''}\u001f${value.writable ? 1 : 0}\u001f${value.info && value.info.state ? value.info.state : ''}\u001f${detail}`
      }, [view])
      // The wrapper only needs phase/writable, not every screen frame; a string
      // snapshot keeps output from re-rendering the whole panel.
      const statusKey = React.useSyncExternalStore(subscribeState, getStatusKey)
      const [phase = '', writableFlag = '0', infoState = '', detail = ''] = statusKey.split('\u001f')
      const writable = writableFlag === '1'

      React.useEffect(() => {
        bashRetryRef.current = 0
      }, [repoKey])

      // After DSH restarts, the first view often reattaches a PTY that died with
      // the previous process. Wait briefly so a terminal that is only passing
      // through "closed" on its way to "connected" is left alone, then drop the
      // dead binding once and allocate a new one.
      React.useEffect(() => {
        if (phase !== 'failed' && phase !== 'closed') return undefined
        if (bashRetryRef.current >= 1) return undefined
        const current = viewRef.current
        if (!current || !view) return undefined
        const watched = view
        const timer = window.setTimeout(() => {
          if (bashRetryRef.current >= 1) return
          if (viewRef.current !== current) return
          const value = watched.state && watched.state.getSnapshot ? watched.state.getSnapshot() : null
          const still = value && value.phase
          if (still !== 'failed' && still !== 'closed') return
          bashRetryRef.current += 1
          const id = watched.id ? String(watched.id) : ''
          forgetStartedTerminal(id)
          bridge.closeView(current.sessionId, current.key, current.contentId)
          viewRef.current = null
          setView(null)
          setEpoch((epochValue) => epochValue + 1)
        }, 700)
        return () => window.clearTimeout(timer)
      }, [phase, view, bridge])

      const restart = React.useCallback(() => {
        // New content identity → a real new PTY; the view effect closes the old one.
        bashRetryRef.current = 0
        setView(null)
        setEpoch((value) => value + 1)
      }, [])

      React.useEffect(() => {
        if (!view || !writable) return undefined
        const id = view.id ? String(view.id) : ''
        const remembered = id ? readStartedTerminals()[id] : undefined
        if (!remembered && gitBash) {
          const launch = buildGitBashLaunch(shellState && shellState.picked ? shellState.picked.path : '', repo, gitBash)
          if (launch) {
            try {
              view.write(launch)
              if (id) rememberStartedTerminal(id, repo)
            } catch {
              /* the terminal closed before the shell could take the command */
            }
          }
        }
        if (!gitBash) return undefined
        // Git Bash reads the palette command after its login banner; when the
        // shell is already running (panel remount) 60ms is enough.
        const timer = window.setTimeout(() => {
          try {
            view.write(buildGitBashPaletteCommand())
            if (id) rememberStartedTerminal(id, repo)
          } catch {
            /* the terminal was closed before the timer fired */
          }
        }, remembered ? 60 : 900)
        return () => window.clearTimeout(timer)
      }, [view, writable, gitBash, shellState, repo])

      // Focus the xterm after a new terminal or a project switch, but never steal
      // focus from the search box or another input.
      React.useEffect(() => {
        if (!view || !writable) return undefined
        const timer = window.setTimeout(() => {
          const node = paneRef.current
          if (!node) return
          const active = document.activeElement
          if (active && node.contains(active)) return
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
          const textarea = node.querySelector('textarea.xterm-helper-textarea')
          if (textarea) textarea.focus()
        }, 250)
        return () => window.clearTimeout(timer)
      }, [view, writable, repoKey])

      // retainTabs is one global list shared with DSH's own terminal tabs; when
      // that list is rewritten our process could lose its window hold, so put
      // our entry back without touching the other tabs. A release bumps the
      // generation so this timer cannot resurrect a terminal we just closed.
      React.useEffect(() => {
        if (!view) return undefined
        const generation = bridge.currentHoldGeneration()
        const timer = window.setInterval(() => {
          if (bridge.currentHoldGeneration() !== generation) return
          const current = viewRef.current
          if (current) bridge.holdTerminal(current.sessionId, current.key, current.contentId)
        }, 4000)
        return () => window.clearInterval(timer)
      }, [view, bridge])

      const fakeTab = React.useMemo(() => ({
        id: TERMINAL_KEY,
        visible: true,
        actions: { openTab: () => restart() },
      }), [restart])
      const useTabInfo = React.useCallback(() => ({ tab: fakeTab }), [fakeTab])
      const useTerminal = React.useCallback(() => React.useSyncExternalStore(subscribeState, getStateSnapshot), [subscribeState, getStateSnapshot])
      const themeCache = React.useRef({ base: undefined, patched: null })
      const useTheme = React.useCallback((selector) => React.useSyncExternalStore(
        bridge.theme.subscribe,
        () => {
          const base = bridge.theme.getSnapshot()
          const cache = themeCache.current
          if (cache.base !== base || !cache.patched) {
            const value = base || {}
            cache.base = base
            cache.patched = {
              ...value,
              fontFamilies: { ...(value.fontFamilies || {}), terminal: TERMINAL_FONT },
              fontSizes: { ...(value.fontSizes || {}), terminal: 13 },
            }
          }
          // useSyncExternalStore requires a stable snapshot: return the cached
          // object, not a fresh spread on every call.
          return selector(cache.patched)
        },
      ), [bridge])
      const viewFn = React.useCallback(() => view, [view])
      const themeValue = bridge.getTheme()

      let status = 'Git Bash'
      if (!servicesReady) status = '等待终端服务…'
      else if (!sessionId) status = '没有活动会话'
      else if (shellError) status = shellError
      else if (!shellState) status = '读取 Shell…'
      else if (!shellState.picked) status = '没有可用的 Shell'
      else if (gitBash === null) status = '查找 Git Bash…'
      else if (!gitBash) status = '未找到 Git Bash，使用默认 Shell'
      else if (!view) status = '创建终端…'
      else if (phase === 'failed') {
        const reason = detail || (infoState && infoState !== 'exited' ? infoState : '')
        status = reason ? `连接失败：${reason}` : '连接失败'
      }
      else if (phase === 'closed' || infoState === 'exited') status = detail ? `终端已关闭：${detail}` : '终端已关闭'
      else if (phase === 'connected') status = 'Git Bash'

      let body
      if (!servicesReady) {
        body = h('div', { style: styles.empty }, '正在等待 DSH 终端服务…')
      } else if (!sessionId) {
        body = h('div', { style: styles.empty }, '先打开一个会话，终端会使用这个会话的权限和 Git Bash。')
      } else if (shellError) {
        body = h('div', { style: styles.empty }, shellError)
      } else if (!shellState) {
        body = h('div', { style: styles.empty }, '正在读取可用的 Shell…')
      } else if (!shellState.picked) {
        body = h('div', { style: styles.empty }, '没有可用的 Shell。')
      } else if (!terminalComponent) {
        body = h('div', { style: styles.empty }, '正在等待 DSH 内置终端组件…')
      } else if (!themeValue) {
        body = h('div', { style: styles.empty }, '主题服务不可用，无法渲染终端。')
      } else if (!view) {
        body = h('div', { style: styles.empty }, '正在创建 Git Bash 终端…')
      } else {
        body = h(TerminalErrorBoundary, { key: view.id ? String(view.id) : 'terminal' },
          h(terminalComponent, { useTabInfo, useTerminal, useTheme, view: viewFn, t: bridge.t }),
        )
      }

      const terminalLabel = gitBash ? 'Git Bash' : '终端'
      return h('div', { style: styles.terminalInner },
        h('div', { style: styles.terminalHead },
          h('span', { style: { ...styles.dot, background: gitBash ? '#40FF40' : 'var(--dsw-alias-state-warn-primary)' } }),
          h('span', { style: styles.terminalTitle, title: repo ? `${terminalLabel} · ${repo}` : terminalLabel },
            `${terminalLabel}${repo ? ' · ' + baseName(repo) : ''}`),
          h('span', {
            style: {
              flex: '0 0 auto',
              fontSize: 12,
              maxWidth: 280,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: phase === 'failed' ? '#FF4040' : '#9e9e9e',
            },
            title: status,
          }, status),
          h('button', {
            style: styles.terminalDarkButton,
            title: '在项目目录里新开一个 Git Bash（会结束当前终端进程）',
            onClick: restart,
          }, '新建'),
          h('button', {
            style: styles.terminalDarkButton,
            title: '收起终端',
            onClick: onClose,
          }, '×'),
        ),
        h('div', { style: styles.terminalBody, ref: paneRef }, body),
      )
    }
// @part 08-lists.js
    function relationText(report) {
      const branch = report && report.branch ? report.branch : '默认分支'
      if (!report) return ''
      if (report.relation === 'push') return `远端分支 ${branch} 没有需要合进来的提交。用「推送」把本地提交送上去。`
      if (report.relation === 'same') return `本地和远端 ${branch} 是同一次提交。`
      if (report.relation === 'empty') return '远端还没有任何提交。本地提交之后直接推送。'
      if (report.relation === 'ff') return `远端 ${branch} 比本地超前，可以快进合并，不会产生新的合并提交。`
      if (report.relation === 'merge') return `本地和远端 ${branch} 都有新提交。合并后改动先放进暂存区，填写日志再提交。`
      if (report.relation === 'unrelated') return `本地和远端 ${branch} 没有共同祖先。合并会把两边的文件放到同一次提交里；冲突的文件在变更树里选择「用本地」或「用远端」，再填写日志提交。`
      if (report.relation === 'local-unborn') return `本地还没有提交。会把远端 ${branch} 的历史取下来作为当前分支。`
      if (report.relation === 'choose') return '远端有多个分支，先选择要合并的那一个。'
      if (report.pending && report.conflicts && report.conflicts.length) return `有 ${report.conflicts.length} 个冲突。在变更树里选择「用本地」或「用远端」，再填写日志提交。`
      if (report.pending) return '两边的改动已经放进暂存区。填写日志后提交。'
      if (report.merged) return '已把远端历史快进到本地。'
      return '已读取远端。'
    }

    function checkedOutBranch(status) {
      const name = status && status.branch
      if (!name || name === 'HEAD') return ''
      return name
    }

    function integrateLabel(relation) {
      if (relation === 'ff') return '快进合并'
      if (relation === 'local-unborn') return '取下远端历史'
      return '合并两边'
    }

    function renderChangeFile(entry, padLeft, openDiffTab, actions) {
      const tone = colorForStatus(entry.xy)
      const deleted = isDeleted(entry)
      const busy = !!(actions && (actions.stageBusy === entry.path || actions.sideBusy === entry.path))
      let action = null
      if (actions && entry.kind === 'conflict') {
        action = h('span', { style: styles.fileActions, onClick: (event) => event.stopPropagation() },
          h('button', {
            type: 'button',
            style: styles.rowButton,
            disabled: busy,
            title: '保留当前分支上的这一边',
            onClick: (event) => { event.preventDefault(); actions.onTakeSide(entry, 'ours') },
          }, '用本地'),
          h('button', {
            type: 'button',
            style: styles.rowButton,
            disabled: busy,
            title: '保留远端的这一边',
            onClick: (event) => { event.preventDefault(); actions.onTakeSide(entry, 'theirs') },
          }, '用远端'),
        )
      } else if (actions && (entry.unstaged || entry.untracked)) {
        action = h('button', {
          type: 'button',
          style: styles.rowButton,
          disabled: busy,
          title: actions.headBranch ? `git add 这个文件，只影响分支 ${actions.headBranch}` : 'git add 这个文件',
          onClick: (event) => { event.preventDefault(); event.stopPropagation(); actions.onStage(entry) },
        }, actions.stageBusy === entry.path ? '暂存中…' : 'add')
      } else if (actions && entry.staged) {
        action = h('span', { style: styles.count }, '已暂存')
      }
      return h('div', {
        key: 'file:' + entry.path,
        className: 'dsh-git-hit',
        style: { ...styles.fileRow, paddingLeft: padLeft },
        onClick: () => openDiffTab(entry),
        title: `${statusLabel(entry.xy)}\n${entry.path}`,
      },
        h('span', { style: { ...styles.xy, color: tone } }, displayXY(entry)),
        h('span', {
          style: {
            ...styles.fileName,
            color: tone,
            textDecoration: deleted ? 'line-through' : 'none',
          },
        }, baseName(entry.path)),
        h('span', { style: { ...styles.count, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 400 } }, entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : ''),
        action,
      )
    }

    function renderChangeList({
      files, tree, collapsed, toggleDir, openDiffTab, treeMode, onTreeMode,
      stagedCount, unstagedCount, untrackedCount, moduleNames,
      commitMessage, onCommitMessage, onCommit, commitBusy, commitError, conflictCount, merging,
      onStage, onTakeSide, stageBusy, sideBusy, headBranch,
    }) {
      const actions = headBranch ? { onStage, onTakeSide, stageBusy, sideBusy, headBranch } : null
      const messageReady = !!(commitMessage && String(commitMessage).trim())
      const canCommit = !!headBranch && messageReady && stagedCount > 0 && !conflictCount && !commitBusy
      const rows = []
      const renderNode = (node, depth) => {
        for (const dir of dirsOf(node)) {
          const isCollapsed = collapsed.has(dir.key)
          rows.push(h('div', {
            key: 'dir:' + dir.key,
            className: 'dsh-git-hit',
            style: {
              ...(depth === 0 ? styles.moduleRow : styles.dirRow),
              paddingLeft: depth === 0 ? 12 : 8 + depth * 14,
            },
            onClick: () => toggleDir(dir.key),
            title: dir.key,
          },
            h('span', { style: styles.caret }, isCollapsed ? '▸' : '▾'),
            h('span', { style: styles.dirName }, dir.name),
            h('span', { style: styles.count }, String(dir.counts.total)),
            h('span', { style: styles.dots }, statusDots(dir.counts)),
          ))
          if (!isCollapsed) renderNode(dir, depth + 1)
        }
        for (const entry of node.files) {
          rows.push(renderChangeFile(entry, 8 + depth * 14 + 12, openDiffTab, actions))
        }
      }
      if (treeMode === 'files') {
        const flat = files.slice().sort((a, b) => String(a.path).localeCompare(String(b.path), 'zh-Hans-CN'))
        for (const entry of flat) rows.push(renderChangeFile(entry, 12, openDiffTab, actions))
      } else {
        renderNode(tree, 0)
      }
      const modeButton = (mode, label) => h('button', {
        key: mode,
        style: {
          ...styles.buttonQuiet,
          ...(treeMode === mode ? { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' } : {}),
        },
        type: 'button',
        onClick: (event) => { event.preventDefault(); onTreeMode(mode) },
      }, label)
      return h('div', null,
        h('div', { style: styles.treeSummary },
          h('div', null, `${files.length} 个文件有未提交改动 · 已暂存 ${stagedCount} · 未暂存 ${unstagedCount} · 未跟踪 ${untrackedCount}`),
          treeMode === 'modules'
            ? h('div', null, moduleNames.length ? `${moduleNames.length} 个模块：${moduleNames.slice(0, 6).join('、')}${moduleNames.length > 6 ? '…' : ''}` : '')
            : h('div', null, '只列出文件，不按模块折叠。'),
          h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
            modeButton('modules', '按模块'),
            modeButton('files', '只显示文件'),
          ),
          statusLegend(),
          headBranch
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 } },
                h('div', null, `只提交到当前分支 ${headBranch}`),
                h('textarea', {
                  style: styles.commitBox,
                  value: commitMessage || '',
                  placeholder: merging ? `填写日志，在 ${headBranch} 上完成这次合并` : `提交到 ${headBranch}（日志必填）`,
                  spellCheck: false,
                  onChange: (event) => onCommitMessage(event.target.value),
                  onKeyDown: (event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canCommit) onCommit()
                  },
                }),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('button', {
                    type: 'button',
                    style: { ...styles.button, opacity: canCommit ? 1 : 0.45 },
                    disabled: !canCommit,
                    title: !messageReady
                      ? '先填写提交日志'
                      : (conflictCount ? '先解决冲突' : (stagedCount === 0 ? '先 add 要提交的文件' : `提交到 ${headBranch}`)),
                    onClick: (event) => { event.preventDefault(); onCommit() },
                  }, commitBusy ? '提交中…' : '提交'),
                  h('span', null, conflictCount
                    ? `${conflictCount} 个冲突待选择，解决后才能提交`
                    : (stagedCount === 0 ? '先 add 文件。日志为空不能提交。' : `只提交已 add 的文件到 ${headBranch}。`)),
                ),
                commitError
                  ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'normal' } }, commitError)
                  : null,
              )
            : h('div', { style: { marginTop: 8 } }, '当前不在分支上。先切换到一个分支，再暂存和提交。'),
        ),
        rows,
      )
    }

    function renderDirectoryList({
      rootNode, dirNodes, expandedDirs, setExpandedDirs, changedDirCounts, changedByPath,
      loadDirectory, openDiffTab, openFileTab, resetDirectories,
    }) {
      const rows = []
      const pad = (depth, extra = 0) => 8 + depth * 14 + extra
      const loadingRow = (relPath, depth) => {
        rows.push(h('div', {
          key: 'dir-loading:' + relPath,
          style: { padding: `4px 8px 4px ${pad(depth, 12)}px`, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
        }, '读取中…'))
      }
      const errorRow = (relPath, rowError, depth) => {
        rows.push(h('div', {
          key: 'dir-error:' + relPath,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: `4px 8px 4px ${pad(depth, 12)}px`,
            fontSize: 12,
            color: 'var(--dsw-alias-state-error-primary)',
          },
        },
          h('span', { style: { flex: '1 1 auto', whiteSpace: 'normal' } }, rowError),
          h('button', { style: styles.buttonQuiet, onClick: () => loadDirectory(relPath, true) }, '重试'),
        ))
      }
      const renderDirChildren = (relPath, depth) => {
        const node = dirNodes[relPath]
        if (!node) {
          loadingRow(relPath, depth)
          return
        }
        if (node.error) {
          errorRow(relPath, node.error, depth)
          return
        }
        if (!node.loaded) {
          loadingRow(relPath, depth)
          return
        }
        if (!node.dirs.length && !node.files.length) {
          rows.push(h('div', {
            key: 'dir-empty:' + relPath,
            style: { padding: `4px 8px 4px ${pad(depth, 12)}px`, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
          }, '空目录'))
          return
        }
        for (const dir of node.dirs) {
          const isOpen = expandedDirs.has(dir.path)
          const changedCount = changedDirCounts.get(dir.path) || 0
          rows.push(h('div', {
            key: 'dir-tree:' + dir.path,
            className: 'dsh-git-hit',
            style: {
              ...(depth === 0 ? styles.moduleRow : styles.dirRow),
              paddingLeft: depth === 0 ? 12 : pad(depth),
            },
            onClick: () => setExpandedDirs((current) => {
              const next = new Set(current)
              if (next.has(dir.path)) next.delete(dir.path)
              else next.add(dir.path)
              return next
            }),
            title: `${dir.path}/`,
          },
            h('span', { style: styles.caret }, isOpen ? '▾' : '▸'),
            h('span', { style: styles.dirName }, dir.name || baseName(dir.path)),
            changedCount
              ? h('span', { style: { ...styles.dot, background: 'var(--dsw-alias-state-warn-primary)' }, title: `${changedCount} 个文件有未提交改动` })
              : null,
          ))
          if (isOpen) renderDirChildren(dir.path, depth + 1)
        }
        for (const file of node.files) {
          const change = changedByPath.get(file.path)
          const deleted = !!change && isDeleted(change)
          const tone = change ? colorForStatus(change.xy) : 'var(--dsw-alias-label-primary)'
          rows.push(h('div', {
            key: 'file-tree:' + file.path,
            className: 'dsh-git-hit',
            style: { ...styles.fileRow, paddingLeft: pad(depth, 12) },
            onClick: () => (deleted ? openDiffTab(change) : openFileTab(file.path)),
            title: `${change ? statusLabel(change.xy) + (deleted ? '（已删除，点开差异）' : '') + ' · ' : ''}${file.path}${file.type === 'link' ? '（符号链接）' : ''}`,
          },
            h('span', { style: { ...styles.tabBadge, color: change ? tone : extColor(file.path) } }, change ? displayXY(change) : extLabel(file.path)),
            h('span', { style: { ...styles.fileName, color: tone, textDecoration: deleted ? 'line-through' : 'none' } }, file.name || baseName(file.path)),
          ))
        }
        if (node.truncated) {
          rows.push(h('div', {
            key: 'dir-truncated:' + relPath,
            style: { padding: `4px 8px 4px ${pad(depth, 12)}px`, fontSize: 12, color: 'var(--dsw-alias-state-warn-primary)' },
          }, '这个目录条目超过 5000 个，只显示前 5000 个。'))
        }
      }
      if (rootNode.dirs.length || rootNode.files.length) renderDirChildren('', 0)
      return h('div', null,
        h('div', { style: styles.treeSummary },
          h('div', null, `整个项目目录 · 顶层 ${rootNode.dirs.length} 个文件夹 / ${rootNode.files.length} 个文件`),
          h('div', { style: { marginTop: 4 } },
            '含 .gitignore 忽略的目录/文件和空目录（隐藏 .git）；点击文件夹展开，点文件打开全文。'),
          h('div', { style: { marginTop: 6, display: 'flex', gap: 6 } },
            h('button', { style: styles.buttonQuiet, onClick: resetDirectories }, '重新读取'),
            h('button', { style: styles.buttonQuiet, onClick: () => setExpandedDirs(new Set()) }, '全部收起'),
          ),
        ),
        rows.length ? rows : h('div', { style: styles.empty }, '项目目录是空的。'),
      )
    }
// @part 09-panel-state.js
    function GitWorkbenchPanel() {
      const stored = React.useMemo(() => {
        const current = readStore()
        if (typeof current.repo === 'string' && current.repo) return current
        // 0.3.0 kept the single repository under its own key; carry it over once.
        try {
          const legacy = window.localStorage.getItem('dsh-git-workbench.repo')
          if (legacy) return { ...current, repo: legacy }
        } catch {
          /* ignore */
        }
        return current
      }, [])
      const [repo, setRepo] = React.useState(() => (typeof stored.repo === 'string' ? stored.repo : ''))
      const [manualRepos, setManualRepos] = React.useState(() => (Array.isArray(stored.manualRepos) ? stored.manualRepos.filter((item) => typeof item === 'string') : []))
      const [repoColors, setRepoColors] = React.useState(() => (stored.repoColors && typeof stored.repoColors === 'object' ? stored.repoColors : {}))
      const [auto, setAuto] = React.useState({ repos: [], workspaces: [], source: '', defaultRepo: '' })
      const [limits, setLimits] = React.useState({ history: DEFAULT_HISTORY_LIMIT, graph: DEFAULT_GRAPH_LIMIT })
      const [manualEntries, setManualEntries] = React.useState([])
      const [reposBusy, setReposBusy] = React.useState(false)
      const [reposError, setReposError] = React.useState('')
      const [repoMenuOpen, setRepoMenuOpen] = React.useState(false)
      const [repoFilter, setRepoFilter] = React.useState('')
      const [newPath, setNewPath] = React.useState('')
      const [addBusy, setAddBusy] = React.useState(false)
      const [addError, setAddError] = React.useState('')

      const [tab, setTab] = React.useState('changes')
      const [status, setStatus] = React.useState(null)
      const [commits, setCommits] = React.useState([])
      const [branches, setBranches] = React.useState([])
      const [graph, setGraph] = React.useState([])
      const [unborn, setUnborn] = React.useState(false)
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState('')

      const [openTabs, setOpenTabs] = React.useState([])
      const [activeTabId, setActiveTabId] = React.useState('')
      const [detail, setDetail] = React.useState('')
      const [detailError, setDetailError] = React.useState('')
      const [detailBusy, setDetailBusy] = React.useState(false)
      const [detailMeta, setDetailMeta] = React.useState({ truncated: false, size: 0, binary: false })

      const [collapsed, setCollapsed] = React.useState(() => new Set())
      const [searchText, setSearchText] = React.useState('')
      const [searchOpen, setSearchOpen] = React.useState(false)
      const [searchIndex, setSearchIndex] = React.useState(0)
      const [allFiles, setAllFiles] = React.useState(null)
      const [colorPicker, setColorPicker] = React.useState(null)
      const [branchMenuOpen, setBranchMenuOpen] = React.useState(false)
      const [branchBusy, setBranchBusy] = React.useState('')
      const [branchError, setBranchError] = React.useState('')
      const [branchDraft, setBranchDraft] = React.useState('')
      const [renameDraft, setRenameDraft] = React.useState('')
      const [syncBusy, setSyncBusy] = React.useState('')
      const [origin, setOrigin] = React.useState(null)
      const [bindUrl, setBindUrl] = React.useState('')
      const [bindOpen, setBindOpen] = React.useState(false)
      const [moreOpen, setMoreOpen] = React.useState(false)
      const [bindBusy, setBindBusy] = React.useState(false)
      const [bindReport, setBindReport] = React.useState(null)
      const [integrateBusy, setIntegrateBusy] = React.useState(false)
      const [commitMessage, setCommitMessage] = React.useState('')
      const [commitBusy, setCommitBusy] = React.useState(false)
      const [commitError, setCommitError] = React.useState('')
      const [stageBusy, setStageBusy] = React.useState('')
      const [sideBusy, setSideBusy] = React.useState('')
      const [treeMode, setTreeMode] = React.useState(() => (stored.treeMode === 'files' ? 'files' : 'modules'))
      const [changedMarks, setChangedMarks] = React.useState({ added: [], near: [] })
      const [notice, setNotice] = React.useState('')
      const [sidebarWidth, setSidebarWidth] = React.useState(() => {
        const width = Number(stored.sidebarWidth)
        return Number.isFinite(width)
          ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
          : SIDEBAR_DEFAULT_WIDTH
      })
      const [terminalOpen, setTerminalOpen] = React.useState(() => stored.terminalOpen === true)
      const [terminalWidth, setTerminalWidth] = React.useState(() => {
        const width = Number(stored.terminalWidth)
        return Number.isFinite(width)
          ? Math.min(TERMINAL_MAX_WIDTH, Math.max(TERMINAL_MIN_WIDTH, Math.round(width)))
          : TERMINAL_DEFAULT_WIDTH
      })
      const [expandedDirs, setExpandedDirs] = React.useState(() => new Set())
      // The directory tab is a lazy tree: one host `dir` call per opened folder,
      // so the whole project (including .gitignore'd folders) can be browsed
      // without reading everything at once.
      const [dirNodes, setDirNodes] = React.useState({})

      const flash = React.useCallback((message) => {
        setNotice(message)
        window.setTimeout(() => setNotice((current) => (current === message ? '' : current)), 2200)
      }, [])

      const repoRef = React.useRef(repo)
      React.useEffect(() => { repoRef.current = repo }, [repo])
      const searchWrapRef = React.useRef(null)
      const bodyRef = React.useRef(null)
      const sidebarWidthRef = React.useRef(sidebarWidth)
      const terminalWidthRef = React.useRef(terminalWidth)
      const terminalOpenRef = React.useRef(terminalOpen)
      const dirRequestsRef = React.useRef(new Set())
      const dirEpochRef = React.useRef(0)

      React.useEffect(() => { terminalOpenRef.current = terminalOpen }, [terminalOpen])
      React.useEffect(() => { terminalWidthRef.current = terminalWidth }, [terminalWidth])

      /**
       * Keep the columns inside the panel: at least SIDEBAR_MIN_WIDTH for the
       * list, MAIN_MIN_WIDTH for the diff and TERMINAL_MIN_WIDTH for the shell.
       * Computed from the actual body width so a narrow DSH window cannot
       * squeeze a column to nothing.
       */
      const clampSidebarWidth = React.useCallback((value) => {
        const bodyWidth = bodyRef.current ? bodyRef.current.clientWidth : (window.innerWidth || 1280)
        const terminalSpace = terminalOpenRef.current ? terminalWidthRef.current + SPLITTER_WIDTH : 0
        const max = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, bodyWidth - terminalSpace - MAIN_MIN_WIDTH - SPLITTER_WIDTH))
        return Math.round(Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, Number(value) || SIDEBAR_DEFAULT_WIDTH)))
      }, [])

      const clampTerminalWidth = React.useCallback((value) => {
        const bodyWidth = bodyRef.current ? bodyRef.current.clientWidth : (window.innerWidth || 1280)
        const max = Math.max(TERMINAL_MIN_WIDTH, Math.min(TERMINAL_MAX_WIDTH, bodyWidth - sidebarWidthRef.current - MAIN_MIN_WIDTH - SPLITTER_WIDTH * 2))
        return Math.round(Math.min(max, Math.max(TERMINAL_MIN_WIDTH, Number(value) || TERMINAL_DEFAULT_WIDTH)))
      }, [])

      const resizeSidebar = React.useCallback((value) => {
        const next = clampSidebarWidth(value)
        sidebarWidthRef.current = next
        setSidebarWidth(next)
        return next
      }, [clampSidebarWidth])

      const resizeTerminal = React.useCallback((value) => {
        const next = clampTerminalWidth(value)
        terminalWidthRef.current = next
        setTerminalWidth(next)
        return next
      }, [clampTerminalWidth])

      const commitSidebar = React.useCallback(() => {
        writeStore({ sidebarWidth: sidebarWidthRef.current })
      }, [])

      const commitTerminal = React.useCallback(() => {
        writeStore({ terminalWidth: terminalWidthRef.current })
      }, [])

      const toggleTerminal = React.useCallback(() => {
        const next = !terminalOpenRef.current
        terminalOpenRef.current = next
        setTerminalOpen(next)
        writeStore({ terminalOpen: next })
        if (next) {
          const width = clampTerminalWidth(terminalWidthRef.current)
          terminalWidthRef.current = width
          setTerminalWidth(width)
          const sidebar = clampSidebarWidth(sidebarWidthRef.current)
          sidebarWidthRef.current = sidebar
          setSidebarWidth(sidebar)
        }
      }, [clampSidebarWidth, clampTerminalWidth])

      // If the DSH panel itself shrinks, pull both columns in with it.
      React.useEffect(() => {
        const node = bodyRef.current
        if (!node || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(() => {
          if (terminalOpenRef.current) {
            const nextTerminal = clampTerminalWidth(terminalWidthRef.current)
            if (nextTerminal !== terminalWidthRef.current) {
              terminalWidthRef.current = nextTerminal
              setTerminalWidth(nextTerminal)
              writeStore({ terminalWidth: nextTerminal })
            }
          }
          const next = clampSidebarWidth(sidebarWidthRef.current)
          if (next !== sidebarWidthRef.current) {
            sidebarWidthRef.current = next
            setSidebarWidth(next)
            writeStore({ sidebarWidth: next })
          }
        })
        observer.observe(node)
        return () => observer.disconnect()
      }, [clampSidebarWidth, clampTerminalWidth])

      const call = React.useCallback(async (op, extra, repoOverride) => {
        const target = repoOverride === undefined ? repoRef.current : repoOverride
        const params = new URLSearchParams({ op })
        if (target) params.set('repo', target)
        if (extra) for (const [key, value] of Object.entries(extra)) params.set(key, String(value))
        const response = await fetch(apiUrl(params), {
          headers: { accept: 'application/json', 'x-dsh-git-workbench': '1' },
        })
        const payload = await response.json().catch(() => ({ error: '响应不是合法 JSON' }))
        if (!response.ok) {
          const error = new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`)
          error.payload = payload
          throw error
        }
        return payload
      }, [])

      const callPost = React.useCallback(async (op, body, repoOverride) => {
        const target = repoOverride === undefined ? repoRef.current : repoOverride
        const params = new URLSearchParams({ op })
        if (target) params.set('repo', target)
        const response = await fetch(apiUrl(params), {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-dsh-git-workbench': '1',
          },
          body: JSON.stringify(body || {}),
        })
        const payload = await response.json().catch(() => ({ error: '响应不是合法 JSON' }))
        if (!response.ok) {
          const error = new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`)
          error.payload = payload
          throw error
        }
        return payload
      }, [])

      /** Drop every cached folder and ignore responses already in flight. */
      const resetDirectories = React.useCallback(() => {
        dirEpochRef.current += 1
        dirRequestsRef.current.clear()
        setDirNodes({})
      }, [])

      const loadDirectory = React.useCallback(async (relPath, force) => {
        if (!repo) return
        const key = relPath || ''
        // A cached node (loading, loaded or failed) is enough: the retry button
        // passes force=true. This also keeps the render effect from looping.
        if (!force && dirNodes[key]) return
        if (dirRequestsRef.current.has(key)) return
        dirRequestsRef.current.add(key)
        const epoch = dirEpochRef.current
        const token = repo
        setDirNodes((current) => ({
          ...current,
          [key]: { loading: true, loaded: false, dirs: [], files: [], truncated: false, error: '' },
        }))
        try {
          const payload = await call('dir', { path: key })
          if (epoch !== dirEpochRef.current || repoRef.current !== token) return
          setDirNodes((current) => ({
            ...current,
            [key]: {
              loading: false,
              loaded: true,
              dirs: Array.isArray(payload.dirs) ? payload.dirs : [],
              files: Array.isArray(payload.files) ? payload.files : [],
              truncated: !!payload.truncated,
              error: '',
            },
          }))
        } catch (failure) {
          if (epoch !== dirEpochRef.current || repoRef.current !== token) return
          const raw = String((failure && failure.message) || failure)
          const message = /未知操作/.test(raw)
            ? '宿主半边还是旧版本（还没有 /dir 接口）：退出 DSH 再启动后，目录页才能读取整个项目目录。'
            : raw
          setDirNodes((current) => ({
            ...current,
            [key]: { loading: false, loaded: false, dirs: [], files: [], truncated: false, error: message },
          }))
        } finally {
          // A reset clears the set and may start a new request for the same key;
          // the old request must not remove the new one's in-flight marker.
          if (epoch === dirEpochRef.current) dirRequestsRef.current.delete(key)
        }
      }, [repo, call, dirNodes])

      const loadRepos = React.useCallback(async (refresh) => {
        setReposBusy(true)
        setReposError('')
        try {
          const params = new URLSearchParams({ op: 'repos' })
          if (refresh) params.set('refresh', '1')
          const response = await fetch(apiUrl(params), {
            headers: { accept: 'application/json', 'x-dsh-git-workbench': '1' },
          })
          const payload = await response.json().catch(() => ({ error: '响应不是合法 JSON' }))
          if (!response.ok) throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`)
          const nextLimits = rememberServerConfig(payload)
          setLimits((current) => (
            current.history === nextLimits.history && current.graph === nextLimits.graph ? current : nextLimits
          ))
          setAuto({
            repos: Array.isArray(payload.repos) ? payload.repos : [],
            workspaces: Array.isArray(payload.workspaces) ? payload.workspaces : [],
            source: typeof payload.source === 'string' ? payload.source : '',
            defaultRepo: typeof payload.defaultRepo === 'string' ? payload.defaultRepo : '',
          })
        } catch (failure) {
          const message = String((failure && failure.message) || failure)
          setReposError(message)
          setAuto({ repos: [], workspaces: [], source: '', defaultRepo: '' })
        } finally {
          setReposBusy(false)
        }
      }, [])

      React.useEffect(() => {
        loadRepos(false)
      }, [loadRepos])

      const describeManual = React.useCallback(async (item) => {
        try {
          return { ...(await call('repoInfo', { repo: item }, '')), source: 'manual', manual: true }
        } catch (failure) {
          const message = String((failure && failure.message) || failure)
          if (!/未知操作/.test(message)) throw failure
          // Host half not restarted yet: the old route still answers `status`.
          const payload = await call('status', {}, item)
          return {
            repo: payload.repo || item,
            path: payload.repo || item,
            name: baseName(payload.repo || item),
            branch: payload.branch,
            changed: Array.isArray(payload.files) ? payload.files.length : 0,
            error: '',
            source: 'manual',
            manual: true,
          }
        }
      }, [call])

      React.useEffect(() => {
        let alive = true
        if (manualRepos.length === 0) {
          setManualEntries([])
          return () => { alive = false }
        }
        const load = async () => {
          const entries = await Promise.all(manualRepos.map(async (item) => {
            try {
              return await describeManual(item)
            } catch (failure) {
              return { path: item, name: baseName(item), error: String((failure && failure.message) || failure), source: 'manual', manual: true }
            }
          }))
          if (alive) setManualEntries(entries)
        }
        load()
        return () => { alive = false }
      }, [manualRepos, describeManual])

      const selectRepo = React.useCallback((next) => {
        setRepo(next)
        writeStore({ repo: next })
        setOpenTabs([])
        setActiveTabId('')
        setDetail('')
        setDetailError('')
        setCollapsed(new Set())
        setExpandedDirs(new Set())
        resetDirectories()
        setAllFiles(null)
        setSearchOpen(false)
        setSearchText('')
        setColorPicker(null)
        setRepoMenuOpen(false)
        setBranchMenuOpen(false)
        setBranchError('')
        setTab('changes')
        setOrigin(null)
        setBindUrl('')
        setBindOpen(false)
        setBindReport(null)
        setCommitMessage('')
        setCommitError('')
      }, [resetDirectories])

      // First run: land on the configured default or the first readable project.
      React.useEffect(() => {
        if (repo) return
        const repos = Array.isArray(auto.repos) ? auto.repos : []
        const preferred = auto.defaultRepo && repos.find((entry) => normalizeKey(entry.path) === normalizeKey(auto.defaultRepo) && !entry.error)
        const fallback = preferred || repos.find((entry) => !entry.error)
        if (fallback && fallback.path) selectRepo(fallback.path)
      }, [auto, repo, selectRepo])

      const entryFor = React.useCallback((target) => {
        const key = normalizeKey(target)
        return [...manualEntries, ...(auto.repos || [])].find((entry) => normalizeKey(entry.path) === key) || null
      }, [manualEntries, auto])

      const refresh = React.useCallback(async (withRepos) => {
        if (!repo) return
        const token = repo
        setLoading(true)
        setError('')
        try {
          const [nextStatus, nextLog, nextGraph, nextBranches, nextRemote] = await Promise.all([
            call('status'),
            call('log', { limit: limits.history }),
            call('graph', { limit: limits.graph }),
            call('branches'),
            call('remote').catch(() => ({ origin: null, unavailable: true })),
          ])
          if (repoRef.current !== token) return
          setStatus(nextStatus)
          setCommits(nextLog.commits || [])
          setGraph(nextGraph.lines || [])
          setBranches(nextBranches.branches || [])
          setUnborn(!!(nextStatus.unborn || nextLog.unborn || nextGraph.unborn))
          if (!nextRemote.unavailable) setOrigin(nextRemote.origin || '')
          // A refresh may follow a branch switch; drop the cached file list and
          // directory nodes so search and the project tree pick up the new tree.
          setAllFiles(null)
          resetDirectories()
        } catch (failure) {
          if (repoRef.current !== token) return
          setError(String((failure && failure.message) || failure))
          setStatus(null)
        } finally {
          if (repoRef.current === token) setLoading(false)
        }
        if (withRepos) loadRepos(true)
      }, [call, repo, loadRepos, resetDirectories, limits])

      /** Switch the checked-out branch through the host's `git switch`. */
      const switchBranch = React.useCallback(async (name) => {
        if (!repo || !name || branchBusy) return
        setBranchBusy(name)
        setBranchError('')
        try {
          const result = await call('switch', { branch: name })
          setBranchMenuOpen(false)
          setOpenTabs([])
          setActiveTabId('')
          setDetail('')
          setAllFiles(null)
          setExpandedDirs(new Set())
          resetDirectories()
          flash(result && result.unchanged ? `已经在分支 ${name} 上` : `已切换到分支 ${name}`)
          await refresh(false)
          loadRepos(true)
        } catch (failure) {
          const raw = String((failure && failure.message) || failure)
          setBranchError(/未知操作/.test(raw)
            ? '宿主半边还是旧版本，重启 DSH 之后才能从面板切换分支。现在可以继续查看，切换要等重启。'
            : raw)
        } finally {
          setBranchBusy('')
        }
      }, [repo, branchBusy, call, flash, refresh, loadRepos, resetDirectories])
// @part 10-panel-actions.js
      const chooseTreeMode = React.useCallback((mode) => {
        const next = mode === 'files' ? 'files' : 'modules'
        setTreeMode(next)
        writeStore({ treeMode: next })
      }, [])

      const hostActionError = (failure, fallback) => {
        const raw = String((failure && failure.message) || failure)
        return /未知操作/.test(raw) ? fallback : raw
      }

      const createBranch = React.useCallback(async () => {
        const name = branchDraft.trim()
        if (!repo || !name || branchBusy) return
        setBranchBusy(name)
        setBranchError('')
        try {
          await call('branchCreate', { branch: name })
          setBranchDraft('')
          setBranchMenuOpen(false)
          setOpenTabs([])
          setActiveTabId('')
          setDetail('')
          setAllFiles(null)
          setExpandedDirs(new Set())
          resetDirectories()
          flash(`已新建并切换到分支 ${name}`)
          await refresh(false)
          loadRepos(true)
        } catch (failure) {
          setBranchError(hostActionError(failure, '宿主半边还是旧版本，重启 DSH 之后才能新建分支。'))
        } finally {
          setBranchBusy('')
        }
      }, [repo, branchDraft, branchBusy, call, flash, refresh, loadRepos, resetDirectories])

      const renameBranch = React.useCallback(async () => {
        const name = renameDraft.trim()
        if (!repo || !name || branchBusy) return
        setBranchBusy(name)
        setBranchError('')
        try {
          const result = await call('branchRename', { branch: name })
          setRenameDraft('')
          setBranchMenuOpen(false)
          flash(result && result.unchanged ? `分支名已经是 ${name}` : `已把分支改名为 ${name}`)
          await refresh(false)
          loadRepos(true)
        } catch (failure) {
          setBranchError(hostActionError(failure, '宿主半边还是旧版本，重启 DSH 之后才能修改分支名。'))
        } finally {
          setBranchBusy('')
        }
      }, [repo, renameDraft, branchBusy, call, flash, refresh, loadRepos])

      const syncBranch = React.useCallback(async (action) => {
        if (!repo || syncBusy || branchBusy) return
        setSyncBusy(action)
        setBranchError('')
        try {
          await call(action)
          flash(action === 'pull' ? '已拉取（只快进）' : '已推送')
          await refresh(false)
          loadRepos(true)
        } catch (failure) {
          setBranchError(hostActionError(
            failure,
            action === 'pull'
              ? '宿主半边还是旧版本，重启 DSH 之后才能拉取。'
              : '宿主半边还是旧版本，重启 DSH 之后才能推送。',
          ))
        } finally {
          setSyncBusy('')
        }
      }, [repo, syncBusy, branchBusy, call, flash, refresh, loadRepos])

      const bindRemote = React.useCallback(async (replace) => {
        const url = bindUrl.trim()
        if (!repo || !url || bindBusy) return
        setBindBusy(true)
        setBranchError('')
        try {
          const result = await call('remoteBind', replace ? { url, replace: '1' } : { url })
          setOrigin(result.origin || url)
          setBindReport(result)
          setBindUrl('')
          flash(result.command === 'set-url' ? '已更换 origin 并拉取' : '已绑定 origin 并拉取')
          await refresh(false)
        } catch (failure) {
          const payload = failure && failure.payload
          if (payload && payload.origin) {
            setOrigin(payload.origin)
            setBindOpen(true)
            setBranchError(`已经绑定了 origin：${payload.origin}。确认输入框里的新地址后，点「更换」。`)
          } else {
            setBranchError(hostActionError(failure, '宿主半边还是旧版本，重启 DSH 之后才能绑定仓库。'))
          }
        } finally {
          setBindBusy(false)
        }
      }, [repo, bindUrl, bindBusy, call, flash, refresh])

      const planRemote = React.useCallback(async (branch) => {
        if (!repo || !branch || integrateBusy) return
        setIntegrateBusy(true)
        setBranchError('')
        try {
          const result = await call('remotePlan', { branch })
          setBindReport(result)
        } catch (failure) {
          setBranchError(hostActionError(failure, '宿主半边还是旧版本，重启 DSH 之后才能查看远端分支。'))
        } finally {
          setIntegrateBusy(false)
        }
      }, [repo, integrateBusy, call])

      const integrateRemote = React.useCallback(async () => {
        if (!repo || !bindReport || !bindReport.branch || integrateBusy) return
        setIntegrateBusy(true)
        setBranchError('')
        try {
          const result = await call('integrate', { branch: bindReport.branch })
          setBindReport((current) => ({ ...(current || {}), ...result }))
          if (result.conflicts && result.conflicts.length) {
            flash(`有 ${result.conflicts.length} 个冲突，在变更树里选择保留哪一边`)
            setTab('changes')
          } else if (result.pending) {
            flash('两边的改动已暂存，填写日志后提交')
            setTab('changes')
          } else if (result.merged) {
            flash('已快进到远端提交')
          } else if (result.hint === 'push') {
            flash('远端没有新提交，可以直接推送')
          }
          await refresh(false)
        } catch (failure) {
          setBranchError(hostActionError(failure, '宿主半边还是旧版本，重启 DSH 之后才能合并。'))
        } finally {
          setIntegrateBusy(false)
        }
      }, [repo, bindReport, integrateBusy, call, flash, refresh])

      const stageFile = React.useCallback(async (entry) => {
        const branch = checkedOutBranch(status)
        if (!repo || !branch || !entry || !entry.path || stageBusy) return
        setStageBusy(entry.path)
        setCommitError('')
        try {
          await call('stage', { path: entry.path, branch })
          flash(`已暂存 ${entry.path}（分支 ${branch}）`)
          await refresh(false)
        } catch (failure) {
          setCommitError(hostActionError(failure, '宿主半边还是旧版本，重启 DSH 之后才能 add。'))
        } finally {
          setStageBusy('')
        }
      }, [repo, status, stageBusy, call, flash, refresh])

      const takeSide = React.useCallback(async (entry, side) => {
        const branch = checkedOutBranch(status)
        if (!repo || !branch || !entry || !entry.path || sideBusy) return
        setSideBusy(entry.path)
        setCommitError('')
        try {
          await call('takeSide', { path: entry.path, side, branch })
          flash(side === 'ours' ? `已保留本地的 ${entry.path}` : `已保留远端的 ${entry.path}`)
          await refresh(false)
        } catch (failure) {
          setCommitError(hostActionError(failure, '宿主半边还是旧版本，重启 DSH 之后才能解决冲突。'))
        } finally {
          setSideBusy('')
        }
      }, [repo, status, sideBusy, call, flash, refresh])

      const createCommit = React.useCallback(async () => {
        const message = commitMessage.trim()
        const branch = checkedOutBranch(status)
        if (!repo || !branch || !message || commitBusy) return
        setCommitBusy(true)
        setCommitError('')
        try {
          await callPost('commitCreate', { message, branch })
          setCommitMessage('')
          setBindReport(null)
          flash(`已提交到 ${branch}`)
          await refresh(false)
          loadRepos(true)
        } catch (failure) {
          setCommitError(hostActionError(failure, '宿主半边还是旧版本，重启 DSH 之后才能提交。'))
        } finally {
          setCommitBusy(false)
        }
      }, [repo, status, commitMessage, commitBusy, callPost, flash, refresh, loadRepos])

      const uncommit = React.useCallback(async () => {
        const branch = checkedOutBranch(status)
        if (!repo || !branch || syncBusy || branchBusy) return
        setSyncBusy('uncommit')
        setBranchError('')
        try {
          const result = await call('uncommit', { branch })
          flash(result && result.unpushed
            ? '已回退最近一次提交。仓库还没有上游，这次提交只在本地，改动仍在暂存区。'
            : '已回退最近一次未推送的提交，改动仍在暂存区。')
          setTab('changes')
          await refresh(false)
          loadRepos(true)
        } catch (failure) {
          setBranchError(hostActionError(failure, '宿主半边还是旧版本，重启 DSH 之后才能回退提交。'))
        } finally {
          setSyncBusy('')
        }
      }, [repo, status, syncBusy, branchBusy, call, flash, refresh, loadRepos])

      const openLocation = async (target) => {
        try {
          await call('reveal', { repo: target }, '')
          flash('已在文件管理器里打开项目目录')
        } catch (failure) {
          const raw = String((failure && failure.message) || failure)
          flash(/未知操作/.test(raw) ? '宿主半边需要重启后才支持打开目录' : `打不开目录：${raw}`)
        }
      }

      React.useEffect(() => {
        let alive = true
        if (!repo) {
          setStatus(null)
          setCommits([])
          setBranches([])
          setGraph([])
          setUnborn(false)
          return () => { alive = false }
        }
        refresh(false).then(() => { if (!alive) return })
        return () => { alive = false }
      }, [repo, refresh])

      React.useEffect(() => {
        if (!searchOpen || !repo) return undefined
        let alive = true
        if (allFiles && normalizeKey(allFiles.repo) === normalizeKey(repo)) return undefined
        call('files').then((payload) => {
          if (alive) setAllFiles({ repo, files: payload.files || [], truncated: !!payload.truncated })
        }).catch((failure) => {
          if (alive) setAllFiles({ repo, files: [], error: String((failure && failure.message) || failure) })
        })
        return () => { alive = false }
      }, [searchOpen, repo, call, allFiles])

      // Open the project root when the directory tab appears, and (re)load any
      // folder the user has expanded after a refresh/reset.
      React.useEffect(() => {
        if (tab !== 'directory' || !repo) return
        loadDirectory('')
        for (const key of expandedDirs) loadDirectory(key)
      }, [tab, repo, expandedDirs, loadDirectory])

      // Close the quick search when the pointer goes down anywhere outside it.
      React.useEffect(() => {
        if (!searchOpen) return undefined
        const onPointerDown = (event) => {
          const node = searchWrapRef.current
          if (node && !node.contains(event.target)) setSearchOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => document.removeEventListener('mousedown', onPointerDown)
      }, [searchOpen])

      const activeTab = openTabs.find((item) => item.id === activeTabId) || null

      React.useEffect(() => {
        let alive = true
        if (!activeTab || !repo) {
          setDetail('')
          setDetailError('')
          return () => { alive = false }
        }
        setDetailBusy(true)
        setDetailError('')
        const run = async () => {
          try {
            let payload
            if (activeTab.kind === 'commit') payload = await call('commit', { rev: activeTab.rev })
            else if (activeTab.kind === 'file') payload = await call('file', { path: activeTab.path })
            else payload = await call('diff', { path: activeTab.path, scope: activeTab.scope })
            if (!alive) return
            setDetail(payload.binary ? '' : String(payload.text || ''))
            setDetailMeta({ truncated: !!payload.truncated, size: Number(payload.size) || 0, binary: !!payload.binary })
            if (activeTab.kind === 'file' && !payload.binary) {
              try {
                const diffPayload = await call('diff', { path: activeTab.path, scope: 'all' })
                if (alive) setChangedMarks(parseChangedLines(diffPayload && diffPayload.text))
              } catch {
                if (alive) setChangedMarks({ added: [], near: [] })
              }
            } else if (alive) {
              setChangedMarks({ added: [], near: [] })
            }
            if (payload.binary) setDetailError('这个文件是二进制内容，无法以文本预览。')
            else if (payload.truncated) setDetailError('文件较大，只显示前 200 KB。')
          } catch (failure) {
            if (alive) {
              setDetail('')
              setDetailError(String((failure && failure.message) || failure))
            }
          } finally {
            if (alive) setDetailBusy(false)
          }
        }
        run()
        return () => { alive = false }
      }, [activeTab, repo, call])

      const openTab = React.useCallback((next) => {
        setOpenTabs((current) => {
          const existing = current.find((item) => item.id === next.id)
          if (existing) return current.map((item) => (item.id === next.id ? { ...item, ...next } : item))
          const appended = [...current, next]
          return appended.length > 14 ? appended.slice(appended.length - 14) : appended
        })
        setActiveTabId(next.id)
        setSearchOpen(false)
        setSearchText('')
      }, [])

      const closeTab = React.useCallback((id) => {
        const index = openTabs.findIndex((item) => item.id === id)
        const next = openTabs.filter((item) => item.id !== id)
        setOpenTabs(next)
        if (activeTabId === id) {
          const neighbour = next[index] || next[index - 1] || null
          setActiveTabId(neighbour ? neighbour.id : '')
        }
      }, [openTabs, activeTabId])

      const openDiffTab = React.useCallback((entry) => {
        const scope = entry.untracked ? 'worktree' : (entry.staged && !entry.unstaged ? 'staged' : 'worktree')
        openTab({ id: 'diff:' + entry.path, kind: 'diff', path: entry.path, scope })
      }, [openTab])

      const openFileTab = React.useCallback((filePath) => {
        openTab({ id: 'file:' + filePath, kind: 'file', path: filePath })
      }, [openTab])

      const openCommitTab = React.useCallback((commit) => {
        openTab({ id: 'commit:' + commit.sha, kind: 'commit', rev: commit.sha, short: commit.short, subject: commit.subject })
      }, [openTab])
// @part 11-panel-lists.js
      const files = React.useMemo(() => (status && Array.isArray(status.files) ? status.files.filter((item) => !item.ignored) : []), [status])
      const tree = React.useMemo(() => buildTree(files), [files])
      const stagedCount = files.filter((item) => item.staged).length
      const unstagedCount = files.filter((item) => item.unstaged).length
      const untrackedCount = files.filter((item) => item.untracked).length
      const conflictCount = files.filter((item) => item.kind === 'conflict').length
      const canUncommit = !!repo && !unborn && !!status && !status.merging && (!status.upstream || status.ahead > 0)
      const moduleNames = React.useMemo(() => {
        const names = tree.dirs.map((dir) => dir.name)
        if (tree.files.length > 0) names.unshift('根目录')
        return names
      }, [tree])

      const changedByPath = React.useMemo(() => new Map(files.map((entry) => [entry.path, entry])), [files])

      // Changed-file count per ancestor folder, for the small dot on directory rows.
      const changedDirCounts = React.useMemo(() => {
        const counts = new Map()
        for (const entry of files) {
          const parts = String((entry && entry.path) || '').split('/').filter(Boolean)
          let prefix = ''
          for (let index = 0; index < parts.length - 1; index += 1) {
            prefix = prefix ? `${prefix}/${parts[index]}` : parts[index]
            counts.set(prefix, (counts.get(prefix) || 0) + 1)
          }
        }
        return counts
      }, [files])

      const repoEntries = React.useMemo(() => {
        const seen = new Set()
        const list = []
        for (const entry of [...(auto.repos || []), ...manualEntries]) {
          if (!entry || !entry.path) continue
          const key = normalizeKey(entry.path)
          if (seen.has(key)) continue
          seen.add(key)
          list.push(entry)
        }
        return list
      }, [auto, manualEntries])

      const currentEntry = entryFor(repo)
      const currentName = currentEntry ? (currentEntry.name || baseName(currentEntry.path)) : (repo ? baseName(repo) : '')
      const oldHost = /未知操作|repo 参数为空/.test(reposError) || /未知操作/.test(error)
      const repoColor = repo ? projectColorFor(repo, repoColors) : PROJECT_COLORS[0]

      const setRepoColor = (path, color) => {
        const key = normalizeKey(path)
        setRepoColors((current) => {
          const next = { ...current }
          if (color) next[key] = color
          else delete next[key]
          writeStore({ repoColors: next })
          return next
        })
        setColorPicker(null)
        flash(color ? '已更新项目颜色' : '已恢复默认颜色')
      }

      const openColorPicker = (event, path) => {
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        const width = 252
        setRepoMenuOpen(false)
        setBranchMenuOpen(false)
        setColorPicker({
          repo: path,
          top: rect.bottom + 6,
          left: Math.max(8, Math.min(rect.left, (window.innerWidth || 1280) - width - 8)),
        })
      }

      const searchQuery = searchText.trim().toLowerCase()
      const searchItems = React.useMemo(() => {
        if (!repo) return []
        const changed = files
          .filter((entry) => !searchQuery || entry.path.toLowerCase().includes(searchQuery))
          .slice(0, 24)
          .map((entry) => ({ kind: 'changed', key: 'c:' + entry.path, path: entry.path, xy: entry.xy, entry }))
        const changedSet = new Set(files.map((entry) => entry.path))
        const list = allFiles && normalizeKey(allFiles.repo) === normalizeKey(repo) && !allFiles.error ? allFiles.files : []
        const others = list
          .filter((path) => !changedSet.has(path) && (!searchQuery || path.toLowerCase().includes(searchQuery)))
          .slice(0, Math.max(0, MAX_SEARCH_ROWS - changed.length))
          .map((path) => ({ kind: 'file', key: 'f:' + path, path }))
        return [...changed, ...others]
      }, [files, allFiles, repo, searchQuery])

      const openSearchItem = (item) => {
        if (!item) return
        if (item.kind === 'changed') openDiffTab(item.entry)
        else openFileTab(item.path)
        setSearchOpen(false)
        setSearchText('')
      }

      const toggleDir = (key) => {
        setCollapsed((current) => {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }

      const addRepo = async () => {
        const value = newPath.trim()
        if (!value) return
        setAddBusy(true)
        setAddError('')
        try {
          const payload = await describeManual(value)
          const next = manualRepos.some((item) => normalizeKey(item) === normalizeKey(payload.repo)) ? manualRepos : [...manualRepos, payload.repo]
          setManualRepos(next)
          writeStore({ manualRepos: next })
          setNewPath('')
          selectRepo(payload.repo)
          flash('已添加项目：' + (payload.name || baseName(payload.repo)))
        } catch (failure) {
          setAddError(String((failure && failure.message) || failure))
        } finally {
          setAddBusy(false)
        }
      }

      const removeManual = (path) => {
        const next = manualRepos.filter((item) => normalizeKey(item) !== normalizeKey(path))
        setManualRepos(next)
        writeStore({ manualRepos: next })
        if (normalizeKey(repo) === normalizeKey(path)) selectRepo(next[0] || '')
      }

      const copyText = async (text) => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text)
            flash('已复制到剪贴板')
          } else {
            flash('浏览器不允许写剪贴板')
          }
        } catch {
          flash('复制失败')
        }
      }

      const tabTitle = (item) => {
        if (item.kind === 'commit') return `提交 ${String(item.rev || '').slice(0, 8)}`
        return item.path
      }

      const tabLabel = (item) => {
        if (item.kind === 'commit') return `提交 ${String(item.short || item.rev || '').slice(0, 7)}`
        return baseName(item.path)
      }

      const tabBadge = (item) => (item.kind === 'commit' ? 'C' : extLabel(item.path))

      let listContent
      if (!repo) {
        listContent = h('div', { style: styles.empty },
          '选择一个 Git 项目开始。',
          h('br'),
          '顶部的「选取项目」会列出 DSH 工作区里检测到的 Git 仓库；没有权限或不在工作区里的仓库，可以在同一个弹层里手动填绝对路径添加。',
        )
      } else if (tab === 'changes') {
        if (!status) {
          listContent = h('div', { style: styles.empty }, error ? error : (loading ? '读取中…' : '还没有读到仓库状态。'))
        } else if (files.length === 0) {
          listContent = h('div', { style: styles.empty }, '工作区干净：没有未暂存、已暂存或未跟踪的改动，没有需要提交的内容。')
        } else {
          listContent = renderChangeList({
            files, tree, collapsed, toggleDir, openDiffTab, treeMode, onTreeMode: chooseTreeMode,
            stagedCount, unstagedCount, untrackedCount, moduleNames,
            commitMessage, onCommitMessage: (value) => { setCommitMessage(value); setCommitError('') },
            onCommit: createCommit, commitBusy, commitError, conflictCount, merging: !!(status && status.merging),
            onStage: stageFile, onTakeSide: takeSide, stageBusy, sideBusy,
            headBranch: checkedOutBranch(status),
          })
        }
      } else if (tab === 'directory') {
        const rootNode = dirNodes['']
        if (!rootNode || (rootNode.loading && !rootNode.loaded)) {
          listContent = h('div', { style: styles.empty }, '正在读取项目目录…')
        } else if (rootNode.error) {
          listContent = h('div', { style: styles.empty },
            rootNode.error,
            h('div', { style: { marginTop: 8 } },
              h('button', { style: styles.buttonQuiet, onClick: () => loadDirectory('', true) }, '重试'),
            ),
          )
        } else {
          listContent = renderDirectoryList({
            rootNode, dirNodes, expandedDirs, setExpandedDirs, changedDirCounts, changedByPath,
            loadDirectory, openDiffTab, openFileTab, resetDirectories,
          })
        }
      } else if (tab === 'graph') {
        listContent = unborn
          ? h('div', { style: styles.empty }, `这个仓库还没有任何提交（unborn 分支 ${status && status.branch ? status.branch : ''}）。先提交一次，图谱才有内容。`)
          : graph.length
            ? graph.map((line, index) => h('div', {
                key: index,
                className: line.sha ? 'dsh-git-hit' : undefined,
                style: styles.graphRow,
                onClick: line.sha ? () => openCommitTab({ sha: line.sha, short: line.sha.slice(0, 7), subject: line.text }) : undefined,
              },
                h('span', null,
                  graphGlyphs(line.graph).map((glyph, glyphIndex) => h('span', {
                    key: glyphIndex,
                    style: glyph.color ? { color: glyph.color, fontWeight: glyph.bold ? 700 : 500 } : null,
                  }, glyph.ch)),
                ),
                h('span', null, line.text),
              ))
            : h('div', { style: styles.empty }, '没有提交记录。')
      } else if (tab === 'log') {
        listContent = commits.length
          ? commits.map((commit) => h('div', {
              key: commit.sha,
              className: 'dsh-git-hit',
              style: { ...styles.logRow, ...(activeTab && activeTab.kind === 'commit' && activeTab.rev === commit.sha ? styles.repoRowActive : {}) },
              onClick: () => openCommitTab(commit),
              title: commit.sha + '\n' + commit.author + ' · ' + commit.date,
            },
              h('span', { style: { flex: '0 0 auto', fontFamily: monospace, fontSize: 12, color: 'var(--dsw-alias-brand-primary)' } }, commit.short),
              h('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, commit.subject),
              h('span', { style: { flex: '0 0 auto', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, commit.date),
            ))
          : h('div', { style: styles.empty }, unborn ? '这个仓库还没有任何提交。' : '没有提交记录。')
      } else {
        const branchRows = branches.map((branch) => h('div', {
          key: branch.name,
          className: branch.current ? undefined : 'dsh-git-hit',
          style: { ...styles.branchRow, cursor: branch.current ? 'default' : 'pointer' },
          onClick: branch.current ? undefined : () => switchBranch(branch.name),
          title: branch.upstream ? `${branch.name} → ${branch.upstream}` : branch.name,
        },
          h('span', { style: { flex: '0 0 auto', width: 14, color: 'var(--dsw-alias-state-success-primary)' } }, branch.current ? '●' : ''),
          h('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, branch.name),
          h('span', { style: { flex: '0 0 auto', fontFamily: monospace, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, branch.sha),
          h('span', { style: { flex: '0 0 auto', fontSize: 12, color: branch.current ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-brand-primary)' } },
            branchBusy === branch.name ? '切换中…' : (branch.current ? '当前' : '切换')),
        ))
        if (branches.length === 0 && unborn && status && status.branch) {
          branchRows.push(h('div', { key: 'unborn', style: styles.branchRow },
            h('span', { style: { flex: '0 0 auto', width: 14, color: 'var(--dsw-alias-state-idle-primary)' } }, '○'),
            h('span', { style: { flex: '1 1 auto' } }, status.branch),
            h('span', { style: { flex: '0 0 auto', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '尚无提交'),
          ))
        }
        listContent = branchRows.length ? branchRows : h('div', { style: styles.empty }, '没有本地分支。')
      }

      const tabButton = (key, label, count) =>
        h('button', {
          key,
          style: { ...styles.tab, ...(tab === key ? { ...styles.tabActive, borderBottomColor: repoColor } : {}) },
          title: key === 'directory' ? '查看整个项目目录（含 .gitignore 忽略的文件夹）' : undefined,
          onClick: () => setTab(key),
        }, count === undefined || count === 0 ? label : `${label} ${count}`)

      const sidebar = h('div', { style: { ...styles.card, ...styles.sidebar, width: sidebarWidth } },
        h('div', { style: styles.tabs },
          tabButton('changes', '变更树', files.length),
          tabButton('directory', '目录'),
          tabButton('graph', '图谱', graph.length),
          tabButton('log', '日志', commits.length),
          tabButton('branches', '分支', branches.length),
        ),
        h('div', { style: styles.list }, listContent),
      )

      const folderIcon = h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block', flex: '0 0 auto' } },
        h('path', { d: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2h8A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z' }),
      )

      const chevron = h('svg', { width: 10, height: 10, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block', flex: '0 0 auto' } },
        h('path', { d: 'M6 9l6 6 6-6' }),
      )

      const paletteIcon = h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M12 3a9 9 0 0 0 0 18h1.4a1.9 1.9 0 0 0 1.2-3.4 1.9 1.9 0 0 1 1.2-3.4H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3z' }),
        h('circle', { cx: 8, cy: 9.5, r: 1.15, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 8, cy: 14.5, r: 1.15, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 12.5, cy: 7, r: 1.15, fill: 'currentColor', stroke: 'none' }),
      )

      const externalIcon = h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M13 4h7v7' }),
        h('path', { d: 'M20 4l-8.5 8.5' }),
        h('path', { d: 'M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5' }),
      )

      const repoFilterText = repoFilter.trim().toLowerCase()
      const visibleRepos = repoEntries.filter((entry) => {
        if (!repoFilterText) return true
        return String(entry.name || '').toLowerCase().includes(repoFilterText)
          || String(entry.path || '').toLowerCase().includes(repoFilterText)
          || String(entry.branch || '').toLowerCase().includes(repoFilterText)
      })

      const repoMenu = repoMenuOpen
        ? h(React.Fragment, null,
            h('div', { style: styles.overlay, onClick: () => setRepoMenuOpen(false) }),
            h('div', { style: { ...styles.popover, top: 40, left: 0 } },
              h('input', {
                style: styles.input,
                value: repoFilter,
                placeholder: '搜索项目名称 / 路径 / 分支',
                spellCheck: false,
                onChange: (event) => setRepoFilter(event.target.value),
              }),
              h('div', { style: styles.popHead },
                `DSH 工作区检测到 ${auto.repos.filter((entry) => !entry.error).length} 个 Git 项目`
                + (auto.workspaces.length ? ` · ${auto.workspaces.length} 个工作区` : '')
                + (reposBusy ? ' · 检测中…' : '')),
              visibleRepos.length === 0
                ? h('div', { style: { ...styles.empty, padding: '10px 8px' } }, '没有匹配的项目。')
                : visibleRepos.map((entry) => {
                    const key = normalizeKey(entry.path)
                    const active = normalizeKey(repo) === key
                    return h('div', {
                      key,
                      className: 'dsh-git-hit-pop',
                      style: {
                        ...styles.repoRow,
                        ...(active ? { ...styles.repoRowActive, borderBottomColor: projectColorFor(entry.path, repoColors) } : {}),
                      },
                      onClick: () => {
                        if (entry.error) {
                          setNewPath(entry.path)
                          setAddError(entry.error)
                          return
                        }
                        selectRepo(entry.path)
                      },
                      title: entry.error ? entry.error : entry.path,
                    },
                      h('span', {
                        style: {
                          ...styles.colorDot,
                          width: 9,
                          height: 9,
                          background: projectColorFor(entry.path, repoColors),
                        },
                        title: '这个项目的颜色',
                      }),
                      h('div', { style: styles.repoRowMain },
                        h('div', { style: styles.repoRowName },
                          h('span', { style: styles.repoNameText }, entry.name || baseName(entry.path)),
                          entry.manual ? h('span', { style: { ...styles.repoMeta, color: 'var(--dsw-alias-brand-primary)' } }, '手动') : null,
                          entry.branch ? h('span', { style: styles.repoMeta }, entry.branch) : null,
                          entry.changed ? h('span', { style: { ...styles.repoMeta, color: 'var(--dsw-alias-state-warn-primary)' } }, `${entry.changed} 个改动`) : null,
                          entry.error ? h('span', { style: { ...styles.repoMeta, color: 'var(--dsw-alias-state-error-primary)' } }, '不可访问') : null,
                        ),
                        h('div', { style: styles.repoRowPath }, entry.path),
                        entry.error ? h('div', { style: { marginTop: 2, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'normal' } }, entry.error) : null,
                      ),
                      h('div', { style: styles.repoActions },
                        h('button', {
                          style: styles.iconButton,
                          title: '修改项目颜色',
                          onClick: (event) => openColorPicker(event, entry.path),
                        }, paletteIcon),
                        h('button', {
                          style: styles.iconButton,
                          title: '在文件管理器里打开项目位置',
                          onClick: (event) => { event.stopPropagation(); openLocation(entry.path) },
                        }, externalIcon),
                        entry.manual && !entry.error
                          ? h('button', {
                              style: styles.iconButton,
                              title: '从手动列表移除',
                              onClick: (event) => { event.stopPropagation(); removeManual(entry.path) },
                            }, '×')
                          : null,
                      ),
                    )
                  }),
              h('div', { style: styles.divider }),
              h('div', { style: styles.popHead }, '手动添加仓库（绝对路径）'),
              h('div', { style: { display: 'flex', gap: 6, padding: '2px 0' } },
                h('input', {
                  style: styles.input,
                  value: newPath,
                  spellCheck: false,
                  placeholder: 'C:\\path\\to\\my-repo',
                  onChange: (event) => setNewPath(event.target.value),
                  onKeyDown: (event) => { if (event.key === 'Enter') addRepo() },
                }),
                h('button', { style: styles.button, onClick: addRepo, disabled: addBusy }, addBusy ? '验证中…' : '添加'),
              ),
              addError ? h('div', { style: { padding: '4px 8px', fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, addError) : null,
              h('div', { style: styles.divider }),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px' } },
                h('button', { style: styles.buttonQuiet, onClick: () => loadRepos(true), disabled: reposBusy }, reposBusy ? '重新检测中…' : '重新检测'),
                h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                  auto.source === 'registry' ? '来源：DSH 工作区注册表' : auto.source === 'storage' ? '来源：DSH 工作区记录文件' : '来源：插件配置'),
              ),
              h('div', { style: { padding: '4px 8px', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' } },
                '每行右侧的调色板按钮改这个项目的颜色，箭头按钮在文件管理器里打开项目目录；颜色只影响这个面板。'),
            ),
          )
        : null
// @part 12-panel-chrome.js

      const repoButton = h('div', { style: { position: 'relative', flex: '0 0 auto' } },
        h('div', {
          style: { ...styles.repoButton, borderBottomColor: repoColor },
          onClick: () => { setRepoMenuOpen((open) => !open); setBranchMenuOpen(false); setSearchOpen(false); setRepoFilter(''); setAddError('') },
          title: repo ? `${currentName}\n${repo}\n点这里切换项目 / 添加仓库` : '选择项目',
        },
          repo
            ? h('button', {
                style: styles.colorDotButton,
                title: '设置这个项目的颜色',
                onClick: (event) => openColorPicker(event, repo),
              }, h('span', { style: { ...styles.colorDot, background: repoColor } }))
            : null,
          folderIcon,
          h('span', { style: styles.repoName }, currentName || '选取项目'),
          chevron,
        ),
        repoMenu,
      )

      const branchChip = h('div', { style: { position: 'relative', flex: '0 0 auto' } },
        h('button', {
          style: styles.branchButton,
          disabled: !repo,
          onClick: () => { setBranchMenuOpen((open) => !open); setRepoMenuOpen(false); setSearchOpen(false); setBranchError('') },
          title: repo ? '切换本地分支' : '先选择一个项目',
        },
          h('span', { style: { color: repoColor, fontSize: 12, flex: '0 0 auto' } }, '●'),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            (status && status.branch ? status.branch : '—') + (unborn ? ' · 无提交' : '')),
          status && status.ahead ? h('span', { style: { color: 'var(--dsw-alias-state-success-primary)' } }, '↑' + status.ahead) : null,
          status && status.behind ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, '↓' + status.behind) : null,
          chevron,
        ),
        branchMenuOpen ? h(React.Fragment, null,
          h('div', { style: styles.overlay, onClick: () => setBranchMenuOpen(false) }),
          h('div', { style: styles.branchMenu },
            h('div', { style: styles.popHead }, `本地分支 · ${branches.length}`),
            files.length
              ? h('div', { style: { padding: '4px 8px', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-state-warn-primary)' } },
                  `有 ${files.length} 个未提交改动：切换分支会带着它们，冲突时 git 会拒绝切换。`)
              : null,
            branches.length === 0
              ? h('div', { style: { ...styles.empty, padding: '10px 8px' } },
                  unborn ? '这个仓库还没有提交，暂时没有可切换的分支。' : '没有本地分支。')
              : branches.map((branch) => h('div', {
                  key: branch.name,
                  className: 'dsh-git-hit-pop',
                  style: { ...styles.pickerRow, ...(branch.current ? styles.repoRowActive : {}) },
                  onClick: () => { if (!branch.current) switchBranch(branch.name) },
                  title: branch.upstream ? `${branch.name} → ${branch.upstream}` : branch.name,
                },
                  h('span', { style: { width: 12, flex: '0 0 auto', color: 'var(--dsw-alias-state-success-primary)' } }, branch.current ? '●' : ''),
                  h('span', { style: { flex: '1 1 auto', fontWeight: branch.current ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, branch.name),
                  branchBusy === branch.name
                    ? h('span', { style: { flex: '0 0 auto', fontSize: 12, color: 'var(--dsw-alias-brand-primary)' } }, '切换中…')
                    : h('span', { style: { flex: '0 0 auto', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, branch.current ? '当前' : '点击切换'),
                  h('span', { style: { flex: '0 0 auto', fontFamily: monospace, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, branch.sha),
                )),
            h('div', { style: styles.divider }),
            h('div', { style: styles.popHead }, '新建分支（从当前提交）'),
            h('div', { style: { display: 'flex', gap: 6, padding: '2px 0' } },
              h('input', {
                style: styles.input,
                value: branchDraft,
                spellCheck: false,
                placeholder: 'feature/name',
                onChange: (event) => setBranchDraft(event.target.value),
                onKeyDown: (event) => { if (event.key === 'Enter') createBranch() },
              }),
              h('button', { style: styles.button, disabled: !branchDraft.trim() || !!branchBusy, onClick: createBranch }, branchBusy && branchBusy === branchDraft.trim() ? '创建中…' : '新建'),
            ),
            h('div', { style: styles.popHead }, '修改当前分支的名称'),
            h('div', { style: { display: 'flex', gap: 6, padding: '2px 0' } },
              h('input', {
                style: styles.input,
                value: renameDraft,
                spellCheck: false,
                placeholder: status && status.branch ? status.branch : '新的分支名',
                onChange: (event) => setRenameDraft(event.target.value),
                onKeyDown: (event) => { if (event.key === 'Enter') renameBranch() },
              }),
              h('button', { style: styles.button, disabled: !renameDraft.trim() || !!branchBusy, onClick: renameBranch }, branchBusy && branchBusy === renameDraft.trim() ? '改名中…' : '改名'),
            ),
            branchError
              ? h('div', { style: { padding: '4px 8px', fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'normal' } }, branchError)
              : null,
          ),
        ) : null,
      )

      const syncButtons = h(React.Fragment, null,
        h('button', {
          type: 'button',
          style: styles.button,
          disabled: !repo || !!syncBusy || !!branchBusy,
          title: 'git pull --ff-only。不能快进时会显示 git 的原因，不会自动合并。',
          onClick: (event) => { event.preventDefault(); syncBranch('pull') },
        }, syncBusy === 'pull' ? '拉取中…' : `拉取${status && status.behind ? ' ↓' + status.behind : ''}`),
        h('button', {
          type: 'button',
          style: styles.button,
          disabled: !repo || !!syncBusy || !!branchBusy,
          title: 'git push。没有上游时推送到 origin 并设置上游。不会使用 --force。',
          onClick: (event) => { event.preventDefault(); syncBranch('push') },
        }, syncBusy === 'push' ? '推送中…' : `推送${status && status.ahead ? ' ↑' + status.ahead : ''}`),
      )

      const refreshButton = h('button', {
        type: 'button',
        style: styles.button,
        onClick: (event) => { event.preventDefault(); refresh(true) },
        disabled: loading || !repo,
      }, loading ? '刷新中…' : '刷新')

      const moreMenu = h('div', {
        style: { position: 'relative', flex: '0 0 auto', paddingBottom: 8, marginBottom: -8 },
        onMouseEnter: () => setMoreOpen(true),
        onMouseLeave: () => setMoreOpen(false),
      },
        h('button', {
          type: 'button',
          style: styles.button,
          disabled: !repo,
          title: '回退、绑定或更换仓库',
          onClick: (event) => { event.preventDefault(); setMoreOpen((open) => !open) },
        }, '更多'),
        moreOpen ? h('div', { style: styles.moreMenu },
          h('button', {
            type: 'button',
            className: 'dsh-git-hit',
            style: styles.moreItem,
            disabled: !canUncommit || !!syncBusy || !!branchBusy,
            title: checkedOutBranch(status)
              ? `只回退当前分支 ${checkedOutBranch(status)} 上还没推送的最新提交`
              : '先切换到一个分支',
            onClick: (event) => { event.preventDefault(); setMoreOpen(false); uncommit() },
          }, syncBusy === 'uncommit' ? '回退中…' : '回退'),
          h('button', {
            type: 'button',
            className: 'dsh-git-hit',
            style: styles.moreItem,
            disabled: !repo || !!bindBusy,
            title: origin ? `已绑定 origin：${origin}` : '粘贴远端仓库地址，记为 origin 并拉取',
            onClick: (event) => { event.preventDefault(); setMoreOpen(false); setBindOpen(true) },
          }, origin ? '更换仓库' : '绑定仓库'),
        ) : null,
      )

      const searchRow = (item, index) => h('div', {
        key: item.key,
        className: 'dsh-git-hit-pop',
        style: { ...styles.resultRow, ...(index === searchIndex ? styles.resultActive : {}) },
        onMouseEnter: () => setSearchIndex(index),
        onClick: () => openSearchItem(item),
        title: item.path,
      },
        item.kind === 'changed'
          ? h('span', { style: { ...styles.xy, color: colorForStatus(item.xy) } }, displayXY(item))
          : h('span', { style: { ...styles.tabBadge, color: extColor(item.path) } }, extLabel(item.path)),
        h('span', { style: styles.fileName }, item.path),
        h('span', { style: { flex: '0 0 auto', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, item.kind === 'changed' ? '差异' : '全文'),
      )

      const searchBox = h('div', { style: styles.searchWrap, ref: searchWrapRef },
        h('span', { style: styles.searchIcon }, '⌕'),
        h('input', {
          style: { ...styles.searchInput, borderColor: searchOpen ? repoColor : 'var(--dsw-alias-border-l1)' },
          value: searchText,
          placeholder: '搜索文件…',
          spellCheck: false,
          onFocus: () => { setSearchOpen(true); setSearchIndex(0); setRepoMenuOpen(false); setBranchMenuOpen(false) },
          onChange: (event) => { setSearchText(event.target.value); setSearchOpen(true); setSearchIndex(0) },
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              setSearchOpen(false)
              event.currentTarget.blur()
              return
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSearchIndex((index) => Math.min(index + 1, Math.max(0, searchItems.length - 1)))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSearchIndex((index) => Math.max(0, index - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              openSearchItem(searchItems[searchIndex] || searchItems[0])
            }
          },
        }),
        searchOpen
          ? h('div', { style: styles.searchPop },
              searchItems.length === 0
                ? h('div', { style: { ...styles.empty, padding: '10px 8px' } },
                    allFiles && allFiles.error ? allFiles.error : (repo ? '没有匹配的文件。' : '先选择一个项目。'))
                : h(React.Fragment, null,
                    searchItems.some((item) => item.kind === 'changed')
                      ? h('div', { key: 'h-changed', style: styles.popHead }, '有改动 · 打开差异')
                      : null,
                    searchItems.map((item, index) => (item.kind === 'changed' ? searchRow(item, index) : null)),
                    searchItems.some((item) => item.kind === 'file')
                      ? h('div', { key: 'h-file', style: styles.popHead }, '仓库文件 · 打开全文')
                      : null,
                    searchItems.map((item, index) => (item.kind === 'file' ? searchRow(item, index) : null)),
                    h('div', {
                      key: 'hint',
                      style: { ...styles.popHead, borderTop: '1px solid var(--dsw-alias-border-l1)', marginTop: 4 },
                    }, 'Enter 打开 · ↑↓ 选择 · Esc 关闭'),
                  ),
            )
          : null,
      )

      const tabsBar = h('div', { style: styles.tabStrip },
        repoButton,
        branchChip,
        syncButtons,
        moreMenu,
        refreshButton,
        h('button', {
          type: 'button',
          style: {
            ...styles.button,
            borderColor: terminalOpen ? repoColor : 'var(--dsw-alias-border-l1)',
            color: terminalOpen ? repoColor : 'var(--dsw-alias-label-primary)',
          },
          onClick: (event) => { event.preventDefault(); toggleTerminal() },
          title: terminalOpen
            ? '收起最右侧的 Git Bash 终端；进程会保留'
            : '在最右侧打开 Git Bash 终端（使用电脑上的 Git Bash）',
        }, terminalOpen ? '收起终端' : 'Git Bash'),
        h('div', { style: { width: 1, height: 18, background: 'var(--dsw-alias-border-l1)', flex: '0 0 auto' } }),
        searchBox,
        h('div', { style: styles.tabScroll },
          openTabs.map((item) => h('div', {
            key: item.id,
            style: {
              ...styles.fileTab,
              ...(item.id === activeTabId ? styles.fileTabActive : {}),
              ...(item.id === activeTabId ? { borderBottomColor: repoColor } : {}),
            },
            onClick: () => setActiveTabId(item.id),
            title: tabTitle(item),
          },
            h('span', { style: { ...styles.tabBadge, color: extColor(item.path || item.kind) } }, tabBadge(item)),
            h('span', { style: styles.tabName }, tabLabel(item)),
            h('span', {
              style: styles.tabClose,
              title: '关闭',
              onClick: (event) => { event.stopPropagation(); closeTab(item.id) },
            }, '×'),
          )),
        ),
      )
// @part 13-panel-detail.js
      function activeTabPath() {
        if (!activeTab) return repo || ''
        if (activeTab.kind === 'commit') return `${repo} · commit ${String(activeTab.rev || '').slice(0, 8)}`
        return absolutePath(repo, activeTab.path)
      }

      const scopeOf = activeTab && activeTab.kind === 'diff' ? activeTab.scope : ''
      const activeEntry = activeTab && activeTab.kind !== 'commit' ? files.find((item) => item.path === activeTab.path) : null

      const contentHead = h('div', { style: styles.contentHead },
        activeTab && activeTab.kind === 'diff' && !(activeEntry && activeEntry.untracked)
          ? h('div', { style: styles.segment },
              ['worktree', 'staged', 'all'].map((scope) => h('button', {
                key: scope,
                style: { ...styles.segmentItem, ...(scopeOf === scope ? styles.segmentActive : {}) },
                onClick: () => setOpenTabs((current) => current.map((item) => (item.id === activeTab.id ? { ...item, scope } : item))),
              }, scope === 'worktree' ? '工作区' : scope === 'staged' ? '已暂存' : '全部')),
            )
          : null,
        activeTab && activeTab.kind === 'diff' && activeEntry && activeEntry.untracked
          ? h('span', null, '未跟踪文件 · 全文预览')
          : null,
        activeTab && activeTab.kind === 'commit'
          ? h('span', { style: { fontFamily: monospace } }, `${String(activeTab.rev || '').slice(0, 8)}${activeTab.subject ? ' · ' + activeTab.subject : ''}`)
          : null,
        activeTab && activeTab.kind === 'file'
          ? h('span', null, detailBusy ? '读取中…' : (detail ? `${detail.split('\n').length} 行` : '空文件'))
          : null,
        h('div', { style: { flex: '1 1 auto' } }),
        activeTab && activeTab.kind === 'diff' && activeEntry && !activeEntry.untracked
          ? h('button', { style: styles.buttonQuiet, onClick: () => openFileTab(activeTab.path) }, '完整文件')
          : null,
        activeTab && activeTab.kind === 'file' && files.some((item) => item.path === activeTab.path)
          ? h('button', { style: styles.buttonQuiet, onClick: () => openDiffTab(files.find((item) => item.path === activeTab.path)) }, '查看改动')
          : null,
        activeTab
          ? h('button', { style: styles.buttonQuiet, onClick: () => copyText(detail) }, '复制内容')
          : null,
      )

      let contentBody
      if (!repo) {
        contentBody = h('div', { style: styles.empty },
          '还没有选择项目。',
          h('br'),
          '点左上角的「选取项目」，从 DSH 工作区自动检测出的 Git 仓库里挑一个；也可以手动添加绝对路径。',
        )
      } else if (!activeTab) {
        contentBody = h('div', { style: styles.empty },
          '左侧的变更树按模块分组列出改动的文件；点文件在标签页里查看差异，顶部的搜索框可以打开仓库里的任意文件。',
        )
      } else if (detailError && !detail) {
        contentBody = h('div', { style: styles.empty }, detailError)
      } else if (detailBusy && !detail) {
        contentBody = h('div', { style: styles.empty }, '读取中…')
      } else {
        const codeLang = sourceLang(extensionOf(activeTab.path || ''))
        contentBody = activeTab.kind === 'file'
          ? h(FileBody, {
              text: detail,
              truncated: detailMeta.truncated,
              size: detailMeta.size,
              lang: codeLang,
              added: changedMarks.added,
              near: changedMarks.near,
            })
          : h(DiffBody, { text: detail, lang: activeTab.kind === 'diff' ? codeLang : '' })
      }

      const sidebarSplitter = h(PaneSplitter, {
        value: sidebarWidth,
        min: SIDEBAR_MIN_WIDTH,
        max: SIDEBAR_MAX_WIDTH,
        defaultValue: SIDEBAR_DEFAULT_WIDTH,
        clamp: clampSidebarWidth,
        onResize: resizeSidebar,
        onCommit: commitSidebar,
        color: repoColor,
        label: '拖动调整左侧列表与右侧内容区的宽度',
        title: '拖动调整左右宽度；双击恢复默认；聚焦后可用 ← → 微调',
      })

      const terminalSplitter = terminalOpen
        ? h(PaneSplitter, {
            value: terminalWidth,
            min: TERMINAL_MIN_WIDTH,
            max: TERMINAL_MAX_WIDTH,
            defaultValue: TERMINAL_DEFAULT_WIDTH,
            clamp: clampTerminalWidth,
            onResize: resizeTerminal,
            onCommit: commitTerminal,
            color: repoColor,
            label: '拖动调整右侧内容区与 Git Bash 终端的宽度',
            title: '拖动调整终端宽度；双击恢复默认；聚焦后可用 ← → 微调',
          })
        : null

      const terminalPane = terminalOpen
        ? h('div', { style: { ...styles.terminal, width: terminalWidth } },
            terminalBridge
              ? h(GitTerminalPane, { bridge: terminalBridge, repo, onClose: toggleTerminal })
              : h('div', { style: styles.empty }, 'DSH 终端服务不可用。'),
          )
        : null

      return h('div', {
        style: styles.root,
        onClickCapture: (event) => {
          const node = event.target && event.target.closest ? event.target.closest('button') : null
          if (node) event.preventDefault()
        },
        onClick: (event) => event.stopPropagation(),
      },
        h('style', null, '.dsh-git-hit:hover{background:var(--dsw-alias-bg-layer-2)}.dsh-git-hit-pop:hover{background:var(--dsw-alias-bg-layer-1)}'),
        tabsBar,
        h('div', { style: styles.pathBar },
          h('span', {
            style: {
              ...styles.pathText,
              borderLeft: `2px solid ${repoColor}`,
              paddingLeft: 6,
            },
          }, activeTab ? activeTabPath() : (repo || '未选择项目')),
          h('span', { style: styles.pathSummary },
            !repo
              ? (reposBusy ? '正在检测 DSH 工作区里的 Git 项目…' : '没有选择项目')
              : (!status
                  ? (loading ? '读取中…' : '')
                  : (files.length ? `${files.length} 个文件有改动 · ${moduleNames.length} 个模块` : '工作区干净，没有待提交的改动')),
          ),
        ),
        error ? h('div', { style: styles.banner }, error) : null,
        !error && reposError && !oldHost ? h('div', { style: styles.banner }, reposError) : null,
        !error && oldHost ? h('div', { style: styles.banner }, '宿主半边还是旧版本（还没有 /repos 接口）：退出 DSH 再启动后，自动识别工作区项目才会生效。现在可以先用「选取项目 → 手动添加仓库」打开项目。') : null,
        branchError ? h('div', { style: { ...styles.banner, cursor: 'pointer' }, title: '点击关闭', onClick: () => setBranchError('') }, branchError) : null,
        repo && (bindOpen || bindReport)
          ? h('div', { style: styles.infoBanner },
              origin
                ? h('div', null, `当前 origin：${origin}`)
                : h('div', null, '这个项目还没有绑定远端仓库。粘贴地址后会执行 git remote add origin，并 fetch。'),
              h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
                h('input', {
                  style: styles.input,
                  value: bindUrl,
                  spellCheck: false,
                  placeholder: 'https://github.com/org/repo.git',
                  onChange: (event) => setBindUrl(event.target.value),
                  onKeyDown: (event) => { if (event.key === 'Enter') bindRemote(!!origin) },
                }),
                h('button', {
                  style: styles.button,
                  disabled: !bindUrl.trim() || !!bindBusy,
                  onClick: () => bindRemote(!!origin),
                }, bindBusy ? '绑定中…' : (origin ? '更换' : '绑定')),
              ),
              bindReport
                ? h('div', { style: { marginTop: 6 } },
                    h('div', null, relationText(bindReport)),
                    (bindReport.branches || []).length > 1
                      ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 } },
                          bindReport.branches.map((name) => h('button', {
                            key: name,
                            style: {
                              ...styles.rowButton,
                              ...(name === bindReport.branch ? { borderColor: repoColor, color: repoColor } : {}),
                            },
                            disabled: !!integrateBusy,
                            onClick: () => planRemote(name),
                          }, name)),
                        )
                      : null,
                    ['ff', 'merge', 'unrelated', 'local-unborn'].includes(bindReport.relation)
                      ? h('div', { style: { marginTop: 6 } },
                          h('button', {
                            style: styles.button,
                            disabled: !!integrateBusy || !bindReport.branch,
                            onClick: integrateRemote,
                          }, integrateBusy ? '合并中…' : integrateLabel(bindReport.relation)),
                        )
                      : null,
                    h('button', {
                      style: { ...styles.buttonQuiet, marginTop: 6 },
                      onClick: () => { setBindReport(null); setBindOpen(false) },
                    }, '关闭'),
                  )
                : null,
            )
          : null,
        h('div', { style: styles.body, ref: bodyRef },
          sidebar,
          sidebarSplitter,
          h('div', { style: { ...styles.card, ...styles.main } },
            contentHead,
            h('div', { style: { ...styles.scroll, ...(detail && activeTab ? styles.codeSurface : {}) } }, contentBody),
          ),
          terminalSplitter,
          terminalPane,
        ),
        notice ? h('div', { style: styles.notice }, notice) : null,
        colorPicker
          ? h(React.Fragment, null,
              h('div', { style: styles.overlay, onClick: () => setColorPicker(null) }),
              h('div', {
                style: { ...styles.popover, position: 'fixed', width: 252, top: colorPicker.top, left: colorPicker.left, padding: 8 },
              },
                h('div', { style: styles.popHead }, `项目颜色 · ${baseName(colorPicker.repo)}`),
                h('div', { style: styles.paletteGrid },
                  PROJECT_COLORS.map((color) => h('button', {
                    key: color,
                    title: color,
                    style: {
                      ...styles.swatch,
                      background: color,
                      outline: projectColorFor(colorPicker.repo, repoColors) === color ? '2px solid var(--dsw-alias-label-primary)' : 'none',
                      outlineOffset: 1,
                    },
                    onClick: () => setRepoColor(colorPicker.repo, color),
                  })),
                ),
                h('button', {
                  style: { ...styles.button, ...styles.paletteReset },
                  onClick: () => setRepoColor(colorPicker.repo, ''),
                }, '恢复默认颜色'),
                h('div', { style: { ...styles.popHead, whiteSpace: 'normal' } }, '只改这个面板里的显示颜色，不会写进仓库。'),
              ),
            )
          : null,
      )
    }
// @part 14-register.js

    function GitWorkbenchIcon(props) {
      const size = (props && props.size) || 16
      const active = !!(props && props.active)
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: active ? 'var(--dsw-alias-brand-primary)' : 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block' },
      },
        h('circle', { cx: 6, cy: 5, r: 2.2 }),
        h('circle', { cx: 6, cy: 19, r: 2.2 }),
        h('circle', { cx: 18, cy: 9, r: 2.2 }),
        h('path', { d: 'M6 7.2v9.6' }),
        h('path', { d: 'M6 12h7a5 5 0 0 0 5-5' }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        terminalBridge = createTerminalBridge(ctx)
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'git-workbench', order: 30, label: 'Git' }, GitWorkbenchIcon),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'git-workbench' }, GitWorkbenchPanel),
        )
      },
    }
  },
})

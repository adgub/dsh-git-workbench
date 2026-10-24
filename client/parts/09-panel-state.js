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

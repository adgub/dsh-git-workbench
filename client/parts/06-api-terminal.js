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

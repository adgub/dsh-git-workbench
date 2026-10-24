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

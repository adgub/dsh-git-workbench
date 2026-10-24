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

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

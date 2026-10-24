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

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

    function canAdd(entry) {
      return !!entry && entry.kind !== 'conflict' && (entry.unstaged || entry.untracked)
    }

    function canCommitFile(entry) {
      return !!entry && entry.kind !== 'conflict' && !!entry.staged
    }

    function filesUnder(node) {
      const out = []
      const walk = (current) => {
        for (const file of current.files || []) out.push(file)
        for (const dir of current.dirs || []) walk(dir)
      }
      walk(node)
      return out
    }

    function pickBox(paths, picked, onToggleMany, stop) {
      const selected = paths.filter((item) => picked.has(item)).length
      const all = paths.length > 0 && selected === paths.length
      return h('input', {
        type: 'checkbox',
        checked: all,
        ref: (node) => { if (node) node.indeterminate = selected > 0 && !all },
        style: styles.check,
        title: all ? '取消勾选' : '勾选这一组',
        onClick: (event) => { if (stop) event.stopPropagation() },
        onChange: () => onToggleMany(paths, !all),
      })
    }

    function renderChangeFile(entry, padLeft, openDiffTab, actions, pick) {
      const tone = colorForStatus(entry.xy)
      const deleted = isDeleted(entry)
      const busy = !!(actions && actions.sideBusy === entry.path)
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
      }
      const box = pick
        ? h('input', {
            type: 'checkbox',
            checked: pick.picked.has(entry.path),
            style: styles.check,
            title: pick.title,
            onClick: (event) => event.stopPropagation(),
            onChange: () => pick.onToggle(entry.path),
          })
        : null
      return h('div', {
        key: (pick && pick.prefix ? pick.prefix : '') + 'file:' + entry.path,
        className: 'dsh-git-hit',
        style: { ...styles.fileRow, paddingLeft: padLeft, ...(entry.kind === 'conflict' ? styles.mergeFileRow : {}) },
        onClick: () => openDiffTab(entry),
        title: `${statusLabel(entry.xy)}\n${entry.path}`,
      },
        box,
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

    function renderPickRows({ files, treeMode, collapsed, toggleDir, openDiffTab, picked, onToggle, onToggleMany, prefix, title }) {
      const pick = { picked, onToggle, prefix, title }
      if (treeMode === 'files') {
        const flat = files.slice().sort((a, b) => String(a.path).localeCompare(String(b.path), 'zh-Hans-CN'))
        return flat.map((entry) => renderChangeFile(entry, 12, openDiffTab, null, pick))
      }
      const rows = []
      const renderNode = (node, depth) => {
        for (const dir of dirsOf(node)) {
          const paths = filesUnder(dir).map((entry) => entry.path)
          const isCollapsed = collapsed.has(prefix + dir.key)
          rows.push(h('div', {
            key: prefix + 'dir:' + dir.key,
            className: 'dsh-git-hit',
            style: {
              ...(depth === 0 ? styles.moduleRow : styles.dirRow),
              paddingLeft: depth === 0 ? 12 : 8 + depth * 14,
            },
            onClick: () => toggleDir(prefix + dir.key),
            title: dir.key,
          },
            pickBox(paths, picked, onToggleMany, true),
            h('span', { style: styles.caret }, isCollapsed ? '▸' : '▾'),
            h('span', { style: styles.dirName }, dir.name),
            h('span', { style: styles.count }, String(paths.length)),
            h('span', { style: styles.dots }, statusDots(dir.counts)),
          ))
          if (!isCollapsed) renderNode(dir, depth + 1)
        }
        for (const entry of node.files) {
          rows.push(renderChangeFile(entry, 8 + depth * 14 + 12, openDiffTab, null, pick))
        }
      }
      renderNode(buildTree(files), 0)
      return rows
    }

    function renderChangeList({
      files, collapsed, toggleDir, openDiffTab, treeMode, onTreeMode,
      stagedCount, unstagedCount, untrackedCount, moduleNames,
      commitMessage, onCommitMessage, onCommit, commitBusy, commitError, conflictCount, merging,
      onStagePaths, onTakeSide, stageBusy, sideBusy, headBranch, onOpenMerge,
      pickedAdd, pickedCommit, onToggleAdd, onToggleCommit, onToggleAddMany, onToggleCommitMany,
    }) {
      const actions = headBranch ? { onTakeSide, sideBusy, headBranch } : null
      const addFiles = files.filter(canAdd)
      const commitFiles = files.filter(canCommitFile)
      const conflictFiles = files.filter((entry) => entry.kind === 'conflict')
      const addPaths = addFiles.map((entry) => entry.path)
      const commitPaths = commitFiles.map((entry) => entry.path)
      const pickedCommitPaths = commitPaths.filter((item) => pickedCommit && pickedCommit.has(item))
      const pickedAddPaths = addPaths.filter((item) => pickedAdd && pickedAdd.has(item))
      const messageReady = !!(commitMessage && String(commitMessage).trim())
      const allCommitPicked = commitPaths.length > 0 && pickedCommitPaths.length === commitPaths.length
      const canCommit = !!headBranch && messageReady && !conflictCount && !commitBusy && (
        merging ? (commitPaths.length === 0 || allCommitPicked) : pickedCommitPaths.length > 0
      )
      const modeButton = (mode, label) => h('button', {
        key: mode,
        style: {
          ...styles.buttonQuiet,
          ...(treeMode === mode ? { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' } : {}),
        },
        type: 'button',
        onClick: (event) => { event.preventDefault(); onTreeMode(mode) },
      }, label)
      const sectionTitle = (text, paths, picked, onToggleMany) => h('div', {
        style: { ...styles.sectionHead, alignItems: 'center' },
      },
        paths.length ? pickBox(paths, picked, onToggleMany, false) : null,
        h('span', { style: { fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } }, text),
        h('span', null, `${paths.filter((item) => picked.has(item)).length}/${paths.length}`),
      )
      return h('div', null,
        merging && onOpenMerge
          ? h('div', { style: conflictCount ? styles.mergeAlert : styles.mergePending },
              h('span', { style: { flex: '1 1 auto' } }, conflictCount
                ? `${conflictCount} 个文件冲突，先选择保留哪一边`
                : '这次合并还没有提交'),
              h('button', {
                type: 'button',
                style: styles.rowButton,
                onClick: (event) => { event.preventDefault(); onOpenMerge() },
              }, '打开合并窗口'),
            )
          : null,
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
        ),
        conflictFiles.length
          ? h('div', null,
              h('div', { style: styles.sectionHead }, h('span', { style: { fontWeight: 700, color: '#e3b341' } }, '冲突')),
              conflictFiles.map((entry) => renderChangeFile(entry, 12, openDiffTab, actions, null)),
            )
          : null,
        h('div', null,
          sectionTitle('待 add', addPaths, pickedAdd || new Set(), onToggleAddMany),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px' } },
            h('button', {
              type: 'button',
              style: { ...styles.button, opacity: pickedAddPaths.length && !stageBusy ? 1 : 0.45 },
              disabled: !headBranch || !pickedAddPaths.length || !!stageBusy,
              title: headBranch ? `git add 勾选的文件，只影响分支 ${headBranch}` : '先切换到一个分支',
              onClick: (event) => { event.preventDefault(); onStagePaths(pickedAddPaths) },
            }, stageBusy ? '暂存中…' : `add${pickedAddPaths.length ? ' ' + pickedAddPaths.length : ''}`),
            h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
              addFiles.length ? '只暂存勾选的未暂存和未跟踪文件。' : '没有需要 add 的文件。'),
          ),
          addFiles.length
            ? renderPickRows({
                files: addFiles, treeMode, collapsed, toggleDir, openDiffTab,
                picked: pickedAdd || new Set(), onToggle: onToggleAdd, onToggleMany: onToggleAddMany,
                prefix: 'add:', title: '勾选后 add，写入暂存区',
              })
            : null,
        ),
        h('div', null,
          sectionTitle('待 commit', commitPaths, pickedCommit || new Set(), onToggleCommitMany),
          commitFiles.length
            ? renderPickRows({
                files: commitFiles, treeMode, collapsed, toggleDir, openDiffTab,
                picked: pickedCommit || new Set(), onToggle: onToggleCommit, onToggleMany: onToggleCommitMany,
                prefix: 'commit:', title: '勾选后提交暂存区里的这一版',
              })
            : h('div', { style: { ...styles.empty, padding: '8px 12px' } }, '还没有已暂存的文件。先在上面勾选并 add。'),
          headBranch
            ? h('div', { style: styles.commitDock },
                h('div', { style: { fontWeight: 700, marginBottom: 6 } }, `提交到 ${headBranch}`),
                h('textarea', {
                  style: styles.commitBox,
                  value: commitMessage || '',
                  placeholder: merging ? `填写日志，在 ${headBranch} 上完成这次合并` : `提交到 ${headBranch}（日志必填）`,
                  spellCheck: false,
                  onChange: (event) => onCommitMessage(event.target.value),
                  onKeyDown: (event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canCommit) {
                      onCommit(merging ? undefined : pickedCommitPaths)
                    }
                  },
                }),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
                  h('button', {
                    type: 'button',
                    style: { ...styles.button, opacity: canCommit ? 1 : 0.45 },
                    disabled: !canCommit,
                    title: !messageReady
                      ? '先填写提交日志'
                      : (conflictCount
                          ? '先解决冲突'
                          : (merging && commitPaths.length && !allCommitPicked
                              ? '合并时要勾选全部已暂存的文件'
                              : (pickedCommitPaths.length ? `只提交勾选的 ${pickedCommitPaths.length} 个文件` : '先勾选要提交的已暂存文件'))),
                    onClick: (event) => { event.preventDefault(); onCommit(merging ? undefined : pickedCommitPaths) },
                  }, commitBusy ? '提交中…' : '提交'),
                  h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                    conflictCount
                      ? `${conflictCount} 个冲突待选择，解决后才能提交`
                      : (merging
                          ? '这次合并会提交全部已暂存的文件。'
                          : '只提交下面勾选的已暂存文件，没勾的留在暂存区。')),
                ),
                commitError
                  ? h('div', { style: { marginTop: 6, color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'normal' } }, commitError)
                  : null,
              )
            : h('div', { style: { margin: '8px 10px' } }, '当前不在分支上。先切换到一个分支，再暂存和提交。'),
        ),
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

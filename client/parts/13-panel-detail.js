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

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

# dsh-git-workbench

DSH Web UI 里的 Git 工具窗，布局接近 JetBrains：顶栏切换项目和分支、搜索并打开文件；左栏按模块查看改动，也能浏览整个项目目录、提交图谱、日志和分支；中间只读查看差异或全文；右侧是可收起的 Git Bash 终端。三栏之间的竖线可以拖动。

> 仅限本机使用。插件通过 DSH 本机 HTTP 读取仓库路径和文件内容，路由没有身份认证。请让 DSH Web 只监听 `127.0.0.1`，不要把端口暴露到局域网或公网。

界面文案为中文。

## 安装

本机需要已安装 `dsh` 和 pnpm，并且 `git` 在 `PATH` 里。插件没有 npm 依赖，不用先执行 `npm install`。

从 GitHub 安装到 Web 配置档：

```bash
dsh plugin --profile web add github:<用户名>/dsh-git-workbench
```

克隆到本机后再安装。这条命令建立的是目录链接，之后在该目录里 `git pull` 不用重新安装：

```bash
git clone https://github.com/<用户名>/dsh-git-workbench.git
dsh plugin --profile web add <克隆下来的绝对路径>
```

也可以在 DSH 的 Plugins 页里选择本地目录安装。

装好后确认配置里出现一层 `# == dsh-git-workbench`，然后完全退出正在运行的 DSH 再启动：

```bash
dsh --profile web --dump-config
dsh web
```

侧栏会出现 **Git**。安装和卸载由 Loader 热应用，通常几秒内生效。改了 `index.js` 或 `host/` 之后要完全退出 DSH 再启动。改了 `client/parts/` 后先执行 `node scripts/build-client.mjs`，再刷新页面才会更新 `client.js`。若页面顶部出现「宿主半边还是旧版本」，按提示重启即可。重启前仍可用「手动添加路径」打开项目。

Windows 上要用右侧终端，需要安装 Git Bash。没有 Git Bash 时，变更树、目录、差异和日志仍然可用，终端会退回默认 Shell。终端栏还依赖 DSH 自带的 `@deepseek-ai/dsh-client-ui-sidebar-terminal`；该插件被禁用时，第三栏会显示不可用。

## 界面

顶栏从左到右是：项目、当前分支、拉取、推送、更多、刷新、Git Bash、文件搜索、已打开文件的标签。鼠标放在「更多」上才出现回退和绑定/更换仓库。下一行是当前路径和改动汇总。

| 区域 | 作用 |
|---|---|
| 项目 | 列出 DSH 工作区里检测到的 Git 仓库，可搜索、切换。读不到的工作区标成「不可访问」并留在列表里。也可以手动添加绝对路径；手动项目存在浏览器 localStorage 中，可移除 |
| 项目颜色 / 打开目录 | 每行可改颜色，或在文件管理器中打开目录。颜色按路径稳定分配（12 色），只保存在浏览器里 |
| 分支 | 显示当前分支和 ↑↓。点本地分支后执行 `git switch`（旧版 git 使用 `git checkout`）。菜单里可以新建分支（`git switch -c`）和修改当前分支的名称（`git branch -m`）。未提交改动会带到新分支；冲突时 git 拒绝切换并显示原因。切换或新建后关闭标签页并刷新 |
| 拉取 / 推送 | 紧挨分支。拉取是 `git pull --ff-only`，不能快进时显示 git 的原因，不自动合并。推送是 `git push`；没有上游时 `git push -u origin <当前分支>`。都不会使用 `--force` |
| 变更树 | 按模块（顶层目录）→ 子目录 → 文件折叠，也可以改成只显示文件。目录显示改动数，文件旁的圆点表示已暂存、未暂存、未跟踪。未暂存和未跟踪的文件有 **add**。顶部填写提交日志后才能点 **提交**，空日志不能提交。冲突文件可以选择「用本地」或「用远端」。点文件打开差异，改动行有底色 |
| 绑定仓库 | 在「更多」里打开。粘贴 `https://`、`http://`、`ssh://` 或 `git@host:path`。面板执行 `git remote add origin` 和 `git fetch`。已经绑定过时可以更换地址 |
| 合并两边 | 绑定并拉取之后，按本地和远端的关系给出一个操作：远端没有新提交就去推送；远端超前就快进；两边都有新提交，或两边没有共同祖先，就合并进暂存区，填写日志后再提交。有冲突时在变更树里选择保留哪一边。不会使用 `--force` |
| 回退 | 在「更多」里。只撤销当前分支最上面那一次还没推送的提交（`git reset --soft HEAD~1`）。改动留在暂存区。已经在上游里的提交不能回退；第一次提交也不能回退。暂存和提交同样只作用于当前检出的分支 |
| 目录 | 按层读取整个项目目录，包含被 `.gitignore` 忽略的项、空目录和 `node_modules`，只隐藏 `.git`。点文件夹再加载下一层，单层超过 5000 项会截断。符号链接目录不展开 |
| 文件标签与搜索 | 输入即筛选。有改动的文件优先，回车打开差异；其余仓库文件打开全文。`↑` `↓` 选择，`Enter` 打开，`Esc` 关闭 |
| 差异 / 全文 | 只读。差异范围可切「工作区 / 已暂存 / 全部」，新增行是绿色底，删除行是红色底。全文按扩展名做简单高亮；有改动的行同样铺底色。未跟踪文件直接预览全文，同一文件上可在差异和全文之间切换 |
| 图谱 / 日志 / 分支 | 图谱是 `git log --graph --all` 的等宽字符，按列着成不同颜色。日志条数来自 `historyLimit`（默认 80），图谱是它的 1.5 倍。点一行查看该提交的 patch。分支列表带短 SHA、上游和当前标记 |
| Git Bash 终端 | 默认收起，避免一打开面板就占住项目目录。打开后复用 DSH 内置终端（真实 PTY + xterm），在当前项目目录启动本机 Git Bash，并设置 `GIT_OPTIONAL_LOCKS=0`，提示符不会去锁 `index`。可用 `DSH_GIT_BASH` 指定 `bash.exe`。收起终端或离开 Git 面板会结束这个进程并放开目录；切换项目会关掉旧进程并在新目录新建；头部「新建」总是分配新的 PTY。配色为 mintty 默认调色板 |
| 分栏 | 左栏 240–720px，终端 280–720px，中间至少留 320px。双击竖线恢复默认宽度；聚焦后 `←` `→` 微调，`Home` 恢复默认，`End` 拉到最宽。宽度和终端开合状态记在 localStorage |

文件名颜色沿用常见习惯：未跟踪红色，新增绿色，修改蓝色，删除灰色并加删除线，重命名紫色，冲突橙色。

还没有任何提交的仓库不会报错。`log` / `graph` 返回 `unborn: true` 和空列表，界面显示「这个仓库还没有任何提交」。

## 功能与 Git 命令

面板上的每个动作，对应宿主实际执行的命令。参数以数组传给 `git -C <仓库>`，不经过 shell。推送、合并和回退都不带 `--force`。

| 功能 | Git 命令 |
|---|---|
| 列出工作区里的仓库 | 先 `git --version`。每个候选目录 `git rev-parse --show-toplevel` |
| 手动添加路径 | `git rev-parse --is-inside-work-tree`，通过后再 `git rev-parse --show-toplevel` |
| 项目列表上的分支和改动数 | `git status --porcelain=v2 --branch --untracked-files=normal`，`git rev-parse --short HEAD` |
| 变更树 | `git status --porcelain=v2 --branch --untracked-files=all`。是否正在合并：`git rev-parse -q --verify MERGE_HEAD` |
| 日志 | `git log -n<条数> --date=short --pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e` |
| 图谱 | `git log --graph --oneline --decorate=short --all -n<条数>` |
| 分支列表 | `git for-each-ref --sort=-committerdate refs/heads`。格式字段用制表符隔开：`%(refname:short)`、`%(objectname:short)`、`%(committerdate:short)`、`%(upstream:short)`、`%(HEAD)` |
| 文件搜索 | `git ls-files -z --cached --others --exclude-standard` |
| 目录 | 不跑 git。逐层读目录，跳过 `.git` |
| 全文 | 不跑 git。直接读该文件，超过 200KB 截断 |
| 差异 | 先 `git status --porcelain=v2 --branch`。未跟踪文件直接读全文。已跟踪文件：工作区是 `git diff --no-color --no-ext-diff -- <路径>`，已暂存再加 `git diff --cached --no-color --no-ext-diff -- <路径>` |
| 某次提交 | `git show --no-color --no-ext-diff --date=short --stat=140 --patch <提交号>` |
| 切换分支 | `git check-ref-format --branch <名>`，`git rev-parse --abbrev-ref HEAD`，`git rev-parse --verify --quiet refs/heads/<名>`，然后 `git switch <名>`。旧版 git 没有 switch 时改为 `git checkout <名>` |
| 新建分支 | `git switch -c <名>`。旧版改为 `git checkout -b <名>` |
| 修改当前分支名称 | `git branch -m <当前名> <新名>` |
| 拉取 | `git pull --ff-only` |
| 推送 | 先 `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}`。有上游时 `git push`。没有上游时 `git push -u origin <当前分支>` |
| 当前 origin | `git remote get-url origin` |
| 绑定或更换仓库 | 没有 origin：`git remote add origin <地址>`。更换：`git remote set-url origin <地址>`。然后 `git fetch origin`。接着 `git for-each-ref --format=%(refname:short) refs/remotes/origin`，并用 `git ls-remote --symref origin HEAD` 选择远端分支 |
| 只查看远端分支关系 | 不再访问网络。`git for-each-ref --format=%(refname:short) refs/remotes/origin`，再对选中的分支做下面的关系判断 |
| 合并 · 远端超前 | `git merge --ff-only refs/remotes/origin/<分支>` |
| 合并 · 两边都有新提交 | `git merge --no-commit refs/remotes/origin/<分支>` |
| 合并 · 没有共同祖先 | `git merge --allow-unrelated-histories --no-commit refs/remotes/origin/<分支>` |
| 合并 · 本地还没有任何提交 | 先 `git diff --cached --quiet` 确认暂存区是空的，然后 `git checkout -B <当前分支> refs/remotes/origin/<分支>` |
| 合并 · 远端没有新提交 | 不执行 merge，界面提示去推送 |
| 冲突时保留一边 | `git checkout --ours -- <路径>` 或 `git checkout --theirs -- <路径>`。这一边把文件删了时改为 `git rm -f -- <路径>`，然后 `git add -- <路径>` |
| 暂存单个文件 | `git add -- <路径>` |
| 提交 | `git diff --cached --quiet` 确认有暂存内容（正在合并时允许空暂存区），然后 `git commit -m <日志>` |
| 回退 | `git rev-parse --verify --quiet HEAD~1`。有上游时再 `git merge-base --is-ancestor HEAD @{upstream}`，已经在上游里就拒绝。通过后 `git reset --soft HEAD~1` |
| 在文件管理器中打开 | 不跑 git |
| 查找 Git Bash | `git --exec-path`，用来定位 `bash.exe`。打开终端后启动的是这个 bash，不是 git 子命令 |
| 刷新 | 同时跑变更树、日志、图谱、分支列表和当前 origin |

这些动作里还会用到的检查：

| 场合 | Git 命令 |
|---|---|
| 是不是 Git 工作区 | `git rev-parse --is-inside-work-tree` |
| 仓库根目录 | `git rev-parse --show-toplevel` |
| 有没有提交 | `git rev-parse --verify --quiet HEAD` |
| 当前分支名 | `git rev-parse --abbrev-ref HEAD`；还没有提交时 `git symbolic-ref --quiet --short HEAD` |
| 分支名是否合法 | `git check-ref-format --branch <名>` |
| 本地有没有这个分支 | `git rev-parse --verify --quiet refs/heads/<名>` |
| 和某条远端分支的关系 | `git rev-parse --verify --quiet refs/remotes/origin/<分支>`，`git merge-base HEAD <该引用>`，`git rev-parse HEAD` |
| 冲突文件 | `git status --porcelain=v2 --untracked-files=no` |
| 是否正在合并 | `git rev-parse -q --verify MERGE_HEAD` |

## 仓库是怎么找到的

宿主按这个顺序取 DSH 工作区：

1. `ctx.workspaceRegistry.list()`（宿主挂了 workspace 服务时）。
2. 否则读 `$DSH_HOME/storages/workspace.json`。`$DSH_HOME` 缺省为 `~/.dsh`。

然后对每个工作区：

- 本身是 Git 工作区：记一个仓库，以 `git rev-parse --show-toplevel` 为准。
- 只是父目录：扫描其中的 Git 仓库。默认 1 层，`scanDepth` 可调到 3。不进入 `node_modules`、`dist` 这类目录。
- 没有权限或目录已删除：仍然返回这条工作区，带 `error`，界面标成「不可访问」，并把路径填进手动添加框。

结果按路径去重。手动添加的路径必须通过 `git rev-parse --is-inside-work-tree`，并且是本地目录。扫描和手动添加不接受远端 URL，也不会 clone。自动检测只覆盖工作区；工作区之外的仓库需要手动添加，或写进下面的 `workspaces` 配置。绑定远端、拉取、推送和合并只在面板按钮上发生。

## 当前边界

- 目录页只读。不创建、不重命名、不删除文件。
- 会改本机的 Git 操作都必须从面板按钮发起：切换、新建和重命名当前分支，`git pull --ff-only`，`git push`（没有上游时 `git push -u origin <分支>`，从不用 `--force`），绑定或更换 `origin`，合并远端分支，暂存单个文件，提交已暂存的文件，回退未推送的最新提交，以及在文件管理器中打开项目目录。
- 终端里的命令由你输入，以当前系统用户权限执行，不受 Agent 沙箱限制。插件不拦截、不记录输出，也不把输出发给模型。
- 不注册模型工具。Agent 调不到这个插件，git 只在你点击时运行。

## 配置

改的是 `cordis.patch.yml` 里这一行的 `config`：

| 键 | 默认 | 说明 |
|---|---|---|
| `route` | `/dsh-git-workbench` | HTTP 前缀。要和 `client.js` 里的 `ROUTE` 一致：面板第一次请求用后者，`repos` 成功后改用接口返回的 `route` |
| `repo` | `''` | 默认仓库绝对路径。留空时用第一个检测到的项目 |
| `historyLimit` | `80` | 日志条数，范围 5–300。图谱条数是它的 1.5 倍（默认 120），最多 300 |
| `workspaces` | `[]` | 额外扫描的目录（绝对路径，逗号或换行分隔） |
| `scanDepth` | `1` | 父目录向下扫描的层数，范围 0–3 |

## 安全

路由不提供身份认证。`repos`、`status`、`log`、`file`、`diff`、`dir` 会把本机绝对路径和文件内容返回给调用方。DSH Web 默认只监听 `127.0.0.1`；若改成 `0.0.0.0`，同一网络里的人可以读到项目路径和文件内容。

- `git` 以参数数组启动（`shell: false`，工作目录是系统临时目录，用 `-C` 指定仓库），分支名和路径不会进 shell。同一仓库的 git 命令串行执行，并且 `GIT_OPTIONAL_LOCKS=0`，状态和差异不会抢 `index.lock`。超时会结束整个进程树，并删掉这次命令留在 `.git` 里的锁文件。
- `GIT_TERMINAL_PROMPT=0`，不会停在凭据提示上。
- 读操作 12 秒超时。拉取和推送 60 秒超时。stdout 上限 8MB，文件预览 200KB。
- 推送、合并和回退都不带 `--force`。回退只做 `git reset --soft HEAD~1`，并且这次提交必须还不在上游里。`switch`、`branchCreate`、`branchRename`、`pull`、`push`、`reveal`、`remoteBind`、`integrate`、`stage`、`commitCreate`、`uncommit` 和 `takeSide` 要求请求头 `x-dsh-git-workbench: 1`，面板会自己带上，跨站页面触发不了。提交日志走 POST，空白日志会被拒绝。
- 文件路径拒绝绝对路径和 `..`。提交号必须是十六进制。仓库路径必须是绝对路径，且通过 `git rev-parse --is-inside-work-tree`。分支名通过 `git check-ref-format --branch`，以 `-` 开头的一律拒绝。
- `dir` 只做逐层 `readdir`：必须是仓库相对路径，拒绝符号链接目录，每层最多 5000 项，隐藏 `.git`。
- 切换分支前不 stash、不丢弃改动。冲突时 `git switch` 拒绝，错误原文显示在界面上。
- 终端默认不启动。打开后由 DSH 的 `webTerminals` 创建真实 PTY；收起终端或离开 Git 面板会关掉它。`gitBash` 只探测路径，不启动 shell。
- 每个工作区最多探测 80 次 `git rev-parse`。

## HTTP 接口

`GET /dsh-git-workbench/api?op=…&repo=<绝对路径>`

| op | 额外参数 | 返回 |
|---|---|---|
| `repos` | `refresh=1` 跳过 8 秒缓存；`depth` 覆盖扫描深度 | `repos[]`、`workspaces[]`、`source`（`registry` / `storage` / `none`） |
| `repoInfo` | `repo` | 单个仓库的校验结果与摘要 |
| `status` | — | `branch`、`oid`、`unborn`、`ahead`、`behind`、`files[]` |
| `log` | `limit` | `commits[]`。空仓库为 `unborn: true` |
| `graph` | `limit` | `lines[]{graph, sha, text}`。空仓库为 `unborn: true` |
| `branches` | — | `branches[]` |
| `files` | — | `git ls-files` 结果，最多 5000 条 |
| `dir` | `path`，根目录为 `''` | 一层 `dirs[]` / `files[]`，以及 `truncated` |
| `gitBash` | — | Git for Windows 的 `bash.exe` 绝对路径；找不到时为空字符串 |
| `file` | `path` | 全文。超过 200KB 截断；含 NUL 视为二进制 |
| `diff` | `path`，`scope=worktree\|staged\|all` | 纯文本 diff。未跟踪文件给全文预览 |
| `commit` | `rev`（4–40 位十六进制） | `git show --stat --patch` |
| `switch` | `branch` | 切到已有本地分支。已在该分支时 `unchanged: true`。需要面板请求头 |
| `branchCreate` | `branch` | 从当前提交新建并切换。本地已有同名分支时拒绝。需要面板请求头 |
| `branchRename` | `branch` | 把当前分支改成这个名字。需要面板请求头 |
| `pull` | — | `git pull --ff-only`。需要面板请求头 |
| `push` | — | `git push`；没有上游时 `git push -u origin <当前分支>`。需要面板请求头 |
| `remote` | — | 当前 `origin` 地址；没有时为 `null` |
| `remoteBind` | `url`，`replace=1` 时允许更换已有 origin | `git remote add` 或 `set-url`，然后 `git fetch`，并返回两边历史的关系。需要面板请求头 |
| `remotePlan` | `branch` | 只判断已经 fetch 过的某个远端分支，不再访问网络 |
| `integrate` | `branch` | 按关系快进、合并进暂存区，或在本地还没有提交时取下远端历史。需要面板请求头 |
| `stage` | `path` | `git add -- <路径>`。需要面板请求头 |
| `commitCreate` | POST JSON `message` | `git commit -m`。日志去掉空白后不能为空。需要面板请求头 |
| `uncommit` | — | 最近一次提交还不在上游时，`git reset --soft HEAD~1`。需要面板请求头 |
| `takeSide` | `path`，`side=ours\|theirs` | 合并冲突时保留一边并暂存。需要面板请求头 |
| `reveal` | `repo` | 在系统文件管理器中打开仓库根目录。需要面板请求头 |

## 开发

宿主逻辑暴露了 `handleOp(op, params, host?)`，可以不经 HTTP 直接跑：

```bash
node smoke.mjs <任意 Git 仓库的绝对路径>
```

脚本会跑 `gitBash`、`repos`、`status`、`log`、`graph`、`branches`、`diff`、`file`、`dir`、`commit`，以及路径穿越、`switch`、`branchCreate`、`branchRename`、`pull`、`push`、`reveal`、`stage`、`commitCreate`、`uncommit`、`remoteBind`、`integrate` 和 `takeSide` 的拒绝分支。

宿主入口仍是 `index.js`，实现在 `host/`：`git.js` 负责启动进程，`parse.js` 解析输出，`discover.js` 找仓库，`ops-read.js`、`ops-branch.js`、`ops-remote.js`、`ops-commit.js` 按操作分开。浏览器源码在 `client/parts/`，按文件名顺序拼成 DSH 加载的那一个 `client.js`：

```bash
node scripts/build-client.mjs
node scripts/build-client.mjs --check
```

没有 npm 依赖，也不用打包器。装好的插件直接使用已经拼好的 `client.js`。

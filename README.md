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

侧栏会出现 **Git**。安装和卸载由 Loader 热应用，通常几秒内生效。改了 `index.js` 之后要完全退出 DSH 再启动；只刷新页面只会更新 `client.js`。若页面顶部出现「宿主半边还是旧版本」，按提示重启即可。重启前仍可用「手动添加路径」打开项目。

Windows 上要用右侧终端，需要安装 Git Bash。没有 Git Bash 时，变更树、目录、差异和日志仍然可用，终端会退回默认 Shell。终端栏还依赖 DSH 自带的 `@deepseek-ai/dsh-client-ui-sidebar-terminal`；该插件被禁用时，第三栏会显示不可用。

## 界面

顶栏从左到右是：项目、当前分支、拉取、推送、刷新、Git Bash、文件搜索、已打开文件的标签。下一行是当前路径和改动汇总。

| 区域 | 作用 |
|---|---|
| 项目 | 列出 DSH 工作区里检测到的 Git 仓库，可搜索、切换。读不到的工作区标成「不可访问」并留在列表里。也可以手动添加绝对路径；手动项目存在浏览器 localStorage 中，可移除 |
| 项目颜色 / 打开目录 | 每行可改颜色，或在文件管理器中打开目录。颜色按路径稳定分配（12 色），只保存在浏览器里 |
| 分支 | 显示当前分支和 ↑↓。点本地分支后执行 `git switch`（旧版 git 使用 `git checkout`）。菜单里可以新建分支（`git switch -c`）和修改当前分支的名称（`git branch -m`）。未提交改动会带到新分支；冲突时 git 拒绝切换并显示原因。切换或新建后关闭标签页并刷新 |
| 拉取 / 推送 | 紧挨分支。拉取是 `git pull --ff-only`，不能快进时显示 git 的原因，不自动合并。推送是 `git push`；没有上游时 `git push -u origin <当前分支>`。都不会使用 `--force` |
| 变更树 | 按模块（顶层目录）→ 子目录 → 文件折叠，也可以改成只显示文件。目录显示改动数，文件旁的圆点表示已暂存、未暂存、未跟踪。点文件打开差异，改动行有底色 |
| 目录 | 按层读取整个项目目录，包含被 `.gitignore` 忽略的项、空目录和 `node_modules`，只隐藏 `.git`。点文件夹再加载下一层，单层超过 5000 项会截断。符号链接目录不展开 |
| 文件标签与搜索 | 输入即筛选。有改动的文件优先，回车打开差异；其余仓库文件打开全文。`↑` `↓` 选择，`Enter` 打开，`Esc` 关闭 |
| 差异 / 全文 | 只读。差异范围可切「工作区 / 已暂存 / 全部」，新增行是绿色底，删除行是红色底。全文按扩展名做简单高亮；有改动的行同样铺底色。未跟踪文件直接预览全文，同一文件上可在差异和全文之间切换 |
| 图谱 / 日志 / 分支 | 图谱是 `git log --graph --all` 的等宽字符，按列着成不同颜色。日志条数来自 `historyLimit`（默认 80），图谱是它的 1.5 倍。点一行查看该提交的 patch。分支列表带短 SHA、上游和当前标记 |
| Git Bash 终端 | 复用 DSH 内置终端（真实 PTY + xterm），在当前项目目录启动本机 Git Bash。可用 `DSH_GIT_BASH` 指定 `bash.exe`。切换项目会关掉旧进程并在新目录新建；头部「新建」总是分配新的 PTY。配色为 mintty 默认调色板 |
| 分栏 | 左栏 240–720px，终端 280–720px，中间至少留 320px。双击竖线恢复默认宽度；聚焦后 `←` `→` 微调，`Home` 恢复默认，`End` 拉到最宽。宽度和终端开合状态记在 localStorage |

文件名颜色沿用常见习惯：未跟踪红色，新增绿色，修改蓝色，删除灰色并加删除线，重命名紫色，冲突橙色。

还没有任何提交的仓库不会报错。`log` / `graph` 返回 `unborn: true` 和空列表，界面显示「这个仓库还没有任何提交」。

## 仓库是怎么找到的

宿主按这个顺序取 DSH 工作区：

1. `ctx.workspaceRegistry.list()`（宿主挂了 workspace 服务时）。
2. 否则读 `$DSH_HOME/storages/workspace.json`。`$DSH_HOME` 缺省为 `~/.dsh`。

然后对每个工作区：

- 本身是 Git 工作区：记一个仓库，以 `git rev-parse --show-toplevel` 为准。
- 只是父目录：扫描其中的 Git 仓库。默认 1 层，`scanDepth` 可调到 3。不进入 `node_modules`、`dist` 这类目录。
- 没有权限或目录已删除：仍然返回这条工作区，带 `error`，界面标成「不可访问」，并把路径填进手动添加框。

结果按路径去重。手动添加的路径必须通过 `git rev-parse --is-inside-work-tree`，并且是本地目录。插件不接受远端 URL，扫描时也不会 clone 或 fetch。自动检测只覆盖工作区；工作区之外的仓库需要手动添加，或写进下面的 `workspaces` 配置。拉取和推送只在面板按钮上发生。

## 当前边界

- 变更树只展示状态。插件不执行 stage、commit、reset 或 merge。
- 目录页只读。不创建、不重命名、不删除文件。
- 会改本机的 Git 操作都必须从面板按钮发起：切换、新建和重命名当前分支，`git pull --ff-only`，`git push`（没有上游时 `git push -u origin <分支>`，从不用 `--force`），以及在文件管理器中打开项目目录。
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

- `git` 以参数数组启动（`shell: false`），分支名和路径不会进 shell。
- `GIT_TERMINAL_PROMPT=0`，不会停在凭据提示上。
- 读操作 12 秒超时。拉取和推送 60 秒超时。stdout 上限 8MB，文件预览 200KB。
- 没有 `add`、`commit`、`reset`，推送也不带 `--force`。`switch`、`branchCreate`、`branchRename`、`pull`、`push` 和 `reveal` 要求请求头 `x-dsh-git-workbench: 1`，面板会自己带上，跨站页面触发不了。
- 文件路径拒绝绝对路径和 `..`。提交号必须是十六进制。仓库路径必须是绝对路径，且通过 `git rev-parse --is-inside-work-tree`。分支名通过 `git check-ref-format --branch`，以 `-` 开头的一律拒绝。
- `dir` 只做逐层 `readdir`：必须是仓库相对路径，拒绝符号链接目录，每层最多 5000 项，隐藏 `.git`。
- 切换分支前不 stash、不丢弃改动。冲突时 `git switch` 拒绝，错误原文显示在界面上。
- 终端由 DSH 的 `webTerminals` 创建真实 PTY。`gitBash` 只探测路径，不启动 shell。
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
| `reveal` | `repo` | 在系统文件管理器中打开仓库根目录。需要面板请求头 |

## 开发

宿主逻辑暴露了 `handleOp(op, params, host?)`，可以不经 HTTP 直接跑：

```bash
node smoke.mjs <任意 Git 仓库的绝对路径>
```

脚本会跑 `gitBash`、`repos`、`status`、`log`、`graph`、`branches`、`diff`、`file`、`dir`、`commit`，以及路径穿越、`switch`、`branchCreate`、`branchRename`、`pull`、`push` 和 `reveal` 的拒绝分支。`client.js` 由 DSH 模块加载器直接加载，没有构建步骤。

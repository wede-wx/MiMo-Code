<h1 align="center">MiMoCode-Atlas</h1>

<p align="center">
  <img src="assets/readme/mimocode-banner.png" alt="MiMoCode-Atlas" width="700">
</p>

<p align="center"><strong>MiMoCode 的诚实核验增强分支。</strong></p>

<p align="center">
  中文 | <a href="README.md">English</a>
</p>

<p align="center">
  上游官方 MiMoCode（Xiaomi）：<a href="https://mimo.xiaomi.com/zh/mimocode">官网</a> | <a href="https://mimo.xiaomi.com/zh/blog/mimo-code-long-horizon">博客</a>
</p>

---

MiMoCode-Atlas 是 Xiaomi MiMoCode 的 fork。它保留了 MiMoCode 的终端原生 AI 编程助手底座：读写代码、执行命令、管理 Git、跨会话记忆，以及面向长任务的上下文重建能力。

本 fork 的核心区别是 Atlas：一套基于证据的诚实核验闭环。当 agent 声称“做完了”时，Atlas 不相信它的一面之词，而是读取轨迹、工具输出、diff 和账本证据来核验。

---

## 核心：Atlas 诚实核验闭环

Atlas 面向长时间编程会话里的一个现实问题：`我改了东西` 不等于 `目标真的达成了`。

- **独立审计员（`/atlas`）** - 以干净、只读的 subagent 身份空降，只看轨迹、工具输入输出、diff 和账本证据，将声明判为 `DONE`、`NOT DONE`、`UNSUPPORTED` 或超出可核范围。
- **审计账本** - 将审计报告落盘到 `.mimocode/audit-ledger.md`，保留查了什么、证据是什么、判决是什么。
- **自动返工闭环** - 审计判为 `NOT_DONE` 时，main agent 会收到返工要求；返工后可自动复审，并有次数上限，避免无限循环。
- **上诉机制** - main agent 可以用固定的 `APPEAL:` 行申辩。独立上诉审计员会核查它引用的证据是否真实且能支持声明。
- **高保真上下文快照** - main 每轮可用的 CLAUDE/AGENTS/MEMORY 注入上下文会按版本存档，方便之后核验“当时它到底知道什么”。
- **结构化副作用留痕** - `write`、`edit`、`bash` 会把 diff 或实际改动文件写入工具 metadata，审计员不必只靠自然语言猜测发生了什么。

目标很简单：让“完成了”的声明可以被审计。

---

## 快速开始

### 准备环境（第一次使用才需要，只装一次）

先安装这两个工具：

1. **Git** - 从 [git-scm.com](https://git-scm.com/) 下载并安装。
2. **Bun** - 本项目的运行环境。从 [bun.sh](https://bun.sh/) 安装；Windows 用户在 PowerShell 里运行：

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

装完 Git 和 Bun 后，关闭当前终端，重新打开一个终端，让新命令生效。

### 下载并启动

请从源码安装本 fork。如果你要使用 MiMoCode-Atlas，不要使用上游的一键安装脚本或上游 npm 全局包；那两种方式安装的是 Xiaomi 官方包，不是这个 fork。

> **重要：** 请用 `git clone` 下载，不要用 GitHub 页面上的 **Download ZIP**。本项目含 symlink 文件，ZIP 解压，尤其是 Windows 上，可能会损坏这些文件，导致无法启动。

```bash
# 1. 克隆代码
git clone https://github.com/wede-wx/MiMo-Code.git

# 2. 进入目录
cd MiMo-Code

# 3. 安装依赖。首次会下载所需包，可能需要几分钟
bun install

# 4. 启动。开发模式，从源码运行
bun run dev
```

启动后会进入交互式终端界面，首次使用会引导你配置 API。要使用 `/atlas` 审计功能，必须选择小米付费档；免费档不支持。

本 fork 是从源码运行，需要 Bun，并且要在项目目录里启动；它不是上游 npm 一键全局安装包。

也可以直接运行 CLI 源码入口：

```bash
bun run --cwd packages/opencode --conditions=browser src/index.ts
```

### 可选：Windows 的 `mimo` 命令

为了本机使用方便，可以在 Windows 的某个 `PATH` 目录里创建 `mimo.cmd` 或 `mimo.ps1`，让它指向你本机 clone 下来的源码目录。

`mimo.cmd` 示例：

```bat
@ECHO off
SETLOCAL
SET "MIMOCODE_REPO=C:\path\to\MiMo-Code\packages\opencode"
bun run --cwd "%MIMOCODE_REPO%" --conditions=browser src/index.ts %*
EXIT /b %ERRORLEVEL%
```

`mimo.ps1` 示例：

```powershell
$mimocodeRepo = "C:\path\to\MiMo-Code\packages\opencode"
& bun run --cwd $mimocodeRepo --conditions=browser src/index.ts @args
exit $LASTEXITCODE
```

请把 `C:\path\to\MiMo-Code` 换成你自己的本机路径。

---

## 怎么使用 Atlas

### 什么时候用

当你让 AI 完成一个任务后，尤其是多步骤、带验证环节、容易被偷工减料的活，如果你想确认它是不是真的做完了，就用 `/atlas`。Atlas 是事后核验，不会自动一直盯着所有事情，需要你主动叫它。

### 怎么用

任务做完后，在对话里直接输入 `/atlas`。它会自动审计当前会话的完成情况，并给出判定：做完了、没做完，或证据不足。

如果判定没做完，它会自动让 AI 返工；AI 改完后，Atlas 会自动复审。这个过程会持续到通过为止，最多三次。你不用做别的，敲一下 `/atlas`，等结果即可。审计的发起权在你手里。

菜单里可能也能看到 `/atlas-appeal`。通常你不需要手动敲它。它是审计判没做完后，流程在背后用来复核 AI 申辩依据的环节；显示出来只是让你知道有这个机制。

### 它在背后做什么

`/atlas` 会启动一个独立的、只读的审计员。它不继承你和 AI 之前的对话，也不能改文件，只去读这次任务里 AI 真实的操作记录：执行了哪些命令、改了哪些文件、退出码是什么、留下了什么证据。

然后它把“AI 声称做了什么”和“证据里实际发生了什么”做对比，而不是听 AI 自己的总结汇报。所以它能抓出“声称做了、实际没做”的情况。

### 为什么这么设计

这和现实里的审计是同一个道理：干活的人不能只靠自己证明自己干好了，得有一个只看证据的独立角色来核。让 AI 自我汇报“我做完了”没有意义，只有独立查证据才靠得住。这就是 Atlas 的核心。

### 前提

`/atlas` 需要连接小米付费档 API。免费档 MiMo Auto 限时免费通道不支持，因为免费档有反滥用校验，会拦截审计员这类纯指令请求。

---

## 继承的上游能力

MiMoCode-Atlas 继承了 Xiaomi 上游 MiMoCode 的核心能力：

- 终端原生 agent 工作流：代码编辑、命令执行、Git 操作和 TUI 交互
- 多 Provider 支持，包括自定义 OpenAI 兼容 Provider
- 持久化项目记忆和 SQLite FTS 搜索
- 长上下文检查点和上下文重建
- 子智能体编排和后台任务
- Compose 工作流、内置 skills、`/dream` 和 `/distill`
- 上游 0.1.1 的 Claude/OpenCode/Codex 导入路径
- 小米 MiMo 托管服务提供的语音输入能力（MiMo 登录用户可用）

完整的上游产品介绍请看本 README 顶部保留的 Xiaomi 官方 MiMoCode 官网和博客链接。

---

## 本 fork 的增强

Atlas 在继承的 agent 运行时之上补上核验和可审计能力：

- `/atlas` 命令：基于证据审计当前会话
- `/atlas-appeal` 流程：处理被审对象的申辩上诉
- 机器可读判决行：让流程能确定性消费审计结果
- 审计报告持久化到 `.mimocode/audit-ledger.md`
- 审计失败后的自动返工编排
- 注入上下文快照索引，供后续证据核验
- 修改类工具的结构化文件变更 metadata
- 保证审计 agent 只读、隔离 system 注入，避免被被审对象或用户偏好带偏

---

## 开发

```bash
bun install              # 安装依赖
bun run dev              # 以开发模式运行本 fork
bun turbo typecheck      # 类型检查
```

测试请在具体 package 目录里运行，例如：

```bash
cd packages/opencode
bun test test/session --timeout 30000
```

---

## 上游官方资源（Xiaomi）

下面这些资源属于 Xiaomi 上游 MiMoCode / MiMo 平台，不是本 fork 运营的服务。保留在这里是为了方便用户找到原始项目、托管服务和官方社区。

- **MiMoCode 官方官网和博客** - 已在 README 顶部链接
- **MiMo Auto / 小米 MiMo 平台** - 小米托管的模型访问和 OAuth 登录能力，适用小米自己的服务条款
- **语音输入** - 由 Xiaomi MiMo ASR 支持，MiMo 登录用户可用
- **社区群聊** - 下方是上游 Xiaomi 官方社区二维码

<p align="center">
  <img src="assets/readme/community-qrcode-1.jpg" alt="上游 Xiaomi 社区群聊二维码 1" width="240">
  &nbsp;&nbsp;
  <img src="assets/readme/community-qrcode-2.jpg" alt="上游 Xiaomi 社区群聊二维码 2" width="240">
</p>

---

## 与 MiMoCode 和 OpenCode 的关系

MiMoCode-Atlas fork 自 [XiaomiMiMo/MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code)，而 Xiaomi MiMoCode 本身基于 [OpenCode](https://github.com/anomalyco/opencode) fork 构建。

上游 MiMoCode 在 OpenCode 底座上增加了持久化记忆、智能上下文管理、子智能体编排、目标驱动的自主循环、Compose 工作流，以及通过 `/dream` 和 `/distill` 实现的自我进化。

本 fork 保留这些底座能力，并在其上加入 Atlas 诚实核验闭环：审计、账本、自动返工、上诉、上下文快照和结构化副作用证据。

---

## 许可证与 Fork 说明

本项目 fork 自 XiaomiMiMo/MiMo-Code，并保留原项目的 MIT 许可证和版权声明，详见 [LICENSE](./LICENSE)。

使用 MiMoCode 及其衍生版本还需遵守上游 [Use Restrictions](./USE_RESTRICTIONS.md)。

如果你使用 Xiaomi MiMo 托管服务，包括 MiMo Auto、小米 MiMo 平台 OAuth、MiMo ASR 或其它小米托管模型服务，还需遵守 [Xiaomi MiMo 服务条款](https://platform.xiaomimimo.com/docs/terms/user-agreement)。

MiMo 名称、标志和商标的使用须遵守 Xiaomi 的 MiMo 商标政策。

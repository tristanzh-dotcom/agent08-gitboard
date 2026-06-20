### ☀️ 次日启动胶囊 (Boot Prompt)

请在明天开启新对话时，直接复制以下指令发给系统：

```text
请静默读取并完全理解当前目录下的 `HANDOVER_agent08_git_control_20260620.md`。
1. 请将本对话的逻辑分支锁定为：【Agent08 Git Control 收口】，并在你回复的第一句话使用 Markdown 的 H1 标题 (`# Agent08 Git Control 收口 工作流重启`) 输出，以便系统自动重命名此对话。
2. 在执行任何操作前，请简要复述当前的【核心卡点】与【下一步行动】。等待我的确认后，再开始执行。
```

## 第一性原理与项目上下文

Agent08 Git Control 是 9 repo 生态的唯一 Git 写操作控制面。它的核心职责不是“展示 Git 状态”，而是把 commit / push / pull / stash / rebase / upstream 等高风险操作收束到 SafetyGate、preflight snapshot、confirmation token、状态复核与产品化错误模型之下。

当前系统边界：

- `agent08-gitboard` 拥有 Git 业务逻辑、只读扫描、mutation safety gate、HTTP Git Control API。
- `web-platform` 只负责统一 `3000` 端口发布、页面 shell、视觉层和 `/api/git-control/*` proxy。
- Codex 工作流不得直接在终端执行 Git 写操作；所有 Git 写操作走 `/agent08`，除非 TZ 使用 §5 手动豁免。

今天的收工主题是 Agent08 Git Control 与 Web 发布接管之间的接口收口：Agent08 service 新增明确的 health endpoint，供 web 发布工作流进行 backend identity probe。

## 今日完成事项

### 1. Agent08 Git Control HTTP health endpoint

修改文件：

- `/Users/tristanzh/agent/agent08-gitboard/src/gitboard/gitControlHttpServer.ts`
- `/Users/tristanzh/agent/agent08-gitboard/tests/gitControlHttpServer.test.ts`

新增接口：

```http
GET /api/git-control/health
```

返回：

```json
{
  "ok": true,
  "agentId": "agent08",
  "service": "agent08-git-control",
  "status": "ok"
}
```

用途：

- 给 web-platform 做明确身份探针。
- 避免 web 侧只能 fallback 到 `/api/git-control/scan` 判断服务可用。
- 与 web 文档中预期的 preferred probe 对齐：
  - `GET /api/git-control/health`
  - timeout `700ms`
  - JSONPath `$.service == "agent08-git-control"`

### 2. Web 发布接管文档已生成

昨天/本轮已在 web repo 生成：

- `/Users/tristanzh/agent/web/HANDOVER_agent08_web_publish_20260619.md`

该文件用于通知 web 发布工作流接管 Agent08 相关 web 变更，核心内容包括：

- `/agent08` 从 read-only Git board 演进为 Git Control console。
- web 只 proxy，不承载 Git mutation。
- `server.mjs`、`app/agent08.css`、`app/agent08.js`、`tests/agent08-service.test.mjs`、`docs/agents/agent08-publishing-config.md` 是 Agent08 web 接管核心范围。
- 不要混入 web 工作区内其他 Agent03/04/05/06、platform-home、port-governance 等既有 dirty 改动。

### 3. 当前验证状态

Agent08 根目录当前未提交变更只有 health endpoint 与对应测试。

最近核验过的 diff：

```text
src/gitboard/gitControlHttpServer.ts | 7 +++++++
tests/gitControlHttpServer.test.ts   | 6 ++++++
```

本次收工没有执行 Git 写操作，没有 commit，没有 push。

## 已作出的关键决策

1. **health endpoint 必须由 agent08-gitboard 提供，而不是 web 伪造。**
   Web 发布面需要验证后端身份；身份源应该来自真实 Git Control service。

2. **`service` 字段使用 `agent08-git-control`。**
   这是比旧 `/identity` 的 `git-control` 更明确的服务名，可直接匹配 web 发布配置中的 backend identity probe。

3. **保留 `/api/git-control/identity`。**
   新增 `/health` 不破坏旧接口。旧测试与旧调用路径继续可用。

4. **web 发布接管独立成文档。**
   Agent08 工作流已经为了功能闭环改动了 web 发布页，但最终视觉治理、跨 agent 统一和发布收口应交给 web 工作流。

5. **不在收工阶段做 Git 写操作。**
   按 Sovereignty Protocol，提交/推送必须通过 `/agent08` 或 TZ 手动豁免。

## 未解决的风险/报错

### 1. Agent08 health endpoint 需要跑全量测试确认

今天只核验了 diff，还未在收工前重新跑 Agent08 全量测试。明天第一步应执行：

```bash
cd /Users/tristanzh/agent/agent08-gitboard
npm test
npm run typecheck
npm run build
```

如果沙箱/平台再次出现 Rollup 原生依赖问题，需要按之前路径处理：优先确认 `typecheck` 与直接 Node 测试，避免误判业务代码失败。

### 2. Web repo 仍有大量 dirty 改动

`/Users/tristanzh/agent/web` 当前存在多类未提交改动，不全属于 Agent08：

- Agent08 页面与测试改动。
- Agent03/04/05/06 发布配置和测试改动。
- platform-home、port-governance、publishing contract、cd-watcher 等改动。

web 工作流接管时必须先做范围切分，不能把所有 dirty 文件混进 Agent08 提交。

### 3. 3000 与 3108 双服务依赖

完整用户测试依赖：

- Web: `http://127.0.0.1:3000/agent08`
- Agent08 Git Control: `http://127.0.0.1:3108`

若 `/agent08` 显示 service unavailable，先确认 Agent08 service 是否启动，而不是直接改页面。

### 4. 视觉治理仍未最终收口

Agent08 页面功能链路已经过多轮验证，但视觉上仍应由 web 发布工作流审计：

- operation panel 底部是否裁切。
- changed files 长路径可读性。
- commit message textarea 与 next action 区域比例。
- topbar、repo rail、selected repo work area 的整体密度。

## 下一步行动

1. **读取上下文。**
   明天先读：
   - `/Users/tristanzh/agent/agent08-gitboard/HANDOVER_agent08_git_control_20260620.md`
   - `/Users/tristanzh/agent/web/HANDOVER_agent08_web_publish_20260619.md`
   - `/Users/tristanzh/agent/agent-tooling/docs/git-operations-sovereignty.md`

2. **验证 Agent08 service。**
   ```bash
   cd /Users/tristanzh/agent/agent08-gitboard
   npm test
   npm run typecheck
   npm run build
   ```

3. **启动服务并检查 health。**
   ```bash
   cd /Users/tristanzh/agent/agent08-gitboard
   npm run serve:git-control
   curl -sS http://127.0.0.1:3108/api/git-control/health
   ```

4. **web 工作流接管时同步 health probe。**
   在 `/Users/tristanzh/agent/web` 中确认：
   - `docs/agents/agent08-publishing-config.md` 已声明 preferred `GET /api/git-control/health`。
   - `server.mjs` 的 backend probe 如仍使用 fallback `/scan`，应改为优先 `/health`。
   - `tests/agent08-service.test.mjs` 应覆盖 health probe。

5. **提交策略。**
   通过 `/agent08` 提交 Agent08 根目录中的 health endpoint 改动：
   - `src/gitboard/gitControlHttpServer.ts`
   - `tests/gitControlHttpServer.test.ts`
   - `HANDOVER_agent08_git_control_20260620.md` 如 TZ 要求纳入归档

   不要在终端直接执行 `git commit` 或 `git push`。

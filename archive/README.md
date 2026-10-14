# Agent08 历史废弃模块归档说明 (Archive Index)

本目录归档了在 `agent08-gitboard` 演进历程中被废弃的历史设计与测试代码。

## 归档背景
根据 TZ 批准的 [git-control-v1.4-finalization.md](file:///Users/tristanzh/agent/agent08-gitboard/docs/sdd/git-control-v1.4-finalization.md) 第 8 节《Phase B/C disposition》以及 Web 统一运维解耦审计结论：
- Agent08 生产运行时（v1.4）全面专注于基于白名单仓库的 `commit` 与 `push` 终审两阶段网关控制，不涉及隔离 Worktree 租约生命周期与复杂的机器授权。
- 原 Phase B（基于 RBAC/ABAC 的机器授权策略系统）与 Phase C（Worktree 租约与隔离运行机制）已被正式废除。
- 原 v1.1/v1.2 的 MutationSafetyGate、MutationGitProxy、ScoreEngine、DashboardService 等旧设计同样已不在生产依赖链路上。
- 生产所需的原子存储与确定性 JSON 规范化功能已统一提取至活跃模块 `src/gitboard/storageUtils.ts`。
- 后台进程生命周期管理已完全统一收敛至 Web 平台的 `platform-backend-supervisor.mjs`，Agent08 不再兼任外部 Python 服务的启停与 PID 管理，`backendProcessManager.ts` 正式归档。

## 归档文件清单

### 1. 源码模块 (`archive/src/`)
- **Phase B/C 机器权限与隔离**：
  - `authorizationPolicy.ts`：机器操作权限策略与级别定义
  - `executionCapabilityStore.ts`：机器执行能力凭证持久化
  - `immutablePreflightStore.ts`：预检记录不可变存储
  - `machineOperationAuditStore.ts`：机器操作审计日志存储
  - `machineOperationAuthorizationService.ts`：机器操作鉴权服务
  - `machineOperationContracts.ts`：机器操作接口定义
  - `phaseBFileStore.ts`：Phase B 旧文件读写库（原子读写已迁移至 `storageUtils.ts`）
  - `phaseCWorktreeService.ts`：Worktree 隔离沙箱服务
  - `policyDecisionStore.ts`：策略决策存储
  - `userConfirmationStore.ts`：旧用户确认存储
  - `worktreeLeaseStore.ts`：Worktree 租约与锁管理
- **v1.1/v1.2 遗留 Gate & 模型**：
  - `dashboardService.ts`：旧状态看板聚合服务
  - `gitControlCardModel.ts`：旧 UI 卡片视图模型
  - `mutationGitProxy.ts`：旧变更 Git 代理
  - `mutationSafetyGate.ts`：旧变更安全门禁
  - `mutationSnapshotStore.ts`：旧变更快照存储
  - `releaseChecklist.ts`：旧发布清单检查
  - `scoreEngine.ts`：旧仓库健康评分引擎
  - `snapshotStore.ts`：旧快照存储
- **解耦的进程管理器**：
  - `backendProcessManager.ts`：旧 Python 进程监督器（已统一收敛归口至 Web Platform Supervisor）

### 2. 测试模块 (`archive/tests/`)
- 对应上述 19 个废弃模块的单元测试、集成测试与激活边界测试（包含 `backendProcessManager.test.ts`）。

> **提示**：本目录文件不参与 TypeScript 构建（`tsconfig.build.json`）与生产测试运行（`vitest.config.ts`），仅作为历史演进参考保留。

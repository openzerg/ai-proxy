# ai-proxy

LLM 代理服务（对应 OpenZergNeo 的 pylon）。提供 OpenAI 兼容的 `/v1/chat/completions` 端点，支持多上游提供商、自动 API Key 管理和调用日志。

## 架构

```
Client (OpenAI SDK)
  --> POST /v1/chat/completions { model: "my-gpt-4o", ... }
  --> Authorization: Bearer cpk_xxx  (proxy 自动生成的 apiKey)
  --> ai-proxy 查询 proxy JOIN provider_model_config
  --> 使用用户存储的上游 API Key 转发到实际 LLM 提供商
  --> 流式/非流式响应透传回客户端
```

### 双协议

| 协议 | 用途 |
|------|------|
| **ConnectRPC** | 管理接口：Proxy CRUD、ProviderModelConfig CRUD、Provider 模板查询、日志/统计 |
| **OpenAI REST** | `/v1/chat/completions` 代理透传，兼容 OpenAI SDK |

## 数据模型

### ProviderModelConfig（上游模型配置）

存储一个上游 LLM 提供商的模型连接信息，包括提供商 ID/名称、模型 ID/名称、上游 URL、**用户自己的 API Key**、能力标志（streaming/tools/vision/reasoning）、token 限制等。

### Proxy（对外代理入口）

轻量级代理端点，存储：
- `sourceModel`：客户端使用的模型别名（如 "my-gpt-4o"），全局唯一
- `providerModelConfigId`：FK 到 ProviderModelConfig
- `apiKey`：自动生成（`cpk_` + 24 字节随机 base64url）

上游详情（URL、目标模型、能力）通过 JOIN ProviderModelConfig 获取。

### Log（调用日志）

Append-only 审计日志，记录每次 chat 请求的 token 使用量、延迟、成功/失败状态。

### 已移除：Permission

OpenZergNeo pylon 的 Permission 系统（基于 agentName 的权限控制）已移除。现在任何持有有效 proxy apiKey 的请求均可使用。

## Provider 模板（models.dev）

从 `https://models.dev/api.json` 动态获取 110+ 提供商和 4000+ 模型的元数据，缓存 5 分钟。

WebUI 使用流程：
1. `ListProviders()` → 展示提供商目录
2. `ListProviderModels(providerId)` → 展示该提供商的模型列表
3. 用户选择模型 + 填入上游 API Key → `CreateProviderModelConfig()`
4. `CreateProxy(sourceModel, configId)` → 自动生成 `cpk_` apiKey

## 认证流程

```
1. 客户端请求：Authorization: Bearer cpk_xxx, body.model = "my-gpt-4o"
2. DB 查询：proxy JOIN provider_model_config WHERE sourceModel = "my-gpt-4o" AND apiKey = "cpk_xxx"
3. 验证通过 → 使用 provider_model_config.apiKey 转发到上游
4. 最终用户永远看不到真实的上游 API Key
```

## ConnectRPC 接口（14 个方法）

| 分组 | 方法 |
|------|------|
| Proxy CRUD | `ListProxies`, `GetProxy`, `CreateProxy`, `UpdateProxy`, `DeleteProxy` |
| ProviderModelConfig CRUD | `ListProviderModelConfigs`, `GetProviderModelConfig`, `CreateProviderModelConfig`, `UpdateProviderModelConfig`, `DeleteProviderModelConfig` |
| Provider 模板 | `ListProviders`, `ListProviderModels` |
| 日志/统计 | `QueryLogs`, `GetTokenStats` |

## 技术栈

| 属性 | 值 |
|------|-----|
| 运行时 | Bun（node:http 兼容层） |
| RPC | ConnectRPC v2（@connectrpc/connect v2） |
| 数据库 | PostgreSQL（Kysely + postgres.js） |
| 错误处理 | neverthrow Result monad |
| API 定义 | TypeSpec → proto → buf → TS（common-spec） |
| Schema 验证 | Zod v4（从 TypeSpec 生成） |

## 与 OpenZergNeo pylon 的主要差异

| 维度 | OpenZergNeo pylon | OpenZergUltra ai-proxy |
|------|-------------------|---------------------|
| 提供商配置 | 硬编码 providers 列表 | **models.dev 动态模板**（110+ 提供商） |
| 数据模型 | 单一 Provider 实体 | **ProviderModelConfig + Proxy 分离** |
| API Key | 手动设置 | **自动生成 cpk_ 前缀 Key** |
| 权限系统 | Permission 实体 + agentName 绑定 | **已移除**，仅需 proxy apiKey |
| API 路由 | 手写 HTTP REST | **ConnectRPC 服务** |
| 生成代码 | 本地 gen/ 目录 | **common-spec 统一生成**，ai-proxy 零生成代码 |
| 数据库 | SQLite | **PostgreSQL** |

## 目录结构

```
ai-proxy/
├── src/
│   ├── main.ts                     # 入口：HTTP 服务器 + CORS + 路由分发 + Registry 注册
│   ├── config.ts                   # 环境变量配置
│   ├── errors.ts                   # 从 @openzerg/common 重导出 AppError 层级
│   ├── entities/index.ts           # 从 @openzerg/common 重导出实体类型
│   ├── providers.ts                # models.dev API 集成 + 内存缓存
│   ├── db/index.ts                 # Kysely + postgres.js 初始化
│   ├── api/
│   │   └── server.ts               # ConnectRPC 路由（AiProxyService 14 个方法）
│   └── service/
│       ├── provider-model-config.ts # ProviderModelConfig CRUD
│       ├── proxy.ts                # Proxy CRUD + JOIN 查询
│       ├── chat.ts                 # OpenAI 兼容代理透传 + 日志
│       ├── logs.ts                 # 日志查询 + token 统计
│       └── util.ts                 # randomId, generateApiKey, nowSec
├── package.json
└── tsconfig.json
```

## 环境变量

```bash
DATABASE_URL=postgresql://openzerg:${DB_PASSWORD}@localhost:5433/openzerg
AI_PROXY_PORT=15316
AI_PROXY_HOST=0.0.0.0
REGISTRY_URL=http://localhost:15319   # 可选，用于 Registry 注册（原 Leviathan）
ADMIN_TOKEN=<管理员 Token>              # 可选，用于 Registry 注册
```

## 开发

```bash
bun install && bun run typecheck && bun run dev
```

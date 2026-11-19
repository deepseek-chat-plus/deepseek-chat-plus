# DeepSeek Chat Plus

[English](README.md) | 简体中文

基于 DeepSeek API 的静态聊天应用，支持接入第三方模型服务。无需应用后端，浏览器直接请求配置的 API 服务。

应用保留原有的聊天体验，并新增模型服务设置：既可以使用 DeepSeek 兼容的 Messages 接口，也可以把服务地址指向任意 OpenAI Chat Completions / OpenAI Responses 兼容服务，再用一次连通性测试确认配置是否可用。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone <仓库地址>
cd deepseek-chat-plus
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。
- 设置 → 模型服务 配置服务地址、接口协议、模型与 API Key，并用一次最小请求测试连通性。

## 模型服务

设置 → 模型服务 集中管理请求配置：

| 字段     | 说明                                                          |
| -------- | ------------------------------------------------------------- |
| 服务地址 | 服务的根地址，具体接口路径由协议决定。                        |
| 接口协议 | `Anthropic Messages`、`OpenAI Chat Completions` 或 `OpenAI Responses`。 |
| 模型     | 作为 `model` 发送的模型名称。                                 |
| API Key  | Anthropic Messages 协议用 `x-api-key`，其余用 `Bearer`。      |

DeepSeek 扩展能力（深度思考、智能搜索、链接阅读、自动标题与安全审核）只在 Anthropic Messages 协议下发送。切换到 OpenAI 协议后，输入框会隐藏这些开关，附件、语音输入与朗读也会关闭，因为 Files 与语音接口只属于 DeepSeek。附件始终通过 DeepSeek Files API 上传，切换服务后已有对话仍可正常使用。

## 数据

模型服务配置和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。模型服务配置和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                |
| ------------- | ------------------- |
| `pnpm dev`    | 启动开发服务器      |
| `pnpm build`  | 构建到 `dist/`      |
| `pnpm type`   | TypeScript 类型检查 |
| `pnpm lint`   | oxlint 检查         |
| `pnpm format` | oxfmt 格式化        |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages API 通信，附件走 Files API；语音使用 ASR / TTS 接口。DeepSeek 请求会带搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               请求、协议适配（Messages / OpenAI 兼容）、SSE 与类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。

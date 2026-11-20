# DeepSeek Chat Plus

English | [简体中文](README.zh-CN.md)

A static chat app powered by the DeepSeek API, with support for third-party model services. No application backend is required: the browser connects directly to the configured API service.

The app keeps the original chat experience and adds a model service panel: point the base URL at any OpenAI Chat Completions or OpenAI Responses compatible service, or keep the DeepSeek-compatible Messages API, then verify the configuration with a single connection test.

This branch is an enhanced fork of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo). Upstream fixes and features are merged in as they land, so everything the original does still works the same way.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/deepseek-chat-plus/deepseek-chat-plus.git
cd deepseek-chat-plus
pnpm install
pnpm dev
```

Open http://localhost:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

### Static hosting

The site is served at [deepseek-chat-plus.github.io](https://deepseek-chat-plus.github.io/) from the repository of the same name, which holds the same commits. Both repositories run [pages.yml](.github/workflows/pages.yml) on every push to `main`, but only the site repository deploys, so the address is the domain root rather than a subdirectory.

`dist/` is plain HTML, CSS, and JavaScript with no server-side rendering, routing, or API proxy, so any static host works, including GitHub Pages. Asset URLs are relative (`publicPath: 'auto'`), so the same build runs from a domain root or from a subdirectory. Enable Pages with "GitHub Actions" as the source.

Because the browser talks to the configured service directly, the service must allow cross-origin requests from the page origin. DeepSeek does; for other providers, check their CORS policy.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.
- Settings → Model service configures the base URL, protocol, model, and API Key, and tests the connection with one minimal request.
- Settings → Advanced sets the context length and max output in tokens (`128K` by default, blank for no limit) and the deep-thinking reasoning effort (Low, High, or Max).

## Model services

Settings → Model service holds the whole request configuration:

| Field    | Meaning                                                                 |
| -------- | ----------------------------------------------------------------------- |
| Base URL | Root address of the service; the request path is appended by protocol.  |
| Protocol | `Anthropic Messages`, `OpenAI Chat Completions`, or `OpenAI Responses`. |
| Model    | Model name sent as `model`.                                             |
| API Key  | Sent as `x-api-key` for Anthropic Messages and `Bearer` otherwise.      |

DeepSeek extensions (deep thinking, smart search, link reading, automatic titles, safety check) are only sent to the Anthropic Messages protocol. Under the OpenAI protocols the input area hides those switches, and attachments, voice input, and read-aloud are disabled because the Files and speech APIs are DeepSeek-only. Attachments are always uploaded through the DeepSeek Files API so that existing conversations keep working after switching providers.

## Advanced settings

Settings → Advanced controls how much of a conversation is sent and how hard the model thinks:

| Field           | Default | Meaning                                                                                                                       |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Context length  | `128K`  | Budget for the conversation history; blank means no limit.                                                                    |
| Max output      | `128K`  | `max_tokens` / `max_output_tokens`; blank means no limit.                                                                     |
| Reasoning level | `High`  | `Low`, `High`, or `Max`, sent as `output_config.effort`, `reasoning_effort`, or `reasoning.effort` depending on the protocol. |

Both limits accept a plain number or a multiple such as `128K` and `0.5M`, and are stored as typed. A value that cannot be parsed is flagged in place and left unsent.

No DeepSeek request carries a context-window parameter, so the context length is enforced in the browser: when the estimated history size exceeds the budget, the oldest question-and-answer rounds are dropped before the request is built. The current question and the continuation prefix are always kept, so a long conversation degrades into recent context instead of failing.

## Data and storage

Your model service configuration and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your model service configuration and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

### Keeping up with upstream

The fork is configured with the original repository as `upstream`. To pick up its latest changes, rebase this branch on top of it:

```sh
git fetch upstream
git rebase upstream/main
```

The enhanced commits stay on top, so the branch history reads as "upstream plus our additions" and merges stay conflict-free.

Chat uses `deepseek-flash` over the Anthropic-compatible Messages API by default, and Files API for attachments. Speech features use ASR / TTS endpoints. DeepSeek requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               Requests, protocols (Messages / OpenAI compatible), SSE, and types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.

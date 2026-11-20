/**
 * 生成接口的请求层：按模型服务配置选择协议，把请求报文发给服务端，
 * 并把两种协议的响应统一成内部的 Messages 事件流。
 */
import { isErrorBody, readErrorResponse, request, ApiError } from './http.js'
import { readOpenAIStream, toOpenAIBody, toOpenAIProbe } from './openai.js'
import { readMessageEvent } from './parseEvent.js'
import {
  authHeaders,
  defaultBaseUrl,
  endpoint,
  hasDeepseekExtensions,
  HY4_FLASH_MAX_OUTPUT,
  messageEndpoint,
  thinkingMode,
  type ChatRequest,
  type ProviderConfig,
} from './provider.js'
import { readServerSentEvents, type ServerSentEvent } from './sse.js'
import type {
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageParam,
  MessageStreamEvent,
} from './types.js'

/** 引用 Files API 上传的附件时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

/** 安全审核固定开启，DeepSeek 兼容协议的请求都走扩展模式 */
const SAFETY_CHECK = { level: 'high' } as const

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜） */
const serverTools = (search: boolean): CreateMessageRequest['tools'] => {
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

/** DeepSeek 兼容协议：扩展能力全开，报文带思考、挡位、搜索、标题与安全审核 */
const toMessageRequest = (chat: ChatRequest): CreateMessageRequest => ({
  model: chat.model,
  system: chat.system ?? '',
  messages: chat.messages,
  thinking: { type: chat.thinking ? 'enabled' : 'disabled' },
  output_config: { effort: chat.reasoningEffort },
  tools: serverTools(chat.search),
  safety_check: SAFETY_CHECK,
  ...(chat.maxOutputTokens ? { max_tokens: chat.maxOutputTokens } : {}),
  ...(chat.title ? { title: { enabled: true } } : {}),
})

/** 通用 Messages 只回传可移植的消息块，不带 DeepSeek 元信息、文件 ID 或服务端工具。 */
const toBasicMessageRequest = (provider: ProviderConfig, chat: ChatRequest) => {
  const hy4 = thinkingMode(provider) === 'hy4'
  const requestedLimit = chat.maxOutputTokens ?? 4096
  const maxTokens = hy4 ? Math.min(requestedLimit, HY4_FLASH_MAX_OUTPUT) : requestedLimit
  if (hy4 && chat.thinking && maxTokens <= 1024) {
    throw new ApiError('protocol', { key: 'providerThinkingOutputLimit' })
  }
  const messages = chat.messages.flatMap<MessageParam>((message) => {
    if (message.role === 'latest_reminder') {
      return []
    }
    if (typeof message.content === 'string') {
      return [message]
    }
    const content = message.content.filter((block) => block.type === 'text')
    return content.length ? [{ role: message.role, content }] : []
  })
  return {
    model: chat.model,
    max_tokens: maxTokens,
    messages,
    ...(hy4
      ? {
          thinking: chat.thinking
            ? { type: 'enabled', budget_tokens: Math.min(8192, maxTokens - 1) }
            : { type: 'disabled' },
        }
      : {}),
  }
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/** 报文一律是 JSON，必须声明类型；stream 为真时按 SSE 事件流接收 */
const providerHeaders = (provider: ProviderConfig, stream: boolean): Record<string, string> => ({
  ...authHeaders(provider.protocol, provider.apiKey),
  ...(provider.protocol === 'anthropic' && !hasDeepseekExtensions(provider)
    ? { 'anthropic-version': '2023-06-01' }
    : {}),
  'Content-Type': 'application/json',
  Accept: stream ? 'text/event-stream' : 'application/json',
})

/** 发一次非流式请求并解析 JSON，用于连通性测试 */
export const verifyProvider = async (
  provider: ProviderConfig,
  signal?: AbortSignal
): Promise<void> => {
  const body =
    provider.protocol === 'anthropic'
      ? {
          model: provider.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }
      : toOpenAIProbe(provider.protocol, provider.model)
  const response = await request(messageEndpoint(provider), {
    method: 'POST',
    headers: providerHeaders(provider, false),
    body: JSON.stringify(body),
    signal,
  })
  const text = await response.text()
  try {
    JSON.parse(text)
  } catch {
    throw new ApiError('protocol', text)
  }
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * 附件始终走 DeepSeek 的 Files API，与当前聊天协议无关，因此只取 API Key。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(endpoint(defaultBaseUrl('anthropic'), '/files'), {
    method: 'POST',
    headers: { ...authHeaders('anthropic', apiKey), 'anthropic-beta': FILES_BETA },
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** 发出流式请求并打开 SSE 事件流；非事件流响应按协议错误处理 */
const openStream = async (
  provider: ProviderConfig,
  body: object,
  signal: AbortSignal,
  headers: Record<string, string> = {}
) => {
  const response = await request(messageEndpoint(provider), {
    method: 'POST',
    headers: { ...providerHeaders(provider, true), ...headers },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  return readServerSentEvents(response.body, signal)
}

/**
 * 逐个产出 Messages 事件，收到 message_stop 时结束。
 * 保活注释与无法解析的帧直接跳过；中止请求时抛出 signal 的 AbortError。
 */
async function* readMessageStream(
  events: AsyncGenerator<ServerSentEvent>
): AsyncGenerator<MessageStreamEvent> {
  for await (const { event: eventName, data } of events) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName === 'error') {
        throw new ApiError('stream', data)
      }
      continue
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}

/** 生成回复：DeepSeek 兼容协议走扩展报文，其余协议翻译成 OpenAI 兼容格式 */
export async function* streamMessage(
  provider: ProviderConfig,
  chat: ChatRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  if (hasDeepseekExtensions(provider)) {
    const body = toMessageRequest(chat)
    const beta: Record<string, string> = hasFile(body) ? { 'anthropic-beta': FILES_BETA } : {}
    yield* readMessageStream(await openStream(provider, body, signal, beta))
    return
  }
  if (provider.protocol === 'anthropic') {
    yield* readMessageStream(
      await openStream(provider, toBasicMessageRequest(provider, chat), signal)
    )
    return
  }
  yield* readOpenAIStream(
    provider.protocol,
    await openStream(provider, toOpenAIBody(provider, chat), signal),
    chat.model
  )
}

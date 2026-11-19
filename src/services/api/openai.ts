/**
 * OpenAI 兼容协议的报文与事件适配：
 * - openai-chat：POST /chat/completions，data 帧承载增量，以 [DONE] 结束；
 * - openai-responses：POST /responses，按事件名区分，以 response.completed 结束。
 * 两者都翻译成内部的 Messages 事件流，上层无需关心协议差异。
 */
import { ApiError } from './http.js'
import type { ApiProtocol, ChatRequest } from './provider.js'
import type { ServerSentEvent } from './sse.js'
import type { MessageParam, MessageStreamEvent, MessageUsage, StopReason } from './types.js'

type OpenAIMessage = { role: 'user' | 'assistant'; content: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const asText = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

const count = (value: unknown) => (typeof value === 'number' && value > 0 ? value : 0)

/** 内容块只取正文：附件与思考、工具块在 OpenAI 兼容协议里没有对应表示 */
const toText = (content: MessageParam['content']): string =>
  typeof content === 'string'
    ? content
    : content.map((block) => ('text' in block ? block.text : '')).join('')

const toMessages = (messages: MessageParam[]): OpenAIMessage[] =>
  messages.flatMap((message) => {
    if (message.role === 'latest_reminder') {
      return []
    }
    const content = toText(message.content)
    return content.trim() ? [{ role: message.role, content }] : []
  })

/** 生成请求报文；两种协议的系统提示词位置不同 */
export const toOpenAIBody = (protocol: ApiProtocol, chat: ChatRequest) => {
  const messages = toMessages(chat.messages)
  if (protocol === 'openai-responses') {
    return {
      model: chat.model,
      ...(chat.system ? { instructions: chat.system } : {}),
      input: messages,
    }
  }
  return {
    model: chat.model,
    messages: chat.system ? [{ role: 'system', content: chat.system }, ...messages] : messages,
  }
}

/** 连通性测试报文：一次最小的非流式生成，返回内容不展示 */
export const toOpenAIProbe = (protocol: ApiProtocol, model: string) =>
  protocol === 'openai-responses'
    ? { model, input: 'ping', max_output_tokens: 1 }
    : { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }

/** 单帧解析结果：可能同时带来增量、结束原因与用量 */
type Chunk = {
  thinking?: string
  text?: string
  stopReason?: StopReason
  usage?: MessageUsage
  /** 收到协议的结束标记，后续不再有内容 */
  done?: boolean
}

/** 思考块固定占用索引 0，正文固定占用索引 1；两者按到达顺序惰性开启 */
const BLOCK_INDEX = { thinking: 0, text: 1 } as const

const toUsage = (usage: unknown): MessageUsage | undefined => {
  if (!isRecord(usage)) {
    return undefined
  }
  const input = count(usage.prompt_tokens ?? usage.input_tokens)
  const output = count(usage.completion_tokens ?? usage.output_tokens)
  if (!input && !output) {
    return undefined
  }
  const details = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : undefined
  return {
    input_tokens: input,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: count(details?.cached_tokens),
    output_tokens: output,
  }
}

const STOP_REASONS: Record<string, StopReason> = {
  length: 'max_tokens',
  content_filter: 'refusal',
}

/** chat 的一帧：正文与思考都在 choices[0].delta 里，用量随最后一帧下发 */
const readChatChunk = (payload: unknown): Chunk | null => {
  if (!isRecord(payload)) {
    return null
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined
  const delta = isRecord(choice) && isRecord(choice.delta) ? choice.delta : undefined
  const finish = isRecord(choice) ? asText(choice.finish_reason) : undefined
  return {
    thinking: delta ? (asText(delta.reasoning_content) ?? asText(delta.reasoning)) : undefined,
    text: delta ? asText(delta.content) : undefined,
    stopReason: finish ? (STOP_REASONS[finish] ?? 'end_turn') : undefined,
    usage: toUsage(payload.usage),
  }
}

const readResponse = (payload: Record<string, unknown>) =>
  isRecord(payload.response) ? payload.response : {}

/** responses 的一帧：正文与思考都是独立事件，完成时随响应体下发用量 */
const readResponsesChunk = (payload: unknown): Chunk | null => {
  if (!isRecord(payload)) {
    return null
  }
  switch (payload.type) {
    case 'response.output_text.delta':
      return { text: asText(payload.delta) }
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta':
      return { thinking: asText(payload.delta) }
    case 'response.completed':
      return { stopReason: 'end_turn', usage: toUsage(readResponse(payload).usage), done: true }
    case 'response.incomplete':
      return { stopReason: 'max_tokens', usage: toUsage(readResponse(payload).usage), done: true }
    case 'response.failed': {
      const error = readResponse(payload).error
      const message = isRecord(error) ? asText(error.message) : undefined
      throw new ApiError('stream', message ?? JSON.stringify(payload))
    }
    default:
      return null
  }
}

/** 把增量整理成内部事件：按需开启内容块，收尾时关闭仍打开的块 */
const createEventWriter = () => {
  const open = new Set<number>()
  return {
    delta: (kind: keyof typeof BLOCK_INDEX, text: string): MessageStreamEvent[] => {
      const index = BLOCK_INDEX[kind]
      const events: MessageStreamEvent[] = []
      if (!open.has(index)) {
        open.add(index)
        events.push({
          type: 'content_block_start',
          index,
          content_block:
            kind === 'text'
              ? { type: 'text', text: '' }
              : { type: 'thinking', thinking: '', signature: '' },
        })
      }
      events.push({
        type: 'content_block_delta',
        index,
        delta:
          kind === 'text'
            ? { type: 'text_delta', text }
            : { type: 'thinking_delta', thinking: text },
      })
      return events
    },
    finish: (stopReason: StopReason, usage?: MessageUsage): MessageStreamEvent[] => {
      const stops: MessageStreamEvent[] = [...open].map((index) => ({
        type: 'content_block_stop',
        index,
      }))
      open.clear()
      return [
        ...stops,
        { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage },
        { type: 'message_stop' },
      ]
    },
  }
}

/** 消费 OpenAI 兼容协议的 SSE 事件流，产出内部的 Messages 事件流 */
export async function* readOpenAIStream(
  protocol: ApiProtocol,
  events: AsyncGenerator<ServerSentEvent>,
  model: string
): AsyncGenerator<MessageStreamEvent> {
  const writer = createEventWriter()
  const readChunk = protocol === 'openai-responses' ? readResponsesChunk : readChatChunk
  let stopReason: StopReason | undefined
  let usage: MessageUsage | undefined
  let done = false
  yield { type: 'message_start', message: { id: '', model } }
  for await (const { data } of events) {
    // chat 协议用独立的 [DONE] 帧收尾，responses 协议靠 response.completed
    if (data === '[DONE]') {
      done = true
      break
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    const chunk = readChunk(payload)
    if (!chunk) {
      continue
    }
    if (chunk.thinking) {
      yield* writer.delta('thinking', chunk.thinking)
    }
    if (chunk.text) {
      yield* writer.delta('text', chunk.text)
    }
    stopReason = chunk.stopReason ?? stopReason
    usage = chunk.usage ?? usage
    if (chunk.done) {
      done = true
      break
    }
  }
  // 没有结束标记也没有结束原因，说明流被提前关闭。
  if (!done && stopReason === undefined) {
    throw new ApiError('interrupted', '')
  }
  yield* writer.finish(stopReason ?? 'end_turn', usage)
}

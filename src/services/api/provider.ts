/**
 * 模型服务配置、地址规则与能力声明。本模块只描述数据与地址，不发起请求，
 * 供设置层与各协议适配器共用，避免循环引用。
 */
import type { MessageParam, ReasoningEffort } from './types.js'

/** 与模型服务通信的协议；协议格式与厂商扩展独立。 */
export type ApiProtocol = 'anthropic' | 'openai-chat' | 'openai-responses'

/** 服务地址是该协议的根地址，具体接口路径由协议决定 */
export type ProviderConfig = {
  baseUrl: string
  protocol: ApiProtocol
  apiKey: string
  model: string
}

/** 各协议的默认地址：DeepSeek 的兼容接口与 OpenAI 兼容接口 */
const BASE_URLS: Record<ApiProtocol, string> = {
  anthropic: `${__API_ORIGIN__}/anthropic/v1`,
  'openai-chat': `${__API_ORIGIN__}/v1`,
  'openai-responses': `${__API_ORIGIN__}/v1`,
}

const PROTOCOLS: readonly ApiProtocol[] = ['anthropic', 'openai-chat', 'openai-responses']

/** 默认模型同时支持深度思考与图片输入 */
const MODEL = 'deepseek-flash'

export const DEFAULT_PROVIDER: ProviderConfig = {
  baseUrl: BASE_URLS.anthropic,
  protocol: 'anthropic',
  apiKey: '',
  model: MODEL,
}

/** 切换协议时的默认地址；用户改过的地址保持不动 */
export const defaultBaseUrl = (protocol: ApiProtocol) => BASE_URLS[protocol]

/** Hy4 Flash 的公开模型输出上限（TokenHub 模型列表）。 */
export const HY4_FLASH_MAX_OUTPUT = 64 * 1024

const isDeepseekEndpoint = ({ baseUrl, protocol }: ProviderConfig) => {
  const url = baseUrl.trim().replace(/\/+$/, '') || defaultBaseUrl(protocol)
  return url === defaultBaseUrl(protocol) || /^https:\/\/api\.deepseek\.com(?:\/|$)/i.test(url)
}

/** DeepSeek 扩展报文不是通用 Messages 协议。 */
export const hasDeepseekExtensions = (provider: ProviderConfig) =>
  provider.protocol === 'anthropic' && isDeepseekEndpoint(provider)

/** 只有明确支持开关的模型报文才覆盖服务端默认推理行为；代理需透传模型参数。 */
export const thinkingMode = (provider: ProviderConfig) => {
  if (isDeepseekEndpoint(provider)) {
    return 'deepseek'
  }
  return provider.model.trim() === 'hy4-flash' ? 'hy4' : undefined
}

/** 推理挡位的全部取值，三种协议一致，其余写法由服务端映射到这三档 */
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'high', 'max']

/** 拼接接口地址，忽略服务地址末尾多余的斜杠 */
export const endpoint = (baseUrl: string, path: string) => `${baseUrl.replace(/\/+$/, '')}${path}`

/** 各协议的生成接口路径；响应均为 SSE 事件流 */
const MESSAGE_PATHS: Record<ApiProtocol, string> = {
  anthropic: '/messages',
  'openai-chat': '/chat/completions',
  'openai-responses': '/responses',
}

export const messageEndpoint = (provider: ProviderConfig) =>
  endpoint(provider.baseUrl, MESSAGE_PATHS[provider.protocol])

/** 各协议的鉴权头：DeepSeek 兼容接口用 x-api-key，OpenAI 兼容接口用 Bearer */
export const authHeaders = (protocol: ApiProtocol, apiKey: string): Record<string, string> =>
  protocol === 'anthropic' ? { 'x-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` }

const asString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** 读取保存的配置：缺失、非法或为空的字段回落到默认值 */
export const normalizeProvider = (value: unknown): ProviderConfig => {
  const saved = (typeof value === 'object' && value !== null ? value : {}) as Partial<
    Record<keyof ProviderConfig, unknown>
  >
  const protocol = PROTOCOLS.find((item) => item === saved.protocol) ?? DEFAULT_PROVIDER.protocol
  return {
    baseUrl: asString(saved.baseUrl) || defaultBaseUrl(protocol),
    protocol,
    apiKey: asString(saved.apiKey),
    model: asString(saved.model) || DEFAULT_PROVIDER.model,
  }
}

/** 与协议无关的生成请求，由各协议适配器转换成自己的报文 */
export type ChatRequest = {
  model: string
  /** 系统提示词；为空时不发送 */
  system?: string
  messages: MessageParam[]
  /** 深度思考；仅有明确开关适配的服务和模型使用。 */
  thinking: boolean
  /** DeepSeek Messages 原生搜索；独立搜索在组装聊天报文前完成。 */
  search: boolean
  /** 顺带生成会话标题；仅 DeepSeek 兼容协议支持 */
  title: boolean
  /** 输出上限（Token）；为空表示不限制，由服务端取默认值 */
  maxOutputTokens?: number
  /** 推理挡位；深度思考关闭时服务端忽略 */
  reasoningEffort: ReasoningEffort
}

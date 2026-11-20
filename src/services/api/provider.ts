/**
 * 模型服务配置、地址规则与能力声明。本模块只描述数据与地址，不发起请求，
 * 供设置层与各协议适配器共用，避免循环引用。
 */
import { inferReasoningProfile, type ReasoningProfile } from './reasoning.js'
import type { MessageParam, ReasoningEffort } from './types.js'

/** 与模型服务通信的协议；协议格式与厂商扩展独立。 */
export type ApiProtocol = 'anthropic' | 'openai-chat' | 'openai-responses'

/** 手动模式声明报文形状，不绑定厂商；仅列出当前协议可以编码的形状。 */
export const REASONING_CONTROLS = {
  anthropic: ['auto', 'service', 'toggle', 'budget', 'adaptive'],
  'openai-chat': [
    'auto',
    'service',
    'toggle',
    'adaptive',
    'boolean',
    'template',
    'effort',
    'effort-no-think',
    'nested-effort',
  ],
  'openai-responses': ['auto', 'service', 'effort', 'effort-no-think'],
} as const satisfies Record<ApiProtocol, readonly string[]>

export type ReasoningControl = (typeof REASONING_CONTROLS)[ApiProtocol][number]

/** 服务地址是该协议的根地址，具体接口路径由协议决定 */
export type ProviderConfig = {
  baseUrl: string
  protocol: ApiProtocol
  apiKey: string
  model: string
  reasoningControl: ReasoningControl
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
  reasoningControl: 'auto',
}

/** 切换协议时的默认地址；用户改过的地址保持不动 */
export const defaultBaseUrl = (protocol: ApiProtocol) => BASE_URLS[protocol]

const isDeepseekEndpoint = ({ baseUrl, protocol }: ProviderConfig) => {
  const url = baseUrl.trim().replace(/\/+$/, '') || defaultBaseUrl(protocol)
  return url === defaultBaseUrl(protocol) || /^https:\/\/api\.deepseek\.com(?:\/|$)/i.test(url)
}

/** DeepSeek 扩展报文不是通用 Messages 协议。 */
export const hasDeepseekExtensions = (provider: ProviderConfig) =>
  provider.protocol === 'anthropic' && isDeepseekEndpoint(provider)

export const reasoningProfile = (provider: ProviderConfig): ReasoningProfile | undefined => {
  // 原生 Messages 保留原有扩展格式，手动模式用于其他服务或中转地址。
  if (hasDeepseekExtensions(provider)) {
    return { control: 'toggle', maxEffort: 'max' }
  }
  const { baseUrl, protocol, reasoningControl, model } = provider
  if (reasoningControl === 'service') {
    return undefined
  }
  if (reasoningControl !== 'auto') {
    return reasoningControl === 'effort-no-think'
      ? { control: reasoningControl, effortMap: { low: 'high' } }
      : { control: reasoningControl }
  }
  if (isDeepseekEndpoint(provider)) {
    return { control: protocol === 'openai-responses' ? 'effort' : 'toggle', maxEffort: 'max' }
  }
  return inferReasoningProfile(model, protocol, baseUrl.trim())
}

export const canToggleThinking = (provider: ProviderConfig): boolean => {
  const control = reasoningProfile(provider)?.control
  return control !== undefined && control !== 'effort-only'
}

/** 高级设置提供的推理挡位。 */
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
    reasoningControl:
      REASONING_CONTROLS[protocol].find((control) => control === saved.reasoningControl) ?? 'auto',
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

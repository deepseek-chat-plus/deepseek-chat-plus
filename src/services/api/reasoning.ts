import type { ApiProtocol, ReasoningControl } from './provider.js'
import type { ReasoningEffort } from './types.js'

export type ReasoningProfile = {
  control: Exclude<ReasoningControl, 'auto' | 'service'> | 'effort-only'
  maxEffort?: 'high' | 'xhigh' | 'max'
  effortMap?: Partial<Record<ReasoningEffort, string>>
  summary?: boolean
  splitThinking?: boolean
  maxOutput?: number
}

type Profiles = Partial<Record<ApiProtocol, ReasoningProfile>>
type Rule = { model: RegExp; profiles: Profiles; service?: RegExp }

const effort = (maxEffort: NonNullable<ReasoningProfile['maxEffort']>): ReasoningProfile => ({
  control: 'effort',
  maxEffort,
})
const adaptive: ReasoningProfile = { control: 'adaptive' }
const toggle: ReasoningProfile = { control: 'toggle' }
const onlyEffort: ReasoningProfile = { control: 'effort-only', maxEffort: 'max' }

const openAI = (profile: ReasoningProfile): Profiles => ({
  'openai-chat': profile,
  'openai-responses': profile,
})
const all = (profile: ReasoningProfile): Profiles => ({ ...openAI(profile), anthropic: profile })
const gpt = (profile: ReasoningProfile): Profiles => openAI({ ...profile, maxOutput: 128_000 })

const deepseek: Profiles = {
  anthropic: { control: 'toggle', maxEffort: 'max' },
  'openai-chat': { control: 'toggle', maxEffort: 'max' },
  'openai-responses': effort('max'),
}
const qwen = (responses?: ReasoningProfile): Profiles => ({
  anthropic: toggle,
  'openai-chat': { control: 'boolean' },
  'openai-responses': responses,
})

/** 自动识别仅列已知可用的模型与协议组合；未验证的预览、专用变体不继承同族开关。 */
const RULES: readonly Rule[] = [
  // DeepSeek Thinking Mode；OpenAI Chat 与 Messages 用 thinking，Responses 用 effort。
  { model: /^deepseek-(?:flash|v4(?:\.1)?-(?:flash|pro))(?:-\d{4,8})?$/, profiles: deepseek },
  // OpenAI 模型页明确列出 none 的通用模型；不匹配 Pro、Codex 或 Chat Latest。
  { model: /^gpt-5\.1$/, profiles: gpt(effort('high')) },
  { model: /^gpt-5\.(?:2|4(?:-mini|-nano)?|5)$/, profiles: gpt(effort('xhigh')) },
  {
    model: /^(?:gpt-5\.6-(?:luna|sol|terra)|gpt-6-(?:sol|luna)|gpt-6\.1-terra)$/,
    profiles: gpt(effort('max')),
  },
  { model: /^gpt-5(?:-mini|-nano)?$/, profiles: gpt({ control: 'effort-only' }) },
  {
    model: /^gpt-5\.(?:2|4|5)-pro$/,
    profiles: {
      'openai-responses': {
        control: 'effort-only',
        maxEffort: 'xhigh',
        maxOutput: 128_000,
        effortMap: { low: 'medium' },
      },
    },
  },
  // Claude 的新版自适应与旧版预算格式不同；有不可关闭的型号，不按整代匹配。
  {
    model: /^claude-(?:(?:opus|sonnet)-5|haiku-5[.-]5|opus-4[.-][678]|sonnet-4[.-]6)$/,
    profiles: { anthropic: { control: 'adaptive', maxEffort: 'max', summary: true } },
  },
  {
    model: /^claude-(?:opus|sonnet|haiku)-4[.-]5$/,
    profiles: { anthropic: { control: 'budget', maxOutput: 64 * 1024 } },
  },
  // Flash-Lite 2.5 接受 none；不依赖即将重路由到不可关闭型号的 Flash 别名。
  {
    model: /^gemini-2\.5-flash-lite$/,
    profiles: { 'openai-chat': { ...effort('high'), maxOutput: 65_536 } },
  },
  // 百炼：Chat 用 enable_thinking，Messages 用 thinking.type，Responses 依型号选择挡位。
  {
    model: /^qwen4-max$/,
    profiles: qwen({ control: 'effort', effortMap: { low: 'high', max: 'high' } }),
  },
  {
    model: /^qwen3\.8-(?:max(?:-0902)?|flash|27b)$/,
    profiles: qwen({ control: 'effort', maxEffort: 'xhigh', effortMap: { high: 'medium' } }),
  },
  {
    model:
      /^qwen3\.7-(?:max(?:-2026-(?:05-20|06-08))?|plus(?:-2026-05-26)?|flash(?:-2026-07-15)?)$/,
    profiles: qwen(),
  },
  {
    model: /^qwen3\.(?:6-(?:plus|flash)|5-(?:plus(?:-2026-02-15)?|flash(?:-2026-02-23)?))$/,
    profiles: qwen(),
  },
  {
    model: /^qwen3\.5-(?:397b-a17b|122b-a10b|27b|35b-a3b)$/,
    profiles: { 'openai-chat': { control: 'boolean' } },
    service: /^https:\/\/dashscope(?:-intl)?\.aliyuncs\.com(?:\/|$)/i,
  },
  {
    model: /^qwen3-(?:8b|14b|32b|235b-a22b)$/,
    profiles: { 'openai-chat': { control: 'boolean' } },
    service: /^https:\/\/api\.siliconflow\.(?:com|cn)(?:\/|$)/i,
  },
  // Z.AI GLM-5.3 不接受 disabled。配置挡位不等同于可开关。
  { model: /^glm-5(?:\.1)?$/, profiles: { 'openai-chat': toggle } },
  { model: /^glm-5\.2$/, profiles: { 'openai-chat': { control: 'toggle', maxEffort: 'max' } } },
  { model: /^glm-5\.3(?:-flashx?)?$/, profiles: { 'openai-chat': onlyEffort } },
  // Kimi 的近代强制思考模型仅映射挡位，不展示可用的关闭按钮。
  { model: /^kimi-k2\.6$/, profiles: { 'openai-chat': toggle } },
  { model: /^kimi-k3(?:\.1-pro(?:-highspeed)?)?$/, profiles: all(onlyEffort) },
  {
    model: /^minimax-m3$/,
    profiles: {
      anthropic: adaptive,
      'openai-chat': { ...adaptive, splitThinking: true },
      'openai-responses': effort('high'),
    },
  },
  {
    model: /^minimax-m3\.1-flash$/,
    profiles: { ...all(onlyEffort), 'openai-chat': { ...onlyEffort, splitThinking: true } },
  },
]

/** 接受保留原模型 ID 的中转路由，如 vendor/model；不把所有厂商的日期变体视为同一型号。 */
export const modelName = (model: string): string => {
  const name = model.trim().toLowerCase().split('/').at(-1) ?? ''
  return /^(?:gpt|claude)-/.test(name)
    ? name.replace(/-(?:20\d{2}-\d{2}-\d{2}|20\d{6})$/, '')
    : name
}

export const inferReasoningProfile = (
  model: string,
  protocol: ApiProtocol,
  baseUrl: string
): ReasoningProfile | undefined => {
  const name = modelName(model)
  const matches = (rule: Rule) =>
    rule.model.test(name) && (!rule.service || rule.service.test(baseUrl))
  // OpenRouter 的 OpenAI 接口统一使用 reasoning.effort，不接受上游厂商的开关字段。
  if (protocol !== 'anthropic' && /^https:\/\/openrouter\.ai(?:\/|$)/i.test(baseUrl)) {
    const profile = RULES.find(matches)?.profiles
    return profile && Object.values(profile).some((item) => item && item.control !== 'effort-only')
      ? { control: 'nested-effort' }
      : undefined
  }
  return RULES.find((rule) => rule.profiles[protocol] && matches(rule))?.profiles[protocol]
}

export const reasoningEffortFor = (profile: ReasoningProfile, effort: ReasoningEffort): string =>
  profile.effortMap?.[effort] ?? (effort === 'max' ? (profile.maxEffort ?? 'high') : effort)

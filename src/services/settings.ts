import { create } from 'zustand'
import { REASONING_EFFORTS, normalizeProvider, type ProviderConfig } from './api/provider.js'
import type { ReasoningEffort } from './api/types.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * 本机设置，存 localStorage：模型服务、语言、主题、位置、朗读音色、
 * 深度思考与智能搜索开关、上下文与输出上限、推理挡位、侧边栏收起状态
 */
type Settings = {
  provider: ProviderConfig
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  /** 可选的独立网页搜索凭据，不与模型 API Key 混用。 */
  searchApiKey: string
  /** 独立搜索须单独打开，原生搜索偏好不会自动触发独立 API 调用。 */
  standaloneSearch: boolean
  /** 上下文上限按用户输入的写法保存，如 128K；超出后整轮丢弃最早的上下文 */
  contextLimit: string
  /** 输出上限按用户输入的写法保存，如 128K；留空表示不限制 */
  outputLimit: string
  reasoningEffort: ReasoningEffort
  siderCollapsed: boolean
}

const KEYS: Record<keyof Settings, string> = {
  provider: 'chat-demo:provider',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  searchApiKey: 'chat-demo:search-api-key',
  standaloneSearch: 'chat-demo:standalone-search',
  contextLimit: 'chat-demo:context-limit',
  outputLimit: 'chat-demo:output-limit',
  reasoningEffort: 'chat-demo:reasoning-effort',
  siderCollapsed: 'chat-demo:sider-collapsed',
}

/** 上下文与输出上限的默认值，与模型支持的窗口一致 */
const DEFAULT_LIMIT = '128K'

/** Token 上限的倍数写法，如 128K、0.5M */
const TOKEN_LIMIT = /^(\d+(?:\.\d+)?)\s*([km]?)$/

const TOKEN_UNITS: Record<string, number> = { '': 1, k: 1024, m: 1024 * 1024 }

/** 解析 Token 上限：支持倍数写法与纯数字；留空、0 与非法值返回 undefined，表示不限制 */
export const parseTokenLimit = (value: string): number | undefined => {
  const match = TOKEN_LIMIT.exec(value.trim().toLowerCase())
  const tokens = match ? Math.round(Number(match[1]) * TOKEN_UNITS[match[2]]) : 0
  return tokens > 0 ? tokens : undefined
}

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** 字符串原样存储，其余按 JSON 存储（布尔值即 'true' / 'false'）；null 表示删除 */
const write = (key: string, value: unknown) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 未保存过时取模型上限；清空后保存的空字符串保持不变，表示不限制 */
const initialLimit = (key: string): string => read(key) ?? DEFAULT_LIMIT

const initialReasoningEffort = (): ReasoningEffort =>
  REASONING_EFFORTS.find((effort) => effort === read(KEYS.reasoningEffort)) ?? 'high'

const initialProvider = (): ProviderConfig => {
  try {
    return normalizeProvider(JSON.parse(read(KEYS.provider) ?? 'null'))
  } catch {
    return normalizeProvider(null)
  }
}

export const useSettings = create<Settings>(() => ({
  provider: initialProvider(),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  searchApiKey: read(KEYS.searchApiKey) ?? '',
  standaloneSearch: read(KEYS.standaloneSearch) === 'true',
  contextLimit: initialLimit(KEYS.contextLimit),
  outputLimit: initialLimit(KEYS.outputLimit),
  reasoningEffort: initialReasoningEffort(),
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

/** 修改设置：内存与 localStorage 同步更新，未提供的项保持不变 */
export const updateSettings = (patch: Partial<Settings>) => {
  useSettings.setState(patch)
  for (const name of Object.keys(patch) as (keyof Settings)[]) {
    write(KEYS[name], patch[name])
  }
}

/** 位置需要先归一化再保存 */
export const setLocation = (value: UserLocation | null) =>
  updateSettings({ location: normalizeLocation(value) })

import { create } from 'zustand'
import { normalizeProvider, type ProviderConfig } from './api/provider.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：模型服务、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  provider: ProviderConfig
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
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
  siderCollapsed: 'chat-demo:sider-collapsed',
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

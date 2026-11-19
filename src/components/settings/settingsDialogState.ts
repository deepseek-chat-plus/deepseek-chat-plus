import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：模型服务 / 通用设置 / 数据管理 */
export type SettingsSection = 'provider' | 'general' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'provider' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有 API Key 时打开设置并选中「模型服务」，返回是否已有 Key */
export const ensureApiKey = () => {
  if (useSettings.getState().provider.apiKey) {
    return true
  }
  openSettings('provider')
  return false
}

import clsx from 'clsx'
import { useRef, useState } from 'react'
import { IconEditOutline16 } from '../base/icons.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Select } from '../base/Select.js'
import { useIsMobile } from '../../app/viewport.js'
import { verifyProvider } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import { ApiError } from '../../services/api/http.js'
import {
  defaultBaseUrl,
  hasDeepseekExtensions,
  normalizeProvider,
  type ApiProtocol,
  type ProviderConfig,
} from '../../services/api/provider.js'
import { updateSettings, useSettings } from '../../services/settings.js'
import { translate, useTranslate, type TranslationKey } from '../../i18n/index.js'
import { SettingCell, type Status } from './SettingCell.js'
import styles from './Settings.module.css'

const protocols: { value: ApiProtocol; label: TranslationKey }[] = [
  { value: 'anthropic', label: 'providerProtocolAnthropic' },
  { value: 'openai-chat', label: 'providerProtocolOpenAIChat' },
  { value: 'openai-responses', label: 'providerProtocolOpenAIResponses' },
]

/** 输入框与已保存的 Key 共用同一个胶囊容器，保持设置项右对齐 */
const wideField = clsx(styles.field, styles.fieldControl)

/** 服务端原文可能很长，展示时截断 */
const ERROR_TEXT_LIMIT = 160

/** 连接失败的原因：鉴权与网络用专门文案，其余带上服务端原文 */
const testFailure = (error: unknown): Status => {
  const condition = classifyApiError(error)
  if (condition === 'unauthorized') {
    return { key: 'apiKeyInvalid', error: true }
  }
  if (condition === 'network') {
    return { key: 'commonNetworkErrorToast', error: true }
  }
  const text = (
    error instanceof ApiError && error.localMessage
      ? translate(error.localMessage.key, error.localMessage.params)
      : error instanceof Error
        ? error.message
        : String(error)
  ).trim()
  const message = text ? text.slice(0, ERROR_TEXT_LIMIT) : translate('unknownError')
  return { key: 'providerTestFailed', params: { message }, error: true }
}

/** 连通性测试：同一时间只跑一次，改动配置即丢弃上次结果 */
const useConnectionTest = (provider: ProviderConfig) => {
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const controller = useRef<AbortController | null>(null)

  const run = async () => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setTesting(true)
    setStatus(null)
    try {
      // 设置里可能还留着编辑中的空值，发送前按保存规则归一化
      await verifyProvider(normalizeProvider(provider), current.signal)
      setStatus({ key: 'providerTestSucceeded' })
    } catch (error) {
      if (!current.signal.aborted) {
        setStatus(testFailure(error))
      }
    } finally {
      if (controller.current === current) {
        setTesting(false)
      }
    }
  }

  /** 配置改动或测试完成保存后，作废旧结果 */
  const reset = () => {
    controller.current?.abort()
    controller.current = null
    setTesting(false)
    setStatus(null)
  }

  return { testing, status, run, reset }
}

/** API Key 的编辑状态：保存后只显示掩码，点编辑按钮才能重新输入 */
const useProviderKey = (saved: string, onSaved: () => void) => {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const submit = () => {
    const apiKey = value.trim()
    if (!apiKey) {
      return
    }
    updateSettings({ provider: { ...useSettings.getState().provider, apiKey } })
    setValue('')
    setEditing(false)
    onSaved()
  }
  return { editing, setEditing, value, setValue, submit, showInput: !saved || editing }
}

/**
 * 模型服务：服务地址、接口协议、模型与 API Key，改动即时保存。
 * 底部的连通性测试用一次最小请求验证地址、协议、模型与 Key 是否可用。
 */
export const ProviderSetting = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const provider = useSettings((state) => state.provider)
  const searchApiKey = useSettings((state) => state.searchApiKey)
  const test = useConnectionTest(provider)
  const key = useProviderKey(provider.apiKey, test.reset)
  const update = (patch: Partial<ProviderConfig>) => {
    test.reset()
    updateSettings({ provider: { ...useSettings.getState().provider, ...patch } })
  }

  return (
    <>
      <SettingCell
        label={t('providerBaseUrl')}
        status={null}
        className={styles.wideCell}
        action={
          <div className={wideField}>
            <input
              type="text"
              placeholder={t('providerBaseUrlPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              value={provider.baseUrl}
              onChange={(event) => update({ baseUrl: event.target.value })}
            />
          </div>
        }
      />
      <SettingCell
        label={t('providerProtocol')}
        status={null}
        className={styles.wideCell}
        action={
          <Select
            ariaLabel={t('providerProtocol')}
            className={styles.fieldControl}
            value={provider.protocol}
            options={protocols.map((item) => ({ value: item.value, label: t(item.label) }))}
            onChange={(protocol) =>
              update({
                protocol,
                // 地址没改过（或已清空）时跟随协议切换，改过的保持不动
                ...(normalizeProvider(provider).baseUrl === defaultBaseUrl(provider.protocol)
                  ? { baseUrl: defaultBaseUrl(protocol) }
                  : {}),
              })
            }
          />
        }
      />
      <SettingCell
        label={t('providerModel')}
        status={null}
        className={styles.wideCell}
        action={
          <div className={wideField}>
            <input
              type="text"
              placeholder={t('providerModelPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              value={provider.model}
              onChange={(event) => update({ model: event.target.value })}
            />
          </div>
        }
      />
      <SettingCell
        label={t('providerApiKey')}
        status={null}
        className={styles.wideCell}
        action={
          provider.apiKey && !key.editing ? (
            <div className={clsx(styles.fieldSaved, styles.fieldControl)}>
              <span className={styles.fieldMask}>{'*'.repeat(provider.apiKey.length)}</span>
              <IconButton
                tone="primary"
                icon={<IconEditOutline16 />}
                tooltip={t('apiKeyEdit')}
                onClick={() => key.setEditing(true)}
              />
            </div>
          ) : (
            <div className={wideField}>
              <input
                type="password"
                placeholder={t('apiKeyPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                // 移动端打开设置时不弹键盘，点编辑后才聚焦
                autoFocus={!isMobile || key.editing}
                value={key.value}
                onChange={(event) => key.setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    key.submit()
                  }
                }}
                onBlur={() => {
                  // 修改时没输入就离开，回到已保存的状态
                  if (provider.apiKey && !key.value.trim()) {
                    key.setEditing(false)
                  }
                }}
              />
              {!isMobile && key.value.trim() ? (
                <>
                  <span className={styles.divider} />
                  <button
                    type="button"
                    className={styles.confirm}
                    // 保持输入框焦点
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={key.submit}
                  >
                    {t('confirm')}
                  </button>
                </>
              ) : null}
            </div>
          )
        }
      />
      <SettingCell
        label={t('providerTest')}
        description={t('providerTestDescription')}
        status={test.status}
        action={
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={test.testing}
            onClick={() => void test.run()}
          >
            {test.testing ? t('providerTesting') : t('providerTestAction')}
          </Button>
        }
      />
      {!hasDeepseekExtensions(provider) ? (
        <SettingCell
          label={t('providerSearchApiKey')}
          description={t('providerSearchApiKeyDescription')}
          status={null}
          className={styles.wideCell}
          action={
            <div className={wideField}>
              <input
                type="password"
                aria-label={t('providerSearchApiKey')}
                placeholder={t('providerSearchApiKeyPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                value={searchApiKey}
                onChange={(event) => {
                  const value = event.target.value
                  updateSettings(
                    value.trim()
                      ? { searchApiKey: value }
                      : { searchApiKey: '', standaloneSearch: false }
                  )
                }}
              />
            </div>
          }
        />
      ) : null}
      {isMobile && key.showInput && key.value.trim() ? (
        <button
          type="button"
          className={styles.mobileConfirm}
          onMouseDown={(event) => event.preventDefault()}
          onClick={key.submit}
        >
          {t('confirm')}
        </button>
      ) : null}
    </>
  )
}

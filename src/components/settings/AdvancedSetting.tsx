import clsx from 'clsx'
import { Select } from '../base/Select.js'
import { REASONING_EFFORTS } from '../../services/api/provider.js'
import type { ReasoningEffort } from '../../services/api/types.js'
import { parseTokenLimit, updateSettings, useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import { SettingCell } from './SettingCell.js'
import styles from './Settings.module.css'

/** 挡位是接口取值，界面按接口写法展示，不随界面语言变化 */
const EFFORT_LABELS: Record<ReasoningEffort, string> = { low: 'Low', high: 'High', max: 'Max' }

/** 上限输入框与选择器共用同一个胶囊容器，保持设置项右对齐 */
const limitField = clsx(styles.field, styles.fieldControl)

/** Token 上限：留空表示不限制，写法无法解析时在下方提示 */
const TokenLimitSetting = ({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description: string
  value: string
  onChange: (value: string) => void
}) => {
  const t = useTranslate()
  return (
    <SettingCell
      label={label}
      description={description}
      status={
        value.trim() && !parseTokenLimit(value)
          ? { key: 'settingsTokenLimitInvalid', error: true }
          : null
      }
      className={styles.wideCell}
      action={
        <div className={limitField}>
          <input
            type="text"
            placeholder={t('settingsTokenLimitPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      }
    />
  )
}

/**
 * 高级设置：上下文与输出上限（支持 128K、0.5M 这样的倍数写法，留空表示不限制），
 * 以及深度思考的推理挡位。改动即时保存，下一轮请求生效。
 */
export const AdvancedSetting = () => {
  const t = useTranslate()
  const contextLimit = useSettings((state) => state.contextLimit)
  const outputLimit = useSettings((state) => state.outputLimit)
  const reasoningEffort = useSettings((state) => state.reasoningEffort)

  return (
    <>
      <TokenLimitSetting
        label={t('settingsContextLimit')}
        description={t('settingsContextLimitDescription')}
        value={contextLimit}
        onChange={(contextLimit) => updateSettings({ contextLimit })}
      />
      <TokenLimitSetting
        label={t('settingsMaxOutput')}
        description={t('settingsMaxOutputDescription')}
        value={outputLimit}
        onChange={(outputLimit) => updateSettings({ outputLimit })}
      />
      <SettingCell
        label={t('settingsReasoningEffort')}
        description={t('settingsReasoningEffortDescription')}
        status={null}
        className={styles.wideCell}
        action={
          <Select
            ariaLabel={t('settingsReasoningEffort')}
            className={styles.fieldControl}
            value={reasoningEffort}
            options={REASONING_EFFORTS.map((effort) => ({
              value: effort,
              label: EFFORT_LABELS[effort],
            }))}
            onChange={(reasoningEffort) => updateSettings({ reasoningEffort })}
          />
        }
      />
    </>
  )
}

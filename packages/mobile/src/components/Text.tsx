import { Text as RNText, StyleSheet, type TextProps } from 'react-native'
import { color, font } from '../theme/tokens'

type Variant = 'title' | 'heading' | 'body' | 'label' | 'caption' | 'money' | 'moneyLarge'

interface Props extends TextProps {
  variant?: Variant
  muted?: boolean
  faint?: boolean
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
}

/**
 * Every string on screen goes through here — React Native throws on bare text,
 * and it keeps the type scale in one place.
 *
 * Money variants use tabular figures. Without them a column of prices jitters
 * as digits change width, which reads as broken software.
 */
export function Text({ variant = 'body', muted, faint, tone = 'default', style, ...rest }: Props) {
  return (
    <RNText
      {...rest}
      style={[
        font[variant],
        { color: muted ? color.textMuted : faint ? color.textFaint : tones[tone] },
        variant === 'label' && styles.upper,
        style,
      ]}
    />
  )
}

const tones = {
  default: color.text,
  primary: color.primary,
  success: color.success,
  warning: color.warning,
  danger: color.danger,
  info: color.info,
} as const

const styles = StyleSheet.create({ upper: { textTransform: 'uppercase' } })

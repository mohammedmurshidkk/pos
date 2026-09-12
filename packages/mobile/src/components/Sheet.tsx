import type { ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { useLayout } from '../theme/layout'
import { color, radius, space } from '../theme/tokens'
import { Button } from './Button'
import { Text } from './Text'

interface Props {
  visible: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  /** Hidden when the sheet must be answered, e.g. the employee picker. */
  cancelLabel?: string | null
}

/**
 * Bottom sheet. Appears over the current screen so the waiter never loses sight
 * of the order. Closes via a full-width button — never a corner ×, which is
 * unhittable with a thumb.
 */
export function Sheet({ visible, title, subtitle, onClose, children, cancelLabel = 'Cancel' }: Props) {
  // A phone in landscape has ~390dp of height. Without tightening the chrome
  // the title and padding alone eat most of it.
  const { isShort } = useLayout()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          isShort && styles.sheetShort,
          // On a short screen take a fixed share so the scrollable content gets
          // real space; otherwise size to content up to a cap.
          isShort ? { height: '94%' } : { maxHeight: '85%' },
        ]}
      >
        {!isShort ? <View style={styles.handle} /> : null}
        <Text variant={isShort ? 'heading' : 'title'}>{title}</Text>
        {subtitle ? <Text variant="body" muted style={styles.subtitle}>{subtitle}</Text> : null}
        {/* flexShrink bounds the children so an inner ScrollView scrolls
            instead of growing and pushing the action button off-screen. */}
        <View style={[styles.content, isShort && styles.contentGrow]}>{children}</View>
        {cancelLabel ? <Button label={cancelLabel} variant="secondary" onPress={onClose} /> : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000099' },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.modal,
    borderTopRightRadius: radius.modal,
    padding: space.xl,
    paddingBottom: space.xxl,
    gap: space.base,
  },
  sheetShort: { padding: space.base, paddingBottom: space.base, gap: space.sm },
  handle: {
    width: 48, height: 4, borderRadius: radius.pill,
    backgroundColor: color.borderStrong, alignSelf: 'center', marginBottom: space.sm,
  },
  subtitle: { marginTop: -space.sm },
  content: { flexShrink: 1, gap: space.md },
  contentGrow: { flex: 1 },
})

import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { Button } from '../src/components/Button'
import { Screen } from '../src/components/Screen'
import { Text } from '../src/components/Text'
import { useCart } from '../src/store/cart'
import { color, orderTypeColor, orderTypeLabel, radius, space, touch } from '../src/theme/tokens'

/**
 * W05 — details for non-dine-in orders. One screen, three shapes, because the
 * only difference is which fields are shown.
 *
 *   takeaway — optional name
 *   car      — vehicle number, optional bay
 *   delivery — phone, name, address
 */
export default function Capture() {
  const router = useRouter()
  const { draft, start } = useCart()
  const type = draft.type

  const [vehicleNo, setVehicleNo] = useState(draft.vehicleNo ?? '')
  const [bayNo, setBayNo] = useState(draft.bayNo ?? '')
  const [name, setName] = useState(draft.customerName ?? '')
  const [phone, setPhone] = useState(draft.phone ?? '')
  const [address, setAddress] = useState(draft.address ?? '')

  const canContinue =
    type === 'car' ? vehicleNo.trim().length > 0
    : type === 'delivery' ? phone.trim().length > 0 && address.trim().length > 0
    : true

  const proceed = () => {
    start({
      ...draft,
      type,
      vehicleNo: type === 'car' ? vehicleNo.trim().toUpperCase() : null,
      bayNo: type === 'car' ? bayNo.trim() || null : null,
      customerName: name.trim() || null,
      phone: type === 'delivery' ? phone.trim() : null,
      address: type === 'delivery' ? address.trim() : null,
    })
    router.push('/menu')
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text variant="body" muted>‹ Back</Text>
        </Pressable>
        <Text variant="heading">{orderTypeLabel[type]} Order</Text>
      </View>

      <View style={styles.wrap}>
        <View style={styles.card}>
          <View style={[styles.chip, { backgroundColor: `${orderTypeColor[type]}26` }]}>
            <Text variant="caption" style={{ color: orderTypeColor[type] }}>
              {orderTypeLabel[type].toUpperCase()}
            </Text>
          </View>

          {type === 'car' ? (
            <>
              <Field label="Vehicle number">
                <TextInput
                  value={vehicleNo}
                  onChangeText={(t) => setVehicleNo(t.toUpperCase())}
                  autoCapitalize="characters"
                  placeholder="KA 05 MH 1234"
                  placeholderTextColor={color.textFaint}
                  style={[styles.input, styles.big]}
                />
              </Field>
              <Field label="Bay / slot number (optional)">
                <TextInput
                  value={bayNo} onChangeText={setBayNo}
                  placeholder="Bay 3" placeholderTextColor={color.textFaint} style={styles.input}
                />
              </Field>
            </>
          ) : null}

          {type === 'delivery' ? (
            <>
              <Field label="Phone number">
                <TextInput
                  value={phone} onChangeText={setPhone} keyboardType="phone-pad"
                  placeholder="+971 50 000 0000" placeholderTextColor={color.textFaint} style={styles.input}
                />
              </Field>
              <Field label="Customer name">
                <TextInput
                  value={name} onChangeText={setName}
                  placeholderTextColor={color.textFaint} style={styles.input}
                />
              </Field>
              <Field label="Delivery address">
                <TextInput
                  value={address} onChangeText={setAddress} multiline
                  placeholder="Flat, building, area, landmark"
                  placeholderTextColor={color.textFaint}
                  style={[styles.input, styles.multiline]}
                />
              </Field>
            </>
          ) : null}

          {type === 'takeaway' ? (
            <Field label="Customer name (optional)">
              <TextInput
                value={name} onChangeText={setName}
                placeholder="Name to call out" placeholderTextColor={color.textFaint} style={styles.input}
              />
            </Field>
          ) : null}

          <View style={styles.actions}>
            <Button label="Cancel" variant="secondary" flex={1} onPress={() => router.back()} />
            <Button label="Continue to Menu" flex={1} disabled={!canContinue} onPress={proceed} />
          </View>
        </View>
      </View>
    </Screen>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text variant="label" muted>{label}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.base, paddingVertical: space.md },
  back: { minHeight: touch.min, justifyContent: 'center' },
  wrap: { flex: 1, alignItems: 'center', paddingHorizontal: space.xl },
  card: {
    width: '100%', maxWidth: 720, gap: space.base,
    backgroundColor: color.surface, borderRadius: radius.modal,
    borderWidth: 1, borderColor: color.border, padding: space.xl,
  },
  chip: { alignSelf: 'flex-start', borderRadius: radius.input, paddingHorizontal: space.sm, paddingVertical: 4 },
  field: { gap: space.xs },
  input: {
    minHeight: touch.comfortable, backgroundColor: color.surfaceAlt,
    borderRadius: radius.input, borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.base, color: color.text, fontSize: 17,
  },
  big: { fontSize: 24, letterSpacing: 1 },
  multiline: { minHeight: 96, paddingVertical: space.md, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: space.md },
})

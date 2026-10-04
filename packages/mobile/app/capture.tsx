import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { api } from '../src/api/client'
import type { Customer } from '../src/api/types'
import { Button } from '../src/components/Button'
import { Screen } from '../src/components/Screen'
import { Text } from '../src/components/Text'
import { useCart } from '../src/store/cart'
import { color, orderTypeColor, orderTypeLabel, radius, space, touch } from '../src/theme/tokens'

/**
 * W05 — details for non-dine-in orders. One screen, three shapes, because the
 * only difference is which fields are shown.
 *
 *   takeaway — optional phone and name
 *   car      — vehicle number, optional bay, phone and name
 *   delivery — phone, name, address
 *
 * Phone comes first: customers are unique by phone number, so a known number
 * fills in the name (and for delivery the last address). The counter saves
 * the customer when the order arrives; the lookup here is only a convenience
 * and simply does nothing when the counter can't be reached.
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
  const [known, setKnown] = useState<Customer | null>(null)
  const [looked, setLooked] = useState(false)

  useEffect(() => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 7) { setKnown(null); setLooked(false); return }
    const t = setTimeout(() => {
      api.lookupCustomer(digits).then(({ customer }) => {
        setKnown(customer)
        setLooked(true)
        if (customer?.name) setName((n) => (n.trim() ? n : customer.name))
        if (customer?.addresses[0]) setAddress((a) => (a.trim() ? a : customer.addresses[0]!))
      }).catch(() => { /* offline: the waiter types it, as before */ })
    }, 400)
    return () => clearTimeout(t)
  }, [phone])

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
      phone: phone.trim() || null,
      address: type === 'delivery' ? address.trim() : null,
    })
    router.push('/menu')
  }

  const customerFields = (phoneLabel: string) => (
    <>
      <Field label={phoneLabel}>
        <TextInput
          value={phone} onChangeText={setPhone} keyboardType="phone-pad"
          placeholder="050 123 4567" placeholderTextColor={color.textFaint} style={styles.input}
        />
      </Field>
      {looked ? (
        <Text variant="caption" muted>
          {known ? `Returning customer · ${known.orderCount} order${known.orderCount === 1 ? '' : 's'}` : 'New customer'}
        </Text>
      ) : null}
      <Field label={type === 'delivery' ? 'Customer name' : 'Customer name (optional)'}>
        <TextInput
          value={name} onChangeText={setName}
          placeholder={type === 'takeaway' ? 'Name to call out' : undefined}
          placeholderTextColor={color.textFaint} style={styles.input}
        />
      </Field>
    </>
  )

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
              {customerFields('Phone number')}
              {known && known.addresses.length > 1 ? (
                <View style={styles.saved}>
                  {known.addresses.map((a) => (
                    <Pressable key={a} onPress={() => setAddress(a)} style={[styles.savedChip, a === address.trim() && styles.savedOn]}>
                      <Text variant="caption" tone={a === address.trim() ? 'primary' : undefined}>{a}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
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

          {type === 'takeaway' || type === 'car' ? customerFields('Phone number (optional)') : null}

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
  saved: { gap: space.xs },
  savedChip: {
    minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.base,
    borderRadius: radius.input, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceAlt,
  },
  savedOn: { borderColor: color.primary, backgroundColor: color.primarySubtle },
})

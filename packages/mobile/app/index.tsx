import { Redirect } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { color } from '../src/theme/tokens'
import { useDevice } from '../src/store/device'

/**
 * Launch routing. A paired tablet goes straight to Home — there is no login
 * screen, so this is the only gate the waiter ever passes through.
 */
export default function Index() {
  const { hydrated, hubUrl } = useDevice()

  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={color.primary} size="large" />
      </View>
    )
  }
  return <Redirect href={hubUrl ? '/home' : '/pair'} />
}

import { Stack, router } from 'expo-router'
import { useEffect } from 'react'
import { setOnUnpaired } from '../src/api/client'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { color } from '../src/theme/tokens'
import { useCart } from '../src/store/cart'
import { useQueue } from '../src/store/queue'
import { useDevice } from '../src/store/device'

export default function RootLayout() {
  const hydrateDevice = useDevice((s) => s.hydrate)
  const hydrateCart = useCart((s) => s.hydrate)
  const hydrateQueue = useQueue((s) => s.hydrate)
  const drain = useQueue((s) => s.drain)

  useEffect(() => {
    void hydrateDevice()
    void hydrateCart()
    void hydrateQueue()
  }, [hydrateDevice, hydrateCart, hydrateQueue])

  // Revoked at the counter: forget the token and ask to pair again, once —
  // several requests can fail at the same moment.
  useEffect(() => {
    let handling = false
    setOnUnpaired(() => {
      if (handling) return
      handling = true
      void useDevice.getState().unpair().then(() => {
        router.replace({ pathname: '/pair', params: { reason: 'unpaired' } })
        handling = false
      })
    })
    return () => setOnUnpaired(null)
  }, [])

  // Queued orders go out on their own. A waiter should never have to remember
  // to press anything once the wifi comes back.
  useEffect(() => {
    const timer = setInterval(() => { void drain() }, 8000)
    return () => clearInterval(timer)
  }, [drain])

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.bg },
          animation: 'fade',
        }}
      />
    </SafeAreaProvider>
  )
}

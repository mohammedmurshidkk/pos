import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { api, OfflineError } from '../src/api/client'
import { Banner } from '../src/components/Banner'
import { Button } from '../src/components/Button'
import { Screen } from '../src/components/Screen'
import { Text } from '../src/components/Text'
import { useQueue } from '../src/store/queue'
import { color, radius, space } from '../src/theme/tokens'
import { appVersion, downloadAndInstall, type AppUpdate } from '../src/update'

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * W13 — app update. Reached from the "Update available" strip on Home, or
 * Device Settings. Shows what is new (CHANGELOG.md, via the counter), then
 * downloads the new app from the counter and opens Android's installer.
 */
export default function Update() {
  const router = useRouter()
  const queued = useQueue((s) => s.pending.length)
  const [update, setUpdate] = useState<AppUpdate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setUpdate(await api.appUpdate(appVersion()))
    } catch (e) {
      setError(e instanceof OfflineError ? "Can't reach the counter." : 'Could not check for an update.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const install = async () => {
    setError(null)
    setProgress(0)
    try {
      await downloadAndInstall(setProgress)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The update could not be installed.')
    } finally {
      setProgress(null)
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title">App Update</Text>
        <Button label="Done" variant="ghost" onPress={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {error ? <Banner tone="danger" message={error} /> : null}

        <View style={styles.card}>
          <Text variant="label" muted>This tablet</Text>
          <Text variant="heading">Version {appVersion()}</Text>
          {!update ? (
            <Text variant="body" muted>{error ? '' : 'Checking the counter…'}</Text>
          ) : update.available ? (
            <Text variant="body" tone="info">
              Version {update.version} is ready on the counter ({mb(update.size)}).
            </Text>
          ) : (
            <Text variant="body" tone="success">Up to date with the counter.</Text>
          )}
        </View>

        {update?.available ? (
          <>
            {update.notes.map((note) => (
              <View key={note.version} style={styles.card}>
                <Text variant="heading">What’s new in {note.version}</Text>
                {note.sections.filter((s) => s.items.length).map((s) => (
                  <View key={s.title} style={styles.section}>
                    <Text variant="label" muted>{s.title}</Text>
                    {s.items.map((item, i) => (
                      <View key={i} style={styles.item}>
                        <Text variant="body" muted>•</Text>
                        <Text variant="body" style={styles.itemText}>{item.replace(/\*\*/g, '')}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ))}

            {queued > 0 ? (
              <Banner tone="warning" message={`${queued} order${queued === 1 ? '' : 's'} still waiting to send. They are kept through the update, but sending them first is safer.`} />
            ) : null}

            <Button
              label={progress === null ? 'Install update' : `Downloading… ${Math.round(progress * 100)}%`}
              loading={progress !== null}
              disabled={progress !== null}
              onPress={() => void install()}
            />
            <Text variant="caption" muted style={styles.hint}>
              Android asks you to confirm. The first time, it may ask to allow this app to install apps: allow it,
              then come back and tap Install. Pairing and orders are kept.
            </Text>
          </>
        ) : update ? (
          <Button label="Check again" variant="secondary" onPress={() => void load()} />
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.base },
  list: { padding: space.base, gap: space.md, maxWidth: 720, width: '100%', alignSelf: 'center' },
  card: {
    gap: space.sm, padding: space.base,
    backgroundColor: color.surface, borderRadius: radius.card,
    borderWidth: 1, borderColor: color.border,
  },
  section: { gap: space.xs, paddingTop: space.xs },
  item: { flexDirection: 'row', gap: space.sm },
  itemText: { flex: 1 },
  hint: { textAlign: 'center' },
})

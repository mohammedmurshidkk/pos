const { withAndroidManifest } = require('@expo/config-plugins')

/**
 * Allow plaintext HTTP to the hub.
 *
 * The whole product is LAN-only with no cloud and no TLS — the tablet talks to
 * http://<shop-ip>:4000. Android has blocked cleartext by default since API 28,
 * and the RN template only sets usesCleartextTraffic in the *debug* manifest.
 * So a release APK installs and launches fine, then fails every request, and
 * pair.tsx reports "No answer from ..." — which sends you hunting the wifi and
 * the firewall instead of the manifest.
 *
 * `expo.android.usesCleartextTraffic` in app.json does NOT do this. Expo types
 * the attribute in @expo/config-plugins but never maps a config key onto it.
 */
module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0]
    if (!application) throw new Error('withCleartextTraffic: no <application> in manifest')
    application.$['android:usesCleartextTraffic'] = 'true'
    return cfg
  })
}

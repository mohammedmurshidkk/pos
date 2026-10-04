/**
 * electron-builder config. Found automatically (CI runs plain `electron-builder`).
 * Names, ids and file names come from brand/brand.json; icons from resources/,
 * which `pnpm brand` regenerates from brand/icon.svg.
 */
const brand = require('../../brand/brand.json')

module.exports = {
  // Changing appId after a shop has installed makes Windows treat the next
  // installer as a different program (second entry, second shortcut).
  appId: brand.ids.appId,
  productName: brand.productName,
  copyright: `© ${new Date().getFullYear()} ${brand.vendor}`,
  // Electron names itself from the packaged package.json; keep it on-brand.
  extraMetadata: { productName: brand.productName, author: brand.vendor, description: brand.description },
  directories: {
    output: 'release',
    // Not build/: that is gitignored and CI builds from git.
    buildResources: 'resources',
  },
  files: ['dist/**/*', 'package.json'],
  asarUnpack: ['**/node_modules/better-sqlite3/**'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'resources/icon.ico',
    artifactName: `${brand.installerFileName}-\${version}.\${ext}`,
  },
  nsis: {
    oneClick: false,
    perMachine: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: brand.productName,
    installerIcon: 'resources/icon.ico',
    uninstallerIcon: 'resources/icon.ico',
    include: 'installer/installer.nsh',
  },
  mac: { target: ['dir'], icon: 'resources/icon.png' },
  npmRebuild: false,
  electronVersion: '33.4.11',
}

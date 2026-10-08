# Releasing — Windows installer and Android APK

Both are built **on GitHub**, not on your Mac:

| Output | Built by | Runs on |
|---|---|---|
| `AlManzilPOS-Setup-<version>.exe` — hub + cashier UI | `.github/workflows/build-windows.yml` | GitHub's Windows machine |
| `app-release.apk` — waiter app | `.github/workflows/build-apk.yml` | GitHub's Linux machine |

GitHub builds **what is pushed to git**, not your working folder. Anything not
committed and pushed is not in the build.

---

## One-time setup

```bash
brew install gh        # GitHub command line
gh auth login          # choose GitHub.com → SSH → log in with the browser
```

---

## Every release

### 1. Raise the version numbers

| File | Field | Example |
|---|---|---|
| `packages/desktop/package.json` | `"version"` | `0.3.0` → `0.4.0` — this names the `.exe` |
| `packages/mobile/app.json` | `"version"` | `1.0.1` → `1.0.2` |
| `packages/mobile/app.json` | `"versionCode"` | `3` → `4` — **must go up every time**, or Android refuses to update the app |

Use the desktop version for the git tag in step 3, so the tag and the file name match.

### 2. Check, commit, push

```bash
cd ~/WorkSpace/pos
pnpm -r test && pnpm -r typecheck
git add -A
git commit -m "Release 0.7.0"
git push origin main
```

### 3. Tag — this starts both builds

```bash
git tag v0.7.0
git push origin v0.7.0
```

A tag can be used once. If a build fails, fix it, commit, push, and use the next
number (`v0.4.1`) — do not move an existing tag.

To build **without** a tag (e.g. to test a branch):

```bash
gh workflow run build-windows.yml --ref main
gh workflow run build-apk.yml --ref main
```

### 4. Wait (about 10–15 minutes)

```bash
gh run list --limit 4      # both should end as ✓
gh run watch               # follow one live
```

Or on the website: the repository → **Actions**.

### 5. Download

```bash
gh run download --name windows-installer --dir ~/Desktop/pos-v0.4.0
gh run download --name waiter-apk        --dir ~/Desktop/pos-v0.4.0
```

Or on the website: **Actions** → open the run → **Artifacts** at the bottom.
GitHub keeps them for 30 days — keep your own copy of every version you give a shop.

---

## Installing

### Windows PC (the hub)

1. Copy `AlManzilPOS-Setup-<version>.exe` to the PC (USB stick, Google Drive…).
2. Run it. Windows may say **"Windows protected your PC"** — the app is not code-signed yet.
   Click **More info → Run anyway**.
3. Accept the administrator prompt. The installer adds a Windows Firewall rule so tablets can connect.
4. Open **Al Manzil POS** from the desktop shortcut.
5. **First run** opens *First-time setup*:
   1. Choose the **superadmin password** — write it down; it cannot be shown again.
   2. **Add admin** — name and a 4-digit starting PIN.
   3. **Open Licence** — start a trial (minutes / hours / days) or paste a licence key.
6. Sign in as the admin, then **Change PIN** (top bar) to replace the starting PIN.
7. Note the PC's IP address for the tablets: in Command Prompt, `ipconfig` → **IPv4 Address**
   (e.g. `192.168.1.20`).

Updating: run the newer installer over the old one. The database, licence and
settings are kept.

The superadmin screen is reached later with **Ctrl + Alt + Shift + A**.

### Android tablet (waiter app)

1. Copy `app-release.apk` to the tablet (USB cable, Google Drive, or WhatsApp to yourself).
2. Open it. Android asks to **allow installing unknown apps** for that app (Files / Drive / Chrome) — allow it.
3. Install and open **Al Manzil POS**.
4. On the PC: **Devices → Pair a tablet** shows a 6-digit code.
5. On the tablet: enter the PC's IP address (port `4000`) and the code.

The tablet must be on the **same wifi** as the PC.

> **Update 2026-10-04:** the product is now **Zentivo POS**. The installer is
> `ZentivoPOS-Setup-<version>.exe`, and the shortcut and the tablet app are named
> **Zentivo POS**. The Windows app id and the Android package changed to
> `com.zentivo.pos`, so on a machine that has the old build:
> - **PC:** uninstall "Al Manzil POS" first (data is kept), then install Zentivo
>   POS. On first start it moves `%APPDATA%\Al Manzil POS` to
>   `%APPDATA%\Zentivo POS`, so the database, licence and backups carry over.
> - **Tablet:** uninstall the old app, install the new APK and pair it again.
>   Send any queued orders before uninstalling.
>
> To rename again later, see `brand/README.md`.

With a USB cable and Android platform tools (`brew install --cask android-platform-tools`):

```bash
adb install -r ~/Desktop/pos-v0.4.0/app-release.apk
```

If Android says **"App not installed"** when updating, the `versionCode` was not
raised (step 1), or the old copy was signed differently — uninstall the old app
first (the tablet then needs pairing again).

---

## Testing the Windows app from a Mac

Nothing on a Mac proves the `.exe` works. Before giving a version to a shop:

- **Windows virtual machine** — install [UTM](https://mac.getutm.app) (free) or Parallels, with
  **Windows 11 ARM**. It runs the x64 installer through emulation. Set the VM network to
  **Bridged** so tablets can reach it.
- Or a real Windows PC.

Check, in this order:

- [ ] Installer runs; the app opens on *First-time setup*
- [ ] No "allow access?" firewall prompt on first start
- [ ] Add admin, start a 10-minute trial, sign in, take an order
- [ ] Printing — on your Mac run `node tools/fake-printer.js 9100`, set the printer IP in
      Setup to your Mac's IP (`ipconfig getifaddr en0`), print a KOT
- [ ] A tablet pairs with the PC's IP and sends an order
- [ ] After the trial runs out, new orders are blocked; open orders can still be settled

---

## When a build fails

Open the failed run → the red step → copy the **whole** log.

| Error contains | Cause | Fix |
|---|---|---|
| `ERR_PNPM_OUTDATED_LOCKFILE` / frozen lockfile | `package.json` changed without `pnpm-lock.yaml` | `pnpm install`, commit the lock file, push |
| `dist\main.cjs was not found in this archive` | Packaging ran before the app was built | The workflow must run `pnpm --filter @pos/desktop build` before `electron-builder` |
| `installer.nsh` not found | The firewall script is missing from git | It lives in `packages/desktop/installer/` — `build/` folders are gitignored |
| `Failed to find package 'tools'` (APK) | Android setup step asks for a removed package | `setup-android` must have `packages: platform-tools` |
| Tests fail | A real bug | Run `pnpm -r test` on the Mac and fix it first |

### Building the `.exe` on the Mac instead (backup)

Needs Rosetta on Apple Silicon (`softwareupdate --install-rosetta`):

```bash
pnpm --filter @pos/desktop dist:win
find packages/desktop/release/win-unpacked -name "*.node" -exec file {} \;   # must say "PE32+ ... x86-64"
pnpm --filter @pos/desktop native:node    # ALWAYS afterwards, or every test fails
```

The APK needs ~8 GB of free disk to build locally — use GitHub.

---

## Licence keys for a shop

1. The shop reads the **Install ID** from **Licence** on the PC.
2. Open `tools/licence-generator.html` on your Mac (double-click), pick your `licence-private.pem`,
   enter install ID, customer and length, **Generate key**, copy.
3. The shop pastes it under **Licence → Activate**.

`licence-private.pem` is the only way to make or renew keys. Keep backups (password manager,
USB stick, encrypted cloud). Never commit it, email it, or paste it anywhere.

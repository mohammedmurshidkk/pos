import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * USB printers — any printer installed in the counter PC's operating system.
 *
 * We never talk to the USB port ourselves. The printer's own Windows driver is
 * installed as usual, and the hub hands the spooler our ESC/POS bytes as a
 * **RAW** document: the driver does no layout of its own, so the cut and the
 * drawer kick reach the printer exactly as they would over TCP. That keeps the
 * hub free of another native module (better-sqlite3 is trouble enough) and
 * keeps the printer working from Windows' own tools too.
 *
 * Windows: winspool (OpenPrinter → StartDocPrinter "RAW" → WritePrinter) via
 * PowerShell. macOS/Linux, for development: CUPS `lp -o raw`.
 *
 * `POS_USB_FAKE_DIR` replaces the spooler with a folder: each printer's bytes
 * are appended to `<dir>/<name>.bin`. For tests and a Mac with no printer.
 */

export interface UsbStatus { online: boolean; detail: string | null }

/** C# compiled by PowerShell on each send. Data type RAW is the whole point. */
const RAW_PRINTER_CS = `
using System;
using System.Runtime.InteropServices;
public static class PosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr h, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] buf, int n, out int written);
  static Exception Fail(string what) {
    return new Exception(what + " failed (Windows error " + Marshal.GetLastWin32Error() + ")");
  }
  public static void Send(string name, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(name, out h, IntPtr.Zero)) {
      throw new Exception("No printer named \\"" + name + "\\" in Windows (error " + Marshal.GetLastWin32Error() + ")");
    }
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = "POS ticket";
      di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw Fail("StartDocPrinter");
      try {
        if (!StartPagePrinter(h)) throw Fail("StartPagePrinter");
        int written;
        if (!WritePrinter(h, data, data.Length, out written)) throw Fail("WritePrinter");
        if (written != data.Length) throw new Exception("Printer took " + written + " of " + data.Length + " bytes");
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
`

/** Errors go to stderr as one plain line, not PowerShell's red block. */
const ps = (body: string) => `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
${body}
} catch {
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  [Console]::Error.WriteLine($e.Message)
  exit 1
}
`

/**
 * The commands per platform. Names and paths travel in environment variables,
 * never spliced into the script, so a printer called `Bar "2"; rm` is just a name.
 */
export function usbCommands(platform: NodeJS.Platform) {
  if (platform === 'win32') {
    return {
      send: ps(`
Add-Type -TypeDefinition @'
${RAW_PRINTER_CS}
'@
[PosRawPrinter]::Send($env:POS_PRINTER, [IO.File]::ReadAllBytes($env:POS_FILE))`),
      status: ps(`
$p = Get-Printer -Name $env:POS_PRINTER
Write-Output ("{0}|{1}|{2}" -f $p.PrinterStatus, $p.WorkOffline, $p.JobCount)`),
      list: ps(`Get-Printer | ForEach-Object { Write-Output $_.Name }`),
    }
  }
  return null
}

/** PowerShell's -EncodedCommand is base64 of UTF-16LE: no quoting to get wrong. */
function powershell(script: string, env: Record<string, string>, timeoutMs: number) {
  return run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], env, timeoutMs)
}

function run(cmd: string, args: string[], env: Record<string, string>, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: { ...process.env, ...env }, timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve(String(stdout))
      // Windows PowerShell can wrap stderr in CLIXML when it is redirected.
      const msg = String(stderr).split(/\r?\n/).map((l) => l.trim())
        .find((l) => l && !l.startsWith('#< CLIXML') && !l.startsWith('<Objs')) ??
        ((err as { killed?: boolean }).killed ? `no answer from the print spooler after ${timeoutMs}ms` : err.message)
      reject(new Error(msg))
    })
  })
}

/**
 * Windows' view of a printer → green or red.
 *
 * A USB thermal printer that is switched off often still reads "Normal", but
 * its jobs pile up in the Windows queue — so a backlog counts as offline too.
 */
export function parseWindowsStatus(out: string): UsbStatus {
  const [status = '', offline = '', jobs = '0'] = out.trim().split('|')
  if (offline.trim().toLowerCase() === 'true') return { online: false, detail: 'Windows has it set to "Use printer offline"' }
  const ok = ['normal', 'idle', 'printing', 'busy', 'processing', 'warmingup', 'warming up', '0']
  if (!ok.includes(status.trim().toLowerCase())) return { online: false, detail: `Windows reports: ${status.trim() || 'unknown'}` }
  const backlog = Number(jobs) || 0
  if (backlog >= 3) return { online: false, detail: `${backlog} jobs waiting in the Windows queue — is it switched on?` }
  return { online: true, detail: null }
}

const fakeDir = () => process.env.POS_USB_FAKE_DIR || null
const fakeFile = (dir: string, name: string) => path.join(dir, `${name.replace(/[^\w.-]+/g, '_')}.bin`)

/** Send one ticket. Resolves once the spooler has accepted all of it. */
export async function sendUsb(systemName: string, payload: Buffer, timeoutMs = 20_000): Promise<void> {
  if (!systemName) throw new Error('No Windows printer chosen for this USB printer')
  const fake = fakeDir()
  if (fake) {
    mkdirSync(fake, { recursive: true })
    appendFileSync(fakeFile(fake, systemName), payload)
    return
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'pos-print-'))
  const file = path.join(dir, 'ticket.bin')
  try {
    writeFileSync(file, payload)
    if (process.platform === 'win32') {
      // First send compiles the helper (~1 s); a ticket is never that urgent.
      await powershell(usbCommands('win32')!.send, { POS_PRINTER: systemName, POS_FILE: file }, timeoutMs)
    } else {
      await run('lp', ['-d', systemName, '-o', 'raw', file], {}, timeoutMs)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// The printer list on Dashboard and the top bar is polled; starting PowerShell
// for every printer on every poll would be most of the PC's work.
const STATUS_TTL_MS = 10_000
const statusCache = new Map<string, { at: number; value: Promise<UsbStatus> }>()

export function usbStatus(systemName: string): Promise<UsbStatus> {
  const hit = statusCache.get(systemName)
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.value
  const value = readStatus(systemName)
  statusCache.set(systemName, { at: Date.now(), value })
  return value
}

async function readStatus(systemName: string): Promise<UsbStatus> {
  if (!systemName) return { online: false, detail: 'No Windows printer chosen' }
  if (fakeDir()) return { online: true, detail: null }
  try {
    if (process.platform === 'win32') {
      return parseWindowsStatus(await powershell(usbCommands('win32')!.status, { POS_PRINTER: systemName }, 8_000))
    }
    const out = await run('lpstat', ['-p', systemName], {}, 5_000)
    return /disabled/i.test(out) ? { online: false, detail: 'Disabled in CUPS' } : { online: true, detail: null }
  } catch (e) {
    return { online: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Printers installed on this PC, for the Setup dropdown. */
export async function listUsbPrinters(): Promise<string[]> {
  if (fakeDir()) return ['USB Test Printer']
  const out = process.platform === 'win32'
    ? await powershell(usbCommands('win32')!.list, {}, 10_000)
    : await run('lpstat', ['-e'], {}, 5_000)
  return [...new Set(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

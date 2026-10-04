/**
 * Receipt printer simulator — fake ESC/POS printers you can SEE.
 *
 * Same idea as fake-printer.js (one TCP port per printer, point the printer's
 * IP at this Mac), but instead of dumping stripped text into the terminal it
 * decodes the ESC/POS stream — bold, double size, centring, inverted banners,
 * cuts, drawer kicks — and shows each ticket as a paper receipt in a browser tab.
 *
 *   pnpm printer:sim                          # seed ports 9100 9101 9102 9130
 *   pnpm printer:sim 9100                     # just one printer
 *   pnpm printer:sim 9100=Grill 9101=Juice    # name the tabs yourself
 *   pnpm printer:sim --web 9180               # browser port (default 9180)
 *
 * Then open http://127.0.0.1:9180 and, in Setup → Printers, set each printer to
 * IP 127.0.0.1 and its port. The hub runs on this Mac, so 127.0.0.1 is right
 * even when orders come from a tablet or the Android emulator.
 *
 * No dependencies. Like fake-printer.js, it proves ROUTING and LAYOUT — column
 * widths, wrapping, what goes in bold. Only a real printer proves the paper.
 */
import http from 'node:http'
import net from 'node:net'

/** Matches packages/server/src/seed.ts so the demo data lands on named tabs. */
const LABELS = {
  9100: 'Arabic Kitchen',
  9101: 'Chinese Kitchen',
  9102: 'Juice Corner',
  9130: 'Counter 1 Printer',
}
const DEFAULT_PORTS = [9100, 9101, 9102, 9130]
const MAX_KEPT = 300

// ── arguments ────────────────────────────────────────────────────────────────

let webPort = 9180
const printers = []
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--web') { webPort = Number(args[++i]); continue }
  if (a === '-h' || a === '--help') {
    console.log('usage: pnpm printer:sim [port[=Name] ...] [--web 9180]')
    process.exit(0)
  }
  const [p, ...name] = a.split('=')
  const port = Number(p)
  if (!port) { console.error(`  ignoring "${a}" — not a port`); continue }
  printers.push({ port, label: name.join('=') || LABELS[port] || `Printer :${port}` })
}
if (printers.length === 0) {
  for (const port of DEFAULT_PORTS) printers.push({ port, label: LABELS[port] })
}

// ── ESC/POS decoder ──────────────────────────────────────────────────────────

const ESC = 0x1b
const GS = 0x1d
const DLE = 0x10

const plainStyle = () => ({ bold: false, underline: false, invert: false, w: 1, h: 1 })
const sameStyle = (a, b) =>
  a.bold === b.bold && a.underline === b.underline && a.invert === b.invert && a.w === b.w && a.h === b.h

/**
 * Turn one connection's bytes into receipts. A cut ends a receipt, so a single
 * connection carrying two tickets shows as two pieces of paper — as it would.
 *
 * Covers what packages/server/src/escpos.ts emits plus the common commands a
 * third-party tool might send; anything unknown is listed on the card rather
 * than silently swallowed, so a template change that emits something odd shows.
 */
export function decode(buf) {
  const receipts = []
  let style = plainStyle()
  let align = 0
  let r = newReceipt()
  let line = null

  function newReceipt() {
    return { lines: [], drawer: false, cut: false, unknown: [], images: 0 }
  }
  const startLine = () => (line ??= { align, spans: [] })
  const text = (s) => {
    startLine()
    const last = line.spans.at(-1)
    if (last && sameStyle(last, style)) last.text += s
    else line.spans.push({ ...style, text: s })
  }
  const endLine = () => {
    r.lines.push(line ?? { align, spans: [] })
    line = null
  }
  const finish = (cut) => {
    if (line) endLine()
    while (r.lines.length && r.lines.at(-1).spans.every((s) => !s.text.trim())) r.lines.pop()
    r.cut = cut
    if (r.lines.length || r.drawer || r.images || r.unknown.length || cut) receipts.push(r)
    r = newReceipt()
  }
  const unknown = (bytes) => {
    const s = [...bytes].map((b) => (b >= 0x21 && b < 0x7f ? String.fromCharCode(b) : `<${b.toString(16).padStart(2, '0')}>`)).join('')
    if (r.unknown.length < 20) r.unknown.push(s)
  }

  let i = 0
  while (i < buf.length) {
    const b = buf[i]
    const n1 = buf[i + 2] ?? 0

    if (b === 0x0a) { endLine(); i += 1; continue }
    if (b === 0x0d) { i += 1; continue }
    if (b === 0x09) { text('    '); i += 1; continue }

    if (b === ESC) {
      const c = String.fromCharCode(buf[i + 1] ?? 0)
      switch (c) {
        case '@': style = plainStyle(); align = 0; i += 2; continue
        case 'E': case 'G': style = { ...style, bold: !!(n1 & 1) }; i += 3; continue
        case '-': style = { ...style, underline: !!(n1 & 3) }; i += 3; continue
        case '!':
          style = { ...style, bold: !!(n1 & 8), h: n1 & 16 ? 2 : 1, w: n1 & 32 ? 2 : 1, underline: !!(n1 & 128) }
          i += 3; continue
        case 'a': align = (n1 >= 48 ? n1 - 48 : n1) % 3; if (line && !line.spans.length) line.align = align; i += 3; continue
        case 'd': if (line) endLine(); for (let k = 0; k < n1; k++) endLine(); i += 3; continue
        case 'J': if (line) endLine(); i += 3; continue
        case 'p': r.drawer = true; i += 5; continue
        case 'i': case 'm': finish(true); i += 2; continue
        case '2': i += 2; continue
        case '3': case 'M': case 't': case 'R': case 'V': case 'r': case '{': case 'c': i += 3; continue
        default: unknown(buf.subarray(i, i + 2)); i += 2; continue
      }
    }

    if (b === GS) {
      const c = String.fromCharCode(buf[i + 1] ?? 0)
      switch (c) {
        case '!': style = { ...style, w: ((n1 >> 4) & 7) + 1, h: (n1 & 7) + 1 }; i += 3; continue
        case 'B': style = { ...style, invert: !!(n1 & 1) }; i += 3; continue
        case 'V': finish(true); i += [65, 66, 97, 98, 103, 104].includes(n1) ? 4 : 3; continue
        case 'h': case 'w': case 'H': case 'f': case 'a': i += 3; continue
        case 'L': case 'W': i += 4; continue
        case 'k': {
          // Barcode: m 0–6 is NUL-terminated, m 65+ is length-prefixed.
          if (line) endLine()
          r.lines.push({ align, spans: [{ ...plainStyle(), text: '[barcode]' }] })
          if (n1 <= 6) { i += 3; while (i < buf.length && buf[i] !== 0) i++; i += 1 }
          else i += 4 + (buf[i + 3] ?? 0)
          continue
        }
        case 'v': {
          // GS v 0 m xL xH yL yH — raster image (a logo).
          const x = (buf[i + 4] ?? 0) + (buf[i + 5] ?? 0) * 256
          const y = (buf[i + 6] ?? 0) + (buf[i + 7] ?? 0) * 256
          if (line) endLine()
          r.lines.push({ align, spans: [{ ...plainStyle(), text: '[image]' }] })
          r.images += 1
          i += 8 + x * y
          continue
        }
        case '(': i += 5 + (buf[i + 3] ?? 0) + (buf[i + 4] ?? 0) * 256; continue
        default: unknown(buf.subarray(i, i + 2)); i += 2; continue
      }
    }

    if (b === DLE) { i += buf[i + 1] === 0x14 ? 5 : 3; continue }
    if (b < 0x20 || b === 0x7f) { unknown(buf.subarray(i, i + 1)); i += 1; continue }

    // Printable run — the hub only ever sends ASCII (toPrintable), so latin1 is exact.
    let j = i
    while (j < buf.length && buf[j] >= 0x20 && buf[j] !== 0x7f) j++
    text(buf.toString('latin1', i, j))
    i = j
  }
  finish(false)
  return receipts
}

/** What the hub was printing, read off the paper — for the card title and filter. */
function classify(r) {
  const all = r.lines.map((l) => l.spans.map((s) => s.text).join('')).join('\n')
  if (!r.lines.length && r.drawer) return 'drawer'
  if (/CANCELLED/.test(all) && /KOT #/.test(all)) return 'void'
  if (/KOT #/.test(all)) return 'kot'
  if (/TAX INVOICE/.test(all)) return 'bill'
  if (/Z-REPORT/.test(all)) return 'report'
  if (/TEST PRINT/.test(all)) return 'test'
  return 'other'
}

const lineWidth = (l) => l.spans.reduce((n, s) => n + s.text.length * s.w, 0)

/**
 * 58 mm paper is 32 columns, 80 mm is 48 (colsFor in escpos.ts). Every hub
 * template draws a full-width rule, so that is the paper width; the longest
 * line is only a fallback, since a line that is too long is exactly the bug
 * this should show rather than hide.
 */
function columns(r) {
  const rules = r.lines.map((l) => l.spans.map((s) => s.text).join('')).filter((t) => /^([=\-])\1{15,}$/.test(t))
  if (rules.length) return Math.max(...rules.map((t) => t.length))
  const max = Math.max(0, ...r.lines.map(lineWidth))
  return max <= 32 ? 32 : 48
}

/** Control bytes made visible, for the "bytes" view on each card. */
function showBytes(buf) {
  const names = { 0x1b: 'ESC', 0x1d: 'GS', 0x10: 'DLE', 0x0a: 'LF\n', 0x0d: 'CR', 0x09: 'HT', 0x00: '00' }
  let out = ''
  for (const b of buf.subarray(0, 16384)) {
    if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b)
    else out += `‹${names[b] ?? b.toString(16).padStart(2, '0')}›`.replace('LF\n›', 'LF›\n')
  }
  if (buf.length > 16384) out += `\n… ${buf.length - 16384} more bytes`
  return out
}

// ── state + live updates ─────────────────────────────────────────────────────

const kept = []
const clients = new Set()
let nextId = 1

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients) res.write(msg)
}

function received(printer, buf, from) {
  const at = new Date().toISOString()
  const decoded = decode(buf)
  const bytes = showBytes(buf)
  for (const r of decoded) {
    const entry = {
      id: nextId++,
      port: printer.port,
      label: printer.label,
      from,
      at,
      size: buf.length,
      kind: classify(r),
      cols: columns(r),
      bytes,
      ...r,
    }
    entry.tooWide = entry.lines.filter((l) => lineWidth(l) > entry.cols).length
    kept.push(entry)
    if (kept.length > MAX_KEPT) kept.shift()
    broadcast('receipt', entry)

    const title = entry.lines.find((l) => l.spans.some((s) => s.text.trim()))
    const what = entry.kind === 'drawer' ? 'drawer kick' : title?.spans.map((s) => s.text).join('').trim() ?? ''
    const time = new Date(at).toLocaleTimeString('en-GB')
    const flags = [entry.drawer && entry.kind !== 'drawer' ? '+drawer' : '', entry.cut || entry.kind === 'drawer' ? '' : 'NO CUT', entry.tooWide ? `${entry.tooWide} line(s) too wide` : ''].filter(Boolean).join(' ')
    console.log(`${time}  ${printer.label.padEnd(18)} :${printer.port}  ${entry.kind.padEnd(6)} ${what} ${flags}`)
  }
}

// ── printers (TCP) ───────────────────────────────────────────────────────────

let listening = 0
for (const printer of printers) {
  const server = net.createServer((sock) => {
    const chunks = []
    const from = sock.remoteAddress?.replace(/^::ffff:/, '') ?? '?'
    sock.on('data', (d) => chunks.push(d))
    sock.on('close', () => {
      // A connect-and-close is the hub's health ping (pingPrinter) — not a print.
      if (chunks.length) received(printer, Buffer.concat(chunks), from)
    })
    sock.on('error', () => {})
  })
  server.listen(printer.port, () => {
    listening += 1
    console.log(`printer  ${printer.label.padEnd(18)} :${printer.port}`)
  })
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`  :${printer.port} is already in use — fake-printer.js or another sim is probably running.`)
      console.error(`  Stop it with:  pkill -f fake-printer.js; pkill -f printer-sim.js`)
    } else {
      console.error(`  :${printer.port} failed to start — ${err.message}`)
    }
    setImmediate(() => { if (listening === 0) process.exit(1) })
  })
}

// ── browser view (HTTP) ──────────────────────────────────────────────────────

const web = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(`event: hello\ndata: ${JSON.stringify({ printers, receipts: kept })}\n\n`)
    clients.add(res)
    const ping = setInterval(() => res.write(': ping\n\n'), 15000)
    req.on('close', () => { clearInterval(ping); clients.delete(res) })
    return
  }
  if (url.pathname === '/api/receipts' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(kept))
    return
  }
  if (url.pathname === '/api/clear' && req.method === 'POST') {
    kept.length = 0
    broadcast('cleared', {})
    res.writeHead(204).end()
    return
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE)
    return
  }
  res.writeHead(404).end('not found')
})
web.on('error', (err) => {
  console.error(`  browser view :${webPort} failed — ${err.message}. Try --web <another port>.`)
})
// Loopback only: the receipts are the shop's sales, not for the whole Wi-Fi.
web.listen(webPort, '127.0.0.1', () => {
  setTimeout(() => {
    console.log(`\n${listening} printer(s) listening — receipts at  http://127.0.0.1:${webPort}`)
    console.log('In Setup → Printers use IP 127.0.0.1 and the port above.  ctrl-c to stop\n')
  }, 100)
})

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Printer Simulator</title>
<style>
  :root {
    --bg: #eceae6; --fg: #23211e; --muted: #6f6b64; --chip: #fff; --chip-on: #23211e; --chip-on-fg: #fff;
    --line: #d6d2cb; --paper: #fffefb; --ink: #1b1b1b; --accent: #c2410c; --ok: #15803d; --warn: #b45309;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #17171a; --fg: #ecebe8; --muted: #9b988f; --chip: #26262b; --chip-on: #ecebe8; --chip-on-fg: #17171a; --line: #34343a; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, -apple-system, sans-serif; }
  header { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 1px solid var(--line);
           padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
  h1 { font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--warn); }
  .dot.live { background: var(--ok); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { border: 1px solid var(--line); background: var(--chip); color: var(--fg); border-radius: 999px;
          padding: 4px 10px; font: inherit; font-size: 13px; cursor: pointer; }
  .chip[aria-pressed="true"] { background: var(--chip-on); color: var(--chip-on-fg); border-color: var(--chip-on); }
  .chip .n { opacity: .6; margin-left: 4px; }
  .spacer { flex: 1; }
  main { padding: 20px 16px 60px; display: flex; flex-wrap: wrap; gap: 28px 24px; align-items: flex-start; }
  .empty { color: var(--muted); max-width: 520px; line-height: 1.6; }
  .empty code { background: var(--chip); padding: 1px 5px; border-radius: 4px; }
  .card { display: flex; flex-direction: column; gap: 6px; max-width: 100%; }
  .meta { font-size: 12px; color: var(--muted); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .meta b { color: var(--fg); font-weight: 600; }
  .tag { font-size: 11px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; padding: 1px 6px;
         border-radius: 4px; background: var(--chip); border: 1px solid var(--line); color: var(--fg); }
  .tag.warn { color: #fff; background: var(--warn); border-color: var(--warn); }
  .tag.drawer { color: #fff; background: var(--ok); border-color: var(--ok); }
  .tag.void { color: #fff; background: var(--accent); border-color: var(--accent); }
  .paper { background: var(--paper); color: var(--ink); padding: 14px 12px 22px; max-width: 100%; overflow-x: auto;
           font: 13px/1.35 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
           box-shadow: 0 1px 2px rgba(0,0,0,.12), 0 6px 18px rgba(0,0,0,.08);
           -webkit-mask: conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 12px 100%;
                   mask: conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 12px 100%; }
  .paper.nocut { -webkit-mask: none; mask: none; border-bottom: 2px dashed #b9b4ab; }
  .new .paper { animation: arrive .6s ease-out; }
  @keyframes arrive { from { transform: translateY(-10px); opacity: 0; } }
  .ln { white-space: pre-wrap; overflow-wrap: anywhere; min-height: 1.35em; }
  .a1 { text-align: center; } .a2 { text-align: right; }
  .b { font-weight: 700; } .u { text-decoration: underline; } .inv { background: var(--ink); color: var(--paper); }
  .big { font-size: 2em; line-height: 1.15; }
  .drawerOnly { font: 12px ui-monospace, Menlo, monospace; padding: 10px 14px; border: 2px dashed var(--ok);
                color: var(--ok); border-radius: 6px; }
  details { font-size: 12px; color: var(--muted); }
  details pre { max-width: 560px; max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-all;
                background: var(--chip); color: var(--fg); padding: 8px; border-radius: 6px; font-size: 11px; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<header>
  <h1><span class="dot" id="dot" title="Live connection to the simulator"></span>Printer Simulator</h1>
  <div class="chips" id="printers"></div>
  <div class="chips" id="kinds"></div>
  <span class="spacer"></span>
  <button class="chip" id="clear">Clear</button>
</header>
<main id="list"><p class="empty" id="empty"></p></main>
<script>
  const KINDS = { kot: 'Kitchen', void: 'Cancelled', bill: 'Bill', drawer: 'Drawer', report: 'Z-report', test: 'Test', other: 'Other' }
  let printers = [], receipts = []
  let port = 'all', kind = 'all'
  const $ = (id) => document.getElementById(id)
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

  function chip(label, n, on, click) {
    const b = document.createElement('button')
    b.className = 'chip'
    b.setAttribute('aria-pressed', on)
    b.innerHTML = esc(label) + (n != null ? '<span class="n">' + n + '</span>' : '')
    b.onclick = click
    return b
  }

  function renderChips() {
    const p = $('printers'); p.replaceChildren()
    p.append(chip('All printers', receipts.length, port === 'all', () => { port = 'all'; renderAll() }))
    for (const pr of printers) {
      const n = receipts.filter((r) => r.port === pr.port).length
      p.append(chip(pr.label + ' :' + pr.port, n, port === pr.port, () => { port = pr.port; renderAll() }))
    }
    const k = $('kinds'); k.replaceChildren()
    const present = [...new Set(receipts.map((r) => r.kind))]
    if (present.length > 1) {
      k.append(chip('Everything', null, kind === 'all', () => { kind = 'all'; renderAll() }))
      for (const key of Object.keys(KINDS)) if (present.includes(key))
        k.append(chip(KINDS[key], null, kind === key, () => { kind = key; renderAll() }))
    }
  }

  function card(r, isNew) {
    const el = document.createElement('div')
    el.className = 'card' + (isNew ? ' new' : '')
    const time = new Date(r.at).toLocaleTimeString('en-GB')
    const tags = []
    tags.push('<span class="tag' + (r.kind === 'void' ? ' void' : '') + '">' + KINDS[r.kind] + '</span>')
    if (r.drawer) tags.push('<span class="tag drawer">Drawer opened</span>')
    if (!r.cut && r.kind !== 'drawer') tags.push('<span class="tag warn">No cut</span>')
    if (r.tooWide) tags.push('<span class="tag warn">' + r.tooWide + ' line' + (r.tooWide > 1 ? 's' : '') + ' too wide — wrapped</span>')
    if (r.unknown.length) tags.push('<span class="tag warn" title="' + esc(r.unknown.join(' ')) + '">Unknown codes</span>')
    let body
    if (r.kind === 'drawer') {
      body = '<div class="drawerOnly">Cash drawer kicked — no paper</div>'
    } else {
      body = '<div class="paper' + (r.cut ? '' : ' nocut') + '" style="width:calc(' + r.cols + 'ch + 26px)">' +
        r.lines.map((l) => '<div class="ln a' + l.align + '">' + l.spans.map((s) => {
          const c = [s.bold && 'b', s.underline && 'u', s.invert && 'inv', (s.w > 1 || s.h > 1) && 'big'].filter(Boolean).join(' ')
          return c ? '<span class="' + c + '">' + esc(s.text) + '</span>' : esc(s.text)
        }).join('') + '</div>').join('') + '</div>'
    }
    el.innerHTML =
      '<div class="meta"><b>' + esc(r.label) + '</b> :' + r.port + ' · ' + time + (r.kind === 'drawer' ? '' : ' · ' + r.cols + ' cols') + ' · from ' + esc(r.from) + '</div>' +
      '<div class="meta">' + tags.join('') + '</div>' + body +
      '<details><summary>' + r.size + ' bytes</summary><pre>' + esc(r.bytes) + '</pre></details>'
    return el
  }

  const visible = (r) => (port === 'all' || r.port === port) && (kind === 'all' || r.kind === kind)

  function renderAll() {
    renderChips()
    const list = $('list'); list.replaceChildren()
    const shown = receipts.filter(visible).reverse()
    if (!shown.length) {
      const p = document.createElement('p'); p.className = 'empty'
      p.innerHTML = receipts.length ? 'Nothing matches this filter.' :
        'Waiting for a print. In the cashier UI open <b>Setup → Printers</b>, set a printer to IP <code>127.0.0.1</code> ' +
        'and one of the ports above, then press <b>Test</b> or send an order to the kitchen.'
      list.append(p)
    }
    for (const r of shown) list.append(card(r, false))
  }

  function connect() {
    const es = new EventSource('/events')
    es.addEventListener('hello', (e) => { const d = JSON.parse(e.data); printers = d.printers; receipts = d.receipts; $('dot').classList.add('live'); renderAll() })
    es.addEventListener('receipt', (e) => {
      const r = JSON.parse(e.data); receipts.push(r)
      renderChips()
      if (!visible(r)) return
      const list = $('list')
      if (list.querySelector('.empty')) list.replaceChildren()
      list.prepend(card(r, true))
    })
    es.addEventListener('cleared', () => { receipts = []; renderAll() })
    es.onerror = () => $('dot').classList.remove('live')
  }
  $('clear').onclick = () => fetch('/api/clear', { method: 'POST' })
  connect()
</script>
</body>
</html>`

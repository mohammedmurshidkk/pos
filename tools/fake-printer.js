/**
 * Fake ESC/POS printers for development on macOS.
 *
 * Listens on one TCP port per kitchen/counter and prints whatever it receives
 * to the console with the control codes stripped. Lets you test KOT routing to
 * three kitchens without owning three printers.
 *
 *   node tools/fake-printer.js 9100 9101 9102 9130
 *
 * The fake proves ROUTING. Only a real printer proves BYTES — column widths,
 * cut, drawer kick. Buy one.
 */
import net from 'node:net'

const LABELS = {
  9100: 'ARABIC KITCHEN',
  9101: 'CHINESE KITCHEN',
  9102: 'JUICE CORNER',
  9130: 'COUNTER 1',
}

const ports = process.argv.slice(2).map(Number).filter(Boolean)
if (ports.length === 0) ports.push(9100)

const clean = (buf) =>
  buf
    .toString('binary')
    // ESC/GS command sequences — enough to make output readable, not a parser.
    .replace(/\x1b@/g, '')
    .replace(/\x1b[!aEMdG][\s\S]/g, '')
    .replace(/\x1d![\s\S]/g, '')
    .replace(/\x1dB[\s\S]/g, '')
    .replace(/\x1d[Vh w][\s\S]{0,2}/g, '')
    .replace(/\x1b\x70[\s\S]{0,2}/g, '[DRAWER KICK]\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')

for (const port of ports) {
  const label = LABELS[port] ?? `PRINTER :${port}`
  net
    .createServer((sock) => {
      const chunks = []
      sock.on('data', (d) => chunks.push(d))
      sock.on('close', () => {
        const out = clean(Buffer.concat(chunks))
        const time = new Date().toLocaleTimeString('en-GB')
        console.log(`\n┌─ ${label} :${port} ─ ${time} ${'─'.repeat(Math.max(0, 30 - label.length))}`)
        for (const l of out.split('\n')) console.log(`│ ${l}`)
        console.log(`└${'─'.repeat(50)}`)
      })
      sock.on('error', () => {})
    })
    .listen(port, () => console.log(`fake printer  ${label.padEnd(16)} :${port}`))
}

console.log('\nwaiting for jobs — ctrl-c to stop\n')

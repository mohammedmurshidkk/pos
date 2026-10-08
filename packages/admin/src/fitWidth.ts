/**
 * The UI is laid out for at least 1024 CSS px (`body { min-width }` in tokens.css).
 * A 1024×768 POS monitor with Windows display scaling at 125% gives the window
 * only ~819 CSS px, and the right side of every screen — the order, Send to
 * kitchen, the top bar's More — would be cut off. Below 1024 we scale the whole
 * page down instead, like Ctrl + minus, so it always fits the width.
 */
const MIN_WIDTH = 1024

function fit() {
  const w = window.innerWidth
  document.documentElement.style.zoom = w < MIN_WIDTH ? String(w / MIN_WIDTH) : ''
}

fit()
window.addEventListener('resize', fit)

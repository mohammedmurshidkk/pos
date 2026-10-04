import { brand } from '../brand'

/**
 * The product's own name and icon, kept small: the restaurant's name is the
 * heading on every screen, the POS brand only signs it.
 */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <img src="/favicon.svg" alt="" width={size} height={size} style={{ borderRadius: size * 0.22 }} />
      <span className="faint" style={{ fontSize: 12, fontWeight: 600 }}>{brand.productName}</span>
    </span>
  )
}

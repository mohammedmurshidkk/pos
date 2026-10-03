/**
 * Public half of the vendor's licence signing key (Ed25519).
 *
 * Safe to commit — it can only VERIFY licences.
 *
 * Rotating it invalidates every licence already issued.
 */
export const LICENCE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA+Hv+wRPi7MEt+K60mGBtdB/mKZ/RIQSE2p1TA3Yj+28=
-----END PUBLIC KEY-----
`

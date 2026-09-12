/** CLI entry: `pnpm dev` / `pnpm start`. The desktop shell calls startServer directly. */
import { startServer } from './index.js'

await startServer()

import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

/** The admin build and the SQL migrations both have to ship inside the app. */
const copies = [
  { from: path.join(root, '../admin/dist'), to: path.join(root, 'dist/ui') },
  { from: path.join(root, '../server/drizzle'), to: path.join(root, 'dist/drizzle') },
]

for (const { from, to } of copies) {
  await rm(to, { recursive: true, force: true })
  await mkdir(path.dirname(to), { recursive: true })
  await cp(from, to, { recursive: true })
  console.log(`copied ${path.relative(root, from)} -> ${path.relative(root, to)}`)
}

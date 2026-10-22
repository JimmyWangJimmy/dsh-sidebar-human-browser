/**
 * Inline lib/human.js into src/client.template.js and write lib/client.js.
 * The shell loads the client half as a plain script (not a module), so the
 * engine cannot be imported there; this keeps one source of truth anyway.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const engine = readFileSync(join(root, 'lib/human.js'), 'utf8')
  .replace(/^\/\*\*[\s\S]*?\*\//, '')       // drop the module docblock
  .replace(/^export /gm, '')                // strip ESM exports
  .trim()

const template = readFileSync(join(root, 'src/client.template.js'), 'utf8')
const out = template.replace('/*__HUMAN_ENGINE__*/', engine)
if (out === template) throw new Error('marker /*__HUMAN_ENGINE__*/ not found')

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib/client.js'), out)
console.log(`lib/client.js written (${out.split('\n').length} lines, engine ${engine.split('\n').length} lines)`)

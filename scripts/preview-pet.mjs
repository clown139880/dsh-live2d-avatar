import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const root = process.cwd()
const modelsRoot = resolve(root, 'assets', 'models')
const port = Number(process.env.HEROINE_PREVIEW_PORT ?? 4173)
const mime = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.moc3': 'application/octet-stream' }

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#20232b}canvas{width:100%;height:100%}
#heroine-pet-controls,#heroine-pet-name{display:none}
</style></head><body><canvas id="heroine-pet-canvas"></canvas><div id="heroine-pet-controls"><button id="heroine-pet-back"></button><button id="heroine-pet-smaller"></button><button id="heroine-pet-larger"></button><button id="heroine-pet-close"></button></div><div id="heroine-pet-name"></div><script src="/avatar/pet-window.js"></script></body></html>`

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/avatar/pet') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page)
    return
  }
  const target = url.pathname === '/avatar/pet-window.js'
    ? resolve(root, 'lib', 'pet-window.js')
    : url.pathname.startsWith('/avatar/models/')
      ? resolve(modelsRoot, url.pathname.slice('/avatar/models/'.length))
      : undefined
  if (!target || (target !== modelsRoot && target.startsWith(modelsRoot + sep) === false && target !== resolve(root, 'lib', 'pet-window.js'))) {
    res.writeHead(404).end()
    return
  }
  try {
    const data = await readFile(target)
    res.writeHead(200, { 'content-type': mime[extname(target)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404).end()
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Avatar pet preview: http://127.0.0.1:${port}/avatar/pet?model=haru/Haru.model3.json&name=Haru&scale=1&y=0.1`)
})

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const source = resolve('assets/leviathan-icon.svg')
const pngTarget = resolve('assets/leviathan-icon.png')
const icoTarget = resolve('assets/leviathan-icon.ico')

const svg = await readFile(source)
const png = await sharp(svg, { density: 1024 })
  .resize(256, 256, { kernel: 'nearest' })
  .png()
  .toBuffer()

await mkdir(dirname(pngTarget), { recursive: true })
await writeFile(pngTarget, png)
await writeFile(icoTarget, createIco(png))
console.log(`Wrote ${pngTarget}`)
console.log(`Wrote ${icoTarget}`)

function createIco(png: Buffer): Buffer {
  const headerSize = 6
  const entrySize = 16
  const imageOffset = headerSize + entrySize
  const ico = Buffer.alloc(imageOffset + png.length)

  ico.writeUInt16LE(0, 0)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(1, 4)

  ico.writeUInt8(0, 6)
  ico.writeUInt8(0, 7)
  ico.writeUInt8(0, 8)
  ico.writeUInt8(0, 9)
  ico.writeUInt16LE(1, 10)
  ico.writeUInt16LE(32, 12)
  ico.writeUInt32LE(png.length, 14)
  ico.writeUInt32LE(imageOffset, 18)

  png.copy(ico, imageOffset)
  return ico
}

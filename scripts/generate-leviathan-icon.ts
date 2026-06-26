import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const source = resolve('assets/leviathan-icon.svg')
const pngTarget = resolve('assets/leviathan-icon.png')
const icoTarget = resolve('assets/leviathan-icon.ico')
const icoSizes = [16, 24, 32, 48, 64, 128, 256] as const

const svg = await readFile(source)
const png = await sharp(svg, { density: 1024 })
  .resize(256, 256, { kernel: 'nearest' })
  .png()
  .toBuffer()
const icoImages = await Promise.all(
  icoSizes.map(async size => ({
    size,
    png: await sharp(svg, { density: 1024 })
      .resize(size, size, { kernel: 'lanczos3' })
      .png()
      .toBuffer(),
  })),
)

await mkdir(dirname(pngTarget), { recursive: true })
await writeFile(pngTarget, png)
await writeFile(icoTarget, createIco(icoImages))
console.log(`Wrote ${pngTarget}`)
console.log(`Wrote ${icoTarget}`)

function createIco(images: readonly { size: number; png: Buffer }[]): Buffer {
  const headerSize = 6
  const entrySize = 16
  const imageOffset = headerSize + entrySize * images.length
  const totalImageSize = images.reduce((sum, image) => sum + image.png.length, 0)
  const ico = Buffer.alloc(imageOffset + totalImageSize)

  ico.writeUInt16LE(0, 0)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(images.length, 4)

  let offset = imageOffset
  images.forEach((image, index) => {
    const entryOffset = headerSize + entrySize * index
    const encodedSize = image.size >= 256 ? 0 : image.size
    ico.writeUInt8(encodedSize, entryOffset)
    ico.writeUInt8(encodedSize, entryOffset + 1)
    ico.writeUInt8(0, entryOffset + 2)
    ico.writeUInt8(0, entryOffset + 3)
    ico.writeUInt16LE(1, entryOffset + 4)
    ico.writeUInt16LE(32, entryOffset + 6)
    ico.writeUInt32LE(image.png.length, entryOffset + 8)
    ico.writeUInt32LE(offset, entryOffset + 12)

    image.png.copy(ico, offset)
    offset += image.png.length
  })

  return ico
}

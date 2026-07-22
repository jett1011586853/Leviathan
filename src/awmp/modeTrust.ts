import {
  createPublicKey,
  generateKeyPairSync,
  sign as signPayload,
  verify as verifyPayload,
} from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { hashModePackage } from './modeCatalog.js'
import { lintModePackage } from './modeAuthoring.js'
import { getAwmpStateRoot } from './paths.js'

export type AwmpModeSignaturePayload = {
  awmp: '0.1'
  kind: 'ModeSignaturePayload'
  modeId: string
  version: string
  packageDigest: string
  publisherId: string
  algorithm: 'ed25519'
}

export type AwmpModeSignature = {
  awmp: '0.1'
  kind: 'ModeSignature'
  id: string
  modeId: string
  name: string
  version: string
  root: string
  publisherId: string
  packageDigest: string
  algorithm: 'ed25519'
  publicKeyPem: string
  signatureBase64: string
  signedAt: string
  payload: AwmpModeSignaturePayload
  lint: {
    ok: boolean
    errors: number
    warnings: number
  }
}

export type AwmpModeTrustStore = {
  awmp: '0.1'
  kind: 'ModeTrustStore'
  generatedAt: string
  trustPath: string
  signatures: AwmpModeSignature[]
}

export type AwmpModeTrustKeyPair = {
  publicKeyPath: string
  privateKeyPath: string
  publicKeyPem: string
}

export type AwmpModeSignResult = {
  trust: AwmpModeTrustStore
  signature: AwmpModeSignature
  trustPath: string
  replaced: boolean
}

export type AwmpModeSignatureVerification = {
  awmp: '0.1'
  kind: 'ModeSignatureVerification'
  generatedAt: string
  trustPath: string
  ok: boolean
  checked: Array<{
    modeId: string
    version: string
    publisherId: string
    root: string
    expectedDigest: string
    actualDigest?: string
    status:
      | 'matched'
      | 'missing'
      | 'digest_mismatch'
      | 'invalid_signature'
      | 'invalid_mode'
    message: string
  }>
}

const MODE_TRUST_FILE = 'mode_trust.json'

export function getDefaultModeTrustPath(cwd = process.cwd()): string {
  return join(getAwmpStateRoot(cwd), 'catalog', MODE_TRUST_FILE)
}

export async function loadModeTrust(input?: {
  cwd?: string
  trustPath?: string
}): Promise<AwmpModeTrustStore> {
  const trustPath = resolve(
    input?.trustPath ?? getDefaultModeTrustPath(input?.cwd),
  )
  try {
    const parsed = JSON.parse(
      await readFile(trustPath, 'utf8'),
    ) as Partial<AwmpModeTrustStore>
    return {
      awmp: '0.1',
      kind: 'ModeTrustStore',
      generatedAt: parsed.generatedAt ?? new Date().toISOString(),
      trustPath,
      signatures: Array.isArray(parsed.signatures) ? parsed.signatures : [],
    }
  } catch {
    return emptyModeTrust(trustPath)
  }
}

export async function generateModeTrustKeyPair(input: {
  publicKeyPath: string
  privateKeyPath: string
  force?: boolean
}): Promise<AwmpModeTrustKeyPair> {
  const publicKeyPath = resolve(input.publicKeyPath)
  const privateKeyPath = resolve(input.privateKeyPath)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({
    type: 'spki',
    format: 'pem',
  }) as string
  const privateKeyPem = privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string

  await writeNewFile(publicKeyPath, publicKeyPem, input.force === true)
  await writeNewFile(privateKeyPath, privateKeyPem, input.force === true)

  return {
    publicKeyPath,
    privateKeyPath,
    publicKeyPem,
  }
}

export async function signModePackage(input: {
  modeDir: string
  publisherId: string
  privateKeyPath: string
  cwd?: string
  trustPath?: string
  force?: boolean
}): Promise<AwmpModeSignResult> {
  const root = resolve(input.modeDir)
  const trustPath = resolve(input.trustPath ?? getDefaultModeTrustPath(input.cwd))
  const publisherId = input.publisherId.trim()
  if (!publisherId) throw new Error('publisherId is required to sign a mode.')

  const lint = await lintModePackage(root)
  if (lint.modePackage === undefined || !lint.ok) {
    throw new Error(`Cannot sign invalid AWMP mode: ${formatLintFailure(lint)}`)
  }

  const privateKeyPem = await readFile(resolve(input.privateKeyPath), 'utf8')
  const publicKeyPem = createPublicKey(privateKeyPem).export({
    type: 'spki',
    format: 'pem',
  }) as string
  const packageDigest = await hashModePackage(root)
  const payload: AwmpModeSignaturePayload = {
    awmp: '0.1',
    kind: 'ModeSignaturePayload',
    modeId: lint.modePackage.mode.id,
    version: lint.modePackage.mode.version,
    packageDigest,
    publisherId,
    algorithm: 'ed25519',
  }
  const signatureBase64 = signCanonicalPayload(payload, privateKeyPem)
  const signature: AwmpModeSignature = {
    awmp: '0.1',
    kind: 'ModeSignature',
    id: `${payload.modeId}@${payload.version}:${publisherId}`,
    modeId: payload.modeId,
    name: lint.modePackage.mode.name,
    version: payload.version,
    root: lint.modePackage.root,
    publisherId,
    packageDigest,
    algorithm: 'ed25519',
    publicKeyPem,
    signatureBase64,
    signedAt: new Date().toISOString(),
    payload,
    lint: {
      ok: lint.ok,
      errors: lint.diagnostics.filter(item => item.severity === 'error').length,
      warnings: lint.diagnostics.filter(item => item.severity === 'warning')
        .length,
    },
  }

  const trust = await loadModeTrust({ trustPath })
  const existing = trust.signatures.find(item => item.id === signature.id)
  if (
    existing !== undefined &&
    existing.packageDigest !== signature.packageDigest &&
    input.force !== true
  ) {
    throw new Error(
      `Mode signature ${signature.id} already exists with a different digest. Use --force to replace it.`,
    )
  }

  const updated: AwmpModeTrustStore = {
    awmp: '0.1',
    kind: 'ModeTrustStore',
    generatedAt: new Date().toISOString(),
    trustPath,
    signatures: [
      ...trust.signatures.filter(item => item.id !== signature.id),
      signature,
    ].sort(
      (left, right) =>
        left.modeId.localeCompare(right.modeId) ||
        left.version.localeCompare(right.version) ||
        left.publisherId.localeCompare(right.publisherId),
    ),
  }
  await writeModeTrust(updated)

  return {
    trust: updated,
    signature,
    trustPath,
    replaced: existing !== undefined,
  }
}

export async function verifyModeSignature(input?: {
  cwd?: string
  trustPath?: string
  modeDir?: string
  publisherId?: string
  publicKeyPath?: string
}): Promise<AwmpModeSignatureVerification> {
  const trust = await loadModeTrust({
    cwd: input?.cwd,
    trustPath: input?.trustPath,
  })
  const modeRoot =
    input?.modeDir === undefined ? undefined : resolve(input.modeDir)
  const publicKeyPem =
    input?.publicKeyPath === undefined
      ? undefined
      : await readFile(resolve(input.publicKeyPath), 'utf8')
  const signatures = trust.signatures.filter(signature => {
    const rootMatches =
      modeRoot === undefined ||
      resolve(signature.root).toLowerCase() === modeRoot.toLowerCase()
    const publisherMatches =
      input?.publisherId === undefined ||
      signature.publisherId === input.publisherId
    const keyMatches =
      publicKeyPem === undefined || signature.publicKeyPem.trim() === publicKeyPem.trim()
    return rootMatches && publisherMatches && keyMatches
  })

  const checked: AwmpModeSignatureVerification['checked'] = []
  if (modeRoot !== undefined && signatures.length === 0) {
    checked.push({
      modeId: '<unknown>',
      version: '<unknown>',
      publisherId: input?.publisherId ?? '<any>',
      root: modeRoot,
      expectedDigest: '<missing>',
      status: 'missing',
      message: `No mode signature found for mode root ${modeRoot}.`,
    })
  }

  for (const signature of signatures) {
    try {
      const actualDigest = await hashModePackage(signature.root)
      if (actualDigest !== signature.packageDigest) {
        checked.push({
          modeId: signature.modeId,
          version: signature.version,
          publisherId: signature.publisherId,
          root: signature.root,
          expectedDigest: signature.packageDigest,
          actualDigest,
          status: 'digest_mismatch',
          message: 'Mode package digest differs from signed digest.',
        })
        continue
      }

      const verified = verifyCanonicalPayload(
        signature.payload,
        signature.publicKeyPem,
        signature.signatureBase64,
      )
      checked.push({
        modeId: signature.modeId,
        version: signature.version,
        publisherId: signature.publisherId,
        root: signature.root,
        expectedDigest: signature.packageDigest,
        actualDigest,
        status: verified ? 'matched' : 'invalid_signature',
        message: verified
          ? 'Mode package signature is valid.'
          : 'Mode package signature could not be verified.',
      })
    } catch (error) {
      checked.push({
        modeId: signature.modeId,
        version: signature.version,
        publisherId: signature.publisherId,
        root: signature.root,
        expectedDigest: signature.packageDigest,
        status: 'invalid_mode',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    awmp: '0.1',
    kind: 'ModeSignatureVerification',
    generatedAt: new Date().toISOString(),
    trustPath: trust.trustPath,
    ok:
      checked.length > 0 &&
      checked.every(item => item.status === 'matched'),
    checked,
  }
}

export function verifyModeSignatureRecord(
  signature: AwmpModeSignature,
  actualDigest?: string,
): boolean {
  if (actualDigest !== undefined && actualDigest !== signature.packageDigest) {
    return false
  }
  if (signature.payload.packageDigest !== signature.packageDigest) return false
  if (signature.payload.modeId !== signature.modeId) return false
  if (signature.payload.version !== signature.version) return false
  if (signature.payload.publisherId !== signature.publisherId) return false
  return verifyCanonicalPayload(
    signature.payload,
    signature.publicKeyPem,
    signature.signatureBase64,
  )
}

export function formatModeTrust(trust: AwmpModeTrustStore): string {
  if (trust.signatures.length === 0) {
    return [
      'AWMP mode trust store',
      `Path: ${trust.trustPath}`,
      '',
      'No signed modes.',
    ].join('\n')
  }

  return [
    'AWMP mode trust store',
    `Path: ${trust.trustPath}`,
    `Signatures: ${trust.signatures.length}`,
    '',
    ...trust.signatures.map(signature =>
      [
        `- ${signature.modeId}@${signature.version} (${signature.name})`,
        `  publisher: ${signature.publisherId}`,
        `  root: ${signature.root}`,
        `  digest: ${signature.packageDigest}`,
        `  algorithm: ${signature.algorithm}`,
        `  signed: ${signature.signedAt}`,
      ].join('\n'),
    ),
  ].join('\n')
}

export function formatModeSignatureVerification(
  verification: AwmpModeSignatureVerification,
): string {
  return [
    `AWMP mode signature verification: ${verification.ok ? 'passed' : 'failed'}`,
    `Path: ${verification.trustPath}`,
    `Checked: ${verification.checked.length}`,
    '',
    ...verification.checked.map(item =>
      [
        `- ${item.modeId}@${item.version}: ${item.status}`,
        `  publisher: ${item.publisherId}`,
        `  root: ${item.root}`,
        `  expected: ${item.expectedDigest}`,
        item.actualDigest === undefined ? undefined : `  actual: ${item.actualDigest}`,
        `  ${item.message}`,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n')
}

async function writeModeTrust(trust: AwmpModeTrustStore): Promise<void> {
  await mkdir(dirname(trust.trustPath), { recursive: true })
  await writeFile(trust.trustPath, `${JSON.stringify(trust, null, 2)}\n`, 'utf8')
}

async function writeNewFile(
  path: string,
  content: string,
  force: boolean,
): Promise<void> {
  if (!force) {
    try {
      await readFile(path, 'utf8')
      throw new Error(`Refusing to overwrite existing file ${path}. Use --force.`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Refusing')) {
        throw error
      }
    }
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}

function emptyModeTrust(trustPath: string): AwmpModeTrustStore {
  return {
    awmp: '0.1',
    kind: 'ModeTrustStore',
    generatedAt: new Date().toISOString(),
    trustPath,
    signatures: [],
  }
}

function signCanonicalPayload(
  payload: AwmpModeSignaturePayload,
  privateKeyPem: string,
): string {
  return signPayload(
    null,
    Buffer.from(stableStringify(payload)),
    privateKeyPem,
  ).toString('base64')
}

function verifyCanonicalPayload(
  payload: AwmpModeSignaturePayload,
  publicKeyPem: string,
  signatureBase64: string,
): boolean {
  return verifyPayload(
    null,
    Buffer.from(stableStringify(payload)),
    publicKeyPem,
    Buffer.from(signatureBase64, 'base64'),
  )
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function formatLintFailure(
  lint: Awaited<ReturnType<typeof lintModePackage>>,
): string {
  return (
    lint.diagnostics
      .filter(diagnostic => diagnostic.severity === 'error')
      .map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`)
      .join('; ') || 'missing mode package'
  )
}

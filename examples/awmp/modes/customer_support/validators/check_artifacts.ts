import { readFile } from 'fs/promises'

const artifactIndexPath = process.env.AWMP_ARTIFACT_INDEX
const expectedTypes = ['support.analysis.report']

if (!artifactIndexPath) {
  console.log(
    JSON.stringify({
      status: 'skipped',
      severity: 'info',
      message: 'AWMP_ARTIFACT_INDEX is not available.',
    }),
  )
  process.exit(0)
}

const artifacts = JSON.parse(await readFile(artifactIndexPath, 'utf8')) as Array<{
  type?: string
}>
const businessTypes = artifacts
  .map(artifact => artifact.type)
  .filter((type): type is string => typeof type === 'string' && !type.startsWith('awmp.'))

if (businessTypes.length === 0) {
  console.log(
    JSON.stringify({
      status: 'skipped',
      severity: 'info',
      message: 'No business artifacts have been produced yet.',
    }),
  )
  process.exit(0)
}

const missing = expectedTypes.filter(type => !businessTypes.includes(type))
if (missing.length > 0) {
  console.log(
    JSON.stringify({
      status: 'failed',
      severity: 'blocking',
      message: `Missing expected support artifact types: ${missing.join(', ')}`,
    }),
  )
  process.exit(1)
}

console.log(
  JSON.stringify({
    status: 'passed',
    severity: 'info',
    message: 'Support artifact contract passed.',
  }),
)

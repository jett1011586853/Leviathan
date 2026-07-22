import type { Command } from '../../commands.js'

const awmp = {
  type: 'local',
  name: 'awmp',
  description: 'Run Agent Work Mode Protocol mode discovery and task substrate',
  argumentHint:
    'status|init|lint|modes|catalog|publish-mode|mode-lock|lock-mode|verify-lock|trust-keygen|mode-trust|sign-mode|verify-signature|marketplace|marketplace-publish|marketplace-revoke|marketplace-verify|marketplace-sync|marketplace-install|policy|policy-set|policy-check|eval-mode|install|export-bundle|install-bundle|route|run|approvals|approve|reject|reviews|review-artifact|inspect|eval|tool-call|step-run|retry-step|scheduler-run',
  supportsNonInteractive: true,
  load: () => import('./awmp.js'),
} satisfies Command

export default awmp

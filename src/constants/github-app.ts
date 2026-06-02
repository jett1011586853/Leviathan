export const PR_TITLE = 'Add Leviathan GitHub Workflow'

export const GITHUB_ACTION_SETUP_DOCS_URL =
  'https://leviathan.local/docs/github-actions'

export const WORKFLOW_CONTENT = `name: Leviathan

on:
  workflow_dispatch:

jobs:
  leviathan:
    runs-on: ubuntu-latest
    steps:
      - name: Leviathan workflow unavailable
        run: |
          echo "Configure a Leviathan GitHub Action source before enabling this workflow."
          exit 1
`

export const PR_BODY = `## Installing Leviathan GitHub Workflow

This placeholder keeps recovered product workflow templates from being installed.
Configure a Leviathan-owned GitHub Action source before enabling repository automation.`

export const CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT = `name: Leviathan Review

on:
  workflow_dispatch:

jobs:
  leviathan-review:
    runs-on: ubuntu-latest
    steps:
      - name: Leviathan review workflow unavailable
        run: |
          echo "Configure a Leviathan review action source before enabling this workflow."
          exit 1
`

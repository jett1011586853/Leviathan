<div align="center">

```text
       ▄▄
  ▄██████▄    ▄
 ██▀██████▄████
 ▀████████▀███▀
   ▀▀███▀   ▀▀
```

# Leviathan

**A terminal-first, bring-your-own-model coding agent harness.**

一个终端优先、可接入自定义模型的本地编码 Agent Harness。

[![CI](https://github.com/jett1011586853/Leviathan/actions/workflows/ci.yml/badge.svg)](https://github.com/jett1011586853/Leviathan/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=black)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)

</div>

> [!IMPORTANT]
> Leviathan is under active development. The current release is Windows-first and intended for developers who are comfortable reviewing terminal-agent permissions and provider configuration.

## Overview

Leviathan is an interactive coding agent that runs inside your terminal and works directly in the current directory. It does not require a Leviathan product account or vendor account login. You provide an Anthropic-compatible API endpoint, an exact model ID, and that provider's credential.

Leviathan is an independent project and is not affiliated with Anthropic or any model provider. “Anthropic-compatible” describes API protocol compatibility only.

## Highlights

- **Bring your own model**: configure arbitrary model IDs from Anthropic-compatible providers without a local model allowlist.
- **Five model slots**: save up to five provider profiles and switch models during a session with `/model`.
- **1M context marker**: append `[1m]` to a configured model to make Leviathan use a 1,000,000-token local context budget. The suffix is removed from the model ID sent to the provider.
- **Max reasoning effort**: supports `low`, `medium`, `high`, and `max` effort levels for compatible models and gateways.
- **Interactive permission modes**: use `Shift+Tab` to cycle available permission modes, including Plan, Accept Edits, and Full Access when policy permits.
- **Persistent sessions**: continue the latest conversation in a workspace or select an earlier session to resume.
- **Reusable personal instructions**: `/leviathan` creates an installation-level `leviathan.md` that is loaded into future sessions.
- **Agent tooling**: file operations, shell commands, MCP, skills, hooks, subagents, session compaction, and structured tool rendering.
- **One-line installation**: install a standalone Windows executable without cloning the repository or installing Bun.
- **Automatic stable updates**: downloads checksum-verified releases in the background and applies them on the next launch.

## Requirements

- Windows 10 or Windows 11
- PowerShell 5.1 or newer
- An Anthropic-compatible provider endpoint and credential

Git and [Bun](https://bun.sh/) are required only when developing from source.

## One-Line Installation

```powershell
irm https://raw.githubusercontent.com/jett1011586853/Leviathan/main/install.ps1 | iex
```

Then open any workspace and run:

```powershell
cd D:\path\to\your-project
leviathan
```

The installer downloads the latest stable standalone executable, verifies its SHA-256 checksum, installs it under `%LOCALAPPDATA%\Leviathan`, and adds the `leviathan` command to the user PATH.

After Leviathan opens, run `/model`, choose one of the five slots, and enter:

1. Provider base URL
2. Exact provider model ID
3. API key or auth token

The credential is hidden in the UI and stored through Leviathan's local secure-storage interface. It is not written to the repository. The directory where you run `leviathan` becomes the active workspace.

## Automatic Updates

The installed launcher checks GitHub stable releases in a hidden background process at most once every six hours. A downloaded update is SHA-256 verified, staged separately, and applied before the next session starts. The previous executable is retained as `leviathan.previous.exe` for recovery.

Force an immediate update check with:

```powershell
leviathan update
```

Disable automatic checks when you need a fully offline environment:

```powershell
$env:LEVIATHAN_DISABLE_AUTO_UPDATE="1"
leviathan
```

## Model Configuration

### Interactive slots

Run `/model` and select a slot. Configured slots can use different providers, and multiple slots may use the same model name.

Examples of model IDs:

```text
your-provider-model
your-provider-model[1m]
```

`[1m]` is a Leviathan client-side context marker. Use it only when the provider actually supports a 1M context window; otherwise local compaction may happen later than the provider allows.

### Environment variables

Environment configuration remains available for automation and first launch:

```powershell
$env:ANTHROPIC_BASE_URL="https://gateway.example.com/anthropic"
$env:ANTHROPIC_AUTH_TOKEN="your-provider-token"
$env:ANTHROPIC_MODEL="your-provider-model[1m]"

bun run start
```

See [`.env.example`](./.env.example) for optional effort, beta-header, and small-model settings. Never commit a populated `.env` file.

## Common Commands

| Command | Description |
| --- | --- |
| `leviathan` | Start an interactive session in the current directory |
| `leviathan -c` | Continue the most recent conversation for the current workspace |
| `leviathan -r` | Open the session picker |
| `leviathan --dangerously-skip-permissions` | Start directly in Full Access mode |
| `/model` | Configure or switch one of five provider slots |
| `/effort` | Change the reasoning effort level |
| `/leviathan` | Create or locate the persistent installation instructions file |
| `/help` | Show interactive command help |

> [!WARNING]
> Full Access bypasses permission prompts and can modify or delete files and run arbitrary commands. Use it only in a workspace you trust and can restore.

## Persistent Instructions

Run `/leviathan` once to create `leviathan.md` in the Leviathan installation root. Put stable preferences, coding conventions, or recurring instructions in that file. Leviathan loads it into the context of future sessions.

Keep secrets out of instruction files. The local `leviathan.md` file is intentionally ignored by Git.

## Development

```powershell
git clone https://github.com/jett1011586853/Leviathan.git
cd Leviathan
bun install --frozen-lockfile
bun run test
bun run build
bun run build:startup
bun run build:release
```

Project layout:

```text
src/          CLI, TUI, agent runtime, tools, and provider integration
scripts/      source launcher, installed launcher, and automatic updater
docs/         design and implementation notes
.github/      CI workflow
```

## Security and Privacy

- Leviathan does not require a Leviathan-hosted account login.
- Your configured model provider still receives prompts, repository context, and tool results sent in API requests. Review that provider's privacy and retention policy.
- Provider credentials and `.env` files must never be committed.
- Review every permission mode before using Leviathan on sensitive repositories.
- Report security-sensitive findings privately to the repository owner before opening a public issue.

## Project Status

The current milestone focuses on the local coding-agent harness: custom providers, model freedom, permission control, persistent sessions, and stable terminal interaction. Planned work includes broader platform packaging, reproducible harness-level heuristic-learning experiments, and stronger provider-compatibility testing.

## Contributing

Issues and pull requests are welcome for reproducible bugs, provider compatibility, terminal behavior, tests, and documentation. Keep changes scoped, include verification steps, and never include real credentials or private repository content.

## License

No open-source license has been selected yet. The source is publicly readable, but no reuse, modification, or redistribution rights are granted by default. A provenance and rights review should be completed before adding an OSI-approved license.

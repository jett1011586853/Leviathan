[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$LeviathanArgs
)

& bun (Join-Path $PSScriptRoot 'start-leviathan.ts') @LeviathanArgs

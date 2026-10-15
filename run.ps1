param(
    [string]$OutputDir = "",
    [switch]$ChartOnly,
    [ValidateSet("loosegrown", "carbonsparkle", "aurelinne", "altura")]
    [string]$Source = ""
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExeCandidates = @(
    (Join-Path $Root "build\Release\LooseGrownDiamondPriceTracker.exe"),
    (Join-Path $Root "build\LooseGrownDiamondPriceTracker.exe")
)

$Exe = $ExeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $Exe) {
    & (Join-Path $Root "build.ps1")
    $Exe = $ExeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Exe) {
    throw "LooseGrownDiamondPriceTracker.exe was not found."
}

$Args = @()
if ($OutputDir) {
    $Args += @("--output-dir", $OutputDir)
}
if ($ChartOnly) { $Args += "--chart-only" }
if ($Source) { $Args += @("--source", $Source) }

& $Exe @Args
exit $LASTEXITCODE

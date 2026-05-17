param(
    [string]$OutputDir = ""
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

& $Exe @Args
exit $LASTEXITCODE

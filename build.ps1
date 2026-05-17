$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir = Join-Path $Root "build"

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    throw "cmake is not installed or not available in PATH."
}

cmake -S $Root -B $BuildDir
if ($LASTEXITCODE -ne 0) {
    throw "cmake configure failed with exit code $LASTEXITCODE."
}

cmake --build $BuildDir --config Release
if ($LASTEXITCODE -ne 0) {
    throw "cmake build failed with exit code $LASTEXITCODE."
}

$exeCandidates = @(
    (Join-Path $BuildDir "Release\LooseGrownDiamondPriceTracker.exe"),
    (Join-Path $BuildDir "LooseGrownDiamondPriceTracker.exe")
)

foreach ($exe in $exeCandidates) {
    if (Test-Path $exe) {
        Write-Host "Built: $exe"
        exit 0
    }
}

throw "Build finished, but LooseGrownDiamondPriceTracker.exe was not found."

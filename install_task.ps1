param(
    [string]$TaskName = "LooseGrownDiamondPriceTrackerDaily",
    [string]$Time = "09:00"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunScript = Join-Path $Root "run.ps1"

if (-not (Test-Path $RunScript)) {
    throw "run.ps1 was not found: $RunScript"
}

$ArgList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$RunScript`""
)

$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($ArgList -join " ") -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -Daily -At $Time
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Measure Loose Grown Diamond lowest displayed price and update chart files." -Force | Out-Null

Write-Host "Registered task '$TaskName' at $Time daily."

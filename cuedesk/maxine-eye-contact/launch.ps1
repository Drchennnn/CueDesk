$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$configPath = Join-Path $PSScriptRoot 'config.json'
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$sdkDirectory = Join-Path $PSScriptRoot 'runtime\sdk'
if ($config.sdkDirectory) {
    $sdkDirectory = [string]$config.sdkDirectory
    if (-not [IO.Path]::IsPathRooted($sdkDirectory)) {
        $sdkDirectory = Join-Path $PSScriptRoot $sdkDirectory
    }
    $sdkDirectory = [IO.Path]::GetFullPath($sdkDirectory)
}
elseif ($env:MC_EYE_SDK_DIR) {
    $sdkDirectory = [IO.Path]::GetFullPath($env:MC_EYE_SDK_DIR)
}
$sdkAvailable = (Test-Path -LiteralPath (Join-Path $sdkDirectory 'nvARPose.dll')) -and
    (Test-Path -LiteralPath (Join-Path $sdkDirectory 'models') -PathType Container)
if (-not $sdkAvailable) {
    if ($config.sdkDirectory -or $env:MC_EYE_SDK_DIR) {
        throw 'The configured SDK directory is missing nvARPose.dll or models. Check the SDK path.'
    }
    $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if (-not $node) { throw 'Install Node.js 22 or newer to download the GPU-matched NVIDIA SDK.' }
    $nodeVersion = & $node.Source --version
    if ($LASTEXITCODE -ne 0 -or [int](([string]$nodeVersion).TrimStart('v').Split('.')[0]) -lt 22) {
        throw 'Node.js 22 or newer is required for SDK acquisition.'
    }
    $cache = Join-Path $env:LOCALAPPDATA 'MeetingCopilot-Maxine\maxine-sdk'
    $manager = Join-Path $PSScriptRoot 'runtime\tools\maxine-sdk.cjs'
    $extractor = Join-Path $PSScriptRoot 'runtime\tools\maxine\7z.exe'
    $sdkDirectory = $null
    & $node.Source $manager --directory $cache --extractor $extractor | ForEach-Object {
        $line = [string]$_
        Write-Host $line
        try {
            $sdkMessage = $line | ConvertFrom-Json
            if ($sdkMessage.type -eq 'ready') { $sdkDirectory = [string]$sdkMessage.sdkDir }
        }
        catch { }
    }
    if ($LASTEXITCODE -ne 0 -or -not $sdkDirectory) {
        throw 'SDK installation failed. Retry startup after checking the displayed error and network connection.'
    }
}
$engine = Join-Path $PSScriptRoot 'runtime\engine\EyeContactEngine.exe'
$engineArguments = @('--sdk-dir', '.', '--eye-size', [string]$config.eyeSize,
    '--look-away', [string][int][bool]$config.lookAway, '--temporal', [string]$config.temporal)
if ($config.deviceName) { $engineArguments += @('--device', [string]$config.deviceName) }
Push-Location -LiteralPath $sdkDirectory
try { & $engine @engineArguments; exit $LASTEXITCODE }
finally { Pop-Location }

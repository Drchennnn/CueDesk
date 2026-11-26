param(
    [string]$Dll,
    [string]$ReceiptDirectory = (Join-Path $env:LOCALAPPDATA 'MeetingCopilot\camera-registration'),
    [string]$Restore
)
$ErrorActionPreference = 'Stop'
$classId = '{AEF3B972-5FA5-4647-9571-358EB472BC9E}'
$categoryId = '{860BB310-5D01-11D0-BD3B-00A0C911CE86}'
$classPath = 'Software\Classes\CLSID\' + $classId
$devicePath = 'Software\Classes\CLSID\' + $categoryId + '\Instance\DirectShow Softcam'
$registrationPaths = @($classPath, $devicePath)

if ($Restore) {
    $receipt = Get-Content -LiteralPath $Restore -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($receipt.classPath -ne $classPath -or $receipt.devicePath -ne $devicePath) {
        throw 'The receipt does not describe this virtual-camera registration.'
    }
    foreach ($relative in $registrationPaths) {
        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($relative, $false)
    }
    foreach ($backup in $receipt.backups) {
        if ($backup) {
            & reg.exe import $backup | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Cannot restore the registry backup.' }
        }
    }
    @{restored=$true; receipt=[IO.Path]::GetFullPath($Restore)} | ConvertTo-Json -Compress
    exit 0
}

if (-not $Dll) {
    $Dll = Join-Path $PSScriptRoot 'engine\softcam.dll'
    if (-not (Test-Path -LiteralPath $Dll)) { $Dll = Join-Path $PSScriptRoot 'runtime\engine\softcam.dll' }
}
$dllFile = (Get-Item -LiteralPath $Dll).FullName
$dllHash = (Get-FileHash -LiteralPath $dllFile -Algorithm SHA256).Hash.ToLowerInvariant()
# This filter's fixed CLSID and serialized filter data belong to the supplied build.
if ($dllHash -ne '6664f2edb9ebcef9b1005ace0eae1c6db3bb40f602dead183d8634dae345a0c2') {
    throw 'Use the Softcam build supplied with this module.'
}
$backupDirectory = Join-Path ([IO.Path]::GetFullPath($ReceiptDirectory)) (Get-Date -Format 'yyyyMMdd-HHmmss-ffff')
[IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
$backups = @()
for ($index = 0; $index -lt $registrationPaths.Count; $index++) {
    $relative = $registrationPaths[$index]
    if (Test-Path -LiteralPath ('Registry::HKEY_CURRENT_USER\' + $relative)) {
        $backupFile = Join-Path $backupDirectory ($index.ToString() + '.reg')
        & reg.exe export ('HKCU\' + $relative) $backupFile /y | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot back up the existing user registration.' }
        $backups += $backupFile
    } else { $backups += '' }
}
$receiptFile = Join-Path $backupDirectory 'receipt.json'
@{classPath=$classPath; devicePath=$devicePath; dll=$dllFile; sha256=$dllHash; backups=$backups} |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $receiptFile -Encoding UTF8

$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($classPath)
try { $key.SetValue('', 'DirectShow Softcam') } finally { $key.Dispose() }
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($classPath + '\InprocServer32')
try {
    $key.SetValue('', $dllFile)
    $key.SetValue('ThreadingModel', 'Both')
} finally { $key.Dispose() }
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($devicePath)
try {
    $key.SetValue('CLSID', $classId)
    $key.SetValue('FriendlyName', 'DirectShow Softcam')
    $filterData = [Convert]::FromBase64String('AgAAAAAAIAABAAAAAAAAADBwaTMIAAAAAAAAAAEAAAAAAAAAAAAAADB0eTMAAAAAOAAAAEgAAAB2aWRzAAAQAIAAAKoAOJtxAAAAAAAAAAAAAAAAAAAAAA==')
    $key.SetValue('FilterData', $filterData, [Microsoft.Win32.RegistryValueKind]::Binary)
} finally { $key.Dispose() }
@{registered=$true; scope='current-user'; dll=$dllFile; receipt=$receiptFile} | ConvertTo-Json -Compress

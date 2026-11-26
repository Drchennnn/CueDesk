param([string]$Output = (Join-Path $PSScriptRoot 'bin\EyeContactEngine.exe'))
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The x64 .NET Framework compiler is unavailable.' }
$outputFile = [IO.Path]::GetFullPath($Output)
[IO.Directory]::CreateDirectory((Split-Path -Parent $outputFile)) | Out-Null
$sources = @('Engine.cs', 'MaxineSdk.cs', 'DirectShowCamera.cs') | ForEach-Object { Join-Path $PSScriptRoot $_ }
& $compiler /nologo /optimize+ /target:exe /platform:x64 /r:System.Web.Extensions.dll "/out:$outputFile" @sources
if ($LASTEXITCODE -ne 0) { throw "The engine compiler exited with $LASTEXITCODE." }
& $outputFile --self-test
if ($LASTEXITCODE -ne 0) { throw "The engine ABI/bitmap self-test exited with $LASTEXITCODE." }
Get-Item -LiteralPath $outputFile | Select-Object FullName,Length

[CmdletBinding()]
param(
  [string]$OutputDirectory = "dist"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw (Join-Path $root "manifest.json") | ConvertFrom-Json
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$stage = Join-Path $tempRoot ("gpt-delagger-package-" + [System.Guid]::NewGuid().ToString("N"))
$output = Join-Path $root $OutputDirectory
$archive = Join-Path $output "gpt-delagger-v$($manifest.version).zip"

New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path $output -Force | Out-Null

try {
  Copy-Item -LiteralPath (Join-Path $root "manifest.json") -Destination $stage
  Copy-Item -LiteralPath (Join-Path $root "content.js") -Destination $stage
  Copy-Item -LiteralPath (Join-Path $root "popup") -Destination $stage -Recurse
  Copy-Item -LiteralPath (Join-Path $root "icons") -Destination $stage -Recurse

  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }

  Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $archive -CompressionLevel Optimal
}
finally {
  $resolvedStage = [System.IO.Path]::GetFullPath($stage)
  if ($resolvedStage.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
      (Test-Path -LiteralPath $resolvedStage)) {
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
}

Write-Output $archive

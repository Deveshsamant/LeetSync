# Builds the Chrome Web Store zip.
#
# Only the files the extension actually loads are included. Store artwork,
# the marketing site and docs deliberately stay out: they were ~9.8 MB of the
# folder and shipped to every user on every update without being referenced.
#
#   powershell -File package.ps1

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$manifest = Get-Content 'manifest.json' -Raw | ConvertFrom-Json
$version = $manifest.version
# Built into store/dist so the upload artefact sits beside the listing copy
# and the promo art, rather than loose in the repo root.
$outDir = Join-Path $PSScriptRoot 'store/dist'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$out = Join-Path $outDir "leetsync-$version.zip"

$files = @(
  'manifest.json',
  'background.js',
  'readme.js',        # loaded by background.js via importScripts
  'analytics.js',     # loaded by background.js via importScripts
  'content.js',
  'injected.js',
  'utils.js',
  'theme.css',
  'popup.html',
  'popup.css',
  'popup.js',
  'sheet-progress.js',
  'toast.css',
  'remote-config.json',
  'sheets.json',      # built by scripts/parse-sheets.py
  'tracker.html',
  'tracker.css',
  'tracker.js'
)
$dirs = @('icons', 'fonts')

foreach ($f in $files) {
  if (-not (Test-Path $f)) { throw "Required file missing: $f" }
}

# Guard against the failure this script already shipped once: a file pulled in
# with importScripts() is invisible to the manifest, so it is easy to leave out
# of $files and only discover the breakage after upload.
$imported = Select-String -Path '*.js' -Pattern "importScripts\(([^)]*)\)" -AllMatches |
  ForEach-Object { $_.Matches } |
  ForEach-Object { [regex]::Matches($_.Groups[1].Value, "'([^']+)'") } |
  ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
foreach ($dep in $imported) {
  if ($files -notcontains $dep) {
    throw "importScripts('$dep') is used but '$dep' is not in the package file list."
  }
}
foreach ($d in $dirs) {
  if (-not (Test-Path $d)) { throw "Required folder missing: $d" }
}

$stage = Join-Path $env:TEMP "leetsync-pkg-$version"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

foreach ($f in $files) { Copy-Item $f -Destination $stage }
foreach ($d in $dirs) { Copy-Item $d -Destination $stage -Recurse }

if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $out
Remove-Item $stage -Recurse -Force

$kb = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Output ""
Write-Output "Built $out  ($kb KB)"
Write-Output "Upload this file to the Chrome Web Store."

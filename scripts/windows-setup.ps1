<#
  One-shot setup for observe_desk on Windows: checks the tools, offers to install what is missing,
  gets the code, installs packages and starts the app.

  Run in PowerShell (not as administrator):
    Set-ExecutionPolicy -Scope Process Bypass -Force
    irm https://raw.githubusercontent.com/nat-30102000/observe_desk/claude/obsidian-desktop-app-plan-q79ggg/scripts/windows-setup.ps1 | iex

  Or, from a clone:  .\scripts\windows-setup.ps1 [-Build]
  -Build makes the installer instead of starting the app.
#>
param(
  [string]$Folder = "$HOME\observe_desk",
  [string]$Branch = 'claude/obsidian-desktop-app-plan-q79ggg',
  [switch]$Build
)

$ErrorActionPreference = 'Stop'

function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Ask($question) {
  $answer = Read-Host "$question [y/N]"
  return $answer -match '^(y|yes)$'
}

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ";$HOME\.cargo\bin"
}

function Install-With-Winget($id, $name, $extra = @()) {
  if (-not (Have 'winget')) {
    Write-Host "winget is not available, so please install $name by hand (see README.md) and run this again." -ForegroundColor Yellow
    exit 1
  }
  Write-Host "Installing $name ..." -ForegroundColor Cyan
  winget install --id $id -e --accept-source-agreements --accept-package-agreements @extra
  Refresh-Path
}

Write-Host "`nobserve_desk setup`n" -ForegroundColor Magenta

# --- Git
if (-not (Have 'git')) {
  if (Ask 'Git is missing. Install it with winget?') { Install-With-Winget 'Git.Git' 'Git' } else { Write-Host 'Git is needed.'; exit 1 }
}

# --- Node.js 20+
$needNode = $true
if (Have 'node') { $needNode = [int]((node -v).TrimStart('v').Split('.')[0]) -lt 20 }
if ($needNode) {
  if (Ask 'Node.js 20 or newer is missing. Install Node.js LTS with winget?') { Install-With-Winget 'OpenJS.NodeJS.LTS' 'Node.js LTS' } else { Write-Host 'Node.js 20+ is needed.'; exit 1 }
}

# --- Visual Studio Build Tools (C++)
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$haveCpp = (Test-Path $vswhere) -and (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if (-not $haveCpp) {
  if (Ask 'The C++ build tools are missing (about 3 GB, takes a while). Install Visual Studio Build Tools?') {
    Install-With-Winget 'Microsoft.VisualStudio.2022.BuildTools' 'Visual Studio Build Tools' @('--override', '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
  } else { Write-Host 'The C++ build tools are needed to compile the app.'; exit 1 }
}

# --- Rust
if (-not (Have 'rustc')) {
  if (Ask 'Rust is missing. Install it with winget (rustup)?') {
    Install-With-Winget 'Rustlang.Rustup' 'Rust (rustup)'
    rustup default stable-x86_64-pc-windows-msvc
  } else { Write-Host 'Rust is needed.'; exit 1 }
}

# --- WebView2 (present on most PCs)
$wv = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue
if (-not $wv) {
  Write-Host 'WebView2 was not found. Windows 11 and up-to-date Windows 10 have it; if the app opens blank, install the "WebView2 Runtime" from Microsoft.' -ForegroundColor Yellow
}

# --- Code
if (Test-Path "$Folder\.git") {
  Write-Host "Updating $Folder ..." -ForegroundColor Cyan
  git -C $Folder fetch origin $Branch
  git -C $Folder checkout $Branch
  git -C $Folder pull --ff-only origin $Branch
} else {
  Write-Host "Cloning into $Folder ..." -ForegroundColor Cyan
  git clone --branch $Branch https://github.com/nat-30102000/observe_desk $Folder
}
Set-Location $Folder

Write-Host 'Installing packages ...' -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

Write-Host 'Running the tests ...' -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { Write-Host 'Some tests failed. Please send me the output.' -ForegroundColor Yellow }

if ($Build) {
  Write-Host 'Building the installer (the first build takes several minutes) ...' -ForegroundColor Cyan
  npm run tauri -w '@observe/desk' build
  if ($LASTEXITCODE -ne 0) { throw 'The build failed. Please send me the error text above.' }
  $out = "$Folder\apps\desk\src-tauri\target\release\bundle\nsis"
  Write-Host "Done. The installer is in $out" -ForegroundColor Green
  Invoke-Item $out
} else {
  Write-Host "Starting the app (the first build takes several minutes). Nib appears near the bottom-right of your screen." -ForegroundColor Green
  npm run tauri -w '@observe/desk' dev
}

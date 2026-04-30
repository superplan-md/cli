$ErrorActionPreference = 'Stop'

$SuperplanRepoUrl = if ($env:SUPERPLAN_REPO_URL) { $env:SUPERPLAN_REPO_URL } else { 'https://github.com/superplan-md/superplan-plugin.git' }
$SuperplanRef = if ($env:SUPERPLAN_REF) { $env:SUPERPLAN_REF } else { '' }
$SuperplanLatestCommitish = if ($env:SUPERPLAN_LATEST_COMMITISH) { $env:SUPERPLAN_LATEST_COMMITISH } else { '' }
$SuperplanSourceDir = if ($env:SUPERPLAN_SOURCE_DIR) { $env:SUPERPLAN_SOURCE_DIR } else { '' }
$SuperplanInstallPrefix = if ($env:SUPERPLAN_INSTALL_PREFIX) { $env:SUPERPLAN_INSTALL_PREFIX } else { '' }
$SuperplanOverlaySourcePath = if ($env:SUPERPLAN_OVERLAY_SOURCE_PATH) { $env:SUPERPLAN_OVERLAY_SOURCE_PATH } else { '' }
$SuperplanOverlayReleaseBaseUrl = if ($env:SUPERPLAN_OVERLAY_RELEASE_BASE_URL) { $env:SUPERPLAN_OVERLAY_RELEASE_BASE_URL } else { '' }
$SuperplanOverlayInstallDir = if ($env:SUPERPLAN_OVERLAY_INSTALL_DIR) { $env:SUPERPLAN_OVERLAY_INSTALL_DIR } else { (Join-Path $HOME '.config\superplan\overlay') }
$SuperplanEnableOverlay = if ($env:SUPERPLAN_ENABLE_OVERLAY) { $env:SUPERPLAN_ENABLE_OVERLAY } else { '1' }
$SuperplanRunSetupAfterInstall = if ($null -ne $env:SUPERPLAN_RUN_SETUP_AFTER_INSTALL) { $env:SUPERPLAN_RUN_SETUP_AFTER_INSTALL } else { $null }
$SuperplanResolvedRef = ''
$SuperplanOverlayRef = ''
$OverlayInstallMethod = ''
$OverlayInstallPath = ''
$OverlayExecutablePath = ''
$OverlayArtifactName = ''
$OverlayPlatform = ''
$OverlayArch = ''
$NodeCommand = 'node'
$NpmCommand = 'npm'
$BundledNodeRuntimeRoot = Join-Path $HOME '.config\superplan\node-runtime'
$UsingBundledNodeRuntime = $false
$SetupCompleted = $false
$OriginalLocation = Get-Location

function Say {
  param([string] $Message)
  Write-Host $Message
}

function Fail {
  param([string] $Message)
  throw "error: $Message"
}

function Require-Command {
  param([string] $Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail "missing required command: $Name"
  }
}

function To-Lower {
  param([string] $Value)

  return $Value.ToLowerInvariant()
}

function Show-InstallSuccess {
  if ($Host.UI.RawUI) {
    Write-Host 'Installation successful.' -ForegroundColor Green
    return
  }

  Say 'Installation successful.'
}

function Invoke-QuietCommand {
  param(
    [string] $Label,
    [scriptblock] $Command
  )

  $logPath = Join-Path $workDir "$Label.log"
  $previousErrorActionPreference = $ErrorActionPreference
  $nativePreferenceVariable = Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue
  $previousNativeErrorPreference = $null

  try {
    $script:ErrorActionPreference = 'Continue'
    if ($nativePreferenceVariable) {
      $previousNativeErrorPreference = $global:PSNativeCommandUseErrorActionPreference
      $global:PSNativeCommandUseErrorActionPreference = $false
    }

    & $Command *> $logPath
    if ($LASTEXITCODE -ne 0) {
      if (Test-Path -LiteralPath $logPath) {
        Get-Content -Path $logPath
      }
      Fail "$Label failed"
    }
  } finally {
    $script:ErrorActionPreference = $previousErrorActionPreference
    if ($nativePreferenceVariable) {
      $global:PSNativeCommandUseErrorActionPreference = $previousNativeErrorPreference
    }
    Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
  }
}

function Test-DirectoryWritable {
  param([string] $Path)

  try {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
    $probePath = Join-Path $Path (".superplan-write-test-" + [Guid]::NewGuid().ToString('N'))
    Set-Content -Path $probePath -Value 'ok' -Encoding utf8
    Remove-Item -Force $probePath
    return $true
  } catch {
    return $false
  }
}

function Copy-LocalSourceSnapshot {
  param(
    [string] $SourceDir,
    [string] $DestinationDir
  )

  $excludedNames = @(
    '.git',
    'node_modules'
  )

  $excludedPaths = @(
    (Join-Path $SourceDir 'apps/desktop/node_modules'),
    (Join-Path $SourceDir 'apps/desktop/dist')
  ) | ForEach-Object { [System.IO.Path]::GetFullPath($_) }

  New-Item -ItemType Directory -Force -Path $DestinationDir | Out-Null

  Get-ChildItem -LiteralPath $SourceDir -Force | ForEach-Object {
    if ($excludedNames -contains $_.Name) {
      return
    }

    $sourcePath = [System.IO.Path]::GetFullPath($_.FullName)
    if ($excludedPaths -contains $sourcePath) {
      return
    }

    $targetPath = Join-Path $DestinationDir $_.Name
    Copy-Item -LiteralPath $_.FullName -Destination $targetPath -Recurse -Force
  }
}

function Parse-GitHubRepo {
  param([string] $RepoUrl)

  if ($RepoUrl -match '^git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$') {
    return @{
      owner = $Matches[1]
      repo = $Matches[2]
    }
  }

  try {
    $uri = [Uri] $RepoUrl
  } catch {
    return $null
  }

  if ($uri.Host -ne 'github.com') {
    return $null
  }

  $segments = $uri.AbsolutePath.Trim('/').Split('/', [System.StringSplitOptions]::RemoveEmptyEntries)
  if ($segments.Length -lt 2) {
    return $null
  }

  return @{
    owner = $segments[0]
    repo = ($segments[1] -replace '\.git$', '')
  }
}

function Resolve-WindowsArch {
  $rawArch = [string] $env:PROCESSOR_ARCHITECTURE
  if ([string]::IsNullOrWhiteSpace($rawArch)) {
    return 'x64'
  }

  switch -Regex ($rawArch.ToLowerInvariant()) {
    '^(amd64|x86_64)$' { return 'x64' }
    '^(arm64|aarch64)$' { return 'arm64' }
    '^x86$' { return 'x86' }
    default { return 'x64' }
  }
}

function Resolve-BundledNodeRuntimeHome {
  if (-not (Test-Path -LiteralPath $BundledNodeRuntimeRoot -PathType Container)) {
    return $null
  }

  $directNodePath = Join-Path $BundledNodeRuntimeRoot 'node.exe'
  $directNpmPath = Join-Path $BundledNodeRuntimeRoot 'npm.cmd'
  if ((Test-Path -LiteralPath $directNodePath -PathType Leaf) -and (Test-Path -LiteralPath $directNpmPath -PathType Leaf)) {
    return $BundledNodeRuntimeRoot
  }

  $nodeHomes = Get-ChildItem -LiteralPath $BundledNodeRuntimeRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending

  foreach ($nodeHome in $nodeHomes) {
    $candidateNodePath = Join-Path $nodeHome.FullName 'node.exe'
    $candidateNpmPath = Join-Path $nodeHome.FullName 'npm.cmd'
    if ((Test-Path -LiteralPath $candidateNodePath -PathType Leaf) -and (Test-Path -LiteralPath $candidateNpmPath -PathType Leaf)) {
      return $nodeHome.FullName
    }
  }

  return $null
}

function Use-BundledNodeRuntime {
  param([string] $NodeHome)

  $script:NodeCommand = Join-Path $NodeHome 'node.exe'
  $script:NpmCommand = Join-Path $NodeHome 'npm.cmd'
  $script:UsingBundledNodeRuntime = $true
  $env:PATH = "$NodeHome;$($env:PATH)"
}

function Ensure-NodeToolchain {
  if ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    $script:NodeCommand = 'node'
    $script:NpmCommand = 'npm'
    $script:UsingBundledNodeRuntime = $false
    return
  }

  $existingBundledNodeHome = Resolve-BundledNodeRuntimeHome
  if (-not [string]::IsNullOrWhiteSpace($existingBundledNodeHome)) {
    Say "Using bundled Superplan Node runtime from $existingBundledNodeHome"
    Use-BundledNodeRuntime -NodeHome $existingBundledNodeHome
    return
  }

  $portableRoot = Join-Path $workDir 'node-portable'
  $archivePath = Join-Path $workDir 'node-portable.zip'
  $latestTrackUrl = 'https://nodejs.org/dist/latest-v20.x/SHASUMS256.txt'
  $nodeArch = Resolve-WindowsArch

  Say 'Node.js not found on PATH. Bootstrapping a portable Node runtime for installation.'
  $checksums = (Invoke-WebRequest -UseBasicParsing -Uri $latestTrackUrl).Content
  $archiveName = $null
  foreach ($line in ($checksums -split "`r?`n")) {
    if ($line -match ("node-v20\.[^\s]+-win-{0}\.zip" -f [regex]::Escape($nodeArch))) {
      $archiveName = $Matches[0]
      break
    }
  }

  if ([string]::IsNullOrWhiteSpace($archiveName)) {
    Fail "failed to resolve a portable Node.js archive for Windows $nodeArch"
  }

  $downloadUrl = "https://nodejs.org/dist/latest-v20.x/$archiveName"
  Say "Downloading portable Node.js from $downloadUrl"
  Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath

  New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null
  Expand-Archive -Path $archivePath -DestinationPath $portableRoot -Force

  $downloadedNodeHome = Get-ChildItem -LiteralPath $portableRoot -Directory | Select-Object -First 1
  if (-not $downloadedNodeHome) {
    Fail 'failed to extract portable Node.js runtime'
  }

  Say "Persisting bundled Superplan Node runtime to $BundledNodeRuntimeRoot"
  Remove-Item -LiteralPath $BundledNodeRuntimeRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $BundledNodeRuntimeRoot | Out-Null
  Get-ChildItem -LiteralPath $portableRoot -Force | ForEach-Object {
    $targetPath = Join-Path $BundledNodeRuntimeRoot $_.Name
    Copy-Item -LiteralPath $_.FullName -Destination $targetPath -Recurse -Force
  }

  $bundledNodeHome = Resolve-BundledNodeRuntimeHome
  if ([string]::IsNullOrWhiteSpace($bundledNodeHome)) {
    Fail 'bootstrapped portable Node.js runtime could not be persisted'
  }

  Use-BundledNodeRuntime -NodeHome $bundledNodeHome
}

function Resolve-LatestReleaseTagFromGitHub {
  $repo = Parse-GitHubRepo $SuperplanRepoUrl
  if (-not $repo) {
    return $null
  }

  try {
    $headers = @{
      Accept = 'application/vnd.github+json'
      'User-Agent' = 'superplan-install-windows'
    }
    $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$($repo.owner)/$($repo.repo)/releases/latest" -Headers $headers
    $tag = [string] $response.tag_name
    if ([string]::IsNullOrWhiteSpace($tag)) {
      return $null
    }
    return $tag.Trim()
  } catch {
    return $null
  }
}

function Resolve-InstallRef {
  if (-not [string]::IsNullOrWhiteSpace($SuperplanRef)) {
    $script:SuperplanResolvedRef = $SuperplanRef
    return
  }

  if (-not [string]::IsNullOrWhiteSpace($SuperplanSourceDir)) {
    $script:SuperplanResolvedRef = 'dev'
    return
  }

  $latestReleaseTag = Resolve-LatestReleaseTagFromGitHub
  if (-not [string]::IsNullOrWhiteSpace($latestReleaseTag)) {
    $script:SuperplanResolvedRef = $latestReleaseTag
    Say "Resolved latest Superplan release: $script:SuperplanResolvedRef"
    return
  }

  $script:SuperplanResolvedRef = 'main'
  Say "No release tag found; defaulting Superplan source to $script:SuperplanResolvedRef"
}

function Resolve-OverlayRef {
  if (-not [string]::IsNullOrWhiteSpace($SuperplanRef)) {
    $script:SuperplanOverlayRef = $SuperplanRef
    return
  }

  $latestReleaseTag = Resolve-LatestReleaseTagFromGitHub
  if (-not [string]::IsNullOrWhiteSpace($latestReleaseTag)) {
    $script:SuperplanOverlayRef = $latestReleaseTag
    Say "Resolved latest Superplan overlay release: $script:SuperplanOverlayRef"
    return
  }

  $script:SuperplanOverlayRef = 'main'
  Say "No release tag found; defaulting overlay ref to $script:SuperplanOverlayRef"
}

function Resolve-OverlayReleaseBaseUrl {
  if (-not [string]::IsNullOrWhiteSpace($SuperplanOverlayReleaseBaseUrl)) {
    return
  }

  $script:SuperplanOverlayReleaseBaseUrl = $SuperplanRepoUrl -replace '\.git$', ''
  $script:SuperplanOverlayReleaseBaseUrl = "$script:SuperplanOverlayReleaseBaseUrl/releases/download/$script:SuperplanOverlayRef"
}

function Resolve-OverlayReleaseTarget {
  param([string] $SourceWorktree)

  $script:OverlayPlatform = 'windows'
  $script:OverlayArch = Resolve-WindowsArch
  $script:OverlayArtifactName = "superplan-overlay-windows-$($script:OverlayArch).exe"
}

function Download-GitHubSourceSnapshot {
  param(
    [string] $RepoUrl,
    [string] $Ref,
    [string] $DestinationDir,
    [string] $WorkDir
  )

  $repo = Parse-GitHubRepo $RepoUrl
  if (-not $repo) {
    return $false
  }

  $archivePath = Join-Path $WorkDir 'superplan-source.zip'
  $extractDir = Join-Path $WorkDir 'source-extract'
  $downloadUrl = "https://codeload.github.com/$($repo.owner)/$($repo.repo)/zip/$Ref"

  Say "Downloading Superplan source archive from $downloadUrl"
  Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath

  New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
  Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force

  $archiveRoot = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1
  if (-not $archiveRoot) {
    Fail 'downloaded source archive did not contain a repo root'
  }

  New-Item -ItemType Directory -Force -Path $DestinationDir | Out-Null
  Get-ChildItem -LiteralPath $archiveRoot.FullName -Force | ForEach-Object {
    $targetPath = Join-Path $DestinationDir $_.Name
    Copy-Item -LiteralPath $_.FullName -Destination $targetPath -Recurse -Force
  }

  return $true
}

function Resolve-PackagedOverlaySource {
  param([string] $SourceWorktree, [string] $WorkDir)

  if (-not [string]::IsNullOrWhiteSpace($SuperplanOverlaySourcePath)) {
    $script:OverlayInstallMethod = 'copied_prebuilt'
    return $true
  }

  $localArtifactPath = Join-Path $SourceWorktree "dist/release/overlay/$script:OverlayArtifactName"
  if (Test-Path -LiteralPath $localArtifactPath -PathType Leaf) {
    $script:SuperplanOverlaySourcePath = $localArtifactPath
    $script:OverlayInstallMethod = 'copied_prebuilt'
    return $true
  }

  $localDesktopDist = Join-Path $SourceWorktree 'apps/desktop/dist'
  $localBuildPath = $null
  if (Test-Path -LiteralPath $localDesktopDist -PathType Container) {
    $localBuildPath = Get-ChildItem -LiteralPath $localDesktopDist -Filter '*portable*.exe' -File -ErrorAction SilentlyContinue |
      Sort-Object Name |
      Select-Object -First 1 -ExpandProperty FullName
  }

  if (-not [string]::IsNullOrWhiteSpace($localBuildPath) -and (Test-Path -LiteralPath $localBuildPath -PathType Leaf)) {
    $script:SuperplanOverlaySourcePath = $localBuildPath
    $script:OverlayInstallMethod = 'copied_prebuilt'
    return $true
  }

  if (-not [string]::IsNullOrWhiteSpace($SuperplanSourceDir)) {
    Say 'No packaged Windows overlay artifact found in local source snapshot; continuing without the desktop companion'
    return $false
  }

  $downloadPath = Join-Path $WorkDir $script:OverlayArtifactName
  $downloadUrl = "$($script:SuperplanOverlayReleaseBaseUrl.TrimEnd('/'))/$script:OverlayArtifactName"
  Say "Downloading Superplan overlay from $downloadUrl"

  try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $downloadPath | Out-Null
  } catch {
    Say "WARNING: Failed to download overlay companion for $script:OverlayPlatform/$script:OverlayArch from $downloadUrl"
    return $false
  }

  $script:SuperplanOverlaySourcePath = $downloadPath
  $script:OverlayInstallMethod = 'downloaded_prebuilt'
  return $true
}

function Install-OverlayCompanion {
  if ([string]::IsNullOrWhiteSpace($SuperplanOverlaySourcePath)) {
    return
  }

  if (-not (Test-Path -LiteralPath $SuperplanOverlaySourcePath)) {
    Fail "SUPERPLAN_OVERLAY_SOURCE_PATH does not exist: $SuperplanOverlaySourcePath"
  }

  New-Item -ItemType Directory -Force -Path $SuperplanOverlayInstallDir | Out-Null
  $overlayName = Split-Path -Path $SuperplanOverlaySourcePath -Leaf
  $script:OverlayInstallPath = Join-Path $SuperplanOverlayInstallDir $overlayName
  $sourcePathToCopy = $SuperplanOverlaySourcePath

  if (Test-Path -LiteralPath $script:OverlayInstallPath) {
    try {
      $sourceResolvedPath = (Get-Item -LiteralPath $SuperplanOverlaySourcePath -Force).FullName
      $targetResolvedPath = (Get-Item -LiteralPath $script:OverlayInstallPath -Force).FullName
      if ($sourceResolvedPath -eq $targetResolvedPath) {
        $stagedOverlayRoot = Join-Path $workDir 'overlay-companion-source'
        $stagedOverlayPath = Join-Path $stagedOverlayRoot $overlayName
        Remove-Item -LiteralPath $stagedOverlayPath -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $stagedOverlayRoot | Out-Null
        Copy-Item -LiteralPath $SuperplanOverlaySourcePath -Destination $stagedOverlayPath -Recurse -Force
        $sourcePathToCopy = $stagedOverlayPath
      }
    } catch {
      $sourcePathToCopy = $SuperplanOverlaySourcePath
    }
  }

  Remove-Item -LiteralPath $script:OverlayInstallPath -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $sourcePathToCopy -Destination $script:OverlayInstallPath -Recurse -Force
  $script:OverlayExecutablePath = $script:OverlayInstallPath
}

function Ensure-WritablePrefix {
  if (-not [string]::IsNullOrWhiteSpace($SuperplanInstallPrefix)) {
    $env:npm_config_prefix = $SuperplanInstallPrefix
    return
  }

  $currentPrefix = (& $script:NpmCommand prefix --global).Trim()
  if ([string]::IsNullOrWhiteSpace($currentPrefix)) {
    return
  }

  if (Test-DirectoryWritable $currentPrefix) {
    return
  }

  $fallbackPrefix = Join-Path $HOME '.superplan\npm-global'
  Say "Default npm global prefix ($currentPrefix) is not writable."
  Say "Falling back to $fallbackPrefix."
  New-Item -ItemType Directory -Force -Path $fallbackPrefix | Out-Null
  $env:npm_config_prefix = $fallbackPrefix
  $script:SuperplanInstallPrefix = $fallbackPrefix
}

function Write-SuperplanWindowsShims {
  param(
    [string] $InstallBinDir
  )

  if (-not $script:UsingBundledNodeRuntime) {
    return
  }

  $bundledNodeHome = Resolve-BundledNodeRuntimeHome
  if ([string]::IsNullOrWhiteSpace($bundledNodeHome)) {
    Fail 'bundled Superplan Node runtime was expected but not found'
  }

  $bundledNodeExe = Join-Path $bundledNodeHome 'node.exe'
  $cmdShimPath = Join-Path $InstallBinDir 'superplan.cmd'
  $ps1ShimPath = Join-Path $InstallBinDir 'superplan.ps1'
  $escapedNodeExe = $bundledNodeExe -replace "'", "''"

  $cmdShimContent = @"
@echo off
setlocal
set "SUPERPLAN_NODE_EXE=$bundledNodeExe"
set "SUPERPLAN_ENTRY=%~dp0node_modules\superplan\dist\cli\main.js"
if not exist "%SUPERPLAN_NODE_EXE%" (
  echo error: missing bundled Superplan Node runtime at %SUPERPLAN_NODE_EXE% 1>&2
  exit /b 1
)
if not exist "%SUPERPLAN_ENTRY%" (
  echo error: missing Superplan CLI entrypoint at %SUPERPLAN_ENTRY% 1>&2
  exit /b 1
)
"%SUPERPLAN_NODE_EXE%" "%SUPERPLAN_ENTRY%" %*
exit /b %ERRORLEVEL%
"@

  $ps1ShimContent = @"
`$ErrorActionPreference = 'Stop'
`$nodeExe = '$escapedNodeExe'
`$entryPath = Join-Path `$PSScriptRoot 'node_modules\superplan\dist\cli\main.js'
if (-not (Test-Path -LiteralPath `$nodeExe -PathType Leaf)) {
  throw "error: missing bundled Superplan Node runtime at `$nodeExe"
}
if (-not (Test-Path -LiteralPath `$entryPath -PathType Leaf)) {
  throw "error: missing Superplan CLI entrypoint at `$entryPath"
}
& `$nodeExe `$entryPath @args
exit `$LASTEXITCODE
"@

  Set-Content -Path $cmdShimPath -Value $cmdShimContent -Encoding ascii
  Set-Content -Path $ps1ShimPath -Value $ps1ShimContent -Encoding ascii
}

function Should-EnableOverlayByDefault {
  $override = To-Lower ([string] $SuperplanEnableOverlay)

  if ($override -in @('1', 'y', 'yes', 'true', 'on')) {
    return $true
  }

  if ($override -in @('0', 'n', 'no', 'false', 'off')) {
    return $false
  }

  if ($Host.Name -notin @('ServerRemoteHost', 'ServerHost')) {
    $answer = Read-Host 'Enable desktop overlay by default on this machine? [Y/n]'
    return [string]::IsNullOrWhiteSpace($answer) -or (To-Lower $answer) -in @('y', 'yes')
  }

  return $true
}

function Run-MachineSetup {
  param([string] $SuperplanCommandPath)

  $shouldRunSetup = $false

  if ($null -ne $SuperplanRunSetupAfterInstall) {
    $shouldRunSetup = (To-Lower ([string] $SuperplanRunSetupAfterInstall)) -in @('1', 'y', 'yes', 'true', 'on')
  } elseif ($Host.Name -notin @('ServerRemoteHost', 'ServerHost')) {
    $answer = Read-Host "Run `superplan init` in $OriginalLocation now? [Y/n]"
    $shouldRunSetup = [string]::IsNullOrWhiteSpace($answer) -or (To-Lower $answer) -in @('y', 'yes')
  }

  if (-not $shouldRunSetup) {
    return
  }

  Say "Running superplan init in $OriginalLocation"
  Push-Location $OriginalLocation
  try {
    & $SuperplanCommandPath init --yes --json | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Fail 'superplan init failed after binary installation'
    }
  } finally {
    Pop-Location
  }
  $script:SetupCompleted = $true

  if (-not [string]::IsNullOrWhiteSpace($script:OverlayInstallPath)) {
    if (Should-EnableOverlayByDefault) {
      Say 'Enabling desktop overlay by default'
      & $SuperplanCommandPath overlay enable --global --json | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Fail 'failed to enable overlay by default'
      }
    } else {
      Say 'Leaving desktop overlay disabled by default'
      & $SuperplanCommandPath overlay disable --global --json | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Fail 'failed to persist overlay preference'
      }
    }
  } else {
    Say 'Overlay not installed; skipping overlay preference setup'
  }
}

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("superplan-install-" + [Guid]::NewGuid().ToString('N'))
$sourceWorktree = Join-Path $workDir 'source'

New-Item -ItemType Directory -Force -Path $workDir | Out-Null

try {
  Ensure-NodeToolchain
  Ensure-WritablePrefix
  Resolve-InstallRef
  Resolve-OverlayRef
  Resolve-OverlayReleaseBaseUrl

  if (-not [string]::IsNullOrWhiteSpace($SuperplanSourceDir)) {
    if (-not (Test-Path -LiteralPath $SuperplanSourceDir -PathType Container)) {
      Fail "SUPERPLAN_SOURCE_DIR does not exist: $SuperplanSourceDir"
    }

    Say "Copying Superplan source from $SuperplanSourceDir"
    Copy-LocalSourceSnapshot -SourceDir $SuperplanSourceDir -DestinationDir $sourceWorktree
  } else {
    $targetRef = if (-not [string]::IsNullOrWhiteSpace($SuperplanLatestCommitish)) { $SuperplanLatestCommitish } else { $SuperplanResolvedRef }
    $downloadedArchive = $false
    try {
      $downloadedArchive = Download-GitHubSourceSnapshot -RepoUrl $SuperplanRepoUrl -Ref $targetRef -DestinationDir $sourceWorktree -WorkDir $workDir
    } catch {
      if (Get-Command git -ErrorAction SilentlyContinue) {
        Say "GitHub archive download failed; falling back to git checkout for $targetRef"
      } else {
        throw
      }
    }

    if (-not $downloadedArchive) {
      Require-Command git
      Say "Cloning Superplan from $SuperplanRepoUrl"
      & git clone $SuperplanRepoUrl $sourceWorktree | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Fail "failed to clone repository: $SuperplanRepoUrl"
      }

      Push-Location $sourceWorktree
      try {
        & git checkout $targetRef | Out-Null
        if ($LASTEXITCODE -ne 0) {
          Fail "failed to check out ref: $targetRef"
        }
      } finally {
        Pop-Location
      }
    }
  }

  $packageJsonPath = Join-Path $sourceWorktree 'package.json'
  if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
    Fail 'package.json not found in installer worktree'
  }

  Resolve-OverlayReleaseTarget -SourceWorktree $sourceWorktree
  if (-not (Resolve-PackagedOverlaySource -SourceWorktree $sourceWorktree -WorkDir $workDir)) {
    Say "WARNING: Could not find or download the Superplan overlay companion for $script:OverlayPlatform/$script:OverlayArch."
    Say 'The CLI will be installed without the desktop overlay. You can install it manually later.'
  }

  Push-Location $sourceWorktree
  try {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceWorktree 'node_modules') -PathType Container)) {
      Say 'Installing dependencies'
      Invoke-QuietCommand -Label 'npm-install' -Command { & $script:NpmCommand install }
    } else {
      Say 'Using existing node_modules from source snapshot'
    }

    Say 'Building Superplan'
    Invoke-QuietCommand -Label 'npm-build' -Command { & $script:NpmCommand run build }

    if (-not [string]::IsNullOrWhiteSpace($SuperplanSourceDir)) {
      Say 'Packing Superplan from local source snapshot'
    } else {
      Say 'Packing Superplan'
    }

    $packLogPath = Join-Path $workDir 'npm-pack.log'
    try {
      $packageTgz = (& $script:NpmCommand pack --silent 2>$packLogPath).Trim().Split([Environment]::NewLine, [System.StringSplitOptions]::RemoveEmptyEntries)[-1]
      if ($LASTEXITCODE -ne 0) {
        if (Test-Path -LiteralPath $packLogPath) {
          Get-Content -Path $packLogPath
        }
        Fail 'npm pack failed'
      }
    } finally {
      Remove-Item -LiteralPath $packLogPath -Force -ErrorAction SilentlyContinue
    }
    if ([string]::IsNullOrWhiteSpace($packageTgz)) {
      Fail 'npm pack did not return an archive path'
    }

    Say 'Installing Superplan globally with npm'
    Invoke-QuietCommand -Label 'npm-global-install' -Command { & $script:NpmCommand install --global (Join-Path $sourceWorktree $packageTgz) }
  } finally {
    Pop-Location
  }

  $installPrefix = (& $script:NpmCommand prefix --global).Trim()
  $installBinDir = $installPrefix
  $superplanCommandPath = Join-Path $installBinDir 'superplan.cmd'

  if (-not (Test-Path -LiteralPath $superplanCommandPath -PathType Leaf)) {
    $superplanCommandPath = Join-Path $installBinDir 'superplan'
  }

  if (-not (Test-Path -LiteralPath $superplanCommandPath -PathType Leaf)) {
    Fail "superplan binary was not installed to $installBinDir"
  }

  if ($script:UsingBundledNodeRuntime) {
    Say 'Rewriting Windows Superplan launchers to use the bundled Node runtime'
    Write-SuperplanWindowsShims -InstallBinDir $installBinDir
    $superplanCommandPath = Join-Path $installBinDir 'superplan.cmd'
  }

  if (-not [string]::IsNullOrWhiteSpace($SuperplanOverlaySourcePath)) {
    Say 'Installing Superplan overlay companion'
    Install-OverlayCompanion
  }

  Run-MachineSetup -SuperplanCommandPath $superplanCommandPath

  $installStateDir = Join-Path $HOME '.config\superplan'
  $installStatePath = Join-Path $installStateDir 'install.json'
  $installMethod = if ([string]::IsNullOrWhiteSpace($SuperplanSourceDir)) { 'remote_repo' } else { 'local_source' }

  New-Item -ItemType Directory -Force -Path $installStateDir | Out-Null

  $metadata = [ordered]@{
    install_method = $installMethod
    repo_url = $SuperplanRepoUrl
    ref = $SuperplanResolvedRef
    install_prefix = $installPrefix
    install_bin = $installBinDir
    installed_at = (Get-Date).ToUniversalTime().ToString('o')
    platform = 'windows'
    setup_completed = $SetupCompleted
  }

  if (-not [string]::IsNullOrWhiteSpace($SuperplanInstallPrefix)) {
    $metadata.requested_install_prefix = $SuperplanInstallPrefix
  }

  if (-not [string]::IsNullOrWhiteSpace($SuperplanSourceDir)) {
    $metadata.source_dir = $SuperplanSourceDir
  }

  if (-not [string]::IsNullOrWhiteSpace($OverlayInstallMethod) -and -not [string]::IsNullOrWhiteSpace($OverlayInstallPath)) {
    $metadata.overlay = [ordered]@{
      install_method = $OverlayInstallMethod
      source_path = if (-not [string]::IsNullOrWhiteSpace($SuperplanOverlaySourcePath)) { $SuperplanOverlaySourcePath } else { $null }
      asset_name = if (-not [string]::IsNullOrWhiteSpace($OverlayArtifactName)) { $OverlayArtifactName } else { $null }
      release_base_url = if (-not [string]::IsNullOrWhiteSpace($SuperplanOverlayReleaseBaseUrl)) { $SuperplanOverlayReleaseBaseUrl } else { $null }
      install_dir = $SuperplanOverlayInstallDir
      install_path = $OverlayInstallPath
      executable_path = $OverlayExecutablePath
      platform = $OverlayPlatform
      arch = $OverlayArch
      installed_at = (Get-Date).ToUniversalTime().ToString('o')
    }
  }

  $metadata | ConvertTo-Json -Depth 8 | Set-Content -Path $installStatePath -Encoding utf8

  Say "Installed Superplan to $superplanCommandPath"
  if (-not [string]::IsNullOrWhiteSpace($OverlayInstallPath)) {
    Say "Installed Superplan overlay to $OverlayInstallPath"
  }

  $pathEntries = ($env:PATH -split ';') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  $installDirOnPath = $false
  foreach ($entry in $pathEntries) {
    if ((To-Lower $entry.TrimEnd('\')) -eq (To-Lower $installBinDir.TrimEnd('\'))) {
      $installDirOnPath = $true
      break
    }
  }

  if (-not $installDirOnPath) {
    Say ''
    Say "NOTE: $installBinDir is not on your PATH."
    Say 'Add it through Windows Environment Variables, then open a new shell.'
  }

  if ($SetupCompleted) {
    Say "Superplan setup completed in $OriginalLocation"
  } else {
    Show-InstallSuccess
    Say 'Please cd into your favorite repo and run: superplan init'
  }

  Say 'Run: superplan --version'
} finally {
  Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}

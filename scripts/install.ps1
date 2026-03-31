$ErrorActionPreference = 'Stop'

$SuperplanRepoUrl = if ($env:SUPERPLAN_REPO_URL) { $env:SUPERPLAN_REPO_URL } else { 'https://github.com/superplan-md/cli.git' }
$SuperplanRef = if ($env:SUPERPLAN_REF) { $env:SUPERPLAN_REF } else { '' }
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

  try {
    & $Command *> $logPath
    if ($LASTEXITCODE -ne 0) {
      if (Test-Path -LiteralPath $logPath) {
        Get-Content -Path $logPath
      }
      Fail "$Label failed"
    }
  } finally {
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

  $overlayScriptPath = Join-Path $SourceWorktree 'scripts/overlay-release.js'
  $targetJson = & node $overlayScriptPath target --platform win32 --arch $env:PROCESSOR_ARCHITECTURE 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($targetJson)) {
    Fail 'failed to resolve packaged overlay target for Windows'
  }

  $parsed = $targetJson | ConvertFrom-Json
  $script:OverlayPlatform = [string] $parsed.platform
  $script:OverlayArch = [string] $parsed.arch
  $script:OverlayArtifactName = [string] $parsed.artifactName
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
    Fail "failed to download overlay companion for $script:OverlayPlatform/$script:OverlayArch from $downloadUrl"
  }

  $script:SuperplanOverlaySourcePath = $downloadPath
  $script:OverlayInstallMethod = 'downloaded_prebuilt'
  return $true
}

function Install-OverlayCompanion {
  if ([string]::IsNullOrWhiteSpace($SuperplanOverlaySourcePath)) {
    return
  }

  if (-not (Test-Path -LiteralPath $SuperplanOverlaySourcePath -PathType Leaf)) {
    Fail "SUPERPLAN_OVERLAY_SOURCE_PATH does not exist: $SuperplanOverlaySourcePath"
  }

  New-Item -ItemType Directory -Force -Path $SuperplanOverlayInstallDir | Out-Null
  $overlayName = Split-Path -Path $SuperplanOverlaySourcePath -Leaf
  $script:OverlayInstallPath = Join-Path $SuperplanOverlayInstallDir $overlayName

  Remove-Item -LiteralPath $script:OverlayInstallPath -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $SuperplanOverlaySourcePath -Destination $script:OverlayInstallPath -Force
  $script:OverlayExecutablePath = $script:OverlayInstallPath
}

function Ensure-WritablePrefix {
  if (-not [string]::IsNullOrWhiteSpace($SuperplanInstallPrefix)) {
    $script:env:npm_config_prefix = $SuperplanInstallPrefix
    return
  }

  $currentPrefix = (& npm prefix --global).Trim()
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
  $script:env:npm_config_prefix = $fallbackPrefix
  $script:SuperplanInstallPrefix = $fallbackPrefix
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

Require-Command node
Require-Command npm

if ([string]::IsNullOrWhiteSpace($SuperplanSourceDir)) {
  Require-Command git
}

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("superplan-install-" + [Guid]::NewGuid().ToString('N'))
$sourceWorktree = Join-Path $workDir 'source'

New-Item -ItemType Directory -Force -Path $workDir | Out-Null

try {
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
    Say "Cloning Superplan from $SuperplanRepoUrl"
    & git clone $SuperplanRepoUrl $sourceWorktree | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Fail "failed to clone repository: $SuperplanRepoUrl"
    }

    Push-Location $sourceWorktree
    try {
      & git checkout $SuperplanResolvedRef | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Fail "failed to check out ref: $SuperplanResolvedRef"
      }
    } finally {
      Pop-Location
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
      Invoke-QuietCommand -Label 'npm-install' -Command { npm install }
    } else {
      Say 'Using existing node_modules from source snapshot'
    }

    Say 'Building Superplan'
    Invoke-QuietCommand -Label 'npm-build' -Command { npm run build }

    if (-not [string]::IsNullOrWhiteSpace($SuperplanSourceDir)) {
      Say 'Packing Superplan from local source snapshot'
    } else {
      Say 'Packing Superplan'
    }

    $packLogPath = Join-Path $workDir 'npm-pack.log'
    try {
      $packageTgz = (& npm pack --silent 2>$packLogPath).Trim().Split([Environment]::NewLine, [System.StringSplitOptions]::RemoveEmptyEntries)[-1]
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
    Invoke-QuietCommand -Label 'npm-global-install' -Command { npm install --global (Join-Path $sourceWorktree $packageTgz) }
  } finally {
    Pop-Location
  }

  $installPrefix = (& npm prefix --global).Trim()
  $installBinDir = $installPrefix
  $superplanCommandPath = Join-Path $installBinDir 'superplan.cmd'

  if (-not (Test-Path -LiteralPath $superplanCommandPath -PathType Leaf)) {
    $superplanCommandPath = Join-Path $installBinDir 'superplan'
  }

  if (-not (Test-Path -LiteralPath $superplanCommandPath -PathType Leaf)) {
    Fail "superplan binary was not installed to $installBinDir"
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

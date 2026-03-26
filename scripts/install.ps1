$ErrorActionPreference = 'Stop'

$SuperplanRepoUrl = if ($env:SUPERPLAN_REPO_URL) { $env:SUPERPLAN_REPO_URL } else { 'https://github.com/superplan-md/superplan-plugin.git' }
$SuperplanRef = if ($env:SUPERPLAN_REF) { $env:SUPERPLAN_REF } else { '' }
$SuperplanSourceDir = if ($env:SUPERPLAN_SOURCE_DIR) { $env:SUPERPLAN_SOURCE_DIR } else { '' }
$SuperplanInstallPrefix = if ($env:SUPERPLAN_INSTALL_PREFIX) { $env:SUPERPLAN_INSTALL_PREFIX } else { '' }
$SuperplanRunSetupAfterInstall = if ($env:SUPERPLAN_RUN_SETUP_AFTER_INSTALL) { $env:SUPERPLAN_RUN_SETUP_AFTER_INSTALL } else { '1' }
$SuperplanResolvedRef = ''

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
    (Join-Path $SourceDir 'apps/overlay-desktop/node_modules'),
    (Join-Path $SourceDir 'apps/overlay-desktop/src-tauri/target')
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
    $script:SuperplanResolvedRef = 'main'
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

function Run-MachineSetup {
  param([string] $SuperplanCommandPath)

  if ($SuperplanRunSetupAfterInstall -ne '1') {
    return
  }

  Say 'Configuring Superplan on this machine'
  & $SuperplanCommandPath init --yes --json | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Fail 'machine install failed after binary installation'
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

  Push-Location $sourceWorktree
  try {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceWorktree 'node_modules') -PathType Container)) {
      Say 'Installing dependencies'
      & npm install | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Fail 'npm install failed'
      }
    } else {
      Say 'Using existing node_modules from source snapshot'
    }

    Say 'Building Superplan'
    & npm run build | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Fail 'npm run build failed'
    }

    if (-not [string]::IsNullOrWhiteSpace($SuperplanSourceDir)) {
      Say 'Packing Superplan from local source snapshot'
    } else {
      Say 'Packing Superplan'
    }

    $packageTgz = (& npm pack).Trim().Split([Environment]::NewLine, [System.StringSplitOptions]::RemoveEmptyEntries)[-1]
    if ([string]::IsNullOrWhiteSpace($packageTgz)) {
      Fail 'npm pack did not return an archive path'
    }

    Say 'Installing Superplan globally with npm'
    & npm install --global (Join-Path $sourceWorktree $packageTgz) | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Fail 'global npm install failed'
    }
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
    setup_completed = ($SuperplanRunSetupAfterInstall -eq '1')
  }

  if (-not [string]::IsNullOrWhiteSpace($SuperplanInstallPrefix)) {
    $metadata.requested_install_prefix = $SuperplanInstallPrefix
  }

  if (-not [string]::IsNullOrWhiteSpace($SuperplanSourceDir)) {
    $metadata.source_dir = $SuperplanSourceDir
  }

  $metadata | ConvertTo-Json -Depth 8 | Set-Content -Path $installStatePath -Encoding utf8

  Say "Installed Superplan to $superplanCommandPath"
  Say 'Windows installer note: the desktop overlay companion is not packaged by this script yet.'

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

  Say 'Run: superplan --version'
  Say 'Then run: superplan init inside a repository to start using Superplan'
} finally {
  Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}

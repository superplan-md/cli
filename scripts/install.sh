#!/bin/sh

set -eu

# Curl-friendly installer for Superplan CLI.
# Default behavior:
# 1. clone the repo into a temporary directory
# 2. install dependencies when needed
# 3. build the CLI
# 4. install it globally through npm
#
# Optional environment variables:
# - SUPERPLAN_REPO_URL: git repository to install from
# - SUPERPLAN_REF: git ref to check out after clone
# - SUPERPLAN_SOURCE_DIR: local source directory to copy instead of cloning
# - SUPERPLAN_INSTALL_PREFIX: custom npm global prefix for the install
# - SUPERPLAN_OVERLAY_SOURCE_PATH: prebuilt overlay bundle or executable to install
# - SUPERPLAN_OVERLAY_RELEASE_BASE_URL: base URL that hosts packaged overlay artifacts
# - SUPERPLAN_OVERLAY_INSTALL_DIR: install directory for the overlay bundle or executable
# - SUPERPLAN_ENABLE_OVERLAY: yes/no override for machine-default overlay behavior
# - SUPERPLAN_RUN_SETUP_AFTER_INSTALL: 1 to run `superplan init` in the launch directory, 0 to skip it

SUPERPLAN_REPO_URL="${SUPERPLAN_REPO_URL:-https://github.com/superplan-md/superplan-plugin.git}"
SUPERPLAN_REF="${SUPERPLAN_REF:-}"
SUPERPLAN_SOURCE_DIR="${SUPERPLAN_SOURCE_DIR:-}"
SUPERPLAN_INSTALL_PREFIX="${SUPERPLAN_INSTALL_PREFIX:-}"
SUPERPLAN_OVERLAY_SOURCE_PATH="${SUPERPLAN_OVERLAY_SOURCE_PATH:-}"
SUPERPLAN_OVERLAY_RELEASE_BASE_URL="${SUPERPLAN_OVERLAY_RELEASE_BASE_URL:-}"
SUPERPLAN_OVERLAY_INSTALL_DIR="${SUPERPLAN_OVERLAY_INSTALL_DIR:-${HOME}/.local/share/superplan/overlay}"
SUPERPLAN_ENABLE_OVERLAY="${SUPERPLAN_ENABLE_OVERLAY:-1}"
SUPERPLAN_RUN_SETUP_AFTER_INSTALL="${SUPERPLAN_RUN_SETUP_AFTER_INSTALL-}"
SUPERPLAN_RESOLVED_REF=""
SUPERPLAN_OVERLAY_REF=""
SETUP_COMPLETED="0"

OVERLAY_INSTALL_METHOD=""
OVERLAY_INSTALL_PATH=""
OVERLAY_EXECUTABLE_PATH=""
OVERLAY_EXECUTABLE_RELATIVE_PATH=""
OVERLAY_DOWNLOAD_URL=""
OVERLAY_ARTIFACT_NAME=""
OVERLAY_ARTIFACT_KIND=""
OVERLAY_PLATFORM=""
OVERLAY_ARCH=""

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "missing required command: $1"
  fi
}

require_command node
require_command npm
require_command mktemp

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/superplan-install-XXXXXX")"
SOURCE_WORKTREE="$WORK_DIR/source"
DOWNLOADED_OVERLAY_PATH=""
ORIGINAL_CWD="$(pwd)"

cleanup() {
  rm -rf "$WORK_DIR"
}

trap cleanup EXIT INT TERM

to_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

print_install_success() {
  if [ -t 1 ]; then
    printf '\033[32mInstallation successful.\033[0m\n'
  else
    say "Installation successful."
  fi
}

run_quiet_command() {
  label="$1"
  shift
  log_path="$WORK_DIR/${label}.log"
  if "$@" >"$log_path" 2>&1; then
    rm -f "$log_path"
    return 0
  fi

  cat "$log_path" >&2
  fail "$label failed"
}

copy_local_source_snapshot() {
  require_command tar
  mkdir -p "$SOURCE_WORKTREE"

  (
    cd "$SUPERPLAN_SOURCE_DIR"
    tar \
      --exclude '.git' \
      --exclude 'node_modules' \
      --exclude 'apps/desktop/node_modules' \
      --exclude 'apps/desktop/dist' \
      -cf - .
  ) | (
    cd "$SOURCE_WORKTREE"
    tar -xf -
  ) || fail "failed to copy local source snapshot from $SUPERPLAN_SOURCE_DIR"
}

resolve_overlay_release_target() {
  overlay_target="$(
    node - "$SOURCE_WORKTREE/scripts/overlay-release.js" "$(uname -s)" "$(uname -m)" <<'EOF'
const overlayRelease = require(process.argv[2]);

function normalizeShellPlatform(rawPlatform) {
  const value = String(rawPlatform).toLowerCase();
  if (value === 'darwin' || value === 'macos') {
    return 'darwin';
  }

  if (value === 'linux') {
    return 'linux';
  }

  throw new Error(`unsupported overlay platform: ${rawPlatform}`);
}

function normalizeShellArch(rawArch) {
  const value = String(rawArch).toLowerCase();
  if (value === 'arm64' || value === 'aarch64') {
    return 'arm64';
  }

  if (value === 'x64' || value === 'x86_64' || value === 'amd64') {
    return 'x64';
  }

  throw new Error(`unsupported overlay arch: ${rawArch}`);
}

const target = overlayRelease.getOverlayReleaseTarget(
  normalizeShellPlatform(process.argv[3]),
  normalizeShellArch(process.argv[4]),
);

process.stdout.write(`${target.platform}\n${target.arch}\n${target.artifactName}\n${target.artifactKind}\n`);
EOF
  )" || fail "failed to resolve packaged overlay target for this platform"

  OVERLAY_PLATFORM="$(printf '%s\n' "$overlay_target" | sed -n '1p')"
  OVERLAY_ARCH="$(printf '%s\n' "$overlay_target" | sed -n '2p')"
  OVERLAY_ARTIFACT_NAME="$(printf '%s\n' "$overlay_target" | sed -n '3p')"
  OVERLAY_ARTIFACT_KIND="$(printf '%s\n' "$overlay_target" | sed -n '4p')"
}

resolve_latest_release_tag_from_github() {
  node - "$SUPERPLAN_REPO_URL" <<'EOF'
const https = require('node:https');

function parseGitHubRepo(repoUrl) {
  const sshMatch = String(repoUrl).match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  try {
    const parsedUrl = new URL(String(repoUrl));
    if (parsedUrl.hostname !== 'github.com') {
      return null;
    }

    const segments = parsedUrl.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (segments.length < 2) {
      return null;
    }

    return {
      owner: segments[0],
      repo: segments[1].replace(/\.git$/i, ''),
    };
  } catch {
    return null;
  }
}

const parsedRepo = parseGitHubRepo(process.argv[2]);
if (!parsedRepo) {
  process.exit(2);
}

const request = https.get({
  hostname: 'api.github.com',
  path: `/repos/${parsedRepo.owner}/${parsedRepo.repo}/releases/latest`,
  headers: {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'superplan-install',
  },
}, response => {
  let body = '';
  response.setEncoding('utf8');
  response.on('data', chunk => {
    body += chunk;
  });
  response.on('end', () => {
    if ((response.statusCode ?? 500) >= 400) {
      console.error(`GitHub latest release lookup failed with status ${response.statusCode}`);
      process.exit(1);
      return;
    }

    try {
      const parsed = JSON.parse(body);
      const tag = String(parsed.tag_name || '').trim();
      if (!tag) {
        throw new Error('GitHub latest release response was missing tag_name');
      }
      process.stdout.write(tag);
    } catch (error) {
      console.error(error.message || String(error));
      process.exit(1);
    }
  });
});

request.on('error', error => {
  console.error(error.message || String(error));
  process.exit(1);
});
EOF
}

resolve_install_ref() {
  if [ -n "$SUPERPLAN_REF" ]; then
    SUPERPLAN_RESOLVED_REF="$SUPERPLAN_REF"
    return 0
  fi

  if [ -n "$SUPERPLAN_SOURCE_DIR" ]; then
    SUPERPLAN_RESOLVED_REF="dev"
    return 0
  fi

  latest_release_tag="$(resolve_latest_release_tag_from_github)" || latest_lookup_status=$?
  latest_lookup_status="${latest_lookup_status:-0}"

  if [ "$latest_lookup_status" -eq 0 ] && [ -n "$latest_release_tag" ]; then
    SUPERPLAN_RESOLVED_REF="$latest_release_tag"
    say "Resolved latest Superplan release: $SUPERPLAN_RESOLVED_REF"
    return 0
  fi

  SUPERPLAN_RESOLVED_REF="main"
  say "No release tag found; defaulting Superplan source to $SUPERPLAN_RESOLVED_REF"
}

resolve_overlay_ref() {
  if [ -n "$SUPERPLAN_REF" ]; then
    SUPERPLAN_OVERLAY_REF="$SUPERPLAN_REF"
    return 0
  fi

  latest_release_tag="$(resolve_latest_release_tag_from_github)" || latest_lookup_status=$?
  latest_lookup_status="${latest_lookup_status:-0}"

  if [ "$latest_lookup_status" -eq 0 ] && [ -n "$latest_release_tag" ]; then
    SUPERPLAN_OVERLAY_REF="$latest_release_tag"
    say "Resolved latest Superplan overlay release: $SUPERPLAN_OVERLAY_REF"
    return 0
  fi

  # Fallback to main if no release found
  SUPERPLAN_OVERLAY_REF="main"
  say "No release tag found; defaulting overlay ref to $SUPERPLAN_OVERLAY_REF"
}

resolve_overlay_release_base_url() {
  if [ -n "$SUPERPLAN_OVERLAY_RELEASE_BASE_URL" ]; then
    return 0
  fi

  SUPERPLAN_OVERLAY_RELEASE_BASE_URL="${SUPERPLAN_REPO_URL%.git}/releases/download/${SUPERPLAN_OVERLAY_REF}"
}

resolve_packaged_overlay_source() {
  if [ -n "$SUPERPLAN_OVERLAY_SOURCE_PATH" ]; then
    OVERLAY_INSTALL_METHOD="copied_prebuilt"
    return 0
  fi

  local_artifact_path="$SOURCE_WORKTREE/dist/release/overlay/$OVERLAY_ARTIFACT_NAME"
  if [ -f "$local_artifact_path" ]; then
    SUPERPLAN_OVERLAY_SOURCE_PATH="$local_artifact_path"
    OVERLAY_INSTALL_METHOD="copied_prebuilt"
    return 0
  fi

  if [ -n "$SUPERPLAN_SOURCE_DIR" ]; then
    local_desktop_dist="$SOURCE_WORKTREE/apps/desktop/dist"
    local_desktop_source=""

    if [ "$OVERLAY_PLATFORM" = "darwin" ] && [ -d "$local_desktop_dist" ]; then
      local_desktop_source="$(find "$local_desktop_dist" -maxdepth 2 -type d -name 'Superplan.app' | sort | head -n 1)"
    elif [ "$OVERLAY_PLATFORM" = "linux" ] && [ -d "$local_desktop_dist" ]; then
      local_desktop_source="$(find "$local_desktop_dist" -maxdepth 1 -type f -name '*.AppImage' | sort | head -n 1)"
    fi

    if [ -n "$local_desktop_source" ] && [ -e "$local_desktop_source" ]; then
      SUPERPLAN_OVERLAY_SOURCE_PATH="$local_desktop_source"
      OVERLAY_INSTALL_METHOD="copied_prebuilt"
      return 0
    fi

    say "No packaged overlay artifact found in local source snapshot; continuing without the desktop companion"
    return 1
  fi

  require_command curl
  OVERLAY_DOWNLOAD_URL="${SUPERPLAN_OVERLAY_RELEASE_BASE_URL%/}/$OVERLAY_ARTIFACT_NAME"
  DOWNLOADED_OVERLAY_PATH="$WORK_DIR/$OVERLAY_ARTIFACT_NAME"
  say "Downloading Superplan overlay from $OVERLAY_DOWNLOAD_URL"
  if ! curl -fsSL "$OVERLAY_DOWNLOAD_URL" -o "$DOWNLOADED_OVERLAY_PATH"; then
    say "WARNING: Failed to download overlay companion for ${OVERLAY_PLATFORM}/${OVERLAY_ARCH} from $OVERLAY_DOWNLOAD_URL"
    DOWNLOADED_OVERLAY_PATH=""
    return 1
  fi

  SUPERPLAN_OVERLAY_SOURCE_PATH="$DOWNLOADED_OVERLAY_PATH"
  OVERLAY_INSTALL_METHOD="downloaded_prebuilt"
  return 0
}

resolve_overlay_executable_path() {
  install_path="$1"

  if [ -d "$install_path/Contents/MacOS" ]; then
    # Prefer the known Superplan bundle binary names before falling back to
    # an alphabetical find, which could accidentally pick a helper binary.
    for candidate in \
      "$install_path/Contents/MacOS/Superplan" \
      "$install_path/Contents/MacOS/Superplan Overlay Desktop" \
      "$install_path/Contents/MacOS/superplan-overlay-desktop"; do
      if [ -f "$candidate" ]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done
    # Fallback: first executable file found inside MacOS/
    find "$install_path/Contents/MacOS" -type f -perm -u+x 2>/dev/null | sort | head -n 1
    return 0
  fi

  if [ -f "$install_path" ]; then
    printf '%s\n' "$install_path"
    return 0
  fi

  find "$install_path" -maxdepth 2 -type f -perm -u+x 2>/dev/null | sort | head -n 1
}

list_overlay_process_ids() {
  target_executable_path="$1"
  [ -n "$target_executable_path" ] || return 0

  ps -axo pid=,command= 2>/dev/null | while IFS= read -r line; do
    pid="$(printf '%s\n' "$line" | sed -n 's/^[[:space:]]*\([0-9][0-9]*\)[[:space:]].*$/\1/p')"
    command_line="$(printf '%s\n' "$line" | sed -e 's/^[[:space:]]*[0-9][0-9]*[[:space:]]*//')"
    [ -n "$pid" ] || continue

    case "$command_line" in
      "$target_executable_path"|"$target_executable_path "*)
        printf '%s\n' "$pid"
        ;;
      "/bin/sh $target_executable_path"|"/bin/sh $target_executable_path "*)
        printf '%s\n' "$pid"
        ;;
      "sh $target_executable_path"|"sh $target_executable_path "*)
        printf '%s\n' "$pid"
        ;;
      "/bin/bash $target_executable_path"|"/bin/bash $target_executable_path "*)
        printf '%s\n' "$pid"
        ;;
      "bash $target_executable_path"|"bash $target_executable_path "*)
        printf '%s\n' "$pid"
        ;;
      "/bin/zsh $target_executable_path"|"/bin/zsh $target_executable_path "*)
        printf '%s\n' "$pid"
        ;;
      "zsh $target_executable_path"|"zsh $target_executable_path "*)
        printf '%s\n' "$pid"
        ;;
    esac
  done
}

stop_running_overlay_companion() {
  target_install_path="$1"
  [ -n "$target_install_path" ] || return 0
  [ -e "$target_install_path" ] || return 0

  target_executable_path="$(resolve_overlay_executable_path "$target_install_path")"
  [ -n "$target_executable_path" ] || return 0

  process_ids="$(list_overlay_process_ids "$target_executable_path")"
  [ -n "$process_ids" ] || return 0

  say "Stopping running Superplan overlay companion"
  for process_id in $process_ids; do
    kill "$process_id" 2>/dev/null || true
  done

  attempt=0
  while [ "$attempt" -lt 5 ]; do
    remaining_ids="$(list_overlay_process_ids "$target_executable_path")"
    [ -z "$remaining_ids" ] && return 0
    sleep 1
    attempt=$((attempt + 1))
  done

  remaining_ids="$(list_overlay_process_ids "$target_executable_path")"
  if [ -n "$remaining_ids" ]; then
    for process_id in $remaining_ids; do
      kill -9 "$process_id" 2>/dev/null || true
    done
  fi
}

install_overlay_companion() {
  if [ -z "$SUPERPLAN_OVERLAY_SOURCE_PATH" ]; then
    return 0
  fi

  [ -e "$SUPERPLAN_OVERLAY_SOURCE_PATH" ] || fail "SUPERPLAN_OVERLAY_SOURCE_PATH does not exist: $SUPERPLAN_OVERLAY_SOURCE_PATH"

  mkdir -p "$SUPERPLAN_OVERLAY_INSTALL_DIR"

  if printf '%s' "$SUPERPLAN_OVERLAY_SOURCE_PATH" | grep -Eq '\.tar\.gz$'; then
    require_command tar
    archive_root="$(
      tar -tzf "$SUPERPLAN_OVERLAY_SOURCE_PATH" \
        | sed -e 's#^\./##' -e '/^$/d' \
        | head -n 1 \
        | cut -d/ -f1
    )"
    [ -n "$archive_root" ] || fail "failed to determine overlay archive root from $SUPERPLAN_OVERLAY_SOURCE_PATH"
    OVERLAY_INSTALL_PATH="$SUPERPLAN_OVERLAY_INSTALL_DIR/$archive_root"
    stop_running_overlay_companion "$OVERLAY_INSTALL_PATH"
    rm -rf "$OVERLAY_INSTALL_PATH"
    tar -xzf "$SUPERPLAN_OVERLAY_SOURCE_PATH" -C "$SUPERPLAN_OVERLAY_INSTALL_DIR"
  else
    overlay_name="$(basename "$SUPERPLAN_OVERLAY_SOURCE_PATH")"
    OVERLAY_INSTALL_PATH="$SUPERPLAN_OVERLAY_INSTALL_DIR/$overlay_name"
    stop_running_overlay_companion "$OVERLAY_INSTALL_PATH"
    rm -rf "$OVERLAY_INSTALL_PATH"
    cp -R "$SUPERPLAN_OVERLAY_SOURCE_PATH" "$OVERLAY_INSTALL_PATH"
  fi

  OVERLAY_EXECUTABLE_PATH="$(resolve_overlay_executable_path "$OVERLAY_INSTALL_PATH")"
  [ -n "$OVERLAY_EXECUTABLE_PATH" ] || fail "failed to resolve overlay executable inside $OVERLAY_INSTALL_PATH"
  chmod +x "$OVERLAY_EXECUTABLE_PATH" 2>/dev/null || true

  # Bug H2 fix: compute the path of the binary RELATIVE to the install directory
  # so that overlay-companion.ts can re-resolve it when the absolute path
  # becomes stale (e.g. move, re-extract) without falling back to the unsafe
  # 'first executable in readdir' heuristic.
  OVERLAY_EXECUTABLE_RELATIVE_PATH="${OVERLAY_EXECUTABLE_PATH#"$OVERLAY_INSTALL_PATH/"}"
}

prompt_overlay_enabled_by_default() {
  override="$(to_lower "$SUPERPLAN_ENABLE_OVERLAY")"

  case "$override" in
    1|y|yes|true|on)
      return 0
      ;;
    0|n|no|false|off)
      return 1
      ;;
  esac

  if [ -r /dev/tty ]; then
    printf 'Enable desktop overlay by default on this machine? [Y/n] ' > /dev/tty
    IFS= read -r answer < /dev/tty || answer=""
  else
    answer=""
  fi

  answer="$(to_lower "$answer")"
  case "$answer" in
    ""|y|yes)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

prompt_run_setup_after_install() {
  if [ -n "$SUPERPLAN_RUN_SETUP_AFTER_INSTALL" ]; then
    case "$(to_lower "$SUPERPLAN_RUN_SETUP_AFTER_INSTALL")" in
      1|y|yes|true|on)
        return 0
        ;;
      0|n|no|false|off)
        return 1
        ;;
    esac
  fi

  if [ -r /dev/tty ]; then
    printf 'Run `superplan init` in %s now? [Y/n] ' "$ORIGINAL_CWD" > /dev/tty
    IFS= read -r answer < /dev/tty || answer=""
    case "$(to_lower "$answer")" in
      ""|y|yes)
        return 0
        ;;
      *)
        return 1
        ;;
    esac
  fi

  return 1
}

run_machine_setup() {
  if ! prompt_run_setup_after_install; then
    return 1
  fi

  say "Running superplan init in $ORIGINAL_CWD"
  (
    cd "$ORIGINAL_CWD"
    "$INSTALL_BIN_DIR/superplan" init --yes --json > /dev/null
  ) || fail "superplan init failed after binary installation"
  SETUP_COMPLETED="1"

  # Bug H1 fix: only enable the overlay preference when the overlay was actually
  # installed. Previously this ran unconditionally, which wrote
  # 'overlay.enabled = true' to config.toml even when the download failed —
  # causing every subsequent 'superplan run' to silently not show the overlay.
  if [ -n "$OVERLAY_INSTALL_PATH" ]; then
    if prompt_overlay_enabled_by_default; then
      say "Enabling desktop overlay by default"
      "$INSTALL_BIN_DIR/superplan" overlay enable --global --json > /dev/null \
        || fail "failed to enable overlay by default"
    else
      say "Leaving desktop overlay disabled by default"
      "$INSTALL_BIN_DIR/superplan" overlay disable --global --json > /dev/null \
        || fail "failed to persist overlay preference"
    fi
  else
    say "Overlay not installed; skipping overlay preference setup"
  fi

  return 0
}

if [ -n "$SUPERPLAN_INSTALL_PREFIX" ]; then
  export npm_config_prefix="$SUPERPLAN_INSTALL_PREFIX"
fi

# On Linux the default npm global prefix is typically /usr/local which
# requires root.  When no explicit prefix was requested, detect this and
# fall back to $HOME/.local so the install succeeds without sudo.
ensure_writable_prefix() {
  # Skip when the user already chose a prefix.
  [ -z "$SUPERPLAN_INSTALL_PREFIX" ] || return 0

  _current_prefix="$(npm prefix --global 2>/dev/null)" || return 0

  if [ -w "$_current_prefix" ] && [ -w "${_current_prefix}/bin" ] 2>/dev/null; then
    return 0
  fi

  _fallback_prefix="${HOME}/.local"
  say "Default npm global prefix ($_current_prefix) is not writable."
  say "Falling back to $_fallback_prefix (no sudo required)."
  export npm_config_prefix="$_fallback_prefix"
  SUPERPLAN_INSTALL_PREFIX="$_fallback_prefix"
  mkdir -p "$_fallback_prefix/bin" "$_fallback_prefix/lib" 2>/dev/null || true
}

ensure_writable_prefix

resolve_install_ref
resolve_overlay_ref
resolve_overlay_release_base_url

if [ -n "$SUPERPLAN_SOURCE_DIR" ]; then
  [ -d "$SUPERPLAN_SOURCE_DIR" ] || fail "SUPERPLAN_SOURCE_DIR does not exist: $SUPERPLAN_SOURCE_DIR"
  say "Copying Superplan source from $SUPERPLAN_SOURCE_DIR"
  copy_local_source_snapshot
else
  require_command git
  say "Cloning Superplan from $SUPERPLAN_REPO_URL"
  git clone "$SUPERPLAN_REPO_URL" "$SOURCE_WORKTREE" >/dev/null 2>&1
  (
    cd "$SOURCE_WORKTREE"
    git checkout "$SUPERPLAN_RESOLVED_REF" >/dev/null 2>&1
  ) || fail "failed to check out ref: $SUPERPLAN_RESOLVED_REF"
fi

[ -f "$SOURCE_WORKTREE/package.json" ] || fail "package.json not found in installer worktree"
resolve_overlay_release_target
if ! resolve_packaged_overlay_source; then
  say "WARNING: Could not find or download the Superplan overlay companion for ${OVERLAY_PLATFORM:-unknown}/${OVERLAY_ARCH:-unknown}."
  say "The CLI will be installed without the desktop overlay. You can install it manually later."
fi

cd "$SOURCE_WORKTREE"

if [ ! -d node_modules ]; then
  say "Installing dependencies"
  run_quiet_command npm-install npm install
else
  say "Using existing node_modules from source snapshot"
fi

say "Building Superplan"
run_quiet_command npm-build npm run build

INSTALL_PREFIX="$(npm prefix --global)"
INSTALL_BIN_DIR="$INSTALL_PREFIX/bin"

if [ -n "$SUPERPLAN_SOURCE_DIR" ]; then
  say "Packing Superplan from local source snapshot"
else
  say "Packing Superplan"
fi
PACK_LOG_PATH="$WORK_DIR/npm-pack.log"
PACKAGE_TGZ="$(npm pack --silent 2>"$PACK_LOG_PATH")" || {
  cat "$PACK_LOG_PATH" >&2
  fail "npm-pack failed"
}
rm -f "$PACK_LOG_PATH"

say "Installing Superplan globally with npm"
run_quiet_command npm-global-install npm install --global "$SOURCE_WORKTREE/$PACKAGE_TGZ"

if [ -n "$SUPERPLAN_OVERLAY_SOURCE_PATH" ]; then
  say "Installing Superplan overlay companion"
  install_overlay_companion
fi

if [ ! -x "$INSTALL_BIN_DIR/superplan" ]; then
  fail "superplan binary was not installed to $INSTALL_BIN_DIR"
fi

say "Installed Superplan to $INSTALL_BIN_DIR/superplan"
if [ -n "$OVERLAY_INSTALL_PATH" ]; then
  say "Installed Superplan overlay to $OVERLAY_INSTALL_PATH"
fi

# PATH guidance: warn the user if the install bin dir is not on PATH.
case ":$PATH:" in
  *":$INSTALL_BIN_DIR:"*)
    ;;
  *)
    say ""
    say "NOTE: $INSTALL_BIN_DIR is not on your PATH."
    say "Add it by running one of:"
    say ""
    say "  echo 'export PATH=\"$INSTALL_BIN_DIR:\$PATH\"' >> ~/.bashrc   # bash"
    say "  echo 'export PATH=\"$INSTALL_BIN_DIR:\$PATH\"' >> ~/.zshrc    # zsh"
    say ""
    say "Then restart your shell or run:  source ~/.bashrc"
    ;;
esac

# Ask about running superplan init after install details are shown, but before
# persisting install metadata so setup cannot overwrite the shell install record.
run_machine_setup || true

INSTALL_STATE_DIR="${HOME}/.config/superplan"
INSTALL_STATE_PATH="$INSTALL_STATE_DIR/install.json"
INSTALL_METHOD="remote_repo"

if [ -n "$SUPERPLAN_SOURCE_DIR" ]; then
  INSTALL_METHOD="local_source"
fi

mkdir -p "$INSTALL_STATE_DIR"
node - "$INSTALL_STATE_PATH" "$INSTALL_METHOD" "$SUPERPLAN_REPO_URL" "$SUPERPLAN_RESOLVED_REF" "$SUPERPLAN_INSTALL_PREFIX" "$INSTALL_PREFIX" "$INSTALL_BIN_DIR" "$SUPERPLAN_SOURCE_DIR" "$SUPERPLAN_OVERLAY_SOURCE_PATH" "$SUPERPLAN_OVERLAY_RELEASE_BASE_URL" "$SUPERPLAN_OVERLAY_INSTALL_DIR" "$OVERLAY_INSTALL_METHOD" "$OVERLAY_INSTALL_PATH" "$OVERLAY_EXECUTABLE_PATH" "$OVERLAY_EXECUTABLE_RELATIVE_PATH" "$OVERLAY_ARTIFACT_NAME" "$OVERLAY_PLATFORM" "$OVERLAY_ARCH" "$SETUP_COMPLETED" <<'EOF'
const fs = require('node:fs');

const [
  installStatePath,
  installMethod,
  repoUrl,
  ref,
  requestedPrefix,
  installPrefix,
  installBinDir,
  sourceDir,
  overlaySourcePath,
  overlayReleaseBaseUrl,
  overlayInstallDir,
  overlayInstallMethod,
  overlayInstallPath,
  overlayExecutablePath,
  overlayExecutableRelativePath,
  overlayAssetName,
  overlayPlatform,
  overlayArch,
  setupCompleted,
] = process.argv.slice(2);

const metadata = {
  install_method: installMethod,
  repo_url: repoUrl,
  ref,
  install_prefix: installPrefix,
  install_bin: installBinDir,
  installed_at: new Date().toISOString(),
};

if (requestedPrefix) {
  metadata.requested_install_prefix = requestedPrefix;
}

if (sourceDir) {
  metadata.source_dir = sourceDir;
}

if (overlayInstallMethod && overlayInstallPath) {
  metadata.overlay = {
    install_method: overlayInstallMethod,
    source_path: overlaySourcePath || undefined,
    asset_name: overlayAssetName || undefined,
    release_base_url: overlayReleaseBaseUrl || undefined,
    install_dir: overlayInstallDir || undefined,
    install_path: overlayInstallPath,
    executable_path: overlayExecutablePath || undefined,
    // Bug H2: relative path enables stale-path recovery without readdir heuristics
    executable_relative_path: overlayExecutableRelativePath || undefined,
    platform: overlayPlatform || undefined,
    arch: overlayArch || undefined,
    installed_at: new Date().toISOString(),
  };
}

if (setupCompleted) {
  metadata.setup_completed = setupCompleted === '1';
}

fs.writeFileSync(installStatePath, JSON.stringify(metadata, null, 2));
EOF

if [ "$SETUP_COMPLETED" = "1" ]; then
  say "Superplan setup completed in $ORIGINAL_CWD"
else
  print_install_success
  say "Please cd into your favorite repo and run: superplan init"
fi
say "Run: superplan --version"
say ""

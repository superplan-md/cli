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
# - SUPERPLAN_RUN_SETUP_AFTER_INSTALL: 1 to run machine init after install, 0 to skip it

SUPERPLAN_REPO_URL="${SUPERPLAN_REPO_URL:-https://github.com/superplan-md/superplan-plugin.git}"
SUPERPLAN_REF="${SUPERPLAN_REF:-dev}"
SUPERPLAN_SOURCE_DIR="${SUPERPLAN_SOURCE_DIR:-}"
SUPERPLAN_INSTALL_PREFIX="${SUPERPLAN_INSTALL_PREFIX:-}"
SUPERPLAN_OVERLAY_SOURCE_PATH="${SUPERPLAN_OVERLAY_SOURCE_PATH:-}"
SUPERPLAN_OVERLAY_RELEASE_BASE_URL="${SUPERPLAN_OVERLAY_RELEASE_BASE_URL:-https://github.com/superplan-md/superplan-plugin/releases/download/${SUPERPLAN_REF}}"
SUPERPLAN_OVERLAY_INSTALL_DIR="${SUPERPLAN_OVERLAY_INSTALL_DIR:-${HOME}/.local/share/superplan/overlay}"
SUPERPLAN_ENABLE_OVERLAY="${SUPERPLAN_ENABLE_OVERLAY:-1}"
SUPERPLAN_RUN_SETUP_AFTER_INSTALL="${SUPERPLAN_RUN_SETUP_AFTER_INSTALL:-1}"

OVERLAY_INSTALL_METHOD=""
OVERLAY_INSTALL_PATH=""
OVERLAY_EXECUTABLE_PATH=""
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

cleanup() {
  rm -rf "$WORK_DIR"
}

trap cleanup EXIT INT TERM

to_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

copy_local_source_snapshot() {
  require_command tar
  mkdir -p "$SOURCE_WORKTREE"

  (
    cd "$SUPERPLAN_SOURCE_DIR"
    tar \
      --exclude '.git' \
      --exclude 'node_modules' \
      --exclude 'apps/overlay-desktop/node_modules' \
      --exclude 'apps/overlay-desktop/src-tauri/target' \
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
    say "No packaged overlay artifact found in local source snapshot; continuing without the desktop companion"
    return 1
  fi

  require_command curl
  OVERLAY_DOWNLOAD_URL="${SUPERPLAN_OVERLAY_RELEASE_BASE_URL%/}/$OVERLAY_ARTIFACT_NAME"
  DOWNLOADED_OVERLAY_PATH="$WORK_DIR/$OVERLAY_ARTIFACT_NAME"
  say "Downloading Superplan overlay from $OVERLAY_DOWNLOAD_URL"
  if ! curl -fsSL "$OVERLAY_DOWNLOAD_URL" -o "$DOWNLOADED_OVERLAY_PATH"; then
    fail "failed to download overlay companion for ${OVERLAY_PLATFORM}/${OVERLAY_ARCH} from $OVERLAY_DOWNLOAD_URL"
  fi

  SUPERPLAN_OVERLAY_SOURCE_PATH="$DOWNLOADED_OVERLAY_PATH"
  OVERLAY_INSTALL_METHOD="downloaded_prebuilt"
  return 0
}

resolve_overlay_executable_path() {
  install_path="$1"

  if [ -d "$install_path/Contents/MacOS" ]; then
    # Prefer the canonical Tauri binary names before falling back to
    # an alphabetical find, which could accidentally pick a helper binary.
    for candidate in \
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

run_machine_setup() {
  if [ "$SUPERPLAN_RUN_SETUP_AFTER_INSTALL" != "1" ]; then
    return 0
  fi

  say "Configuring Superplan on this machine"
  "$INSTALL_BIN_DIR/superplan" init --scope global --quiet --json >/dev/null \
    || fail "machine init failed after install"

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
}

if [ -n "$SUPERPLAN_INSTALL_PREFIX" ]; then
  export npm_config_prefix="$SUPERPLAN_INSTALL_PREFIX"
fi

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
    git checkout "$SUPERPLAN_REF" >/dev/null 2>&1
  ) || fail "failed to check out ref: $SUPERPLAN_REF"
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
  npm install >/dev/null
else
  say "Using existing node_modules from source snapshot"
fi

say "Building Superplan"
npm run build >/dev/null

INSTALL_PREFIX="$(npm prefix --global)"
INSTALL_BIN_DIR="$INSTALL_PREFIX/bin"

if [ -n "$SUPERPLAN_SOURCE_DIR" ]; then
  say "Packing Superplan from local source snapshot"
else
  say "Packing Superplan"
fi
PACKAGE_TGZ="$(npm pack)"

say "Installing Superplan globally with npm"
npm install --global "$SOURCE_WORKTREE/$PACKAGE_TGZ" >/dev/null

if [ -n "$SUPERPLAN_OVERLAY_SOURCE_PATH" ]; then
  say "Installing Superplan overlay companion"
  install_overlay_companion
fi

if [ ! -x "$INSTALL_BIN_DIR/superplan" ]; then
  fail "superplan binary was not installed to $INSTALL_BIN_DIR"
fi

run_machine_setup

INSTALL_STATE_DIR="${HOME}/.config/superplan"
INSTALL_STATE_PATH="$INSTALL_STATE_DIR/install.json"
INSTALL_METHOD="remote_repo"

if [ -n "$SUPERPLAN_SOURCE_DIR" ]; then
  INSTALL_METHOD="local_source"
fi

mkdir -p "$INSTALL_STATE_DIR"
node - "$INSTALL_STATE_PATH" "$INSTALL_METHOD" "$SUPERPLAN_REPO_URL" "$SUPERPLAN_REF" "$SUPERPLAN_INSTALL_PREFIX" "$INSTALL_PREFIX" "$INSTALL_BIN_DIR" "$SUPERPLAN_SOURCE_DIR" "$SUPERPLAN_OVERLAY_SOURCE_PATH" "$SUPERPLAN_OVERLAY_RELEASE_BASE_URL" "$SUPERPLAN_OVERLAY_INSTALL_DIR" "$OVERLAY_INSTALL_METHOD" "$OVERLAY_INSTALL_PATH" "$OVERLAY_EXECUTABLE_PATH" "$OVERLAY_EXECUTABLE_RELATIVE_PATH" "$OVERLAY_ARTIFACT_NAME" "$OVERLAY_PLATFORM" "$OVERLAY_ARCH" "$SUPERPLAN_RUN_SETUP_AFTER_INSTALL" <<'EOF'
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
  runSetupAfterInstall,
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

if (runSetupAfterInstall) {
  metadata.setup_completed = runSetupAfterInstall === '1';
}

fs.writeFileSync(installStatePath, JSON.stringify(metadata, null, 2));
EOF

say "Installed Superplan to $INSTALL_BIN_DIR/superplan"
if [ -n "$OVERLAY_INSTALL_PATH" ]; then
  say "Installed Superplan overlay to $OVERLAY_INSTALL_PATH"
fi
say "Run: superplan --version"
say "Then run: superplan init --quiet --json inside a repository to start using Superplan"

#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/anti20/ai-commit-helper.git"
INSTALL_DIR="$HOME/.ai-commit-helper"
BIN_DIR="$HOME/.local/bin"
BIN_PATH="$BIN_DIR/ai-commit-helper"
TARGET_PATH="$INSTALL_DIR/dist/index.js"
PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'

log() {
  printf '%s\n' "$1"
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Required tool '$1' was not found. Please install $1 and run this installer again."
  fi
}

path_contains_bin_dir() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) return 0 ;;
    *) return 1 ;;
  esac
}

detect_shell_config() {
  local shell_name
  shell_name="$(basename "${SHELL:-}")"

  case "$shell_name" in
    zsh) printf '%s\n' "$HOME/.zshrc" ;;
    bash) printf '%s\n' "$HOME/.bashrc" ;;
    *) printf '%s\n' "" ;;
  esac
}

ask_yes_no() {
  local prompt="$1"
  local answer=""

  if [ -r /dev/tty ]; then
    printf '%s ' "$prompt" > /dev/tty
    read -r answer < /dev/tty || answer=""
  else
    printf '%s ' "$prompt"
    read -r answer || answer=""
  fi

  case "$answer" in
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

log "Installing ai-commit-helper"

require_tool git
require_tool node
require_tool npm

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing checkout at $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull
elif [ -e "$INSTALL_DIR" ]; then
  fail "$INSTALL_DIR already exists but is not a Git repository. Move it aside and rerun this installer."
else
  log "Cloning $REPO_URL into $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

log "Installing dependencies"
npm --prefix "$INSTALL_DIR" install

log "Building CLI"
npm --prefix "$INSTALL_DIR" run build

if [ ! -f "$TARGET_PATH" ]; then
  fail "Build did not create $TARGET_PATH."
fi

if [ "$(head -n 1 "$TARGET_PATH")" != "#!/usr/bin/env node" ]; then
  fail "$TARGET_PATH is missing the expected Node.js shebang."
fi

chmod +x "$TARGET_PATH"

log "Creating command symlink"
mkdir -p "$BIN_DIR"
ln -sfn "$TARGET_PATH" "$BIN_PATH"

if path_contains_bin_dir; then
  PATH_READY=1
else
  PATH_READY=0
  SHELL_CONFIG="$(detect_shell_config)"

  if [ -n "$SHELL_CONFIG" ]; then
    if ask_yes_no "Add ~/.local/bin to your PATH in $SHELL_CONFIG? [y/N]"; then
      touch "$SHELL_CONFIG"

      if ! grep -Fqx "$PATH_LINE" "$SHELL_CONFIG"; then
        {
          printf '\n'
          printf '%s\n' "$PATH_LINE"
        } >> "$SHELL_CONFIG"
      fi

      log "Added ~/.local/bin to PATH in $SHELL_CONFIG."
      log "Restart your terminal or run:"
      log "source $SHELL_CONFIG"
    else
      log "Skipped shell PATH update."
      log "To use ai-commit-helper by name, run:"
      log "$PATH_LINE"
    fi
  else
    log "~/.local/bin is not currently in PATH."
    log "Add it manually with:"
    log "$PATH_LINE"
  fi
fi

log "Verifying direct command path"
"$BIN_PATH" --help

if [ "$PATH_READY" -eq 1 ]; then
  log "Verifying command from PATH"
  ai-commit-helper --help
fi

log "ai-commit-helper installed successfully."
log "Try it inside a Git repository with:"
log "ai-commit-helper --auto"

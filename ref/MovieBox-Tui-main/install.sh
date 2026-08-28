#!/usr/bin/env bash
set -euo pipefail

APP_NAME="MovieBox-Tui"
BIN_NAME="moviebox-tui"
REPO="mesamirh/MovieBox-Tui"
DEFAULT_INSTALL_DIR="$HOME/.local/bin"

VERSION=""
CUSTOM_DIR=""
FORCE=0
DRY_RUN=0
NO_MODIFY_PATH=0
UNINSTALL=0

while [ $# -gt 0 ]; do
    case "$1" in
        --version=*|-v=*)
            VERSION="${1#*=}"
            shift
            ;;
        --version|-v)
            VERSION="${2:-}"
            shift 2
            ;;
        --dir=*)
            CUSTOM_DIR="${1#*=}"
            shift
            ;;
        --dir)
            CUSTOM_DIR="${2:-}"
            shift 2
            ;;
        --force|-f)
            FORCE=1
            shift
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        --no-modify-path)
            NO_MODIFY_PATH=1
            shift
            ;;
        --uninstall)
            UNINSTALL=1
            shift
            ;;
        --help|-h)
            cat << 'EOF'
MovieBox-TUI Installer

USAGE:
    curl -fsSL https://raw.githubusercontent.com/mesamirh/MovieBox-Tui/main/install.sh | bash [OPTIONS]
    ./install.sh [OPTIONS]

OPTIONS:
    -v, --version <tag>    Install a specific version (e.g. v0.1.12)
        --dir <path>       Install binary to a custom directory
    -f, --force            Reinstall even if already at the latest version
        --dry-run          Perform preflight checks without writing files
        --no-modify-path   Do not modify shell profile configuration
        --uninstall        Uninstall MovieBox-TUI from your system
    -h, --help             Show this help message
EOF
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

IS_TTY=0
if [ -t 1 ]; then
    IS_TTY=1
fi

IS_COLOR=0
if [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ] && [ -t 1 ]; then
    IS_COLOR=1
fi

if [ "$IS_COLOR" -eq 1 ]; then
    C_RESET="\033[0m"
    C_BOLD="\033[1m"
    C_DIM="\033[2m"
    
    if [ "${COLORTERM:-}" = "truecolor" ] || [ "${COLORTERM:-}" = "24bit" ] || [ -n "${WT_SESSION:-}" ] || [ "${TERM_PROGRAM:-}" = "Apple_Terminal" ] || [ "${TERM_PROGRAM:-}" = "iTerm.app" ] || [ "${TERM_PROGRAM:-}" = "ghostty" ] || [ "${TERM_PROGRAM:-}" = "WezTerm" ] || [ "${TERM_PROGRAM:-}" = "warp" ]; then
        C_MAUVE="\033[38;2;203;166;247m"
        C_BLUE="\033[38;2;137;180;250m"
        C_SAPPHIRE="\033[38;2;116;199;236m"
        C_LAVENDER="\033[38;2;180;190;254m"
        C_TEAL="\033[38;2;148;226;213m"
        C_GREEN="\033[38;2;166;227;161m"
        C_YELLOW="\033[38;2;249;226;175m"
        C_RED="\033[38;2;243;139;168m"
        C_TEXT="\033[38;2;205;214;244m"
        C_SUBTEXT="\033[38;2;166;173;200m"
        C_MUTED="\033[38;2;108;112;134m"
    else
        C_MAUVE="\033[35m"
        C_BLUE="\033[34m"
        C_SAPPHIRE="\033[36m"
        C_LAVENDER="\033[35m"
        C_TEAL="\033[36m"
        C_GREEN="\033[32m"
        C_YELLOW="\033[33m"
        C_RED="\033[31m"
        C_TEXT="\033[37m"
        C_SUBTEXT="\033[37m"
        C_MUTED="\033[90m"
    fi

    CURSOR_HIDE="\033[?25l"
    CURSOR_SHOW="\033[?25h"
else
    C_RESET=""
    C_BOLD=""
    C_DIM=""
    C_MAUVE=""
    C_BLUE=""
    C_SAPPHIRE=""
    C_LAVENDER=""
    C_TEAL=""
    C_GREEN=""
    C_YELLOW=""
    C_RED=""
    C_TEXT=""
    C_SUBTEXT=""
    C_MUTED=""
    CURSOR_HIDE=""
    CURSOR_SHOW=""
fi

cleanup() {
    printf "%b" "$CURSOR_SHOW" 2>/dev/null || true
    if [ -n "${TMP_DIR:-}" ] && [ -d "$TMP_DIR" ]; then
        rm -rf "$TMP_DIR"
    fi
}
trap cleanup EXIT INT TERM

log_step() {
    printf "  %b%s%b %b%s%b\n" "$C_BLUE" "→" "$C_RESET" "$C_TEXT" "$1" "$C_RESET"
}

log_success() {
    printf "  %b%s%b %b%s%b\n" "$C_GREEN" "✔" "$C_RESET" "$C_TEXT" "$1" "$C_RESET"
}

log_warn() {
    printf "  %b%s%b %b%s%b\n" "$C_YELLOW" "⚠" "$C_RESET" "$C_TEXT" "$1" "$C_RESET"
}

log_error() {
    printf "  %b%s%b %b%s%b\n" "$C_RED" "✖" "$C_RESET" "$C_TEXT" "$1" "$C_RESET" >&2
}

clear_screen() {
    if [ "$IS_TTY" -eq 1 ] && [ "${TERM:-}" != "dumb" ]; then
        clear 2>/dev/null || printf "\033[2J\033[3J\033[H"
    fi
}

print_header() {
    clear_screen
    if [ "$IS_COLOR" -eq 1 ] && [ "$IS_TTY" -eq 1 ]; then
        printf "%b\n" "$CURSOR_HIDE"
        printf "%b%b" "$C_BOLD" "$C_MAUVE"
        local lines=(
            "███╗   ███╗  ██████╗  ██╗   ██╗ ██╗ ███████╗ ██████╗   ██████╗  ██╗  ██╗"
            "████╗ ████║ ██╔═══██╗ ██║   ██║ ██║ ██╔════╝ ██╔══██╗ ██╔═══██╗ ╚██╗██╔╝"
            "██╔████╔██║ ██║   ██║ ██║   ██║ ██║ █████╗   ██████╔╝ ██║   ██║  ╚███╔╝ "
            "██║╚██╔╝██║ ██║   ██║ ╚██╗ ██╔╝ ██║ ██╔══╝   ██╔══██╗ ██║   ██║  ██╔██╗ "
            "██║ ╚═╝ ██║ ╚██████╔╝  ╚████╔╝  ██║ ███████╗ ██████╔╝ ╚██████╔╝ ██╔╝ ██╗"
            "╚═╝     ╚═╝  ╚═════╝    ╚═══╝   ╚═╝ ╚══════╝ ╚═════╝   ╚═════╝  ╚═╝  ╚═╝"
        )
        for line in "${lines[@]}"; do
            printf "%s\n" "$line"
            sleep 0.02
        done
        printf "%b%b                           Official Installer%b%b\n\n" "$C_SAPPHIRE" "$C_BOLD" "$C_RESET" "$CURSOR_SHOW"
    else
        cat << 'EOF'
███╗   ███╗  ██████╗  ██╗   ██╗ ██╗ ███████╗ ██████╗   ██████╗  ██╗  ██╗
████╗ ████║ ██╔═══██╗ ██║   ██║ ██║ ██╔════╝ ██╔══██╗ ██╔═══██╗ ╚██╗██╔╝
██╔████╔██║ ██║   ██║ ██║   ██║ ██║ █████╗   ██████╔╝ ██║   ██║  ╚███╔╝ 
██║╚██╔╝██║ ██║   ██║ ╚██╗ ██╔╝ ██║ ██╔══╝   ██╔══██╗ ██║   ██║  ██╔██╗ 
██║ ╚═╝ ██║ ╚██████╔╝  ╚████╔╝  ██║ ███████╗ ██████╔╝ ╚██████╔╝ ██╔╝ ██╗
╚═╝     ╚═╝  ╚═════╝    ╚═══╝   ╚═╝ ╚══════╝ ╚═════╝   ╚═════╝  ╚═╝  ╚═╝
                           Official Installer

EOF
    fi
}

run_spinner() {
    local message="$1"
    shift
    local cmd=("$@")

    if [ "$IS_TTY" -ne 1 ] || [ "$IS_COLOR" -ne 1 ]; then
        log_step "$message..."
        if ! "${cmd[@]}"; then
            log_error "$message failed."
            return 1
        fi
        return 0
    fi

    local spin_chars=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
    local spin_count=${#spin_chars[@]}
    local spin_idx=0

    local tmp_out
    tmp_out=$(mktemp)

    printf "%b" "$CURSOR_HIDE"
    "${cmd[@]}" > "$tmp_out" 2>&1 &
    local pid=$!

    while kill -0 "$pid" 2>/dev/null; do
        local frame="${spin_chars[$spin_idx]}"
        printf "\r\033[K  %b%s%b %b%s...%b" "$C_SAPPHIRE" "$frame" "$C_RESET" "$C_TEXT" "$message" "$C_RESET"
        spin_idx=$(( (spin_idx + 1) % spin_count ))
        sleep 0.08
    done

    wait "$pid"
    local exit_code=$?
    printf "%b" "$CURSOR_SHOW"

    if [ "$exit_code" -eq 0 ]; then
        printf "\r\033[K"
        rm -f "$tmp_out"
        return 0
    else
        printf "\r\033[K"
        log_error "$message failed:"
        cat "$tmp_out" >&2
        rm -f "$tmp_out"
        return "$exit_code"
    fi
}

do_uninstall() {
    print_header
    log_step "Uninstalling $APP_NAME..."
    
    local found=0
    local target_paths=(
        "$HOME/.local/bin/$BIN_NAME"
        "/usr/local/bin/$BIN_NAME"
        "${PREFIX:-}/bin/$BIN_NAME"
    )

    if command -v "$BIN_NAME" >/dev/null 2>&1; then
        local current_path
        current_path=$(command -v "$BIN_NAME")
        target_paths+=("$current_path")
    fi

    for path in "${target_paths[@]}"; do
        if [ -n "$path" ] && [ -f "$path" ]; then
            if [ -w "$path" ] || [ -w "$(dirname "$path")" ]; then
                rm -f "$path"
                log_success "Removed $path"
                found=1
            elif command -v sudo >/dev/null 2>&1; then
                sudo rm -f "$path"
                log_success "Removed $path (with sudo)"
                found=1
            fi
        fi
    done

    if [ "$found" -eq 1 ]; then
        log_success "$APP_NAME was successfully uninstalled."
    else
        log_warn "No installed binary of $BIN_NAME was found."
    fi
    exit 0
}

if [ "$UNINSTALL" -eq 1 ]; then
    do_uninstall
fi

print_header

command -v curl >/dev/null 2>&1 || { log_error "curl is required but not installed. Please install curl."; exit 1; }
command -v tar >/dev/null 2>&1 || { log_error "tar is required but not installed. Please install tar."; exit 1; }

OS="$(uname -s)"
ARCH="$(uname -m)"
IS_TERMUX=0

if [ -n "${PREFIX:-}" ] && [[ "$PREFIX" == *com.termux* ]]; then
    IS_TERMUX=1
fi

if [ "$IS_TERMUX" -eq 1 ]; then
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
        FILE="MovieBox_Linux_arm64.tar.gz"
        PLATFORM_NAME="Android Termux (arm64)"
    else
        log_error "Unsupported Termux architecture ($ARCH). Only arm64/aarch64 is hosted. Use 'cargo install moviebox-tui'."
        exit 1
    fi
elif [ "$OS" = "Darwin" ]; then
    FILE="MovieBox_macOS_Universal.tar.gz"
    PLATFORM_NAME="macOS (Universal)"
elif [ "$OS" = "Linux" ]; then
    if [ "$ARCH" = "x86_64" ]; then
        FILE="MovieBox_Linux_x64.tar.gz"
        PLATFORM_NAME="Linux (x86_64)"
    elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
        FILE="MovieBox_Linux_arm64.tar.gz"
        PLATFORM_NAME="Linux (arm64)"
    else
        log_error "Unsupported Linux architecture ($ARCH). Only x86_64 and arm64 are supported."
        exit 1
    fi
else
    log_error "Unsupported Operating System ($OS)."
    exit 1
fi

TMP_VER_FILE=$(mktemp)

resolve_version() {
    if [ -n "$VERSION" ]; then
        printf "%s" "$VERSION" > "$TMP_VER_FILE"
        return 0
    fi

    local release_header
    release_header=$(curl -fsSI "https://github.com/$REPO/releases/latest") || {
        log_error "Failed to contact GitHub for latest release."
        return 1
    }
    local tag
    tag=$(printf "%s" "$release_header" | grep -i '^location:' | awk -F '/' '{print $NF}' | tr -d '\r\n')
    if [ -z "$tag" ]; then
        log_error "Could not resolve latest release version from GitHub."
        return 1
    fi
    printf "%s" "$tag" > "$TMP_VER_FILE"
}

run_spinner "[1/4] Checking environment & resolving version" resolve_version || exit 1
TARGET_VERSION=$(cat "$TMP_VER_FILE" 2>/dev/null || true)
rm -f "$TMP_VER_FILE"

if [ -z "$TARGET_VERSION" ]; then
    log_error "Could not resolve release version."
    exit 1
fi

log_success "[1/4] Environment ready ($PLATFORM_NAME • $TARGET_VERSION)"

if [ -n "$CUSTOM_DIR" ]; then
    INSTALL_DIR="$CUSTOM_DIR"
elif [ "$IS_TERMUX" -eq 1 ]; then
    INSTALL_DIR="$PREFIX/bin"
else
    INSTALL_DIR="$DEFAULT_INSTALL_DIR"
fi

APP_PATH="$INSTALL_DIR/$BIN_NAME"

EXISTING_BIN=$(command -v "$BIN_NAME" 2>/dev/null || true)
if [ -n "$EXISTING_BIN" ] && [ -x "$EXISTING_BIN" ]; then
    CURRENT_VERSION=$("$EXISTING_BIN" --version 2>/dev/null | awk '{print $2}' || true)
    CURRENT_VERSION=${CURRENT_VERSION:-unknown}

    if [ "v$CURRENT_VERSION" = "$TARGET_VERSION" ] && [ "$FORCE" -eq 0 ]; then
        if [ "$IS_TTY" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
            printf "\n  %b%s%b %b%s%b\n" "$C_YELLOW" "ℹ" "$C_RESET" "$C_TEXT" "MovieBox-TUI $TARGET_VERSION is already installed at $EXISTING_BIN." "$C_RESET"
            printf "  Choose an action: [1] Reinstall  [2] Uninstall  [3] Exit: "
            if [ -e /dev/tty ]; then
                read -r user_choice </dev/tty || user_choice="3"
            else
                read -r user_choice || user_choice="3"
            fi
            case "$user_choice" in
                1)
                    log_step "Proceeding with reinstall..."
                    ;;
                2)
                    do_uninstall
                    ;;
                *)
                    log_success "No changes made. Exiting."
                    exit 0
                    ;;
            esac
        else
            log_success "MovieBox-TUI $TARGET_VERSION is already installed. Use --force to reinstall."
            exit 0
        fi
    fi
fi

if [ "$DRY_RUN" -eq 1 ]; then
    log_success "[Dry Run] Target package: $FILE"
    log_success "[Dry Run] Target install directory: $APP_PATH"
    log_success "[Dry Run] All preflight checks passed."
    exit 0
fi

TMP_DIR=$(mktemp -d)

URL="https://github.com/$REPO/releases/download/$TARGET_VERSION/$FILE"
CHECKSUM_URL="https://github.com/$REPO/releases/download/$TARGET_VERSION/SHA256SUMS"

download_files() {
    curl -fsSL "$URL" -o "$TMP_DIR/$FILE" && \
    curl -fsSL "$CHECKSUM_URL" -o "$TMP_DIR/SHA256SUMS"
}

run_spinner "[2/4] Downloading $FILE" download_files || exit 1
log_success "[2/4] Downloaded $FILE"

verify_checksum() {
    local expected_sha
    expected_sha=$(awk -v file="$FILE" '$2 == file {print $1}' "$TMP_DIR/SHA256SUMS")
    if [ -z "$expected_sha" ]; then
        return 1
    fi

    local actual_sha=""
    if command -v sha256sum >/dev/null 2>&1; then
        actual_sha=$(sha256sum "$TMP_DIR/$FILE" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
        actual_sha=$(shasum -a 256 "$TMP_DIR/$FILE" | awk '{print $1}')
    elif command -v openssl >/dev/null 2>&1; then
        actual_sha=$(openssl dgst -sha256 "$TMP_DIR/$FILE" | awk '{print $NF}')
    else
        return 1
    fi

    [ "$actual_sha" = "$expected_sha" ]
}

run_spinner "[3/4] Verifying SHA256 checksum" verify_checksum || exit 1
log_success "[3/4] Cryptographic checksum verified"

install_binary() {
    tar -xzf "$TMP_DIR/$FILE" -C "$TMP_DIR"
    if [ ! -f "$TMP_DIR/$BIN_NAME" ]; then
        return 1
    fi

    mkdir -p "$INSTALL_DIR" 2>/dev/null || true
    if [ ! -w "$INSTALL_DIR" ] && [ ! -w "$(dirname "$INSTALL_DIR")" ]; then
        INSTALL_DIR="$HOME/.local/bin"
        APP_PATH="$INSTALL_DIR/$BIN_NAME"
        mkdir -p "$INSTALL_DIR" 2>/dev/null || true
    fi

    cp "$TMP_DIR/$BIN_NAME" "$APP_PATH"
    chmod 755 "$APP_PATH"
}

run_spinner "[4/4] Installing binary to $INSTALL_DIR" install_binary || exit 1
log_success "[4/4] Binary installed to $APP_PATH"

SHELL_MODIFIED=""
if [ "$NO_MODIFY_PATH" -eq 0 ]; then
    if ! echo "$PATH" | tr ':' '\n' | grep -q "^$INSTALL_DIR$"; then
        CURRENT_SHELL=$(basename "${SHELL:-bash}")
        RC_FILE=""
        case "$CURRENT_SHELL" in
            zsh)
                RC_FILE="$HOME/.zshrc"
                ;;
            bash)
                if [ -f "$HOME/.bashrc" ]; then
                    RC_FILE="$HOME/.bashrc"
                elif [ -f "$HOME/.bash_profile" ]; then
                    RC_FILE="$HOME/.bash_profile"
                else
                    RC_FILE="$HOME/.bashrc"
                fi
                ;;
            fish)
                RC_FILE="$HOME/.config/fish/config.fish"
                ;;
        esac

        if [ -n "$RC_FILE" ]; then
            mkdir -p "$(dirname "$RC_FILE")"
            if [ -f "$RC_FILE" ] && grep -q "$INSTALL_DIR" "$RC_FILE"; then
                :
            else
                if [ "$CURRENT_SHELL" = "fish" ]; then
                    printf "\nfish_add_path %s\n" "$INSTALL_DIR" >> "$RC_FILE"
                else
                    printf "\nexport PATH=\"%s:\$PATH\"\n" "$INSTALL_DIR" >> "$RC_FILE"
                fi
                SHELL_MODIFIED="$RC_FILE"
            fi
        fi
    fi
fi

PLAYER_DETECTED=""
if command -v mpv >/dev/null 2>&1; then
    PLAYER_DETECTED="mpv"
elif command -v iina >/dev/null 2>&1 || command -v iina-cli >/dev/null 2>&1; then
    PLAYER_DETECTED="IINA"
elif command -v vlc >/dev/null 2>&1; then
    PLAYER_DETECTED="VLC"
elif command -v termux-open >/dev/null 2>&1; then
    PLAYER_DETECTED="Android Player (termux-open)"
fi

printf "\n"
printf "  %b✔ MovieBox-Tui %s successfully installed!%b\n\n" "$C_GREEN" "$TARGET_VERSION" "$C_RESET"
printf "  %b•%b %bBinary:%b  %b%s%b\n" "$C_MUTED" "$C_RESET" "$C_MUTED" "$C_RESET" "$C_TEXT" "$APP_PATH" "$C_RESET"

if [ -n "$PLAYER_DETECTED" ]; then
    printf "  %b•%b %bPlayer:%b  %b%s (ready)%b\n" "$C_MUTED" "$C_RESET" "$C_MUTED" "$C_RESET" "$C_GREEN" "$PLAYER_DETECTED" "$C_RESET"
elif [ "$IS_TERMUX" -eq 1 ]; then
    printf "  %b•%b %bPlayer:%b  %bNone detected (run 'pkg install termux-tools')%b\n" "$C_MUTED" "$C_RESET" "$C_MUTED" "$C_RESET" "$C_SAPPHIRE" "$C_RESET"
else
    printf "  %b•%b %bPlayer:%b  %bNone detected (mpv, VLC, or IINA recommended)%b\n" "$C_MUTED" "$C_RESET" "$C_MUTED" "$C_RESET" "$C_SAPPHIRE" "$C_RESET"
fi

if [ -n "$SHELL_MODIFIED" ]; then
    printf "  %b•%b %bShell:%b   %bPATH added to %s%b\n" "$C_MUTED" "$C_RESET" "$C_MUTED" "$C_RESET" "$C_LAVENDER" "$SHELL_MODIFIED" "$C_RESET"
fi

printf "\n"
printf "  %bTo start streaming:%b\n" "$C_TEXT" "$C_RESET"
printf "    %b$ moviebox-tui%b\n\n" "$C_GREEN" "$C_RESET"

if [ -z "$PLAYER_DETECTED" ]; then
    if [ "$IS_TERMUX" -eq 1 ]; then
        printf "  %bℹ%b Note: Run %b'pkg install termux-tools'%b to enable video playback on Termux.\n\n" "$C_SAPPHIRE" "$C_RESET" "$C_BOLD" "$C_RESET"
    else
        printf "  %bℹ%b Note: A media player (mpv, VLC, or IINA) is recommended for video playback.\n\n" "$C_SAPPHIRE" "$C_RESET"
    fi
fi

if [ -n "$SHELL_MODIFIED" ]; then
    printf "  %bℹ%b Run %b'source %s'%b or restart your terminal to reload PATH.\n\n" "$C_SAPPHIRE" "$C_RESET" "$C_BOLD" "$SHELL_MODIFIED" "$C_RESET"
fi

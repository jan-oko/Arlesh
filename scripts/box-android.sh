# Android test builds for scripts/branch-instance.sh (`apk` subcommands). Sourced, never run
# directly: it relies on die(), worktree_path(), all_names(), require_space() and the globals
# MAIN, WORKTREES, SHARED_TARGET and INSTANCES that branch-instance.sh sets.
#
# Every branch gets its own application id, com.atai.arlesh.box.<branch>, and the label
# "Arlesh (<branch>)", so it installs beside the real app and beside other branches. Only this
# build is renamed: the checked-in src-tauri/gen/android and the CI release keep com.atai.arlesh.
# The two files that carry the name are patched for the length of the build and restored after it,
# also when the build fails. Nothing personal is read from the repo: the SDK, NDK and JDK come from
# ANDROID_HOME, ANDROID_NDK_HOME and JAVA_HOME (ARLESH_BOX_JAVA_HOME wins over JAVA_HOME), the
# device from the argument or ARLESH_BOX_DEVICE, the Firebase project from ARLESH_BOX_FIREBASE_PROJECT.

BOX_PACKAGE_PREFIX="com.atai.arlesh.box"
FIREBASE_API="https://firebase.googleapis.com/v1beta1"
DEBUG_KEYSTORE="${ARLESH_BOX_KEYSTORE:-$HOME/.android/debug.keystore}"

note() { printf '%s\n' "$*" >&2; }

# One Java package segment from a branch name: lowercase, [a-z0-9_], and not starting with a digit.
box_segment() {
  local seg
  seg="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_]/_/g')"
  case "$seg" in ""|[0-9]*) seg="b$seg" ;; esac
  printf '%s' "$seg"
}
box_package() { printf '%s.%s' "$BOX_PACKAGE_PREFIX" "$(box_segment "$1")"; }

# The worktree names whose package is $1, one per line (empty when its worktree is gone).
box_owners() {
  local name
  while read -r name; do
    [ -n "$name" ] && [ "$(box_package "$name")" = "$1" ] && printf '%s\n' "$name"
  done < <(all_names)
  return 0
}

box_label() { printf 'Arlesh (%s)' "$1"; }

# ---- Tooling ------------------------------------------------------------------------------------

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "'$1' is not on PATH. $2"; }

android_env() {
  [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME" ] || die "Set ANDROID_HOME to your Android SDK."
  [ -n "${ANDROID_NDK_HOME:-}" ] && [ -d "$ANDROID_NDK_HOME" ] ||
    die "Set ANDROID_NDK_HOME to your Android NDK."
  export ANDROID_HOME ANDROID_NDK_HOME NDK_HOME="$ANDROID_NDK_HOME"
  local jdk="${ARLESH_BOX_JAVA_HOME:-${JAVA_HOME:-}}"
  [ -n "$jdk" ] && [ -x "$jdk/bin/java" ] ||
    die "Set JAVA_HOME (or ARLESH_BOX_JAVA_HOME) to a JDK 17 to 24; the Android Gradle plugin needs one."
  export JAVA_HOME="$jdk"
  PATH="$jdk/bin:$ANDROID_HOME/platform-tools:$PATH"
  export PATH
}

build_tool() {
  local dir
  dir="$(ls -d "$ANDROID_HOME"/build-tools/*/ 2>/dev/null | sort -V | tail -1)"
  [ -n "$dir" ] && [ -x "${dir}$1" ] || die "No '$1' under $ANDROID_HOME/build-tools. Install build-tools with sdkmanager."
  printf '%s' "${dir}$1"
}

ensure_debug_keystore() {
  [ -f "$DEBUG_KEYSTORE" ] && return 0
  need_cmd keytool "It ships with the JDK."
  mkdir -p "$(dirname "$DEBUG_KEYSTORE")"
  keytool -genkeypair -keystore "$DEBUG_KEYSTORE" -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1 || die "Could not create $DEBUG_KEYSTORE."
  note "created $DEBUG_KEYSTORE"
}

# ---- Device -------------------------------------------------------------------------------------

# Prints the adb serial (host:port) for the device argument, connecting to it. Never pairs: a device
# that is not paired is reported with the command to run by hand.
resolve_device() {
  local arg="${1:-${ARLESH_BOX_DEVICE:-}}" host port serial
  [ -n "$arg" ] || die "Name the device as host[:port] or set ARLESH_BOX_DEVICE."
  need_cmd adb "Install platform-tools and put it on PATH (or set ANDROID_HOME)."
  host="${arg%%:*}"; port=""
  case "$arg" in *:*) port="${arg##*:}" ;; esac
  if [ -z "$port" ]; then
    port="$(adb mdns services 2>/dev/null | awk -v h="$host" '
      $2 ~ /_adb-tls-connect/ { n = split($3, a, ":"); if (n == 2 && a[1] == h) { print a[2]; exit } }')"
    if [ -z "$port" ]; then
      local ip; ip="$(getent hosts "$host" 2>/dev/null | awk '{print $1; exit}')"
      [ -n "$ip" ] && [ "$ip" != "$host" ] && port="$(adb mdns services 2>/dev/null | awk -v h="$ip" '
        $2 ~ /_adb-tls-connect/ { n = split($3, a, ":"); if (n == 2 && a[1] == h) { print a[2]; exit } }')"
    fi
    [ -n "$port" ] || die "$host does not show up in 'adb mdns services' (_adb-tls-connect). Turn on Wireless debugging on the device, or pass host:port. If it was never paired: adb pair $host:<pairing port>. This script does not pair."
  fi
  serial="$host:$port"
  adb connect "$serial" >/dev/null 2>&1 || true
  [ "$(adb -s "$serial" get-state 2>/dev/null)" = device ] ||
    die "Could not reach $serial over adb. If it is not paired yet, run: adb pair $host:<pairing port>"
  printf '%s' "$serial"
}

# ---- Firebase -----------------------------------------------------------------------------------

FIREBASE_TOKEN=""
# True when a call can be made; otherwise prints why Firebase is being skipped.
firebase_ready() {
  [ -n "$FIREBASE_TOKEN" ] && return 0
  [ -n "${ARLESH_BOX_FIREBASE_PROJECT:-}" ] || { note "firebase: ARLESH_BOX_FIREBASE_PROJECT is not set, skipping."; return 1; }
  command -v gcloud >/dev/null 2>&1 || { note "firebase: gcloud is not installed, skipping."; return 1; }
  command -v jq >/dev/null 2>&1 || { note "firebase: jq is not installed, skipping."; return 1; }
  FIREBASE_TOKEN="$(gcloud auth application-default print-access-token 2>/dev/null)" || FIREBASE_TOKEN=""
  [ -n "$FIREBASE_TOKEN" ] ||
    { note "firebase: no application-default credentials (gcloud auth application-default login), skipping."; return 1; }
}

# fb_call <METHOD> <path> [json body]: prints the response body, dies on an HTTP error.
fb_call() {
  local method="$1" path="$2" body="${3:-}" out code status
  out="$(mktemp)"
  local args=(-sS -o "$out" -w '%{http_code}' -X "$method" -H "Authorization: Bearer $FIREBASE_TOKEN"
    -H "X-Goog-User-Project: $ARLESH_BOX_FIREBASE_PROJECT" -H 'Content-Type: application/json')
  [ -n "$body" ] && args+=(-d "$body")
  code="$(curl "${args[@]}" "$FIREBASE_API/$path")" || { rm -f "$out"; die "firebase: request to $path failed."; }
  if [ "${code:0:1}" != 2 ]; then
    status="$(jq -r '.error.status // empty' "$out" 2>/dev/null)"
    if [ "$status" = RESOURCE_EXHAUSTED ] || [ "$code" = 429 ]; then
      note "$(jq -r '.error.message // empty' "$out" 2>/dev/null)"
      rm -f "$out"
      die "firebase: project $ARLESH_BOX_FIREBASE_PROJECT is out of quota or has hit its limit on Android apps. Free some with: $0 apk prune"
    fi
    note "$(jq -r '.error.message // empty' "$out" 2>/dev/null | head -c 400)"
    rm -f "$out"
    die "firebase: $method $path answered HTTP $code ${status:+($status)}."
  fi
  cat "$out"; rm -f "$out"
}

# "<appId> <packageName>" lines for every Android app in the project.
fb_list_apps() {
  local token="" page
  while :; do
    page="$(fb_call GET "projects/$ARLESH_BOX_FIREBASE_PROJECT/androidApps?pageSize=100${token:+&pageToken=$token}")"
    jq -r '.apps[]? | "\(.appId) \(.packageName)"' <<<"$page"
    token="$(jq -r '.nextPageToken // empty' <<<"$page")"
    [ -n "$token" ] || break
  done
}

fb_app_id_for() { fb_list_apps | awk -v p="$1" '$2 == p { print $1; exit }'; }

# Registers $1 (a package) unless it is registered, and prints its app id.
fb_ensure_app() {
  local pkg="$1" label="$2" id op res
  id="$(fb_app_id_for "$pkg")"
  if [ -z "$id" ]; then
    op="$(fb_call POST "projects/$ARLESH_BOX_FIREBASE_PROJECT/androidApps" \
      "$(jq -n --arg p "$pkg" --arg d "$label" '{packageName: $p, displayName: $d}')")"
    op="$(jq -r '.name' <<<"$op")"
    for _ in $(seq 60); do
      res="$(fb_call GET "$op")"
      if [ "$(jq -r '.done // false' <<<"$res")" = true ]; then
        if [ "$(jq -r '.error.status // empty' <<<"$res")" = RESOURCE_EXHAUSTED ]; then
          die "firebase: project $ARLESH_BOX_FIREBASE_PROJECT is at its limit of Android apps. Free some with: $0 apk prune"
        fi
        [ "$(jq -r '.error // empty' <<<"$res")" = "" ] || die "firebase: registering $pkg failed: $(jq -c .error <<<"$res")"
        id="$(jq -r '.response.appId' <<<"$res")"
        break
      fi
      sleep 2
    done
    [ -n "$id" ] || die "firebase: registering $pkg did not finish in time."
  fi
  printf '%s' "$id"
}

# Writes the app's config to <dest>/google-services.json.
fb_write_config() {
  local id="$1" dest="$2" cfg
  cfg="$(fb_call GET "projects/$ARLESH_BOX_FIREBASE_PROJECT/androidApps/$id/config")"
  ( umask 077; jq -r '.configFileContents' <<<"$cfg" | base64 -d > "$dest/google-services.json" )
}

fb_remove_pkg() {
  local pkg="$1" id
  firebase_ready || return 0
  id="$(fb_app_id_for "$pkg")"
  [ -n "$id" ] || { note "firebase: no app for $pkg."; return 0; }
  fb_call POST "projects/$ARLESH_BOX_FIREBASE_PROJECT/androidApps/$id:remove" \
    '{"immediate": true, "allowMissing": true}' >/dev/null
  printf 'firebase: removed %s (%s)\n' "$pkg" "$id"
}

# ---- Build, install, launch ---------------------------------------------------------------------

APK_PATCHED=()
restore_android_files() {
  local f
  for f in "${APK_PATCHED[@]:-}"; do
    [ -n "$f" ] && [ -f "$f.box-orig" ] && mv -f "$f.box-orig" "$f"
  done
  APK_PATCHED=()
}

# Sets the application id and the launcher label in the generated Android project.
patch_android_project() {
  local wt="$1" pkg="$2" label="$3" gradle strings
  gradle="$wt/src-tauri/gen/android/app/build.gradle.kts"
  strings="$wt/src-tauri/gen/android/app/src/main/res/values/strings.xml"
  [ -f "$gradle" ] && [ -f "$strings" ] || die "'$wt' has no generated Android project (src-tauri/gen/android)."
  cp "$gradle" "$gradle.box-orig"; cp "$strings" "$strings.box-orig"
  APK_PATCHED=("$gradle" "$strings")
  grep -q 'applicationId = "com.atai.arlesh"' "$gradle" || die "build.gradle.kts has no applicationId to patch."
  sed -i.sedbak "s|applicationId = \"com.atai.arlesh\"|applicationId = \"$pkg\"|" "$gradle"
  python3 - "$strings" "$label" <<'XMLSTR'
import sys
from xml.sax.saxutils import escape
path, label = sys.argv[1], sys.argv[2]
# Android string resources: quoted, with backslash and double quote escaped, and XML-escaped.
text = escape(label.replace("\\", "\\\\").replace('"', '\\"').replace("'", "\\'"))
with open(path, "w") as f:
    f.write('<resources>\n    <string name="app_name">"%s"</string>\n'
            '    <string name="main_activity_title">"%s"</string>\n</resources>\n' % (text, text))
XMLSTR
  rm -f "$gradle.sedbak"
}

box_apk_path() { printf '%s/%s/arlesh-box.apk' "$INSTANCES" "$1"; }

apk_build() {
  local name="$1" nofirebase="$2" wt pkg label marker first=no id unsigned out apksigner
  wt="$(worktree_path "$name")"
  pkg="$(box_package "$name")"; label="$(box_label "$name")"
  android_env
  need_cmd npx "Install Node."
  need_cmd rustup "Install Rust via rustup."
  require_space
  ensure_debug_keystore
  apksigner="$(build_tool apksigner)"
  rustup target add aarch64-linux-android >/dev/null

  [ -e "$wt/node_modules" ] || ln -s "$MAIN/node_modules" "$wt/node_modules"

  if [ "$nofirebase" = no ] && firebase_ready; then
    id="$(fb_ensure_app "$pkg" "$label")"
    fb_write_config "$id" "$wt/src-tauri/gen/android/app"
    printf 'firebase: %s registered as %s; google-services.json written (gitignored).\n' "$pkg" "$id"
    note "note: app/build.gradle.kts does not apply the google-services plugin yet, so the file is not read by the build."
  fi

  # With one target dir shared across worktrees, the first build in a new worktree otherwise finds
  # the generated TauriActivity missing: cargo thinks tauri and wry are up to date.
  marker="$(git -C "$wt" rev-parse --absolute-git-dir)/arlesh-box-first-build"
  if [ ! -f "$marker" ]; then
    first=yes
    ( cd "$wt" && CARGO_TARGET_DIR="$SHARED_TARGET" \
        cargo clean -p tauri -p wry --release --target aarch64-linux-android --manifest-path src-tauri/Cargo.toml ) ||
      note "cargo clean of tauri and wry failed or had nothing to clean; continuing."
  fi

  printf '\n=== %s: android apk %s (%s) ===\n' "$name" "$pkg" "$label"
  (
    trap restore_android_files EXIT
    patch_android_project "$wt" "$pkg" "$label"
    # Rebuilt from scratch, so an older APK is never mistaken for this one.
    rm -rf "$wt/src-tauri/gen/android/app/build/outputs/apk"
    cd "$wt" && CARGO_TARGET_DIR="$SHARED_TARGET" \
      npx tauri android build --apk --target aarch64 --ci -- --no-default-features
  ) || die "$name: the Android build failed."
  [ "$first" = no ] || touch "$marker"

  unsigned="$(find "$wt/src-tauri/gen/android/app/build/outputs/apk" -name '*-release-unsigned.apk' | head -1)"
  [ -n "$unsigned" ] || die "$name: the build produced no unsigned release APK."
  out="$(box_apk_path "$name")"
  mkdir -p "$(dirname "$out")"
  "$apksigner" sign --ks "$DEBUG_KEYSTORE" --ks-key-alias androiddebugkey \
    --ks-pass pass:android --key-pass pass:android --out "$out" "$unsigned"
  printf '=== %s: built %s (%s) ===\n' "$name" "$out" "$(du -h "$out" | cut -f1)"
}

apk_install() {
  local name="$1" serial="$2" apk res
  apk="$(box_apk_path "$name")"
  [ -f "$apk" ] || die "No built APK for '$name' at $apk. Run without --install-only first."
  res="$(adb -s "$serial" install -r "$apk" 2>&1)" || {
    note "$res"
    case "$res" in
      *UPDATE_INCOMPATIBLE*) die "The installed $(box_package "$name") is signed with another key. Uninstall it ($0 apk clean $name) and retry." ;;
      *) die "adb install failed." ;;
    esac
  }
  printf 'installed %s on %s\n' "$(box_package "$name")" "$serial"
}

apk_launch() {
  adb -s "$2" shell monkey -p "$(box_package "$1")" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 ||
    die "Could not launch $(box_package "$1") on $2."
  printf 'launched %s\n' "$(box_package "$1")"
}

# apk <branch> [device] [--build-only|--install-only|--no-launch|--no-firebase]
cmd_apk() {
  local sub="${1:-}"
  case "$sub" in
    prune) shift; apk_prune "$@"; return ;;
    clean) shift; [ "$#" -ge 1 ] || die "Usage: $0 apk clean <branch> [device]"; apk_clean "$@"; return ;;
  esac
  local build=yes install=yes launch=yes firebase=yes pos=() a
  for a in "$@"; do
    case "$a" in
      --build-only) install=no; launch=no ;;
      --install-only) build=no ;;
      --no-launch) launch=no ;;
      --no-firebase) firebase=no ;;
      --*) die "Unknown option $a" ;;
      *) pos+=("$a") ;;
    esac
  done
  [ "${#pos[@]}" -ge 1 ] && [ "${#pos[@]}" -le 2 ] ||
    die "Usage: $0 apk <branch> [host[:port]] [--build-only|--install-only|--no-launch|--no-firebase]"
  local name="${pos[0]}" serial=""
  worktree_path "$name" >/dev/null
  if [ "$install" = yes ]; then
    android_env
    serial="$(resolve_device "${pos[1]:-}")"   # before a long build: fail early on a missing device
  fi
  [ "$build" = no ] || apk_build "$name" "$([ "$firebase" = yes ] && echo no || echo yes)"
  [ "$install" = no ] || apk_install "$name" "$serial"
  [ "$launch" = no ] || apk_launch "$name" "$serial"
}

# Removes <branch>'s Firebase app and uninstalls its test app. Each part is skipped, with a notice,
# when it cannot be done.
apk_clean() {
  local name="$1" device="${2:-${ARLESH_BOX_DEVICE:-}}" pkg serial
  pkg="$(box_package "$name")"
  fb_remove_pkg "$pkg"
  if [ -n "$device" ]; then
    android_env
    serial="$(resolve_device "$device")"
    adb -s "$serial" uninstall "$pkg" >/dev/null 2>&1 && printf 'uninstalled %s from %s\n' "$pkg" "$serial" ||
      note "$pkg was not installed on $serial."
  else
    note "no device given and ARLESH_BOX_DEVICE is unset: not uninstalling $pkg."
  fi
}

# Every com.atai.arlesh.box.* app in Firebase or on the device whose worktree is gone.
apk_prune() {
  local device="${1:-${ARLESH_BOX_DEVICE:-}}" serial="" pkgs=() pkg
  [ "$#" -le 1 ] || die "Usage: $0 apk prune [device]"
  if firebase_ready; then
    while read -r _ pkg; do
      case "$pkg" in "$BOX_PACKAGE_PREFIX".*) pkgs+=("$pkg") ;; esac
    done < <(fb_list_apps)
  fi
  if [ -n "$device" ]; then
    android_env
    serial="$(resolve_device "$device")"
    while read -r pkg; do
      [ -n "$pkg" ] && pkgs+=("${pkg#package:}")
    done < <(adb -s "$serial" shell pm list packages "$BOX_PACKAGE_PREFIX." | tr -d '\r')
  else
    note "no device given and ARLESH_BOX_DEVICE is unset: pruning Firebase only."
  fi
  local seen=" " removed=0
  for pkg in ${pkgs[@]+"${pkgs[@]}"}; do
    case "$seen" in *" $pkg "*) continue ;; esac
    seen="$seen$pkg "
    [ -z "$(box_owners "$pkg")" ] || continue
    fb_remove_pkg "$pkg"
    [ -z "$serial" ] || { adb -s "$serial" uninstall "$pkg" >/dev/null 2>&1 && printf 'uninstalled %s\n' "$pkg"; } || true
    removed=$((removed + 1))
  done
  printf 'pruned %s test app(s) whose worktree is gone.\n' "$removed"
}

#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SHELL_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
OUTPUT_ROOT="$SHELL_ROOT/dist"
APP_ROOT="$OUTPUT_ROOT/DeepSeek Harness.app"
DMG_PATH="$OUTPUT_ROOT/DeepSeek-Harness-macOS.dmg"
STAGE=$(mktemp -d)
ARCHIVE_LIST=$(mktemp)
AUDIT_ROOT=$(mktemp -d)
trap 'rm -rf "$STAGE" "$ARCHIVE_LIST" "$AUDIT_ROOT"' EXIT

"$SCRIPT_DIR/build-app.sh" --distribution
codesign --verify --deep --strict "$APP_ROOT"

if [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_ROOT/Contents/Info.plist")" != "ai.deepseek.harness.desktop" ]; then
  echo "package-dmg: distribution app uses the development bundle identifier" >&2
  exit 1
fi
if /usr/libexec/PlistBuddy -c 'Print :DSHSourceRoot' "$APP_ROOT/Contents/Info.plist" >/dev/null 2>&1; then
  echo "package-dmg: distribution app contains DSHSourceRoot" >&2
  exit 1
fi
if strings "$APP_ROOT/Contents/MacOS/DeepSeekHarnessDesktop" | grep -F "$HOME" >/dev/null; then
  echo "package-dmg: executable contains the builder home path" >&2
  exit 1
fi
if [ ! -f "$APP_ROOT/Contents/Resources/SourceBootstrap.tar.gz" ]; then
  echo "package-dmg: bundled source snapshot is missing" >&2
  exit 1
fi
if [ "$(/usr/libexec/PlistBuddy -c 'Print :DSHSourceBranch' "$APP_ROOT/Contents/Info.plist")" != "codex/upstream-alpha3-adaptation" ]; then
  echo "package-dmg: distribution app does not point at the release source branch" >&2
  exit 1
fi
/usr/bin/tar -tzf "$APP_ROOT/Contents/Resources/SourceBootstrap.tar.gz" > "$ARCHIVE_LIST"
if grep -E '(^|/)\.git(/|$)' "$ARCHIVE_LIST" >/dev/null; then
  echo "package-dmg: source snapshot contains Git metadata" >&2
  exit 1
fi
if grep -E '/private/var/|/var/folders/' "$ARCHIVE_LIST" >/dev/null; then
  echo "package-dmg: source snapshot contains a developer-specific path" >&2
  exit 1
fi
/usr/bin/tar -xzf "$APP_ROOT/Contents/Resources/SourceBootstrap.tar.gz" -C "$AUDIT_ROOT"
if rg -n -I -F "$HOME" "$AUDIT_ROOT" >/dev/null \
  || rg -n -I '/private/var/|BEGIN [A-Z ]*PRIVATE KEY' "$AUDIT_ROOT" >/dev/null; then
  echo "package-dmg: source snapshot contains a developer path or private key" >&2
  exit 1
fi
for PACKAGE in \
  packages/client/ui-plugin-library \
  packages/client/ui-deepseek-files \
  packages/attachment/file-recognizer-office \
  packages/lark/lark \
  packages/llm/model-catalog
do
  if ! grep -F "./$PACKAGE/package.json" "$ARCHIVE_LIST" >/dev/null; then
    echo "package-dmg: bundled plugin $PACKAGE is missing" >&2
    exit 1
  fi
done
if ! grep -F './packages/boot/app-boot/src/profile.ts' "$ARCHIVE_LIST" >/dev/null; then
  echo "package-dmg: release Web profile template is missing" >&2
  exit 1
fi
if ! grep -F "@deepseek-ai/dsh-client-ui-plugin-library" "$AUDIT_ROOT/packages/boot/app-boot/src/profile.ts" \
  | grep -F "@deepseek-ai/dsh-file-recognizer-office" \
  | grep -F "@deepseek-ai/dsh-lark" \
  | grep -F "@deepseek-ai/dsh-model-catalog" >/dev/null; then
  echo "package-dmg: release Web profile does not enable the self-developed bundles" >&2
  exit 1
fi

ditto "$APP_ROOT" "$STAGE/DeepSeek Harness.app"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG_PATH"
hdiutil create \
  -volname "DeepSeek Harness" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

echo "$DMG_PATH"

#!/usr/bin/env bash
# Says whether an iPhone build carries the Push Notifications entitlement, and whether it is the
# sandbox or production APNs environment. Accepts an .app or an .ipa.
#
#   scripts/ios/check-push.sh frontend/ios/App/build/.../App.app
#   scripts/ios/check-push.sh openGym-1.4.4.ipa
#
# An unsigned simulator build has no code signature and no embedded profile, so this is for a
# signed device build or a finished IPA. The App Store/TestFlight build must say production; a
# debug build on a cable says development.
set -euo pipefail

INPUT=${1:?usage: scripts/ios/check-push.sh <App.app|app.ipa>}
[ -e "$INPUT" ] || { echo "no such file: $INPUT" >&2; exit 2; }
WORK=$(mktemp -d "${TMPDIR:-/tmp}/check-push.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

APP=$INPUT
case "$INPUT" in
  *.ipa)
    unzip -q "$INPUT" -d "$WORK/ipa"
    APP="$WORK/ipa/Payload/App.app"
    ;;
esac
[ -d "$APP" ] || { echo "no App.app inside $INPUT" >&2; exit 2; }

entitlement() {
  local file=$1
  python3 - "$file" "$2" <<'PY'
import plistlib, sys
try:
    value = plistlib.load(open(sys.argv[1], 'rb')).get(sys.argv[2])
except Exception:
    value = None
if isinstance(value, str) and value:
    print(value)
    raise SystemExit(0)
raise SystemExit(1)
PY
}

mkdir -p "$WORK"
if command -v codesign >/dev/null 2>&1; then
  codesign -d --entitlements :- "$APP" >"$WORK/entitlements.plist" 2>/dev/null || true
  if ENV=$(entitlement "$WORK/entitlements.plist" aps-environment); then
    echo "Push entitlement: $ENV"
    exit 0
  fi
fi

if [ -f "$APP/embedded.mobileprovision" ]; then
  openssl smime -inform der -verify -noverify -in "$APP/embedded.mobileprovision" -out "$WORK/profile.plist" 2>/dev/null || true
  if ENV=$(entitlement "$WORK/profile.plist" aps-environment); then
    echo "Push entitlement in the provisioning profile: $ENV"
    exit 0
  fi
fi

echo "No aps-environment entitlement found. The app cannot receive APNs notifications." >&2
exit 1

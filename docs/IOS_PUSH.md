# Native push on iPhone: first test

This is the iOS-only path for trying server notifications on a real iPhone. Android is prepared in
the same code but stays inactive while only the APNs settings are present: `GET /api/config`
reports `native_push: { ios: true, android: false }`, and the Android app never shows its Server
notifications switch.

For the full feature (friend starts, friend requests, reactions, shared plans and Coach
suggestions), the phone has to be paired to your server. The time-based workout reminder, nudge,
Wrapped and rest timer stay native local notifications, so enabling this does not duplicate them.

## What you need

- A **paid Apple Developer Program membership**. Free Xcode signing cannot enable Push
  Notifications.
- A real iPhone. The iOS simulator does not receive APNs notifications.
- The iPhone app built from this repository.
- An APNs Auth Key (`.p8`) and its Key ID, your Team ID, and the app's bundle id.
- A provisioning profile for that bundle id with Push Notifications enabled.

## 1. Apple Developer

1. In Certificates, Identifiers & Profiles → Identifiers, create an App ID for the bundle id you
   will use and enable **Push Notifications**.
2. In Keys, create an **APNs Auth Key**, download the `.p8` once, and note its Key ID. Note your
   Team ID from Membership.
3. Make sure the App ID is included in the provisioning profile Xcode uses. With automatic
   signing, adding the Push Notifications capability to the target does this for you.

The repository's current identifiers belong to the upstream project (`hb.opengym.app` and the
`VHBVLLJ369` team). For your own build, use your own bundle id and team, and change the bundle id
of the App target and of the embedded extensions/watch targets to match yours. The server's
`APNS_BUNDLE_ID` must be the App target's bundle id.

## 2. Xcode

```sh
cd frontend
npm run build:mobile
npx cap open ios
```

In Xcode:

1. Open the **App** target → Signing & Capabilities.
2. Choose your Team and the bundle id you created.
3. Add the **Push Notifications** capability.
4. Confirm **App.entitlements** now contains `aps-environment` (the repository already has it).
5. Select your iPhone as the run destination and run the app.

The app registers for APNs when, and only when, **Settings → Reminders → Server notifications**
is switched on.

## 3. Server

Mount the `.p8` read-only into the api container and set:

```sh
APNS_KEY_FILE=/run/secrets/apns-key.p8
APNS_KEY_ID=ABC123DEFG
APNS_TEAM_ID=TEAM123456
APNS_BUNDLE_ID=your.app.bundle.id
APNS_ENV=sandbox            # a cable/debug build; production for TestFlight/App Store
```

Restart the api. Check the public capability:

```sh
curl -s https://gym.example.com/api/config | jq .native_push
# { "ios": true, "android": false }
```

`APNS_ENV` can stay unset: the server tries production and then sandbox once per token and
remembers the environment that worked. For a first test with a debug build, setting it to
`sandbox` avoids the first failed attempt.

## 4. Register the phone

1. Pair the app with your server (Settings → Account → Connect to my server).
2. Open Settings → Reminders → Server notifications and switch it on. Allow notifications when
   iOS asks.
3. Tap **Send test notification**. The banner should arrive within a few seconds.

If the server runs on plain `http://` on your LAN, push registration still goes to Apple's APNs
over HTTPS; only the app-to-server connection is plain. Pairing and notifications work the same.

## 5. Test a friend's start

Two profiles on the same server:

- The athlete: Friends → Live training → **Share live workout** and **Tell friends when I start**.
- The friend: Friends → Live training → **Friend workout alerts** on the iPhone. Both phones need
  Server notifications enabled and notification permission granted.

The athlete starts a workout. The friend should get one of the localized start messages, and
tapping it opens **Friends → Live now**.

## 6. Troubleshooting

| Symptom | Check |
|---|---|
| No **Server notifications** row | `/api/config` has `native_push.ios: true`, the app is paired, and the build contains the Push Notifications plugin. F-Droid/Android is not this path. |
| Permission denied | iOS Settings → openGym → Notifications; then switch the app's Server notifications off and on again. |
| `BadDeviceToken` | The token and the APNs environment do not match. A cable/debug build is sandbox; TestFlight/App Store is production. Set `APNS_ENV` or let the server discover it. |
| Registration error | The App ID or provisioning profile lacks Push Notifications. `scripts/ios/check-push.sh` on the built app says what the signature carries. |
| Test button does nothing | The app is not paired, the server has no APNs key, or the phone has no native token yet. Reopen Settings to trigger a fresh registration. |
| No banner in the foreground | iOS shows foreground banners only with the presentation options in `capacitor.config.json`; those are already set. The notification is also in Notification Center. |
| Simulator never receives one | Expected. APNs requires a real device. |

## Checking a signed build

`scripts/ios/check-push.sh` accepts a `.app` or `.ipa` and prints the APNs environment or exits
non-zero when the signature has no `aps-environment`:

```sh
scripts/ios/check-push.sh ~/Library/Developer/Xcode/DerivedData/.../App.app
scripts/ios/check-push.sh openGym-1.4.4.ipa
```

For a server-side test with a token copied from `data/db.json` (`nativeSubs[].token`):

```sh
APNS_KEY_FILE=... APNS_KEY_ID=... APNS_TEAM_ID=... APNS_BUNDLE_ID=... \
  node api/scripts/send-apns-test.mjs <token> sandbox
```

Android/FCM remains documented in `docs/SELF_HOSTING.md` and `docs/APP_STORES.md`; it can stay
unconfigured while this iOS path is tested.

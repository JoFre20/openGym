# Motion rep counting

Status: first implementation. iPhone app only.

## What it does

One or three clean reference repetitions are recorded for an exercise and sensor. The resulting
template lets a later set count its own reps from acceleration. The set still goes through the
workout screen's normal `toggle`: reps are written to the row, the row is ticked, and the rest and
superset flow run exactly as after a manual check.

There is no browser or Android implementation. A browser cannot promise continuous 50 Hz
acceleration while its page is in a pocket, and a silent wrong count is worse than no feature.

## Pieces

| File | Role |
|---|---|
| `frontend/src/lib/rep-core.js` | Pure calibration and detector. PCA axis, projection, EMA, thresholds, state machine, inactivity window. |
| `frontend/src/lib/rep-core.test.js` | Synthetic traces: clean reps, fatigue, diagonal axes, partial reps, noise bumps, set end. |
| `frontend/src/lib/rep-templates.js` | Device-local storage, keyed by exercise and source (`iphone` / `watch`). |
| `frontend/src/lib/motion-source.js` | The two native sources and their error codes. No web source. |
| `frontend/src/lib/use-rep-tracker.js` | React adapter: 3-2-1, sensor lifetime, auto-stop timer, calibration and tracking state. |
| `frontend/src/components/RepTrackerSheet.jsx` | Source picker, calibration, live count, confirm and error states. |
| `frontend/ios/App/App/MotionPlugin.swift` | iPhone CoreMotion, `userAcceleration`, five-sample batches at 50 Hz. |
| `frontend/ios/App/App/WatchBridgePlugin.swift` | WatchConnectivity controls and forwarding `motionSamples` / `motionState` to the page. |
| `frontend/ios/App/Watch/MotionSensor.swift` | Watch CoreMotion. Sends samples, never counts in sensor mode. |
| `frontend/ios/App/Watch/MotionSensorView.swift` | The small "Sensor active" screen with a Stop button. |
| `frontend/ios/App/WatchCore/Sources/WatchCore/RepCore.swift` | Swift twin of the calibration and detector, used by the Watch-alone tracker. |
| `frontend/ios/App/Watch/WatchMotion.swift` | Local CoreMotion source, converted to m/s². |
| `frontend/ios/App/Watch/RepTrackerModel.swift` | Watch-alone countdown, calibration, tracking and auto-stop state. |
| `frontend/ios/App/Watch/RepTrackerView.swift` | The Watch-alone sheet and its small waveform. |
| `frontend/ios/App/WatchCore/Tests/WatchCoreTests/RepCoreTests.swift` | Synthetic traces for the Swift core. |

## Calibration

The template stores:

- the dominant axis as a unit vector
- the positive and negative peak acceleration
- the phase order (which direction comes first)
- the duration of one repetition and its minimum / maximum accepted duration
- the noise floor, neutral zone and smoothing alpha
- a 50-point normalized curve, for inspection and future template matching

Three reference reps are the default. Equal-sign peaks and opposite peak gaps give the median
duration, so a pause between reps does not become the rep duration. The template is valid only for
its exercise and sensor; a phone in a pocket and a watch on a wrist have different axes.

## Detection

The detector projects each 3D sample onto the template axis, smooths it with the same alpha, and
runs a three-state machine:

```
idle --(first peak threshold)--> first
first --(opposite peak threshold)--> second
second --(back in neutral zone)--> idle + one rep
```

The thresholds are `peak * tolerance` with a default tolerance of 0.62, lower than the calibrated
amplitude because later reps in a set are smaller. A rep shorter than `minRepMs` is discarded; one
that stays in `first`/`second` longer than `maxRepMs` is abandoned. A complete rep records its
duration and the wall-clock arrival time.

Set end is the configured quiet window after the last rep. It is deliberately not tied to the
sensor clock: the phone may receive a Watch batch slightly late.

## Settings

Stored as separate scalar fields, so a change on one device merges without dragging the others:

- `repMotionMode`: `auto`, `confirm`, `manual`
- `repMotionSetEndSec`: 4, 6, 10 or 15
- `repMotionCalibReps`: 1 or 3
- `repMotionSource`: last source used

## Watch as a pure sensor

Phone to Watch:

- `motionStart { hz, batchSize }`
- `motionStop`

Watch to phone:

- `motionSamples { seq, firstT, samples: [[t, x, y, z], ...] }`
- `motionState { state: started | ended | error, hz, reason? }`

The phone asks only when the Watch is paired, installed and reachable. Samples are live messages,
not queued events: a late count is worse than a visible gap. The phone watches the sequence number
and pauses on a gap. The Watch keeps a ten-minute ring buffer for a possible resend, but the first
version does not automatically request it; a gap ends in the error state, where the user can accept
the counted reps or retry.

watchOS keeps CoreMotion running with the wrist down only while a workout session is active. With
Apple Health on, the existing `WorkoutManager` session does this. With it off, the Watch app must
stay frontmost; the phone sees the stream stop and pauses. No HealthKit session is started without
the user's Apple Health switch.

## No server involvement

Motion samples and templates never reach the API. There is no sync field for them, no backup entry
and no server route. This also means a calibration is not carried to another phone; that is
intentional, because the axis would be wrong.

## Watch alone

The Watch has its own tracker for training without the iPhone. It is a separate calibration from
the phone's Watch-as-sensor source: the wrist movement is the same, but the detector runs on the
watch and keeps its templates in the watch app's `UserDefaults`.

- The current set page has a small waveform button for a reps work set.
- One or three reference repetitions are recorded on the wrist.
- `RepCore.swift` is the Swift twin of `rep-core.js`; `RepCoreTests` uses the same synthetic traces.
- `RepTrackerView` / `RepTrackerModel` run the countdown, live count, auto-stop and confirm states.
- At the end `SessionStore.completeMotionSet` sets the reps and calls the normal `completeSet`, so
  the `setDone` event, rest timer and phone sync are exactly the manual path's.
- The Watch follows the phone's mode, inactivity window and calibration habit from the snapshot
  (`WatchSettings.repMotion*`). Without a snapshot it uses automatic, 6 seconds, 3 reps.

## Testing

- `cd frontend && npx vitest run src/lib/rep-core.test.js src/lib/rep-templates.test.js src/lib/use-rep-tracker.test.jsx src/lib/motion-source.test.js`
- `cd frontend && npm test`
- `cd frontend && node scripts/check-locales.mjs && node scripts/check-source-strings.mjs --strict`
- `cd frontend/ios/App/WatchCore && swift test --filter RepCoreTests`
- `cd frontend/ios/App && xcodebuild -project App.xcodeproj -scheme OpenGymWatch -sdk watchsimulator -configuration Debug -destination 'generic/platform=watchOS Simulator' build CODE_SIGNING_ALLOWED=NO`
- A real iPhone and a real Watch are still needed: simulator CoreMotion is not the sensor.

## Known limits

- A loose phone or a loose Watch can blur the axis. The error and confirm modes are the way out.
- A pause longer than the quiet window ends the set; pick a longer window for long rests between
  reps.
- The Watch sensor stops when watchOS suspends the app without a workout session. The phone never
  fills that gap with invented reps.
- The Watch-alone tracker needs the same clean reference reps as the phone. A loose watch or a
  worn-out band can blur the axis; recalibrate in the position you train in.

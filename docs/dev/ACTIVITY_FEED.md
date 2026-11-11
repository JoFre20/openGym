# Activity feed and the new layout

## The two layouts

`S.uiMode` is a synced setting under Settings → Look & Home → App layout:

- `classic`: Home, Plan, Start, Stats, Exercises. Every profile that had no `uiMode` reads
  as Classic.
- `new`: Home, Activity, Start, Plan, Stats. A profile started on this device begins with
  `new` (`freshState`).

`frontend/src/lib/ui-mode.js` owns the choice and the tab a nested screen lights. The tab bar
reads it, and `App.jsx` maps `/social` to the Activity screen in the new layout and to the
Friends screen in Classic. `/crew` is the Friends management screen behind the Activity
header, and exists only in the new layout. `/activity` is an alias. Existing friend links and
push URLs (`#/social?friend=CODE`) keep working in both.

The exercise library has no tab in the new layout. Its Start header button, the quick link
under today's card and the `/library` route all lead there.

## The live dot

`frontend/src/lib/live-badge.js` keeps the last `GET /api/social/live` answer for the signed-in
profile; `use-live-badge.js` polls it every 15 seconds while the tab bar is on screen. The tab
bar shows a red pulsing dot on the Activity tab in the new layout and on the Home tab in Classic,
where the Friends screen is opened from. The live rows are also what the Activity screen's live
strip renders, so both surfaces agree without a second source.

Live rows are pinned above the Activity filters: switching to Goals, Me or Friends never hides
who is training right now. The same order holds on the Classic Friends page.

## Unread filter numbers

The numbers beside the filters are not feed totals. `frontend/src/lib/activity-seen.js` keeps a
local, per-profile `lastSeenAt`; the chips count only items newer than that mark. The mark is
written when Activity is left or the app goes to the background, so the numbers stay readable
during a visit and are gone on the next one. A profile that has never opened Activity has no
mark and therefore shows no numbers on its first visit.

## Close friends

`social.profiles[uid].closeFriends` is a personal, one-sided list of accepted friend ids. It says
whose live details `uid` may see. It is never mutual: marking Ada as close does not let Ada see
more of my workout unless I am on her list too.

- Every accepted friend with `shareLive` on sees that the athlete is training live, the workout
  name and the elapsed time.
- Only close friends also see the current exercise, set progress, ETA and seconds left. Other
  friends get `limited: true` and the reduced live card.
- Start notifications go only to close friends who also have `friendStartAlerts` enabled.
- The Crew screen's friend menu marks and unmarks a close friend; the flag lives in
  `social.json`, not in the synced profile state.
- A removed friendship is filtered out of the close list, so a stale id never grants anything.

## Workout details

The workout title of a card is tappable when the viewer is the owner or a close friend. It opens
the same summary layout as the finish screen: trophy, duration, volume, sets, PRs, the body map
of what was trained, and the owner's photos and videos when the workout is local. The top-set
rows open the per-exercise sheet instead.

`GET /api/social/workout?workoutId=...` returns the completed work sets and exercise snapshots
for that one workout. The sheets derive muscle groups, set/repetition/volume totals and the list
of sets on the device; warm-ups and uncompleted rows are filtered out on the server. A normal
friend gets `not-close`, and `shareWorkouts: false` blocks even a close friend.

## Feed items

`frontend/src/lib/activity.js` builds the caller's own rows locally and normalises the server's
`own`, `feed` and `milestones` arrays into one shape:

- `kind: 'workout'` carries `owner`, `workout` (name, duration, volume, PRs, top sets) and
  `reactions`.
- `kind: 'milestone'` carries `owner`, `milestone` (the goal and its data) and `reactions`.

The Activity screen filters them locally: All, Friends, Me, Goals. Own rows come from the
server when it sends `own` (so reactions friends sent are visible); offline, signed out, or
against an older server they are built from the local profile.

## Reached goals

`frontend/src/lib/milestones.js` writes a small, bounded event list into the profile:

```js
S.milestones = [
  { id: 'weight:78:2026-11-09', kind: 'weight_goal', at, d, data: { targetW, w, from, unit } },
  { id: 'challenge:2026-11:workouts', kind: 'challenge', at, d, data: { month, challengeId, n, u } },
]
```

- The ids are deterministic, so two devices write the same row and the sync merge keeps one.
- Nothing is backfilled. A weight goal is recorded by the first weigh-in after `edited.targetW`
  that reaches the target; a challenge is recorded when `markDone` first marks it.
- The list is capped at 200 and merged by id in `lib/sync-merge.js` and `api/sync-stamps.js`.
  Reset everything clears it through `resetIds`.
- A future exercise or strength goal only needs another `kind` and a row in the same list.

## Privacy

Existing rules are the only rules:

- `shareWorkouts === false`: no workout rows and no reached goals to friends.
- `shareWeight === 'none'`: no weight-goal rows.
- `shareWeight === 'delta'`: a weight goal shows the change only.
- `shareWeight === 'absolute'`: the day's weight and the change.

The owner always sees their own full rows.

## Server

`GET /api/social/feed` keeps its old `feed` array (friends' workouts) and adds:

- `own`: the caller's workouts and reached goals, with reaction summaries.
- `milestones`: friends' reached goals after the sharing rules.

`POST /api/social/react` accepts either `workoutId` or `itemId`; old reaction records keep
their `workoutId` key, so no migration is needed.

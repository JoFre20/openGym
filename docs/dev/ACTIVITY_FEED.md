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

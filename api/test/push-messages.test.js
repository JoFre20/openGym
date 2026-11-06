import test from 'node:test';
import assert from 'node:assert/strict';
import { dayReminderPush, friendRequestPush, friendStartPush, planSharePush, reactionPush, restTimerPush, routineEmoji, testPush } from '../push-messages.js';

test('localizes every server-generated notification in pt-BR', () => {
  assert.deepEqual(restTimerPush('pt-BR'), {
    title: 'Descanso terminado 💪',
    body: 'Hora da próxima série.',
    tag: 'rest-timer',
  });
  assert.deepEqual(testPush('pt-BR'), {
    title: 'openGym',
    body: 'Notificação de teste ✅ É assim que os alertas aparecem.',
    tag: 'test',
  });
  assert.deepEqual(dayReminderPush('pt-BR', { name: 'Treino A', emoji: '💪' }), {
    title: '💪 Treino A hoje',
    body: 'Está no seu plano. Bora treinar 💪',
    tag: 'day-reminder',
  });
});

test('keeps the existing English copy as the fallback', () => {
  assert.deepEqual(restTimerPush('fr'), restTimerPush('en'));
  assert.equal(dayReminderPush('unknown', null).title, 'Workout planned today');
  assert.equal(testPush(undefined).body, 'Test notification ✅ This is what alerts look like.');
});

// Routines stopped storing a literal emoji when the glyph picker landed: `emoji` now holds an
// icon key the app renders as an SVG. A notification has no SVG, so before this the reminder
// read "dumbbell Push today" — the key's own name, on the lock screen.
test('renders a routine glyph key as an emoji, never as its name', () => {
  assert.equal(routineEmoji('dumbbell'), '🏋️');
  assert.equal(routineEmoji('figureRun'), '🏃');
  assert.equal(routineEmoji('legs'), '🦵');
  assert.equal(
    dayReminderPush('pt-BR', { name: 'Costas e Bíceps', emoji: 'dumbbell' }).title,
    '🏋️ Costas e Bíceps hoje',
  );
});

test('leaves a literal emoji alone and falls back for anything else', () => {
  assert.equal(routineEmoji('💪'), '💪');
  assert.equal(routineEmoji('🏋️‍♀️'), '🏋️‍♀️');
  // An icon key the picker no longer offers is still ASCII, so it falls back to the default
  // rather than reaching the phone as a word.
  assert.equal(routineEmoji('trophy'), '🏋️');
  assert.equal(routineEmoji(''), '🏋️');
  assert.equal(routineEmoji(undefined), '🏋️');
});


test('social pushes follow the target language', () => {
  assert.deepEqual(friendRequestPush('de', 'Ada'), {
    title: 'Neue Freundschaftsanfrage',
    body: 'Ada möchte deinem Squad beitreten.',
    tag: 'friend-request',
    url: '#/social',
  });
  assert.deepEqual(reactionPush('pt-BR', 'Ada', '🔥'), {
    title: '🔥 Ada reagiu ao seu treino',
    body: 'Continue assim.',
    tag: 'social-reaction',
    url: '#/social',
  });
  assert.equal(friendRequestPush('ar', 'Ada').body.includes('Ada'), true);
  assert.equal(reactionPush('zh', 'Ada', '💪').title, '💪 Ada 回应了你的训练');
  assert.deepEqual(planSharePush('de', 'Ada'), {
    title: 'Neuer Plan von Ada',
    body: 'Bereit in deinem Squad. Öffne openGym, um ihn zu übernehmen.',
    tag: 'social-plan',
    url: '#/social',
  });
});

test('every app language has social push copy', () => {
  for (const lang of ['en', 'de', 'pt', 'pt-BR', 'es', 'fr', 'it', 'pl', 'ru', 'uk', 'sv', 'hu', 'tr', 'ar', 'hi', 'bn', 'ko', 'zh', 'zh-TW', 'th', 'de-CH']) {
    const friend = friendRequestPush(lang, 'Ada');
    const reaction = reactionPush(lang, 'Ada', '🔥');
    const plan = planSharePush(lang, 'Ada');
    assert.ok(friend.title && friend.body.includes('Ada'), lang);
    assert.ok(reaction.title.includes('Ada') && reaction.title.includes('🔥'), lang);
    assert.ok(reaction.body, lang);
    assert.ok(plan.title.includes('Ada') && plan.body, lang);
  }
});

test('friend start pushes follow the tone and rotate through its lines', () => {
  assert.deepEqual(friendStartPush('de', 'Ada', { tone: 'motivational', seed: 0 }), {
    title: '💪 Ada trainiert jetzt',
    body: 'Dein Zug. Auch ein Satz zählt.',
    tag: 'friend-start',
    url: '#/social',
  });
  assert.equal(friendStartPush('de', 'Ada', { tone: 'motivational', seed: 1 }).body, 'Das Gym ist offen. Komm dazu.');
  assert.equal(friendStartPush('de', 'Ada', { tone: 'drill', seed: 0 }).body, 'Keine Ausreden. Ab unter die Stange.');
  assert.equal(friendStartPush('de', 'Ada', { tone: 'mix', seed: 3 }).body, 'Keine Ausreden. Ab unter die Stange.');
  assert.equal(friendStartPush('de', 'Ada', { tone: 'unknown', seed: 0 }).body, 'Dein Zug. Auch ein Satz zählt.');
  assert.equal(friendStartPush('de-CH', 'Ada', { tone: 'motivational', seed: 0 }).title, '💪 Ada trainiert jetzt');
});

test('every app language has both friend start tones', () => {
  for (const lang of ['en', 'de', 'pt', 'pt-BR', 'es', 'fr', 'it', 'pl', 'ru', 'uk', 'sv', 'hu', 'tr', 'ar', 'hi', 'bn', 'ko', 'zh', 'zh-TW', 'th', 'de-CH']) {
    for (const tone of ['motivational', 'drill']) {
      const push = friendStartPush(lang, 'Ada', { tone, seed: 1 });
      assert.ok(push.title.includes('Ada'), lang + ' ' + tone);
      assert.ok(push.body, lang + ' ' + tone);
    }
  }
});

test('social pushes fall back to English for an unknown language', () => {
  assert.deepEqual(friendRequestPush('xx', 'Ada'), friendRequestPush('en', 'Ada'));
  assert.deepEqual(reactionPush(undefined, 'Ada', '👑'), reactionPush('en', 'Ada', '👑'));
  assert.equal(friendRequestPush('en', 'Ada').body, 'Ada wants to join your squad.');
  assert.equal(reactionPush('en', 'Ada', '💪').title, '💪 Ada reacted to your workout');
  assert.deepEqual(planSharePush('xx', 'Ada'), planSharePush('en', 'Ada'));
  assert.deepEqual(friendStartPush('xx', 'Ada', { tone: 'motivational', seed: 0 }), friendStartPush('en', 'Ada', { tone: 'motivational', seed: 0 }));
});

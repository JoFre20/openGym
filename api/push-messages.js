import { NUDGE_COPY } from './nudge-copy.js';
import { lineIndex } from './nudge.js';

const COPY = {
  en: {
    restTitle: 'Rest over 💪',
    restBody: 'Time for your next set.',
    testBody: 'Test notification ✅ This is what alerts look like.',
    dayFallbackTitle: 'Workout planned today',
    dayRoutineSuffix: 'today',
    dayBody: "It's on your plan. Let's go 💪",
  },
  'pt-BR': {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Hora da próxima série.',
    testBody: 'Notificação de teste ✅ É assim que os alertas aparecem.',
    dayFallbackTitle: 'Treino planejado para hoje',
    dayRoutineSuffix: 'hoje',
    dayBody: 'Está no seu plano. Bora treinar 💪',
  },
};

const copyFor = lang => COPY[lang] || COPY.en;

// A routine's `emoji` field held a literal emoji until the glyph redesign; since then it holds
// an icon key ('dumbbell', 'figureRun') that the app renders as an SVG. A push notification has
// no SVG to render, so an unmapped key reaches the phone as its own name — "dumbbell Push
// today". Keys are ASCII and emoji are not, so anything ASCII is looked up here (falling back
// rather than printing a word), and anything else is already an emoji and passes through.
// Mirrors frontend/src/lib/glyphs.js: GLYPHS is the full set the picker offers.
const DEFAULT_EMOJI = '🏋️';
const GLYPH_EMOJI = {
  figureStrength: '🏋️', arm: '💪', abs: '💥', legs: '🦵', pullup: '🧗',
  dumbbell: '🏋️', barbell: '🏋️', kettlebell: '🏋️', plate: '🏋️', machine: '🏋️',
  figureRun: '🏃', bike: '🚴', swim: '🏊', boxing: '🥊', timer: '⏱️',
  stretch: '🤸', moon: '🌙', heart: '❤️', flame: '🔥', bolt: '⚡',
};

export function routineEmoji(value) {
  if (!value) return DEFAULT_EMOJI;
  if (!/^[A-Za-z]+$/.test(value)) return value;
  return GLYPH_EMOJI[value] || DEFAULT_EMOJI;
}

export function restTimerPush(lang) {
  const copy = copyFor(lang);
  return { title: copy.restTitle, body: copy.restBody, tag: 'rest-timer' };
}

export function testPush(lang) {
  return { title: 'openGym', body: copyFor(lang).testBody, tag: 'test' };
}

export function dayReminderPush(lang, routine) {
  const copy = copyFor(lang);
  return {
    title: routine
      ? `${routineEmoji(routine.emoji)} ${routine.name} ${copy.dayRoutineSuffix}`
      : copy.dayFallbackTitle,
    body: copy.dayBody,
    tag: 'day-reminder',
  };
}

const SOCIAL_COPY = {
  en: {
    friendTitle: 'New friend request',
    friendBody: '{0} wants to join your squad.',
    reactionTitle: '{1} {0} reacted to your workout',
    reactionBody: 'Keep it up.',
  },
  de: {
    friendTitle: 'Neue Freundschaftsanfrage',
    friendBody: '{0} möchte deinem Squad beitreten.',
    reactionTitle: '{1} {0} hat auf dein Workout reagiert',
    reactionBody: 'Weiter so.',
  },
  pt: {
    friendTitle: 'Novo pedido de amizade',
    friendBody: '{0} quer juntar-se ao teu squad.',
    reactionTitle: '{1} {0} reagiu ao teu treino',
    reactionBody: 'Continua assim.',
  },
  'pt-BR': {
    friendTitle: 'Nova solicitação de amizade',
    friendBody: '{0} quer entrar no seu squad.',
    reactionTitle: '{1} {0} reagiu ao seu treino',
    reactionBody: 'Continue assim.',
  },
  es: {
    friendTitle: 'Nueva solicitud de amistad',
    friendBody: '{0} quiere unirse a tu squad.',
    reactionTitle: '{1} {0} ha reaccionado a tu entrenamiento',
    reactionBody: 'Sigue así.',
  },
  fr: {
    friendTitle: 'Nouvelle demande d’ami',
    friendBody: '{0} veut rejoindre ton squad.',
    reactionTitle: '{1} {0} a réagi à ta séance',
    reactionBody: 'Continue comme ça.',
  },
  it: {
    friendTitle: 'Nuova richiesta di amicizia',
    friendBody: '{0} vuole unirsi al tuo squad.',
    reactionTitle: '{1} {0} ha reagito al tuo allenamento',
    reactionBody: 'Continua così.',
  },
  pl: {
    friendTitle: 'Nowe zaproszenie do znajomych',
    friendBody: '{0} chce dołączyć do twojej ekipy.',
    reactionTitle: '{1} Nowa reakcja od {0}',
    reactionBody: 'Tak trzymaj.',
  },
  ru: {
    friendTitle: 'Новый запрос в друзья',
    friendBody: '{0} хочет присоединиться к твоему скваду.',
    reactionTitle: '{1} Новая реакция от {0}',
    reactionBody: 'Так держать.',
  },
  uk: {
    friendTitle: 'Новий запит у друзі',
    friendBody: '{0} хоче приєднатися до твого скваду.',
    reactionTitle: '{1} Нова реакція від {0}',
    reactionBody: 'Так тримати.',
  },
  sv: {
    friendTitle: 'Ny vänförfrågan',
    friendBody: '{0} vill gå med i din squad.',
    reactionTitle: '{1} {0} reagerade på ditt pass',
    reactionBody: 'Fortsätt så.',
  },
  hu: {
    friendTitle: 'Új barátkérés',
    friendBody: '{0} csatlakozni szeretne a squadodhoz.',
    reactionTitle: '{1} {0} reagált az edzésedre',
    reactionBody: 'Csak így tovább.',
  },
  tr: {
    friendTitle: 'Yeni arkadaşlık isteği',
    friendBody: '{0} squadına katılmak istiyor.',
    reactionTitle: '{1} {0} antrenmanına tepki verdi',
    reactionBody: 'Böyle devam.',
  },
  ar: {
    friendTitle: 'طلب صداقة جديد',
    friendBody: '{0} يريد الانضمام إلى فريقك.',
    reactionTitle: '{1} {0} تفاعل مع تمرينك',
    reactionBody: 'واصل التقدم.',
  },
  hi: {
    friendTitle: 'नया मित्र अनुरोध',
    friendBody: '{0} आपके स्क्वाड में शामिल होना चाहता है।',
    reactionTitle: '{1} {0} ने आपके वर्कआउट पर प्रतिक्रिया दी',
    reactionBody: 'ऐसे ही आगे बढ़ें।',
  },
  bn: {
    friendTitle: 'নতুন বন্ধুর অনুরোধ',
    friendBody: '{0} আপনার স্কোয়াডে যোগ দিতে চায়।',
    reactionTitle: '{1} {0} আপনার ওয়ার্কআউটে প্রতিক্রিয়া দিয়েছে',
    reactionBody: 'এভাবেই এগিয়ে যান।',
  },
  ko: {
    friendTitle: '새 친구 요청',
    friendBody: '{0} 님이 스쿼드에 참여하고 싶어 해요.',
    reactionTitle: '{1} {0} 님이 내 운동에 반응했어요',
    reactionBody: '계속 힘내세요.',
  },
  zh: {
    friendTitle: '新好友请求',
    friendBody: '{0} 想加入你的小队。',
    reactionTitle: '{1} {0} 回应了你的训练',
    reactionBody: '继续保持。',
  },
  'zh-TW': {
    friendTitle: '新好友要求',
    friendBody: '{0} 想加入你的小隊。',
    reactionTitle: '{1} {0} 回應了你的訓練',
    reactionBody: '繼續保持。',
  },
  th: {
    friendTitle: 'คำขอเป็นเพื่อนใหม่',
    friendBody: '{0} อยากเข้าร่วม squad ของคุณ',
    reactionTitle: '{1} {0} ตอบรับการฝึกของคุณ',
    reactionBody: 'สู้ต่อไป',
  },
};

// A shared plan is one more thing waiting in the squad, so its copy lives beside the friend and
// reaction pushes. The plan's own name is not printed: it can be long and is already on the
// card the notification opens.
const PLAN_SHARE_COPY = {
  en: { title: 'New plan from {0}', body: 'Ready in your squad. Open openGym to add it.' },
  de: { title: 'Neuer Plan von {0}', body: 'Bereit in deinem Squad. Öffne openGym, um ihn zu übernehmen.' },
  pt: { title: 'Novo plano de {0}', body: 'Pronto no teu squad. Abre o openGym para o adicionar.' },
  'pt-BR': { title: 'Novo plano de {0}', body: 'Pronto no seu squad. Abra o openGym para adicioná-lo.' },
  es: { title: 'Nuevo plan de {0}', body: 'Listo en tu squad. Abre openGym para añadirlo.' },
  fr: { title: 'Nouveau plan de {0}', body: 'Prêt dans ton squad. Ouvre openGym pour l’ajouter.' },
  it: { title: 'Nuovo piano da {0}', body: 'Pronto nel tuo squad. Apri openGym per aggiungerlo.' },
  pl: { title: 'Nowy plan od {0}', body: 'Gotowy w twojej ekipie. Otwórz openGym, aby go dodać.' },
  ru: { title: 'Новый план от {0}', body: 'Готов в твоём скваде. Открой openGym, чтобы добавить его.' },
  uk: { title: 'Новий план від {0}', body: 'Готовий у твоєму скваді. Відкрий openGym, щоб додати його.' },
  sv: { title: 'Ny plan från {0}', body: 'Redo i din squad. Öppna openGym för att lägga till den.' },
  hu: { title: 'Új terv tőle: {0}', body: 'Kész a squadodban. Nyisd meg az openGymet a hozzáadásához.' },
  tr: { title: '{0} kişisinden yeni plan', body: 'Squadında hazır. Eklemek için openGym’i aç.' },
  ar: { title: 'خطة جديدة من {0}', body: 'جاهزة في فريقك. افتح openGym لإضافتها.' },
  hi: { title: '{0} की नई योजना', body: 'आपके स्क्वाड में तैयार। इसे जोड़ने के लिए openGym खोलें।' },
  bn: { title: '{0} থেকে নতুন প্ল্যান', body: 'আপনার স্কোয়াডে প্রস্তুত। যোগ করতে openGym খুলুন।' },
  ko: { title: '{0} 님의 새 플랜', body: '스쿼드에 준비됐어요. 추가하려면 openGym을 여세요.' },
  zh: { title: '来自 {0} 的新计划', body: '已在你的小队中。打开 openGym 添加。' },
  'zh-TW': { title: '來自 {0} 的新計畫', body: '已在小隊中。開啟 openGym 加入。' },
  th: { title: 'แผนใหม่จาก {0}', body: 'พร้อมใน squad ของคุณ เปิด openGym เพื่อเพิ่ม' },
};

// A friend's start, in the tone the sender chose. Each tone keeps three lines, so a run of
// sessions does not repeat the same sentence; `mix` draws from both pools.
const FRIEND_START_COPY = {
  en: {
    title: '💪 {0} is training now',
    motivational: [
      'Your move. Even one set counts.',
      'The gym is open. Go join them.',
      'Future you says thanks.',
    ],
    drill: [
      'No excuses. Get under the bar.',
      'They are already training. Are you?',
      'Your muscles are waiting. Move it.',
    ],
  },
  de: {
    title: '💪 {0} trainiert jetzt',
    motivational: [
      'Dein Zug. Auch ein Satz zählt.',
      'Das Gym ist offen. Komm dazu.',
      'Dein zukünftiges Ich sagt danke.',
    ],
    drill: [
      'Keine Ausreden. Ab unter die Stange.',
      'Die Hanteln warten. Du auch?',
      'Deine Muskeln warten. Bewegung.',
    ],
  },
  pt: {
    title: '💪 {0} está a treinar agora',
    motivational: [
      'É a tua vez. Até uma série conta.',
      'O ginásio está aberto. Vem juntar-te.',
      'O teu eu do futuro agradece.',
    ],
    drill: [
      'Sem desculpas. Para debaixo da barra.',
      'Eles já estão a treinar. E tu?',
      'Os teus músculos estão à espera. Mexe-te.',
    ],
  },
  'pt-BR': {
    title: '💪 {0} está treinando agora',
    motivational: [
      'Sua vez. Até uma série conta.',
      'A academia está aberta. Venha treinar.',
      'Seu eu do futuro agradece.',
    ],
    drill: [
      'Sem desculpas. Para baixo da barra.',
      'Eles já estão treinando. E você?',
      'Seus músculos estão esperando. Mexa-se.',
    ],
  },
  es: {
    title: '💪 {0} está entrenando ahora',
    motivational: [
      'Te toca. Hasta una serie cuenta.',
      'El gimnasio está abierto. Únete.',
      'Tu yo del futuro te lo agradecerá.',
    ],
    drill: [
      'Sin excusas. Bajo la barra.',
      'Ya están entrenando. ¿Y tú?',
      'Tus músculos esperan. Muévete.',
    ],
  },
  fr: {
    title: '💪 {0} s’entraîne maintenant',
    motivational: [
      'À toi. Même une série compte.',
      'La salle est ouverte. Rejoins-les.',
      'Ton toi du futur te remerciera.',
    ],
    drill: [
      'Pas d’excuses. Sous la barre.',
      'Ils s’entraînent déjà. Et toi ?',
      'Tes muscles attendent. Bouge.',
    ],
  },
  it: {
    title: '💪 {0} si sta allenando ora',
    motivational: [
      'Tocca a te. Anche una serie conta.',
      'La palestra è aperta. Unisciti.',
      'Il te del futuro ti ringrazierà.',
    ],
    drill: [
      'Niente scuse. Sotto il bilanciere.',
      'Si stanno già allenando. E tu?',
      'I tuoi muscoli aspettano. Muoviti.',
    ],
  },
  pl: {
    title: '💪 {0} właśnie trenuje',
    motivational: [
      'Twoja kolej. Nawet jedna seria się liczy.',
      'Siłownia jest otwarta. Dołącz.',
      'Twoje przyszłe ja podziękuje.',
    ],
    drill: [
      'Bez wymówek. Pod sztangę.',
      'Oni już trenują. A ty?',
      'Twoje mięśnie czekają. Rusz się.',
    ],
  },
  ru: {
    title: '💪 {0} сейчас тренируется',
    motivational: [
      'Твой ход. Даже один подход считается.',
      'Зал открыт. Присоединяйся.',
      'Ты из будущего скажет спасибо.',
    ],
    drill: [
      'Никаких отговорок. Под штангу.',
      'Они уже тренируются. А ты?',
      'Твои мышцы ждут. Двигайся.',
    ],
  },
  uk: {
    title: '💪 {0} зараз тренується',
    motivational: [
      'Твій хід. Навіть один підхід рахується.',
      'Зал відкритий. Приєднуйся.',
      'Ти з майбутнього подякуєш.',
    ],
    drill: [
      'Жодних відмовок. Під штангу.',
      'Вони вже тренуються. А ти?',
      'Твої м’язи чекають. Рухайся.',
    ],
  },
  sv: {
    title: '💪 {0} tränar nu',
    motivational: [
      'Din tur. Även ett set räknas.',
      'Gymmet är öppet. Häng på.',
      'Ditt framtida jag tackar dig.',
    ],
    drill: [
      'Inga ursäkter. Under stången.',
      'De tränar redan. Gör du?',
      'Dina muskler väntar. Rör på dig.',
    ],
  },
  hu: {
    title: '💪 {0} most edz',
    motivational: [
      'Te jössz. Egy sorozat is számít.',
      'A terem nyitva. Csatlakozz.',
      'A jövőbeli éned hálás lesz.',
    ],
    drill: [
      'Nincs kifogás. A rúd alá.',
      'Már edzenek. Te is?',
      'Az izmaid várnak. Mozogj.',
    ],
  },
  tr: {
    title: '💪 {0} şu anda antrenmanda',
    motivational: [
      'Sıra sende. Bir set bile sayılır.',
      'Salon açık. Katıl onlara.',
      'Gelecekteki sen teşekkür edecek.',
    ],
    drill: [
      'Mazeret yok. Barın altına.',
      'Onlar zaten antrenmanda. Sen?',
      'Kasların bekliyor. Harekete geç.',
    ],
  },
  ar: {
    title: '💪 {0} يتدرب الآن',
    motivational: [
      'دورك. حتى مجموعة واحدة تُحسب.',
      'الصالة مفتوحة. انضم إليهم.',
      'نسختك المستقبلية ستشكرك.',
    ],
    drill: [
      'لا أعذار. تحت البار.',
      'إنهم يتدربون بالفعل. وأنت؟',
      'عضلاتك تنتظر. تحرّك.',
    ],
  },
  hi: {
    title: '💪 {0} अभी ट्रेनिंग कर रहे हैं',
    motivational: [
      'आपकी बारी। एक सेट भी मायने रखता है।',
      'जिम खुला है। शामिल हो जाइए।',
      'आपका भविष्य वाला आप धन्यवाद कहेगा।',
    ],
    drill: [
      'कोई बहाना नहीं। बार के नीचे आओ।',
      'वे पहले से ट्रेनिंग कर रहे हैं। आप?',
      'आपकी मांसपेशियां इंतज़ार कर रही हैं। हिलो।',
    ],
  },
  bn: {
    title: '💪 {0} এখন ট্রেনিং করছেন',
    motivational: [
      'আপনার পালা। একটা সেটও গণনা হয়।',
      'জিম খোলা। যোগ দিন।',
      'আপনার ভবিষ্যৎ আপনি ধন্যবাদ বলবে।',
    ],
    drill: [
      'কোনো অজুহাত নয়। বারের নিচে আসুন।',
      'তারা ইতিমধ্যে ট্রেনিং করছে। আপনি?',
      'আপনার পেশি অপেক্ষা করছে। নড়ুন।',
    ],
  },
  ko: {
    title: '💪 {0} 님이 지금 운동 중이에요',
    motivational: [
      '당신 차례예요. 한 세트도 중요해요.',
      '헬스장이 열었어요. 같이 가요.',
      '미래의 당신이 고마워할 거예요.',
    ],
    drill: [
      '변명 금지. 바 아래로.',
      '그들은 이미 운동 중이에요. 당신은?',
      '근육이 기다려요. 움직여요.',
    ],
  },
  zh: {
    title: '💪 {0} 正在训练',
    motivational: [
      '轮到你了。一组也算。',
      '健身房开着。去加入他们。',
      '未来的你会感谢现在的你。',
    ],
    drill: [
      '别找借口。去杠铃下面。',
      '他们已经在练了。你呢？',
      '你的肌肉在等你。动起来。',
    ],
  },
  'zh-TW': {
    title: '💪 {0} 正在訓練',
    motivational: [
      '換你了。一組也算。',
      '健身房開著。去加入他們。',
      '未來的你會感謝現在的你。',
    ],
    drill: [
      '別找藉口。去槓鈴下面。',
      '他們已經在練了。你呢？',
      '你的肌肉在等你。動起來。',
    ],
  },
  th: {
    title: '💪 {0} กำลังออกกำลังกายอยู่',
    motivational: [
      'ถึงตาคุณแล้ว แค่เซ็ตเดียวก็มีค่า',
      'ยิมเปิดอยู่ ไปร่วมด้วยเลย',
      'ตัวคุณในอนาคตจะขอบคุณ',
    ],
    drill: [
      'ไม่ต้องมีข้ออ้าง ไปใต้บาร์',
      'พวกเขาออกกำลังกายแล้ว คุณล่ะ',
      'กล้ามเนื้อคุณรออยู่ ขยับตัว',
    ],
  },
};

const friendStartCopyFor = lang => {
  if (lang === 'de-CH') {
    const ch = s => s.replace(/ß/g, 'ss');
    return {
      title: ch(FRIEND_START_COPY.de.title),
      motivational: FRIEND_START_COPY.de.motivational.map(ch),
      drill: FRIEND_START_COPY.de.drill.map(ch),
    };
  }
  return FRIEND_START_COPY[lang] || FRIEND_START_COPY.en;
};

const socialCopyFor = lang => {
  if (lang === 'de-CH') {
    const ch = s => s.replace(/ß/g, 'ss');
    return Object.fromEntries(Object.entries(SOCIAL_COPY.de).map(([k, v]) => [k, ch(v)]));
  }
  return SOCIAL_COPY[lang] || SOCIAL_COPY.en;
};

const planShareCopyFor = lang => {
  if (lang === 'de-CH') {
    const ch = s => s.replace(/ß/g, 'ss');
    return Object.fromEntries(Object.entries(PLAN_SHARE_COPY.de).map(([k, v]) => [k, ch(v)]));
  }
  return PLAN_SHARE_COPY[lang] || PLAN_SHARE_COPY.en;
};

const fill = (text, values) => text.replace(/\{(\d+)\}/g, (_, i) => values[+i] ?? '');

export function friendRequestPush(lang, name) {
  const copy = socialCopyFor(lang);
  return {
    title: copy.friendTitle,
    body: fill(copy.friendBody, [name || 'openGym']),
    tag: 'friend-request',
    url: '#/social',
  };
}

export function reactionPush(lang, name, emoji) {
  const copy = socialCopyFor(lang);
  return {
    title: fill(copy.reactionTitle, [name || 'openGym', emoji || '🔥']),
    body: copy.reactionBody,
    tag: 'social-reaction',
    url: '#/social',
  };
}

export function planSharePush(lang, name) {
  const copy = planShareCopyFor(lang);
  return {
    title: fill(copy.title, [name || 'openGym']),
    body: copy.body,
    tag: 'social-plan',
    url: '#/social',
  };
}

const START_TONES = new Set(['motivational', 'drill', 'mix']);
export function friendStartPush(lang, name, { tone = 'motivational', seed = 0 } = {}) {
  const copy = friendStartCopyFor(lang);
  const chosen = START_TONES.has(tone) ? tone : 'motivational';
  const pool = chosen === 'mix' ? [...copy.motivational, ...copy.drill] : copy[chosen];
  const index = Math.abs(Math.floor(Number(seed) || 0)) % pool.length;
  return {
    title: fill(copy.title, [name || 'openGym']),
    body: pool[index],
    tag: 'friend-start',
    url: '#/social',
  };
}

// The missed-workout nudge (nudge.js). Its copy is translated in the frontend packs and generated
// into nudge-copy.js, so every language the app speaks has it — unlike the strings above, which
// predate that and fall back to English. de-CH is de with ß written ss, as in the frontend
// (lib/i18n-core.js DERIVED_LOCALES).
const nudgeCopyFor = lang => {
  if (lang === 'de-CH') {
    const ch = s => s.replace(/ß/g, 'ss');
    return Object.fromEntries(Object.entries(NUDGE_COPY.de).map(([k, c]) => [k, { title: ch(c.title), lines: c.lines.map(ch) }]));
  }
  return NUDGE_COPY[lang] || NUDGE_COPY.en;
};
export function nudgePush(lang, tone, routine, iso) {
  const copy = nudgeCopyFor(lang)[NUDGE_COPY.en[tone] ? tone : 'friendly'];
  const line = copy.lines[lineIndex(iso, copy.lines.length)];
  const name = routine?.name || 'openGym';
  return { title: copy.title, body: line.replace('{0}', () => name), tag: 'nudge' };
}

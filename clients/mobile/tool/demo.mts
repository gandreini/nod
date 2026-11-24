import { readFileSync } from 'node:fs';

export interface DemoFile {
  name: string;
  mimeType: string;
  bytes: Buffer;
}

export interface DemoEntry {
  role: 'user' | 'assistant';
  text: string;
  minutesAgo: number;
  files?: DemoFile[];
  options?: string[];
  answered?: boolean;
  replyToPrevious?: boolean;
}

export interface DemoReply {
  step: string;
  text: string;
  site?: string;
  options?: string[];
  file?: DemoFile;
  handoff?: true;
}

export interface DemoState {
  step: number;
  removed: string[];
  paused: string[];
  stopped: string[];
  preferences: Record<string, unknown>;
  selection?: { connectionId: string; modelId: string; effort: string };
  limit: number | null;
}

const asset = (name: string) => readFileSync(new URL(`demo/${name}`, import.meta.url));
export const browserPage = asset('browser-page.jpg');
const text = (name: string, body: string): DemoFile => ({
  name,
  mimeType: 'text/markdown',
  bytes: Buffer.from(body),
});

export function chime(seconds = 1.2, rate = 16000) {
  const samples = Math.round(seconds * rate);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    const time = index / rate;
    const tone = time < seconds / 2 ? 660 : 880;
    const fade = Math.min(1, time * 20, (seconds - time) * 4);
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * tone * time) * fade * 9000), 44 + index * 2);
  }
  return wav;
}

export const demoConversation: DemoEntry[] = [
  {
    role: 'assistant',
    minutesAgo: 1500,
    text: "Welcome to the **Nod demo**. Everything here is sample data: the conversation, apps, schedules, usage and vault. Nothing reaches a real person or service.\n\nSend a message at any time and I'll walk you through what Nod can do.",
  },
  {
    role: 'user',
    minutesAgo: 1490,
    text: 'Can you help me plan a quiet weekend away?',
  },
  {
    role: 'assistant',
    minutesAgo: 1489,
    text: "## Weekend plan\n\nHere's a first sketch:\n\n- **Friday:** evening train to Lakeside\n- **Saturday:** walk around the lake, lunch at the harbour\n- **Sunday:** slow breakfast, home by 6 pm\n\nTrain times come from the [demo timetable](https://example.com/timetable).\n\nShould I look for a room as well?",
    options: ['Yes, find a room', 'Not yet'],
    answered: true,
  },
  { role: 'user', minutesAgo: 1488, text: 'Not yet', replyToPrevious: true },
  {
    role: 'assistant',
    minutesAgo: 1487,
    text: 'No problem. I wrote the plan down so you have it in one place.',
    files: [
      text(
        'trip-plan.md',
        '# Weekend at Lakeside\n\n## Friday\n- 17:10 train to Lakeside\n- Check in, dinner nearby\n\n## Saturday\n- Morning walk around the lake\n- Lunch at the harbour\n- Free afternoon\n\n## Sunday\n- Slow breakfast\n- 16:30 train home\n\n_Demo file: all places and times are made up._\n',
      ),
    ],
  },
  {
    role: 'user',
    minutesAgo: 1480,
    text: "Lovely. This is the view I'm hoping for.",
    files: [{ name: 'lake-view.jpg', mimeType: 'image/jpeg', bytes: asset('lake-view.jpg') }],
  },
  {
    role: 'assistant',
    minutesAgo: 1479,
    text: 'Quick voice note: pack a warm layer, the lake gets windy in the evening.',
    files: [{ name: 'voice-note.wav', mimeType: 'audio/wav', bytes: chime() }],
  },
  {
    role: 'user',
    minutesAgo: 60,
    text: 'Can you send me a weekly summary every Monday?',
  },
  {
    role: 'assistant',
    minutesAgo: 59,
    text: "### Weekly summary\n\nDone. Every **Monday at 8:00** I'll send you a short summary:\n\n1. What's on your calendar this week\n2. Emails waiting for a reply\n3. Anything I'm still working on\n\nYou'll find it under **Scheduled**.",
  },
  {
    role: 'assistant',
    minutesAgo: 58,
    text: 'One more thing for the weekend.\n\nWhich train do you prefer on Friday?',
    options: ['17:10 direct', '18:40 with one change', 'Decide later'],
  },
];

export const demoScript: DemoReply[] = [
  {
    step: 'Reading your message',
    text: "I'm Nod's **demo server**, so my answers follow a short script instead of a real model. Everything here is sample data.\n\nKeep chatting to try the main features:\n\n- a question with choices\n- a file I made for you\n- Nod's live browser\n\nSend another message when you're ready.",
  },
  {
    step: 'Thinking of options',
    text: 'Questions show up as cards. Pick an answer below, or type your own.\n\nWhat should we plan next?',
    options: ['A dinner for four', 'A day trip', 'A quiet Sunday'],
  },
  {
    step: 'Writing a packing list',
    text: "Here's a packing list for the weekend. Tap the file to open it, then send another message.",
    file: text(
      'packing-list.md',
      '# Packing list\n\n- Warm layer\n- Walking shoes\n- Rain jacket\n- Book for the train\n- Phone charger\n\n_Demo file._\n',
    ),
  },
  {
    step: 'Opening Demo Travel',
    site: 'demo-travel.example',
    text: "I opened a booking page in my browser and need you for a moment.\n\nTap the page, scroll it, then press **Return to Nod** when you're done.",
    handoff: true,
  },
];

export const scriptReply = (step: number) => demoScript[step % demoScript.length]!;

export const answerReply = (label: string): DemoReply => ({
  step: 'Reading your answer',
  text: `Good pick: **${label}**. In the real Nod I'd start working on it now. Send another message to continue the tour.`,
});

export const returnReply: DemoReply = {
  step: 'Reading the page',
  text: "Thanks, I've got the page back. That's the end of the tour: send another message to start it again.",
};

const minute = 60_000;
const day = 24 * 60 * minute;
const iso = (time: number) => new Date(time).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function lastAt(now: number, weekday: number, hour: number) {
  const date = new Date(now);
  date.setUTCHours(hour, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - weekday + 7) % 7));
  return date.getTime() > now ? date.getTime() - 7 * day : date.getTime();
}

const ids = {
  mail: uuid(401),
  calendar: uuid(402),
  work: uuid(403),
  docs: uuid(404),
  task: uuid(421),
  login: uuid(431),
  card: uuid(432),
  session: uuid(433),
};

const schedules = [
  {
    id: uuid(411),
    number: 510,
    title: 'Weekly summary',
    prompt:
      'Every Monday at 8:00, send me a short summary of my week: calendar, emails waiting for a reply and open tasks.',
    cron: '0 8 * * 1',
    weekday: 1,
    hour: 8,
    monthlyUsd: 0.42,
    preview: 'Your week: 3 events, 2 emails waiting for a reply, nothing overdue.',
  },
  {
    id: uuid(412),
    number: 520,
    title: 'Weekend weather',
    prompt: 'Every Friday at 17:00, check the weekend weather and tell me if I need an umbrella.',
    cron: '0 17 * * 5',
    weekday: 5,
    hour: 17,
    monthlyUsd: 0.18,
    preview: 'Sunny on Saturday, light rain on Sunday afternoon. Pack the umbrella.',
  },
];

function runs(now: number, schedule: (typeof schedules)[number]) {
  const last = lastAt(now, schedule.weekday, schedule.hour);
  return [0, 1, 2].map((week) => {
    const at = iso(last - week * 7 * day);
    return {
      id: uuid(schedule.number + week),
      scheduleId: schedule.id,
      title: schedule.title,
      turnId: uuid(schedule.number + 100 + week),
      scheduledFor: at,
      timeZone: 'UTC',
      createdAt: at,
      status: 'succeeded',
      error: null,
      observation: null,
      messageId: null,
      messagePreview: schedule.preview,
      messageText: schedule.preview,
      costUsd: week === 1 ? 0.11 : 0.09,
    };
  });
}

export function demoSections(now: number, state: DemoState) {
  const kept = <T extends { id?: string; connectionId?: string }>(items: T[]) =>
    items.filter((item) => !state.removed.includes(item.id ?? item.connectionId ?? ''));
  const apps = kept([
    {
      slug: 'demo-mail',
      name: 'Demo Mail',
      status: 'connected',
      connectionId: ids.mail,
      accountId: 'demo-mail-account',
      accountEmail: 'demo@example.com',
      triggersEnabled: true,
      triggerStatus: 'active',
      description: 'Sample inbox for the demo.',
    },
    {
      slug: 'demo-calendar',
      name: 'Demo Calendar',
      status: 'connected',
      connectionId: ids.calendar,
      accountId: 'demo-calendar-account',
      accountEmail: 'demo@example.com',
      triggersEnabled: false,
      description: 'Sample calendar for the demo.',
    },
    {
      slug: 'demo-mail',
      name: 'Demo Mail',
      status: 'connected',
      connectionId: ids.work,
      accountId: 'demo-mail-work',
      accountEmail: 'work@example.com',
      reconnectRequired: true,
      triggersEnabled: false,
      description: 'Sample inbox for the demo.',
    },
    {
      slug: 'mcp-demo-docs',
      name: 'Demo Docs',
      status: 'connected',
      connectionId: ids.docs,
      accountId: 'demo-docs-account',
      accountName: 'Demo Docs',
      triggersEnabled: false,
      canRename: true,
      accessPaths: [{ id: 'demo-docs-mcp', kind: 'mcp', endpoint: 'https://example.com/mcp' }],
      description: 'MCP',
    },
  ]);
  const catalog = [
    ...apps,
    ...['Demo Mail', 'Demo Calendar', 'Demo Notes', 'Demo Chat', 'Demo Files']
      .filter((name) => !apps.some((app) => app.name === name))
      .map((name) => ({
        slug: name.toLowerCase().replace(' ', '-'),
        name,
        status: 'disconnected',
        triggersEnabled: false,
        description: 'Sample app for the demo.',
      })),
  ];
  const scheduleViews = kept(schedules).map((schedule) => {
    const last = runs(now, schedule)[0]!;
    return {
      id: schedule.id,
      title: schedule.title,
      prompt: schedule.prompt,
      kind: 'recurring',
      cron: schedule.cron,
      runAt: null,
      timeZone: 'UTC',
      enabled: !state.paused.includes(schedule.id),
      revision: 1 + state.paused.filter((id) => id === schedule.id).length,
      nextRun: state.paused.includes(schedule.id)
        ? null
        : iso(lastAt(now, schedule.weekday, schedule.hour) + 7 * day),
      lastRun: last,
      baselineObservation: null,
      watch: null,
      monthlyUsd: schedule.monthlyUsd,
    };
  });
  const stopped = state.stopped.includes(ids.task);
  const tasks = kept([
    {
      id: ids.task,
      title: 'Find a quiet room by the lake',
      doneWhen: 'Two rooms are compared with prices',
      now: stopped ? 'Stopped' : 'Finished',
      result: 'Pine Cabin, €118 a night with breakfast, is the quietest option.',
      status: stopped ? 'cancelled' : 'done',
      question: null,
      waitingFor: [],
      nextCheck: null,
      createdAt: iso(now - 2 * day),
      updatedAt: iso(now - 2 * day + 40 * minute),
      closedAt: iso(now - 2 * day + 40 * minute),
      messageId: null,
    },
  ]);
  const monthStart = new Date(now);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const days = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const elapsedDays = new Date(now).getUTCDate();
  const daily = Array.from(
    { length: elapsedDays },
    (_, index) => [0.21, 0.08, 0.34, 0.12, 0.05, 0.27, 0.16][index % 7]!,
  );
  const spentUsd = Math.round(daily.reduce((sum, value) => sum + value, 0) * 100) / 100;
  const entry = (
    id: number,
    at: number,
    title: string,
    source: string,
    costUsd: number,
    actions: object[],
  ) => ({
    id: uuid(700 + id),
    messageId: null,
    at: iso(at),
    title,
    source,
    channel: 'app',
    error: null,
    costUsd,
    models: [{ provider: 'anthropic', model: 'Synthetic Large', billing: 'api' }],
    actions,
  });
  const trust = {
    month: {
      start: iso(monthStart.getTime()),
      days,
      elapsedDays,
      spentUsd,
      forecastUsd: Math.round((spentUsd / elapsedDays) * days * 100) / 100,
      planUsd: 0,
      planUsage: false,
      unpriced: false,
      daily,
      backgroundUsd: 0.42,
      outside: [],
    },
    week: { things: 12, actions: 4, spentUsd: 1.18, planUsd: 0 },
    entries: [
      entry(1, now - 59 * minute, 'Set up the weekly summary', 'chat', 0.06, [
        {
          label: 'Created a schedule',
          because: { kind: 'message', text: 'Can you send me a weekly summary every Monday?' },
        },
      ]),
      entry(2, lastAt(now, 5, 17), 'Weekend weather', 'schedule', 0.09, [
        { label: 'Read Demo Calendar', because: { kind: 'schedule', text: schedules[1]!.prompt } },
      ]),
      entry(3, now - 1489 * minute, 'Plan a quiet weekend away', 'chat', 0.14, [
        { label: 'Read Demo Calendar' },
        { label: 'Searched the web' },
      ]),
    ],
    next: null,
    limit: state.limit === null ? null : { monthlyUsd: state.limit, reached: false },
    taskUsd: 5,
  };
  const vault = kept([
    {
      kind: 'login',
      id: ids.login,
      label: 'Demo Travel',
      origin: 'https://demo-travel.example',
      usernameHint: 'demo@example.com',
      username: 'demo@example.com',
      updatedAt: iso(now - 3 * day),
    },
    {
      kind: 'card',
      id: ids.card,
      label: 'Demo card',
      brand: 'Visa',
      last4: '4242',
      expiryMonth: 12,
      expiryYear: 2030,
      updatedAt: iso(now - 5 * day),
    },
  ]);
  const sessions = kept([
    {
      kind: 'session',
      id: ids.session,
      label: 'Demo Travel',
      origin: 'https://demo-travel.example',
      url: 'https://demo-travel.example/account',
      state: 'saved',
      checkedAt: iso(now - day),
    },
  ]);
  return {
    apps,
    catalog,
    schedules: scheduleViews,
    runs: (id: string) => {
      const schedule = kept(schedules).find((item) => item.id === id);
      return { runs: schedule ? runs(now, schedule) : [], nextCursor: null };
    },
    tasks,
    trust,
    vault,
    sessions,
  };
}

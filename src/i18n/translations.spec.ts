import * as fs from 'fs';
import * as path from 'path';

/**
 * Every message a caller can see must exist in BOTH dictionaries.
 *
 * The response contract uses the message literal as its own i18n key, and the
 * literal is written in English. That has one consequence which hid the problem
 * for a long time: a message with no Arabic entry does not fail, it silently
 * falls through and shows an ENGLISH sentence inside an Arabic app. Nothing
 * logs, nothing 500s, and the only way to notice is to read every screen in
 * Arabic.
 *
 * So the check is mechanical rather than editorial: collect the message
 * literals from the source, and require a key in each dictionary. A new route
 * added without translations fails here, at the moment it is written, instead of
 * being found by a user.
 *
 * What this deliberately does NOT check is translation QUALITY — only presence.
 * A wrong translation is a review problem; a missing one is a bug, and only the
 * second kind can be caught by a machine.
 */
const SRC = path.join(__dirname, '..');
const AR = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'ar', 'translation.json'), 'utf8'),
);
const EN = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'en', 'translation.json'), 'utf8'),
);

/** Flat string keys only — nested sections are authored per language. */
function flatKeys(obj: Record<string, unknown>, prefix = '', out = new Set<string>()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatKeys(v as Record<string, unknown>, key, out);
    else out.add(key);
  }
  return out;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // The dictionaries themselves, and node's own trees, are not sources.
      if (entry.name !== 'i18n' && entry.name !== 'node_modules') sourceFiles(p, acc);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      acc.push(p);
    }
  }
  return acc;
}

/**
 * Message literals written as `message: '...'`.
 *
 * Skipped on purpose:
 *  - ALL_CAPS values — those are machine codes (`errorCode`), never shown;
 *  - anything containing `${` — built at runtime, so no static key exists and
 *    the sentence is composed from parts that are themselves translated.
 */
function collectMessages(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const patterns = [
    new RegExp("message:\\s*'((?:[^'\\\\]|\\\\.)*)'", 'g'),
    new RegExp('message:\\s*"((?:[^"\\\\]|\\\\.)*)"', 'g'),
  ];

  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const msg = m[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
        if (!msg || msg.length < 3) continue;
        if (/^[A-Z0-9_]+$/.test(msg)) continue;
        if (msg.includes('${')) continue;
        const rel = path.relative(SRC, file).replace(/\\/g, '/');
        found.set(msg, [...(found.get(msg) ?? []), rel]);
      }
    }
  }
  return found;
}

/**
 * Thrown-exception messages — `new XxxException('...')` anywhere, and `super('...')`
 * inside an exception class. These reach the user through the exception filter,
 * which keys them exactly like success messages, so an untranslated one shows an
 * Arabic app an English error. Same skip rules as `collectMessages`.
 */
function collectThrownMessages(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const excPatterns = [
    new RegExp("new [A-Za-z]*Exception\\(\\s*'((?:[^'\\\\]|\\\\.)*)'", 'g'),
    new RegExp('new [A-Za-z]*Exception\\(\\s*"((?:[^"\\\\]|\\\\.)*)"', 'g'),
  ];
  const superPatterns = [
    new RegExp("super\\(\\s*'((?:[^'\\\\]|\\\\.)*)'", 'g'),
    new RegExp('super\\(\\s*"((?:[^"\\\\]|\\\\.)*)"', 'g'),
  ];

  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const isExc = /exception/i.test(file);
    const patterns = isExc ? [...excPatterns, ...superPatterns] : excPatterns;
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const msg = m[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
        if (!msg || msg.length < 3) continue;
        if (/^[A-Z0-9_]+$/.test(msg)) continue;
        if (msg.includes('${')) continue;
        const rel = path.relative(SRC, file).replace(/\\/g, '/');
        found.set(msg, [...(found.get(msg) ?? []), rel]);
      }
    }
  }
  return found;
}

describe('Response message translations', () => {
  const messages = collectMessages();
  const arKeys = flatKeys(AR);
  const enKeys = flatKeys(EN);

  it('finds the message literals to check', () => {
    // A guard on the guard: if the extraction ever breaks, the two tests below
    // would pass on an empty set and prove nothing.
    expect(messages.size).toBeGreaterThan(200);
  });

  it('has an Arabic entry for every message', () => {
    const missing = [...messages.entries()]
      .filter(([msg]) => !arKeys.has(msg))
      .map(([msg, files]) => `${msg}   <- ${files[0]}`);

    expect(missing).toEqual([]);
  });

  it('has an English entry for every message', () => {
    const missing = [...messages.entries()]
      .filter(([msg]) => !enKeys.has(msg))
      .map(([msg, files]) => `${msg}   <- ${files[0]}`);

    expect(missing).toEqual([]);
  });

  // ── thrown exceptions are messages too ──────────────────────────────────
  const thrown = collectThrownMessages();

  it('finds the thrown-exception messages to check', () => {
    expect(thrown.size).toBeGreaterThan(100);
  });

  it('has an Arabic entry for every thrown-exception message', () => {
    const missing = [...thrown.entries()]
      .filter(([msg]) => !arKeys.has(msg))
      .map(([msg, files]) => `${msg}   <- ${files[0]}`);

    expect(missing).toEqual([]);
  });

  it('has an English entry for every thrown-exception message', () => {
    const missing = [...thrown.entries()]
      .filter(([msg]) => !enKeys.has(msg))
      .map(([msg, files]) => `${msg}   <- ${files[0]}`);

    expect(missing).toEqual([]);
  });

  it('leaves no Arabic entry still holding the untranslated English', () => {
    // A key copied across without being translated is worse than a missing one:
    // it looks done in every audit and reads as English to the user anyway.
    const untranslated = [...arKeys].filter(
      (k) => typeof AR[k] === 'string' && AR[k] === k && /[A-Za-z]/.test(k),
    );

    expect(untranslated).toEqual([]);
  });

  describe('sign-in method messages', () => {
    const SOCIAL_LOGIN =
      'This email is registered with Google. Please sign in with Google instead.';
    const SOCIAL_REGISTER =
      'This email is already registered with Google. Please sign in with Google instead.';

    it.each([SOCIAL_LOGIN, SOCIAL_REGISTER])(
      'translates "%s" into Arabic',
      (msg) => {
        expect(arKeys.has(msg)).toBe(true);
        expect(AR[msg]).toContain('Google');
        // Must actually be Arabic, not the English sentence copied over.
        expect(AR[msg]).toMatch(/[؀-ۿ]/);
      },
    );

    it.each([SOCIAL_LOGIN, SOCIAL_REGISTER])(
      'keeps "%s" available in English',
      (msg) => {
        expect(enKeys.has(msg)).toBe(true);
        expect(EN[msg]).toBe(msg);
      },
    );
  });
});

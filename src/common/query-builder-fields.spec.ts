import * as fs from 'fs';
import * as path from 'path';

/**
 * Every `alias.property` inside a query builder must name a real property of
 * the entity that alias stands for.
 *
 * This closes a gap that nothing else in the project can see. A query builder
 * takes its conditions as STRINGS:
 *
 *     .orderBy('o.offerPrice', 'ASC')
 *
 * so renaming `offerPrice` to `amount` on the entity leaves that line compiling
 * cleanly — the compiler has no reason to look inside a string. The unit tests
 * do not catch it either, because they mock the repository: a fake query
 * builder returns rows for any condition it is handed. The failure appears only
 * against a real database, as
 *
 *     column o.offerprice does not exist
 *
 * and it appeared exactly there — inside a background job, where nobody was
 * watching. Every push of a material's prices to Odoo had been failing for
 * hours while the Odoo screen went on showing the numbers it happened to hold
 * when the rename landed. Nothing looked broken; the data was simply old.
 *
 * The check is static on purpose: it needs no database, so it runs in the same
 * second as the rest of the suite, on every change.
 */
describe('query-builder field references', () => {
  const SRC = path.join(__dirname, '..');

  /** Every .ts file under src, tests excluded. */
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        out.push(full);
      }
    }
    return out;
  };

  const FILES = walk(SRC);

  /**
   * The property names declared on each entity class.
   *
   * Read from the source rather than from TypeORM metadata: metadata needs a
   * DataSource, and a check that needs a database is a check that stops being
   * run.
   */
  const entityProperties = (() => {
    const byClass = new Map<string, Set<string>>();
    for (const file of FILES) {
      if (!/\.entity\.ts$/.test(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      // Several entity classes can share one file.
      const classes = [...source.matchAll(/export class (\w+)[^{]*\{/g)];
      for (let i = 0; i < classes.length; i++) {
        const start = classes[i].index! + classes[i][0].length;
        const end = i + 1 < classes.length ? classes[i + 1].index! : source.length;
        const body = source.slice(start, end);
        const props = new Set<string>();
        // `name: string;`, `name!: string;`, `name?: string;`, `name = 1;`
        // Two OR four spaces — the entity files disagree about indentation, and
        // insisting on one silently collected nothing for half of them, which
        // reported every reference to those entities as a mistake.
        for (const m of body.matchAll(/^ {2,4}(\w+)\s*[!?]?\s*[:=]/gm)) {
          props.add(m[1]);
        }
        byClass.set(classes[i][1], props);
      }
    }
    return byClass;
  })();

  it('knows about the entities it is meant to be checking', () => {
    // A guard that silently found no entities would pass forever. Named ones,
    // so a moved directory fails here rather than quietly disabling the rule.
    expect(entityProperties.size).toBeGreaterThan(20);
    expect(entityProperties.get('Offer')).toBeDefined();
    expect(entityProperties.get('Offer')!.has('amount')).toBe(true);
  });

  /**
   * Blank out comments, keeping the line count so a report still points at the
   * right line. Without this the guard reads the prose ABOUT a bug as the bug —
   * the comment explaining why `o.offerPrice` was removed names it, in quotes.
   */
  const stripComments = (source: string) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\r\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

  /**
   * The class methods of a file, each with the line it starts on.
   *
   * Aliases are scoped per METHOD, not per file: `a` is a truck assignment in
   * one method and something else two methods down, and a file-wide map would
   * check half the references against the wrong entity — reporting problems
   * that are not there, which is how a guard gets switched off.
   */
  const methodBlocks = (source: string): { body: string; line: number }[] => {
    const lines = source.split(/\r?\n/);
    const starts: number[] = [];
    lines.forEach((line, i) => {
      if (/^ {2,4}(?:(?:private|public|protected|static|async|readonly)\s+)*\w+[<(]/.test(line)) {
        starts.push(i);
      }
    });
    if (!starts.length) return [{ body: source, line: 0 }];
    return starts.map((start, i) => ({
      line: start,
      body: lines.slice(start, starts[i + 1] ?? lines.length).join('\n'),
    }));
  };

  it('references only properties the entity actually has', () => {
    const problems: string[] = [];

    for (const file of FILES) {
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw.includes('createQueryBuilder')) continue;
      const source = stripComments(raw);

      // repository field name → entity class, from `Repository<Entity>`. Read
      // from the whole file: the constructor declares them once, and every
      // method below uses them.
      const repoEntity = new Map<string, string>();
      for (const m of source.matchAll(/(\w+)\s*:\s*Repository<(\w+)>/g)) {
        repoEntity.set(m[1], m[2]);
      }

      for (const block of methodBlocks(source)) {
        // alias → entity, from `this.someRepo.createQueryBuilder('alias')`.
        const candidates = new Map<string, Set<string>>();
        for (const m of block.body.matchAll(
          /this\.(\w+)\s*[\r\n\s]*\.createQueryBuilder\(\s*['"](\w+)['"]/g,
        )) {
          const entity = repoEntity.get(m[1]);
          if (!entity || !entityProperties.has(entity)) continue;
          if (!candidates.has(m[2])) candidates.set(m[2], new Set());
          candidates.get(m[2])!.add(entity);
        }
        // One method can build several queries that all call their root `m`,
        // each over a different entity. Which `m.something` belongs to which is
        // not decidable from the text, so an ambiguous alias is skipped rather
        // than resolved by whichever binding happened to be read last.
        const aliasEntity = new Map<string, string>();
        for (const [alias, entities] of candidates) {
          if (entities.size === 1) aliasEntity.set(alias, [...entities][0]);
        }
        if (!aliasEntity.size) continue;

        // Aliases introduced by a JOIN belong to another entity, and working
        // out which would mean resolving the relation. Left alone rather than
        // guessed at: a guard that reports things it is unsure about gets
        // switched off.
        for (const m of block.body.matchAll(
          /\.(?:inner|left)Join\w*\(\s*[^,]+,\s*['"](\w+)['"]/g,
        )) {
          aliasEntity.delete(m[1]);
        }

        block.body.split(/\r?\n/).forEach((line, i) => {
          // An import path is a string full of dots that names no column.
          if (/^\s*import\b|require\(/.test(line)) return;
          // Only inside quoted strings — `o.amount` in ordinary code is checked
          // by the compiler already.
          for (const str of line.matchAll(/'([^']*)'|"([^"]*)"/g)) {
            const text = str[1] ?? str[2] ?? '';
            if (text.includes('/')) continue; // a path, not a condition
            for (const ref of text.matchAll(/\b(\w+)\.(\w+)\b/g)) {
              const [, alias, prop] = ref;
              // snake_case is a COLUMN written straight into SQL — legal, and
              // deliberate inside a raw sub-select. TypeORM only translates
              // property names, so these are not the mistake being hunted.
              if (prop.includes('_')) continue;
              const entity = aliasEntity.get(alias);
              if (!entity) continue;
              if (entityProperties.get(entity)!.has(prop)) continue;
              problems.push(
                `${path.relative(SRC, file)}:${block.line + i + 1}  ` +
                  `"${alias}.${prop}" — ${entity} has no property "${prop}"`,
              );
            }
          }
        });
      }
    }

    expect(problems).toEqual([]);
  });
});

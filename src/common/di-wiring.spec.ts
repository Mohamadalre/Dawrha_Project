import * as fs from 'fs';
import * as path from 'path';

/**
 * Every repository a provider injects must be registered by its module.
 *
 * This exists because the whole application refused to boot and nothing caught
 * it. `WarehouseAdminService` took a `ProvinceRepository` from the day the
 * governorate rule landed, and `WarehouseModule` never listed `Province` in its
 * `TypeOrmModule.forFeature`. Nest could not build the service, so the process
 * died on startup with a dependency-resolution error.
 *
 * `tsc` passes it — the types are all correct, the wiring is not a type. The
 * unit tests pass it too, and they always will: they construct services with
 * `new Service(mockA, mockB, …)`, so the container is never asked to build
 * anything. A whole category of fatal error lived in the gap between those two.
 *
 * This closes the gap statically: no database, no Redis, no boot — just the
 * source. It reads every module's `forFeature` list, reads every provider that
 * module declares, and matches the `@InjectRepository(X)` calls against it.
 *
 * The stronger check is to actually start the app (`npm run boot:check`), which
 * catches non-repository wiring too. This one is here because it costs
 * milliseconds and runs on every `jest`, so the common case fails in front of
 * whoever caused it rather than in front of whoever next deploys.
 */
const SRC = __dirname.replace(/[\\/]common$/, '');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) acc.push(p);
  }
  return acc;
}

const FILES = walk(SRC);
const MODULES = FILES.filter((f) => f.endsWith('.module.ts'));

/**
 * Comments out, THEN split.
 *
 * The other order is subtly wrong and cost this guard its first run: these
 * lists are heavily commented, and a comment containing a comma — "…how many
 * order shares it has been given, and orders are placed on THIS side" — is cut
 * in two by the split, so the entity on the line below it ends up glued to a
 * comment fragment and is never recognised. The guard then reports a correctly
 * registered entity as missing.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Identifiers inside a bracketed list, ignoring comments and nesting. */
function identifiersIn(block: string): string[] {
  return stripComments(block)
    .split(',')
    .map((raw) => raw.trim())
    .filter((name) => /^[A-Z]\w*$/.test(name));
}

/** Entities listed in this module's `TypeOrmModule.forFeature([...])` calls. */
function registeredEntities(source: string): Set<string> {
  const names = new Set<string>();
  const re = /TypeOrmModule\.forFeature\(\s*\[([\s\S]*?)\]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripComments(source)))) {
    for (const name of identifiersIn(m[1])) names.add(name);
  }
  return names;
}

/** Provider/controller class names this module declares. */
function declaredClasses(source: string): Set<string> {
  const names = new Set<string>();
  for (const key of ['providers', 'controllers']) {
    const block = new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'g');
    let m: RegExpExecArray | null;
    while ((m = block.exec(stripComments(source)))) {
      for (const name of identifiersIn(m[1])) names.add(name);
    }
  }
  return names;
}

/** `@InjectRepository(X)` names inside a class file. */
function injectedRepositories(source: string): string[] {
  return [...source.matchAll(/@InjectRepository\(\s*([A-Z]\w*)\s*\)/g)].map((m) => m[1]);
}

/** file path → the exported class names it defines. */
const CLASS_FILES = new Map<string, string[]>();
for (const file of FILES) {
  const text = fs.readFileSync(file, 'utf8');
  const classes = [...text.matchAll(/export\s+class\s+(\w+)/g)].map((m) => m[1]);
  if (classes.length) CLASS_FILES.set(file, classes);
}

function fileDefining(className: string): string | undefined {
  for (const [file, classes] of CLASS_FILES) {
    if (classes.includes(className)) return file;
  }
  return undefined;
}

/**
 * Providers whose repository legitimately comes from elsewhere.
 *
 * Kept as an explicit list with a reason each, rather than loosening the rule:
 * an exception nobody can see is how the rule stops being one.
 */
const EXEMPT = new Set<string>([
  // Nothing yet. Add `ClassName` here with a comment saying which module
  // supplies its repository and why it is not registered locally.
]);

/** `imports: [...]` module class names. */
function importedModules(source: string): string[] {
  const m = stripComments(source).match(/imports\s*:\s*\[([\s\S]*?)\]\s*,?\s*(?:controllers|providers|exports)\s*:/);
  return m ? identifiersIn(m[1]) : [];
}

/**
 * A module that re-exports `TypeOrmModule` hands its repositories to everyone
 * that imports it.
 *
 * `ShiftModule` does exactly this, which is why `OnboardingSubmissionService`
 * can inject a `ShiftRepository` that `OnboardingModule` never registered — and
 * why a guard that stopped at the module's own `forFeature` would call a
 * perfectly correct arrangement broken. Following the re-export is the
 * difference between a rule people trust and one they learn to silence.
 */
function reExportsRepositories(source: string): boolean {
  const m = stripComments(source).match(/exports\s*:\s*\[([\s\S]*?)\]/);
  return !!m && identifiersIn(m[1]).includes('TypeOrmModule');
}

const MODULE_BY_NAME = new Map<string, string>();
for (const p of MODULES) {
  const name = (fs.readFileSync(p, 'utf8').match(/export\s+class\s+(\w+Module)/) || [])[1];
  if (name) MODULE_BY_NAME.set(name, p);
}

/** Entities this module can inject: its own, plus those imported modules share. */
function availableEntities(modulePath: string): Set<string> {
  const source = fs.readFileSync(modulePath, 'utf8');
  const available = registeredEntities(source);
  for (const importedName of importedModules(source)) {
    const importedPath = MODULE_BY_NAME.get(importedName);
    if (!importedPath) continue;
    const importedSource = fs.readFileSync(importedPath, 'utf8');
    if (!reExportsRepositories(importedSource)) continue;
    for (const entity of registeredEntities(importedSource)) available.add(entity);
  }
  return available;
}

describe('DI wiring — every injected repository is registered by its module', () => {
  const problems: string[] = [];

  for (const modulePath of MODULES) {
    const moduleSource = fs.readFileSync(modulePath, 'utf8');
    const registered = availableEntities(modulePath);
    // A module that registers nothing is not making a claim about repositories.
    if (registered.size === 0) continue;

    const moduleName = path.relative(SRC, modulePath).replace(/\\/g, '/');

    for (const className of declaredClasses(moduleSource)) {
      if (EXEMPT.has(className)) continue;
      const file = fileDefining(className);
      if (!file) continue;

      for (const entity of injectedRepositories(fs.readFileSync(file, 'utf8'))) {
        if (!registered.has(entity)) {
          problems.push(
            `${moduleName}: ${className} injects ${entity}Repository, ` +
              `but ${entity} is not in its TypeOrmModule.forFeature([...])`,
          );
        }
      }
    }
  }

  it('finds modules to check', () => {
    // A guard on the guard: if the parsing ever breaks, the assertion below
    // would pass on an empty set and prove nothing.
    expect(MODULES.length).toBeGreaterThan(5);
  });

  it('has no provider injecting an unregistered repository', () => {
    // Each entry here is an application that would die on startup with
    // "Nest can't resolve dependencies of X".
    expect(problems).toEqual([]);
  });
});

/**
 * Lazy loaders for per-fixture-class editor overrides. A fixture class only needs an entry here
 * when it must interfere with display or validation; otherwise {@link FixtureEditDefault} is used.
 * Keyed by the fixture profile `class`. Each value is a thunk returning a dynamic `import()` whose
 * default export is a {@link FixtureEditDefault} subclass.
 *
 * @example
 *   neewer_basic: () => import('./neewer_basic.js'),
 *
 * @type {Record<string, () => Promise<{ default: new () => import('../FixtureEditDefault.js').FixtureEditDefault }>>}
 */
export const FIXTURE_EDITOR_LOADERS = {}

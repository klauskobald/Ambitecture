import { ScreenFixture } from './screen.js';

const fixtureClasses = new Map([['screen', ScreenFixture]]);

export function createFixture(fixtureClass, profile, instanceConfig) {
  const Ctor = fixtureClasses.get(fixtureClass);
  if (!Ctor) {
    return null;
  }
  return new Ctor(profile, instanceConfig);
}

export function isKnownFixtureClass(fixtureClass) {
  return fixtureClasses.has(fixtureClass);
}

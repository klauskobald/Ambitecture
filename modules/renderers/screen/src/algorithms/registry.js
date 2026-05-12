import { SinglePixelAlgorithm } from './singlePixel.js';

const algorithmClasses = new Map([['singlePixel', SinglePixelAlgorithm]]);

export function isKnownAlgorithmClass(className) {
  return algorithmClasses.has(className);
}

export function createAlgorithm(className, fixtureProfile, instanceConfig, algorithmConfig) {
  const Ctor = algorithmClasses.get(className) ?? SinglePixelAlgorithm;
  return new Ctor(fixtureProfile, instanceConfig, algorithmConfig ?? {});
}

export function registerAlgorithmClass(name, Ctor) {
  algorithmClasses.set(name, Ctor);
}

import {
  adaptIntentTargetValue,
  findIntentPropertyDescriptor,
} from '../src/intentValueAdapter';

const BLEND_CAPS = {
  intentProperties: {
    light: [
      { dotKey: 'params.alpha', type: 'number', range: [0, 1] },
      {
        dotKey: 'params.blend',
        type: 'string',
        display: 'pills',
        options: ['ADD', 'ALPHA', 'MULTIPLY'],
      },
    ],
  },
};

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function main(): void {
  const blendDescriptor = findIntentPropertyDescriptor('light', 'params.blend', BLEND_CAPS);
  if (!blendDescriptor) {
    throw new Error('blend descriptor not found');
  }

  assertEqual(
    adaptIntentTargetValue('light', 'params.blend', 0, BLEND_CAPS),
    'ADD',
    'blend 0',
  );
  assertEqual(
    adaptIntentTargetValue('light', 'params.blend', 0.25, BLEND_CAPS),
    'ALPHA',
    'blend 0.25',
  );
  assertEqual(
    adaptIntentTargetValue('light', 'params.blend', 0.5, BLEND_CAPS),
    'MULTIPLY',
    'blend 0.5',
  );
  assertEqual(
    adaptIntentTargetValue('light', 'params.blend', 1, BLEND_CAPS),
    'MULTIPLY',
    'blend 1',
  );

  assertEqual(
    adaptIntentTargetValue('light', 'params.alpha', 0.42, BLEND_CAPS),
    0.42,
    'alpha pass-through',
  );

  assertEqual(
    adaptIntentTargetValue('light', 'params.unknown', 0.7, BLEND_CAPS),
    0.7,
    'unknown dotKey pass-through',
  );

  console.log('intentValueAdapter: PASS');
}

main();

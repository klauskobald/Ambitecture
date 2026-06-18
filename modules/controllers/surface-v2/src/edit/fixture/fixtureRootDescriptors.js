/**
 * Built-in descriptors for the common root fields of any fixture instance, shared by all
 * fixtures. Per-fixture instance `params` are described by the YAML `instance` section instead
 * (see {@link module:edit/fixture/FixtureEditDefault}). `location` is read-only here because it
 * is edited on the stage (drag + Y-slider); the editor only surfaces it for reference.
 *
 * @type {Array<Record<string, unknown>>}
 */
export const FIXTURE_ROOT_DESCRIPTORS = [
  {
    dotKey: 'name',
    name: 'Name',
    type: 'string',
    display: 'string',
    isMandatory: true,
    noMultiple: true
  },
  {
    dotKey: 'location',
    name: 'Location',
    type: 'vector3',
    display: 'vector3',
    isMandatory: true
  },
  {
    dotKey: 'range',
    name: 'Range',
    type: 'number',
    display: 'scalar',
    range: [0, 9999],
    step: 1,
    // Ease-in: most of the slider's left half covers small ranges (fine control), and it ramps
    // up steeply toward 9999. `quadratic` is a gentler alternative.
    stepFunction: 'cubic',
    isMandatory: true
  },
  {
    dotKey: 'intensityTrim',
    name: 'Intensity Trim',
    type: 'number',
    display: 'scalar',
    range: [0, 10],
    step: 0.05,
    // Quadratic ease-in: fine control at low trim values (dim range), rapid toward 10× boost.
    stepFunction: 'quadratic',
    defaultValue: 1,
    isMandatory: true
  },
  {
    dotKey: 'intensityFn',
    name: 'Intensity Curve',
    type: 'string',
    display: 'pills',
    // Resolved to _caps.functionCurves in FixtureParamsHost._appendSection via getCapabilities().
    optionsRef: 'functionCurves',
    defaultValue: 'quadratic',
    isMandatory: true
  }
]

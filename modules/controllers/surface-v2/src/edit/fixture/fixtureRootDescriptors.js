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
    isMandatory: true
  }
]

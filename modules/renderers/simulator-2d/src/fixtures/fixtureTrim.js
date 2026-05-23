function fixtureTrimBrightness (trim) {
  if (!trim || typeof trim !== 'object') return 1
  const value = trim.brightness
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  return 1
}

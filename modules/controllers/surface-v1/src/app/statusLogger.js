export function info (message, key) {
  const suffix = key ? ` [${key}]` : ''
  console.info(`surface-v1:${suffix} ${message}`)
}

export function warn (message, key) {
  const suffix = key ? ` [${key}]` : ''
  console.warn(`surface-v1:${suffix} ${message}`)
}

export function error (message, key) {
  const suffix = key ? ` [${key}]` : ''
  console.error(`surface-v1:${suffix} ${message}`)
}

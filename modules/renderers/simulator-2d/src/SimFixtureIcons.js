globalThis.SimFixtureIcons = {
  rgbSimple: null,
  screen: null,
  movingHead: null
}

function simLoadSvgImage (src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${src}`))
    img.src = src
  })
}

globalThis.simLoadFixtureIconSvgs = async function simLoadFixtureIconSvgs () {
  const icons = globalThis.SimFixtureIcons
  const [rgb, scr, mh] = await Promise.all([
    simLoadSvgImage('./assets/rgb_simple.svg'),
    simLoadSvgImage('./assets/screen.svg'),
    simLoadSvgImage('./assets/movinghead.svg')
  ])
  icons.rgbSimple = rgb
  icons.screen = scr
  icons.movingHead = mh
}

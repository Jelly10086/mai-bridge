try {
  if (process.env.MAIKO_SKIP_POSTINSTALL === '1') {
    console.log('[mai.ko/postinstall] skipped by MAIKO_SKIP_POSTINSTALL=1')
  } else {
    require('../out/setup/postinstall').postinstall()
  }
} catch (error) {
  const message = error && error.message ? error.message : String(error)
  console.warn(`[mai.ko/postinstall] ${message}`)
}

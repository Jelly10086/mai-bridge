try {
  require('../out/setup/postinstall').postinstall()
} catch (error) {
  const message = error && error.message ? error.message : String(error)
  console.warn(`[mai.ko/postinstall] ${message}`)
}

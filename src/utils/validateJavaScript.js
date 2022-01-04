export function validateJavaScript(script) {
  return new Promise((resolve) => {
    try {
      new Function(script)
      resolve({ isValid: true })
    } catch (err) {
      resolve({
        isValid: false,
        error: {
          line: err.line - 1,
          message: err.toString(),
        },
      })
    }
  })
}

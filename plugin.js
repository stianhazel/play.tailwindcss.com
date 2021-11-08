function getCompilerHook(
  compiler,
  { id, entry, filename, chunkFilename, plugins }
) {
  const webpack = compiler.webpack ?? require('webpack')

  return function (compilation, callback) {
    const outputOptions = {
      filename,
      chunkFilename,
      publicPath: compilation.outputOptions.publicPath,
      // HACK: globalObject is necessary to fix https://github.com/webpack/webpack/issues/6642
      globalObject: 'this',
    }
    const childCompiler = compilation.createChildCompiler(id, outputOptions, [
      new webpack.webworker.WebWorkerTemplatePlugin(),
      new webpack.LoaderTargetPlugin('webworker'),
    ])
    const SingleEntryPlugin = webpack.EntryPlugin ?? webpack.SingleEntryPlugin
    new SingleEntryPlugin(compiler.context, entry, filename).apply(
      childCompiler
    )
    plugins.forEach((plugin) => plugin.apply(childCompiler))

    childCompiler.runAsChild((err) => callback(err))
  }
}

module.exports = class AddWorkerEntryPointPlugin {
  constructor({ id, entry, filename, chunkFilename = undefined, plugins }) {
    this.options = { id, entry, filename, chunkFilename, plugins }
  }

  apply(compiler) {
    const webpack = compiler.webpack ?? require('webpack')
    const compilerHook = getCompilerHook(compiler, this.options)
    const majorVersion = webpack.version.split('.')[0]
    if (parseInt(majorVersion) < 4) {
      compiler.plugin('make', compilerHook)
    } else {
      compiler.hooks.make.tapAsync('AddWorkerEntryPointPlugin', compilerHook)
    }
  }
}

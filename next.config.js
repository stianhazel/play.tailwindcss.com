const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin')
const { createLoader } = require('simple-functional-loader')
const path = require('path')
const fs = require('fs')
const AddWorkerEntryPointPlugin = require('./plugin')
const { featuresArr } = require('monaco-editor-webpack-plugin/out/features')

const featuresById = {}
featuresArr.forEach((feature) => (featuresById[feature.label] = feature))
let featureIds = Object.keys(featuresById)

// console.log(featuresArr)

const externals = {
  'fs-extra': 'self.fsextra',
  resolve: 'self.resolve',
  'fs.realpath': 'self.fsrealpath',
  purgecss: 'self.purgecss',
  chokidar: 'self.chokidar',
  tmp: 'self.tmp',
  'vscode-emmet-helper-bundled': 'null',
}

const moduleOverrides = {
  colorette: path.resolve(__dirname, 'src/modules/colorette.js'),
  fs: path.resolve(__dirname, 'src/modules/fs.js'),
  'is-glob': path.resolve(__dirname, 'src/modules/is-glob.js'),
  'glob-parent': path.resolve(__dirname, 'src/modules/glob-parent.js'),
  'fast-glob': path.resolve(__dirname, 'src/modules/fast-glob.js'),
}

function getExternal({ context, request }, callback) {
  if (/node_modules/.test(context) && externals[request]) {
    return callback(null, externals[request])
  }
  callback()
}

const files = [
  {
    pattern: /modern-normalize/,
    file: require.resolve('modern-normalize'),
  },
  {
    pattern: /normalize/,
    file: require.resolve('normalize.css'),
  },
  {
    pattern: /preflight/,
    tailwindVersion: 1,
    file: path.resolve(
      __dirname,
      'node_modules/tailwindcss-v1/lib/plugins/css/preflight.css'
    ),
  },
  {
    pattern: /preflight/,
    tailwindVersion: 2,
    file: path.resolve(
      __dirname,
      'node_modules/tailwindcss/lib/plugins/css/preflight.css'
    ),
  },
  {
    pattern: /preflight/,
    tailwindVersion: 3,
    file: path.resolve(
      __dirname,
      'node_modules/tailwindcss-v3/lib/css/preflight.css'
    ),
  },
]

function createReadFileReplaceLoader(tailwindVersion) {
  return createLoader(function (source) {
    return source.replace(/_fs\.default\.readFileSync\(.*?'utf8'\)/g, (m) => {
      for (let i = 0; i < files.length; i++) {
        if (
          files[i].pattern.test(m) &&
          (!files[i].tailwindVersion ||
            files[i].tailwindVersion === tailwindVersion)
        ) {
          return (
            '`' +
            fs.readFileSync(files[i].file, 'utf8').replace(/`/g, '\\`') +
            '`'
          )
        }
      }
      return m
    })
  })
}

class RenameOutputPlugin {
  constructor(map) {
    this.map = map
  }
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('RenameOutputPlugin', (compilation) => {
      compilation.hooks.optimizeChunks.tap('RenameOutputPlugin', (chunks) => {
        chunks.forEach((chunk) => {
          console.log(chunk.filenameTemplate)
          if (this.map[chunk.name]) {
            chunk.filenameTemplate = this.map[chunk.name]
          }
        })
      })
    })
  }
}

module.exports = {
  async headers() {
    return [
      {
        source: '/plugins/:path*',
        headers: [
          {
            key: 'cache-control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]
  },
  webpack: (config, { isServer, webpack, dev, defaultLoaders }) => {
    config.resolve.alias = { ...config.resolve.alias, ...moduleOverrides }

    config.module.rules
      .filter((rule) => rule.oneOf)
      .forEach((rule) => {
        rule.oneOf.forEach((r) => {
          if (
            r.issuer &&
            r.issuer.and &&
            r.issuer.and.length === 1 &&
            r.issuer.and[0].source &&
            r.issuer.and[0].source.replace(/\\/g, '') ===
              path.resolve(process.cwd(), 'src/pages/_app')
          ) {
            r.issuer.or = [
              ...r.issuer.and,
              /[\\/]node_modules[\\/]monaco-editor[\\/]/,
            ]
            delete r.issuer.and
            delete r.issuer.not
          }
        })
      })

    // config.plugins.push(
    //   new MonacoWebpackPlugin({
    //     languages: ['css', 'typescript', 'javascript', 'html'],
    //     // filename: 'static/chunks/[name].[contenthash].worker.js',
    //     globalAPI: true,
    //   })
    // )

    if (!isServer) {
      if (config.externals) {
        config.externals.push(getExternal)
      } else {
        config.externals = [getExternal]
      }
    }

    config.module.rules.push({
      test: {
        or: [
          require.resolve('monaco-editor/esm/vs/language/css/cssWorker.js'),
          require.resolve('monaco-editor/dev/vs/language/css/cssWorker.js'),
        ],
      },
      use: [
        createLoader(function (source) {
          return source.replace(
            "case 'css':",
            "case 'css':\ncase 'tailwindcss':"
          )
        }),
      ],
    })

    config.module.rules.push({
      test: require.resolve('tailwindcss-v1/lib/plugins/preflight.js'),
      use: [createReadFileReplaceLoader(1)],
    })

    config.module.rules.push({
      test: /tailwindcss\/lib\/plugins\/preflight\.js/,
      use: [createReadFileReplaceLoader(2)],
    })

    config.module.rules.push({
      test: /tailwindcss-v3\/lib\/corePlugins\.js/,
      use: [createReadFileReplaceLoader(3)],
    })

    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.TAILWIND_MODE': JSON.stringify('build'),
        'process.env.TAILWIND_DISABLE_TOUCH': true,
      })
    )

    config.module.rules.push({
      resourceQuery: /fields/,
      use: createLoader(function (source) {
        let fields = new URLSearchParams(this.resourceQuery)
          .get('fields')
          .split(',')

        let res = JSON.stringify(JSON.parse(source), (key, value) => {
          if (['', ...fields].includes(key)) {
            if (key === 'main') {
              return path.relative(
                path.resolve(__dirname, 'node_modules'),
                path.resolve(path.dirname(this.resourcePath), value)
              )
            }
            return value
          }
          return undefined
        })

        return res
      }),
    })

    let browsers = require('browserslist')([
      '> 1%',
      'not edge <= 18',
      'not ie 11',
      'not op_mini all',
    ])

    config.module.rules.push({
      test: require.resolve('browserslist'),
      use: [
        createLoader(function (_source) {
          return `
            module.exports = () => (${JSON.stringify(browsers)})
          `
        }),
      ],
    })

    config.module.rules.push({
      test: require.resolve('caniuse-lite/dist/unpacker/index.js'),
      use: [
        createLoader(function (_source) {
          let agents = require('caniuse-lite/dist/unpacker/agents.js').agents

          for (let name in agents) {
            for (let key in agents[name]) {
              if (key !== 'prefix' && key !== 'prefix_exceptions') {
                delete agents[name][key]
              }
            }
          }

          let features = require('caniuse-lite').feature(
            require('caniuse-lite/data/features/css-featurequeries.js')
          )

          return `
            export const agents = ${JSON.stringify(agents)}
            export function feature() {
              return ${JSON.stringify(features)}
            }
          `
        }),
      ],
    })

    // config.module.rules.push({
    //   test: /monaco-editor\/esm\/vs\/editor\/editor\.worker\.js$/,
    //   use: [
    //     {
    //       loader: 'file-loader',
    //       options: { name: 'static/chunks/[name].js' },
    //     },
    //     defaultLoaders.babel,
    //   ],
    // })

    config.module.rules.push({
      test: require.resolve('autoprefixer/data/prefixes.js'),
      use: [
        createLoader(function (_source) {
          let result = require('autoprefixer/data/prefixes.js')

          for (let key in result) {
            result[key].browsers = result[key].browsers.filter((b) =>
              browsers.includes(b)
            )
            if (result[key].browsers.length === 0) {
              delete result[key]
            }
          }

          return `module.exports = ${JSON.stringify(result)}`
        }),
      ],
    })

    // config.module.rules.push({
    //   test: /\.worker\.js$/,
    //   loader: 'worker-loader',
    //   // options: {
    //   //   publicPath: '/_next/',
    //   //   filename: 'static/chunks/[name].[contenthash].worker.js',
    //   //   chunkFilename: 'static/chunks/[id].[contenthash].worker.js',
    //   // },
    // })

    config.output.globalObject = 'self'

    // let chunk = config.output.chunkFilename
    // console.log({ chunk })
    // config.output.chunkFilename = ({ chunk }) => {
    //   if (chunk.id.includes('monaco-editor_esm_vs_language')) {
    //     return '[name].worker.js'
    //   }
    //   return chunk
    // }
    // config.output.chunkFilename.replace = (...args) => chunk.replace(...args)

    // if (!dev && isServer) {
    let originalEntry = config.entry

    config.entry = async () => {
      const entries = { ...(await originalEntry()) }
      // console.log(entries)
      // delete entries['main.js']
      // entries['scripts/buildBuiltinPlugins'] =
      //   './src/scripts/buildBuiltinPlugins.js'
      return {
        ...entries,
        // 'editor.worker': 'monaco-editor/esm/vs/editor/editor.worker.js',
        // 'css.worker': 'monaco-editor/esm/vs/language/css/css.worker',
        // 'ts.worker': 'monaco-editor/esm/vs/language/typescript/ts.worker',
        // 'html.worker': 'monaco-editor/esm/vs/language/html/html.worker',
      }
    }
    // }

    console.log(config.output)

    let workers = [
      {
        label: 'editorWorkerService',
        id: 'vs/editor/editor',
        entry: 'vs/editor/editor.worker',
      },
      {
        label: 'html',
        id: 'vs/language/html/htmlWorker',
        entry: 'vs/language/html/html.worker',
      },
    ]

    config.plugins.push(
      ...workers.map(
        ({ label, id, entry }) =>
          new AddWorkerEntryPointPlugin({
            id,
            entry: require.resolve(path.join('monaco-editor/esm', entry)),
            filename: isServer ? `${label}.js` : `static/chunks/${label}.js`,
            chunkFilename: isServer
              ? `${label}.js`
              : `static/chunks/${label}.js`,
            plugins: [
              new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
            ],
          })
      )
    )

    if (!isServer) {
      config.plugins
        .push
        // new RenameOutputPlugin({
        //   'editor.worker': 'static/chunks/[name].js',
        //   'ts.worker': 'static/chunks/[name].js',
        //   'html.worker': 'static/chunks/[name].js',
        //   'css.worker': 'static/chunks/[name].js',
        // })
        ()
    }

    config.module.rules.push({
      test: /monaco-editor[/\\]esm[/\\]vs[/\\]editor[/\\]editor.(api|main).js/,
      use: [
        defaultLoaders.babel,
        {
          loader: path.resolve(__dirname, 'include.js'),
          options: {
            globals: {
              MonacoEnvironment: `(function () {
                return {
                  globalAPI: true,
                  getWorkerUrl() {
                    console.log("yo")
                  }
                };
              })()`,
            },
            pre: featuresArr
              .map((x) => x.entry)
              .flat()
              .map((x) => require.resolve(path.join('monaco-editor/esm', x))),
            post: [
              // html
              'vs/basic-languages/html/html.contribution',
              'vs/language/html/monaco.contribution',
              // css
              'vs/basic-languages/css/css.contribution',
              'vs/language/css/monaco.contribution',
              // js
              'vs/basic-languages/javascript/javascript.contribution',
              // ts
              'vs/basic-languages/typescript/typescript.contribution',
              'vs/language/typescript/monaco.contribution',
            ].map((x) => require.resolve(path.join('monaco-editor/esm', x))),
          },
        },
      ],
    })

    // console.log(isServer, config.output)

    return config
  },
}

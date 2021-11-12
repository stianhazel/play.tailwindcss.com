import * as monaco from 'monaco-editor'
import { emmetHTML } from 'emmet-monaco-es'
import parseAbbreviation from '@emmetio/abbreviation'
import format from '@emmetio/markup-formatters'
import transform from '@emmetio/html-transform'
import Profile from '@emmetio/output-profile'
import { HTML_URI } from './html'
import { requestResponse } from '../utils/workers'

// https://github.com/troy351/emmet-monaco-es/blob/master/src/html.ts#L34-L52
const option = {
  field: (index, placeholder) =>
    `\${${index}${placeholder ? ':' + placeholder : ''}}`,
  profile: new Profile(),
  variables: {
    lang: 'en',
    locale: 'en-US',
    charset: 'UTF-8',
  },
}
function expand(abbr) {
  return format(
    parseAbbreviation(abbr).use(transform, null, null),
    option.profile,
    option
  )
}

export function setupEmmet(worker) {
  const _registerCompletionItemProvider =
    monaco.languages.registerCompletionItemProvider
  monaco.languages.registerCompletionItemProvider = (
    lang,
    { triggerCharacters, provideCompletionItems }
  ) => {
    return _registerCompletionItemProvider(lang, {
      triggerCharacters: [...triggerCharacters, '/', ...'0123456789'.split('')],
      provideCompletionItems: async (model, position) => {
        const result = provideCompletionItems(model, position)
        if (!result) return result

        const suggestions = result.suggestions.map((suggestion) => {
          const transformed = suggestion.label
            .replace(/(\d+)\/(\d+)/g, '$1__SLASH__$2')
            .replace(/(\d+)\.(\d+(?:[^a-z0-9]|$))/gi, '$1__DOT__$2')

          if (/__(SLASH|DOT)__/.test(transformed)) {
            const expandText = expand(transformed)
              .replace(/__SLASH__/g, '/')
              .replace(/__DOT__/g, '.')

            suggestion.insertText = expandText
            suggestion.documentation = expandText
              .replace(/([^\\])\$\{\d+\}/g, '$1|')
              .replace(/\$\{\d+:([^\}]+)\}/g, '$1')
          }

          return suggestion
        })

        if (suggestions.length > 0 && worker) {
          const range = {
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          }

          const line = model.getValueInRange(range)

          if (line.includes('.')) {
            const partialClass = line
              .replace(/(\d+)\.($|\d+(?:[^a-z0-9]|$))/gi, '$1__DOT__$2')
              .split('.')
              .pop()
              .replace(/__DOT__/g, '.')

            const { result } = await requestResponse(worker, {
              lsp: {
                type: 'completeString',
                text: partialClass,
                language: 'html',
                uri: HTML_URI,
                range: {
                  ...range,
                  startColumn: range.endColumn - partialClass.length,
                },
              },
            })

            if (result) {
              suggestions.push(
                ...result.suggestions.map((suggestion) => ({
                  ...suggestion,
                  command: { id: 'editor.action.triggerSuggest', title: '' },
                }))
              )
            }
          }
        }

        return { ...result, suggestions }
      },
      async resolveCompletionItem(_model, _position, item, _token) {
        if (item.detail === 'Emmet Abbreviation') return item

        let { result } = await requestResponse(worker, {
          lsp: {
            type: 'resolveCompletionItem',
            item,
          },
        })

        return result
      },
    })
  }

  const emmet = emmetHTML()

  monaco.languages.registerCompletionItemProvider = _registerCompletionItemProvider

  return emmet
}

import { Extension, getChangedRanges } from '@tiptap/core'
import { EditorState, Plugin, PluginKey, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import katex from 'katex'
import type { KatexOptions } from 'katex'

type DecoSpec = {
  isEditable: boolean
  isEditing: boolean
  content: string
  displayMode: boolean
}

type Deco = Omit<Decoration, 'spec'> & { spec: DecoSpec }

type PluginState =
  | { decorations: DecorationSet; isEditable: boolean }
  | { decorations: undefined; isEditable: undefined }

function getAffectedRange(
  newState: EditorState,
  previousPluginState: PluginState,
  isEditable: boolean,
  tr: Transaction,
  state: EditorState,
) {
  const docSize = newState.doc.nodeSize - 2
  let minFrom = 0
  let maxTo = docSize

  if (previousPluginState.isEditable !== isEditable) {
    minFrom = 0
    maxTo = docSize
  } else if (tr.docChanged) {
    minFrom = docSize
    maxTo = 0
    getChangedRanges(tr).forEach(range => {
      minFrom = Math.min(minFrom, range.newRange.from - 1, range.oldRange.from - 1)
      maxTo = Math.max(maxTo, range.newRange.to + 1, range.oldRange.to + 1)
    })
  } else if (tr.selectionSet) {
    const { $from, $to } = state.selection
    const { $from: $newFrom, $to: $newTo } = newState.selection
    minFrom = Math.min(
      $from.depth === 0 ? 0 : $from.before(),
      $newFrom.depth === 0 ? 0 : $newFrom.before(),
    )
    maxTo = Math.max(
      $to.depth === 0 ? maxTo : $to.after(),
      $newTo.depth === 0 ? maxTo : $newTo.after(),
    )
  }

  return {
    minFrom: Math.max(minFrom, 0),
    maxTo: Math.min(maxTo, docSize),
  }
}

const defaultShouldRender = (state: EditorState, pos: number) => {
  const $pos = state.doc.resolve(pos)
  return $pos.parent.type.name !== 'codeBlock'
}

// PDF parsers (MinerU) often emit `\left{` / `\right}` where KaTeX needs the
// brace to be escaped as a delimiter. Without this, KaTeX treats `{` as a
// group-start and fails parsing the rest of the expression.
function normalizeLatexDelimiters(content: string): string {
  return content
    .replace(/\\left\{/g, '\\left\\{')
    .replace(/\\right\}/g, '\\right\\}')
    // Set notation: ``\in { ... }`` (and siblings) should be ``\in \{ ... \}``;
    // otherwise KaTeX silently swallows the braces and renders ``\in 1,..,K``.
    // Restricted to non-nested braces so we don't touch ``\frac{a}{b}`` or
    // subscripts like ``x_{n}``.
    .replace(
      /\\(in|notin|subset|subseteq|supset|supseteq|cup|cap)(\b\s*)\{([^{}]*)\}/g,
      '\\$1$2\\{$3\\}',
    )
}

export const MathematicsDisplayMode = Extension.create<{
  regex: RegExp
  katexOptions?: KatexOptions
  shouldRender?: (state: EditorState, pos: number, node: any) => boolean
}>({
  name: 'Mathematics',

  addOptions() {
    return {
      regex: /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g,
      katexOptions: {},
      shouldRender: defaultShouldRender,
    }
  },

  addProseMirrorPlugins() {
    const { regex, katexOptions = {}, shouldRender = defaultShouldRender } = this.options
    const editor = this.editor

    return [
      new Plugin<PluginState>({
        key: new PluginKey('mathematics'),

        state: {
          init() {
            return { decorations: undefined, isEditable: undefined }
          },
          apply(tr, previousPluginState, state, newState) {
            if (!tr.docChanged && !tr.selectionSet && previousPluginState.decorations) {
              return previousPluginState
            }

            const nextDecorationSet = (previousPluginState.decorations || DecorationSet.empty).map(
              tr.mapping,
              tr.doc,
            )
            const { selection } = newState
            const isEditable = editor.isEditable
            const decorationsToAdd: Deco[] = []
            const { minFrom, maxTo } = getAffectedRange(newState, previousPluginState, isEditable, tr, state)

            newState.doc.nodesBetween(minFrom, maxTo, (node, pos) => {
              const enabled = shouldRender(newState, pos, node)

              if (node.isText && node.text && enabled) {
                let match: RegExpExecArray | null
                const localRegex = new RegExp(regex.source, regex.flags)

                // eslint-disable-next-line no-cond-assign
                while ((match = localRegex.exec(node.text))) {
                  const from = pos + match.index
                  const to = from + match[0].length

                  // group 1 = display math ($$...$$), group 2 = inline math ($...$)
                  const isDisplayMath = match[1] !== undefined
                  const content = isDisplayMath ? match[1] : match[2]

                  if (content) {
                    const selectionSize = selection.from - selection.to
                    const anchorIsInside = selection.anchor >= from && selection.anchor <= to
                    const rangeIsInside = selection.from >= from && selection.to <= to
                    const isEditing = (selectionSize === 0 && anchorIsInside) || rangeIsInside

                    if (
                      nextDecorationSet.find(
                        from,
                        to,
                        (deco: DecoSpec) =>
                          isEditing === deco.isEditing &&
                          content === deco.content &&
                          isEditable === deco.isEditable &&
                          isDisplayMath === deco.displayMode,
                      ).length
                    ) {
                      continue
                    }

                    decorationsToAdd.push(
                      Decoration.inline(
                        from,
                        to,
                        {
                          class:
                            isEditing && isEditable
                              ? 'Tiptap-mathematics-editor'
                              : 'Tiptap-mathematics-editor Tiptap-mathematics-editor--hidden',
                          style:
                            !isEditing || !isEditable
                              ? 'display: inline-block; height: 0; opacity: 0; overflow: hidden; position: absolute; width: 0;'
                              : undefined,
                        },
                        {
                          content,
                          isEditable,
                          isEditing,
                          displayMode: isDisplayMath,
                        } satisfies DecoSpec,
                      ),
                    )

                    if (!isEditable || !isEditing) {
                      decorationsToAdd.push(
                        Decoration.widget(
                          from,
                          () => {
                            const element = document.createElement('span')
                            element.classList.add('Tiptap-mathematics-render')

                            if (isEditable) {
                              element.classList.add('Tiptap-mathematics-render--editable')
                            }

                            // KaTeX's \tag (and other equation-numbering macros)
                            // only works with displayMode: true. If the regex
                            // matched as inline ($…$) but the content uses
                            // \tag, render as display anyway — otherwise KaTeX
                            // throws and the user sees nothing useful.
                            const needsDisplay = /\\tag\b|\\notag\b|\\begin\{align/.test(content!)
                            const useDisplayMode = isDisplayMath || needsDisplay
                            const normalized = normalizeLatexDelimiters(content!)
                            try {
                              katex.render(normalized, element, {
                                ...katexOptions,
                                displayMode: useDisplayMode,
                              })
                            } catch (err) {
                              element.classList.add('Tiptap-mathematics-error')
                              element.textContent = err instanceof Error ? err.message : String(err)
                            }

                            return element
                          },
                          {
                            content,
                            isEditable,
                            isEditing,
                            displayMode: isDisplayMath,
                          } satisfies DecoSpec,
                        ),
                      )
                    }
                  }
                }
              }
            })

            const decorationsToRemove = decorationsToAdd.flatMap(deco =>
              nextDecorationSet.find(deco.from, deco.to),
            )

            return {
              decorations: nextDecorationSet
                .remove(decorationsToRemove)
                .add(tr.doc, decorationsToAdd),
              isEditable,
            }
          },
        },

        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty
          },
        },
      }),
    ]
  },
})

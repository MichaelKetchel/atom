/** @babel */

import TextEditorRegistry from '../src/text-editor-registry'
import TextEditor from '../src/text-editor'
import {it, fit, ffit, fffit} from './async-spec-helpers'
import dedent from 'dedent'

describe('TextEditorRegistry', function () {
  let registry, editor

  beforeEach(function () {
    registry = new TextEditorRegistry({
      config: atom.config,
      grammarRegistry: atom.grammars
    })

    editor = new TextEditor({
      config: atom.config,
      clipboard: atom.clipboard,
    })
  })

  afterEach(function () {
    registry.destroy()
  })

  describe('.add', function () {
    it('adds an editor to the list of registered editors', function () {
      registry.add(editor)
      expect(editor.registered).toBe(true)
      expect(registry.editors.size).toBe(1)
      expect(registry.editors.has(editor)).toBe(true)
    })

    it('returns a Disposable that can unregister the editor', function () {
      const disposable = registry.add(editor)
      expect(registry.editors.size).toBe(1)
      disposable.dispose()
      expect(registry.editors.size).toBe(0)
      expect(editor.registered).toBe(false)
    })
  })

  describe('.observe', function () {
    it('calls the callback for current and future editors until unsubscribed', function () {
      const spy = jasmine.createSpy()
      const [editor1, editor2, editor3] = [{}, {}, {}]
      registry.add(editor1)
      const subscription = registry.observe(spy)
      expect(spy.calls.length).toBe(1)

      registry.add(editor2)
      expect(spy.calls.length).toBe(2)
      expect(spy.argsForCall[0][0]).toBe(editor1)
      expect(spy.argsForCall[1][0]).toBe(editor2)
      subscription.dispose()

      registry.add(editor3)
      expect(spy.calls.length).toBe(2)
    })
  })

  describe('.maintainGrammar', function () {
    it('assigns a grammar to the editor based on its path', async function () {
      await atom.packages.activatePackage('language-javascript')
      await atom.packages.activatePackage('language-c')

      editor.getBuffer().setPath('test.js')
      registry.maintainGrammar(editor)

      expect(editor.getGrammar().name).toBe('JavaScript')

      editor.getBuffer().setPath('test.c')
      expect(editor.getGrammar().name).toBe('C')
    })

    it('updates the editor\'s grammar when a more appropriate grammar is added for its path', async function () {
      expect(editor.getGrammar().name).toBe('Null Grammar')

      editor.getBuffer().setPath('test.js')
      registry.maintainGrammar(editor)
      await atom.packages.activatePackage('language-javascript')
      expect(editor.getGrammar().name).toBe('JavaScript')
    })

    it('returns a disposable that can be used to stop the registry from updating the editor', async function () {
      await atom.packages.activatePackage('language-javascript')

      const previousSubscriptionCount = getSubscriptionCount(editor)
      const disposable = registry.maintainGrammar(editor)
      expect(getSubscriptionCount(editor)).toBeGreaterThan(previousSubscriptionCount)
      expect(registry.editorsWithMaintainedGrammar.size).toBe(1)

      editor.getBuffer().setPath('test.js')
      expect(editor.getGrammar().name).toBe('JavaScript')

      editor.getBuffer().setPath('test.txt')
      expect(editor.getGrammar().name).toBe('Null Grammar')

      disposable.dispose()
      expect(getSubscriptionCount(editor)).toBe(previousSubscriptionCount)
      expect(registry.editorsWithMaintainedGrammar.size).toBe(0)

      editor.getBuffer().setPath('test.js')
      expect(editor.getGrammar().name).toBe('Null Grammar')
    })
  })

  describe('.setGrammarOverride', function () {
    it('sets the editor\'s grammar and does not update it based on other criteria', async function () {
      await atom.packages.activatePackage('language-c')
      await atom.packages.activatePackage('language-javascript')

      registry.maintainGrammar(editor)
      editor.getBuffer().setPath('file-1.js')
      expect(editor.getGrammar().name).toBe('JavaScript')

      registry.setGrammarOverride(editor, 'source.c')
      expect(editor.getGrammar().name).toBe('C')

      editor.getBuffer().setPath('file-3.rb')
      await atom.packages.activatePackage('language-ruby')
      expect(editor.getGrammar().name).toBe('C')

      editor.getBuffer().setPath('file-1.js')
      expect(editor.getGrammar().name).toBe('C')
    })
  })

  describe('.clearGrammarOverride', function () {
    it('resumes setting the grammar based on its path and content', async function () {
      await atom.packages.activatePackage('language-c')
      await atom.packages.activatePackage('language-javascript')

      registry.maintainGrammar(editor)
      editor.getBuffer().setPath('file-1.js')
      expect(editor.getGrammar().name).toBe('JavaScript')

      registry.setGrammarOverride(editor, 'source.c')
      expect(registry.getGrammarOverride(editor)).toBe('source.c')
      expect(editor.getGrammar().name).toBe('C')

      registry.clearGrammarOverride(editor)
      expect(editor.getGrammar().name).toBe('JavaScript')

      editor.getBuffer().setPath('file-3.rb')
      await atom.packages.activatePackage('language-ruby')
      expect(editor.getGrammar().name).toBe('Ruby')
      expect(registry.getGrammarOverride(editor)).toBe(undefined)
    })
  })

  describe('.maintainConfig(editor)', function () {
    it('does not update the editor when config settings change for unrelated scope selectors', async function () {
      await atom.packages.activatePackage('language-javascript')

      const editor2 = new TextEditor({
        config: atom.config,
        clipboard: atom.clipboard,
      })

      editor2.setGrammar(atom.grammars.selectGrammar('test.js'))

      registry.maintainConfig(editor)
      registry.maintainConfig(editor2)

      expect(editor.getRootScopeDescriptor().getScopesArray()).toEqual(['text.plain'])
      expect(editor2.getRootScopeDescriptor().getScopesArray()).toEqual(['source.js'])

      expect(editor.getEncoding()).toBe('utf8')
      expect(editor2.getEncoding()).toBe('utf8')

      atom.config.set('core.fileEncoding', 'utf16le', {scopeSelector: '.text.plain'})
      atom.config.set('core.fileEncoding', 'utf16be', {scopeSelector: '.source.js'})

      expect(editor.getEncoding()).toBe('utf16le')
      expect(editor2.getEncoding()).toBe('utf16be')
    })

    it('updates the editor\'s settings when its grammar changes', async function () {
      await atom.packages.activatePackage('language-javascript')

      registry.maintainConfig(editor)

      atom.config.set('core.fileEncoding', 'utf16be', {scopeSelector: '.source.js'})
      expect(editor.getEncoding()).toBe('utf8')

      atom.config.set('core.fileEncoding', 'utf16le', {scopeSelector: '.source.js'})
      expect(editor.getEncoding()).toBe('utf8')

      editor.setGrammar(atom.grammars.grammarForScopeName('source.js'))
      expect(editor.getEncoding()).toBe('utf16le')

      atom.config.set('core.fileEncoding', 'utf16be', {scopeSelector: '.source.js'})
      expect(editor.getEncoding()).toBe('utf16be')

      editor.setGrammar(atom.grammars.selectGrammar('test.txt'))
      expect(editor.getEncoding()).toBe('utf8')
    })

    it('returns a disposable that can be used to stop the registry from updating the editor\'s config', async function () {
      await atom.packages.activatePackage('language-javascript')

      const previousSubscriptionCount = getSubscriptionCount(editor)
      const disposable = registry.maintainConfig(editor)
      expect(getSubscriptionCount(editor)).toBeGreaterThan(previousSubscriptionCount)
      expect(registry.editorsWithMaintainedConfig.size).toBe(1)

      atom.config.set('core.fileEncoding', 'utf16be')
      expect(editor.getEncoding()).toBe('utf16be')
      atom.config.set('core.fileEncoding', 'utf8')
      expect(editor.getEncoding()).toBe('utf8')

      disposable.dispose()

      atom.config.set('core.fileEncoding', 'utf16be')
      expect(editor.getEncoding()).toBe('utf8')
      expect(getSubscriptionCount(editor)).toBe(previousSubscriptionCount)
      expect(registry.editorsWithMaintainedConfig.size).toBe(0)
    })

    it('sets the encoding based on the config', function () {
      editor.setEncoding('utf8')
      expect(editor.getEncoding()).toBe('utf8')

      atom.config.set('core.fileEncoding', 'utf16le')
      registry.maintainConfig(editor)
      expect(editor.getEncoding()).toBe('utf16le')

      atom.config.set('core.fileEncoding', 'utf8')
      expect(editor.getEncoding()).toBe('utf8')
    })

    it('sets the tab length based on the config', function () {
      editor.setTabLength(4)
      expect(editor.getTabLength()).toBe(4)

      atom.config.set('editor.tabLength', 8)
      registry.maintainConfig(editor)
      expect(editor.getTabLength()).toBe(8)

      atom.config.set('editor.tabLength', 4)
      expect(editor.getTabLength()).toBe(4)
    })

    it('enables soft tabs when the tabType config setting is "soft"', function () {
      atom.config.set('editor.tabType', 'soft')
      registry.maintainConfig(editor)
      expect(editor.getSoftTabs()).toBe(true)
    })

    it('disables soft tabs when the tabType config setting is "hard"', function () {
      atom.config.set('editor.tabType', 'hard')
      registry.maintainConfig(editor)
      expect(editor.getSoftTabs()).toBe(false)
    })

    describe('when the "tabType" config setting is "auto"', function () {
      it('enables or disables soft tabs based on the editor\'s content', async function () {
        await atom.packages.activatePackage('language-javascript')
        editor.setGrammar(atom.grammars.selectGrammar('test.js'))
        atom.config.set('editor.tabType', 'auto')

        registry.maintainConfig(editor)

        editor.setText(dedent`
          {
            hello;
          }
        `)
        editor.tokenizedBuffer.retokenizeLines()
        expect(editor.getSoftTabs()).toBe(true)

        editor.setText(dedent`
          {
          	hello;
          }
        `)
        editor.tokenizedBuffer.retokenizeLines()
        expect(editor.getSoftTabs()).toBe(false)

        editor.setText(dedent`
          /*
           * Comment with a leading space.
           */
          {
          ${'\t'}hello;
          }
        ` + editor.getText())
        editor.tokenizedBuffer.retokenizeLines()
        expect(editor.getSoftTabs()).toBe(false)

        editor.setText(dedent`
          /*
           * Comment with a leading space.
           */

          {
          	hello;
          }
        `)

        editor.tokenizedBuffer.retokenizeLines()
        expect(editor.getSoftTabs()).toBe(false)

        editor.setText(dedent`
          /*
           * Comment with a leading space.
           */

          {
            hello;
          }
        `)
        editor.tokenizedBuffer.retokenizeLines()
        expect(editor.getSoftTabs()).toBe(true)
      })
    })

    describe('when the "tabType" config setting is "auto"', function () {
      it('enables or disables soft tabs based on the "softTabs" config setting', function () {
        registry.maintainConfig(editor)

        editor.setText('abc\ndef')
        atom.config.set('editor.softTabs', true)
        atom.config.set('editor.tabType', 'auto')
        expect(editor.getSoftTabs()).toBe(true)

        atom.config.set('editor.softTabs', false)
        expect(editor.getSoftTabs()).toBe(false)
      })
    })

    it('enables or disables soft tabs based on the config', function () {
      editor.setSoftTabs(true)
      expect(editor.getSoftTabs()).toBe(true)

      atom.config.set('editor.tabType', 'hard')
      registry.maintainConfig(editor)
      expect(editor.getSoftTabs()).toBe(false)

      atom.config.set('editor.tabType', 'soft')
      expect(editor.getSoftTabs()).toBe(true)

      atom.config.set('editor.tabType', 'auto')
      atom.config.set('editor.softTabs', true)
      expect(editor.getSoftTabs()).toBe(true)
    })

    it('enables or disables atomic soft tabs based on the config', function () {
      editor.setAtomicSoftTabs(true)
      expect(editor.hasAtomicSoftTabs()).toBe(true)

      atom.config.set('editor.atomicSoftTabs', false)
      registry.maintainConfig(editor)
      expect(editor.hasAtomicSoftTabs()).toBe(false)

      atom.config.set('editor.atomicSoftTabs', true)
      expect(editor.hasAtomicSoftTabs()).toBe(true)
    })

    it('enables or disables invisible based on the config', function () {
      editor.setShowInvisibles(true)
      expect(editor.doesShowInvisibles()).toBe(true)

      atom.config.set('editor.showInvisibles', false)
      registry.maintainConfig(editor)
      expect(editor.doesShowInvisibles()).toBe(false)

      atom.config.set('editor.showInvisibles', true)
      expect(editor.doesShowInvisibles()).toBe(true)
    })

    it('sets the invisibles based on the config', function () {
      editor.setShowInvisibles(true)
      atom.config.set('editor.showInvisibles', true)

      const invisibles1 = {'tab': 'a', 'cr': false, eol: false, space: false}
      const invisibles2 = {'tab': 'b', 'cr': false, eol: false, space: false}

      editor.setInvisibles(invisibles1)
      expect(editor.getInvisibles()).toEqual(invisibles1)

      atom.config.set('editor.invisibles', invisibles2)
      registry.maintainConfig(editor)
      expect(editor.getInvisibles()).toEqual(invisibles2)

      atom.config.set('editor.invisibles', invisibles1)
      expect(editor.getInvisibles()).toEqual(invisibles1)
    })

    it('enables or disables the indent guide based on the config', function () {
      editor.setShowIndentGuide(true)
      expect(editor.doesShowIndentGuide()).toBe(true)

      atom.config.set('editor.showIndentGuide', false)
      registry.maintainConfig(editor)
      expect(editor.doesShowIndentGuide()).toBe(false)

      atom.config.set('editor.showIndentGuide', true)
      expect(editor.doesShowIndentGuide()).toBe(true)
    })

    it('enables or disables soft wrap based on the config', function () {
      editor.setSoftWrapped(true)
      expect(editor.isSoftWrapped()).toBe(true)

      atom.config.set('editor.softWrap', false)
      registry.maintainConfig(editor)
      expect(editor.isSoftWrapped()).toBe(false)

      atom.config.set('editor.softWrap', true)
      expect(editor.isSoftWrapped()).toBe(true)
    })

    it('sets the soft wrap indent length based on the config', function () {
      editor.setSoftWrapIndentLength(4)
      expect(editor.getSoftWrapIndentLength()).toBe(4)

      atom.config.set('editor.softWrapHangingIndent', 2)
      registry.maintainConfig(editor)
      expect(editor.getSoftWrapIndentLength()).toBe(2)

      atom.config.set('editor.softWrapHangingIndent', 4)
      expect(editor.getSoftWrapIndentLength()).toBe(4)
    })

    it('enables or disables preferred line length-based soft wrap based on the config', function () {
      editor.setSoftWrapAtPreferredLineLength(true)
      expect(editor.doesSoftWrapAtPreferredLineLength()).toBe(true)

      atom.config.set('editor.softWrapAtPreferredLineLength', false)
      registry.maintainConfig(editor)
      expect(editor.doesSoftWrapAtPreferredLineLength()).toBe(false)

      atom.config.set('editor.softWrapAtPreferredLineLength', true)
      expect(editor.doesSoftWrapAtPreferredLineLength()).toBe(true)
    })

    it('sets the preferred line length based on the config', function () {
      editor.setPreferredLineLength(80)
      expect(editor.getPreferredLineLength()).toBe(80)

      atom.config.set('editor.preferredLineLength', 110)
      registry.maintainConfig(editor)
      expect(editor.getPreferredLineLength()).toBe(110)

      atom.config.set('editor.preferredLineLength', 80)
      expect(editor.getPreferredLineLength()).toBe(80)
    })

    it('enables or disables back-up-before-save based on the config', function () {
      editor.setBackUpBeforeSaving(true)
      expect(editor.doesBackUpBeforeSaving()).toBe(true)

      atom.config.set('editor.backUpBeforeSaving', false)
      registry.maintainConfig(editor)
      expect(editor.doesBackUpBeforeSaving()).toBe(false)

      atom.config.set('editor.backUpBeforeSaving', true)
      expect(editor.doesBackUpBeforeSaving()).toBe(true)
    })

    it('enables or disables auto-indent based on the config', function () {
      expect(editor.shouldAutoIndent()).toBe(true)

      atom.config.set('editor.autoIndent', false)
      registry.maintainConfig(editor)
      expect(editor.shouldAutoIndent()).toBe(false)

      atom.config.set('editor.autoIndent', true)
      expect(editor.shouldAutoIndent()).toBe(true)
    })

    it('enables or disables auto-indent-on-paste based on the config', function () {
      expect(editor.shouldAutoIndentOnPaste()).toBe(true)

      atom.config.set('editor.autoIndentOnPaste', false)
      registry.maintainConfig(editor)
      expect(editor.shouldAutoIndentOnPaste()).toBe(false)

      atom.config.set('editor.autoIndentOnPaste', true)
      expect(editor.shouldAutoIndentOnPaste()).toBe(true)
    })

    it('enables or disables scrolling past the end of the buffer based on the config', function () {
      expect(editor.getScrollPastEnd()).toBe(true)

      atom.config.set('editor.scrollPastEnd', false)
      registry.maintainConfig(editor)
      expect(editor.getScrollPastEnd()).toBe(false)

      atom.config.set('editor.scrollPastEnd', true)
      expect(editor.getScrollPastEnd()).toBe(true)
    })

    it('sets the undo grouping interval based on the config', function () {
      expect(editor.getUndoGroupingInterval()).toBe(300)

      atom.config.set('editor.undoGroupingInterval', 600)
      registry.maintainConfig(editor)
      expect(editor.getUndoGroupingInterval()).toBe(600)

      atom.config.set('editor.undoGroupingInterval', 300)
      expect(editor.getUndoGroupingInterval()).toBe(300)
    })

    it('sets the non-word characters based on the config', function () {
      atom.config.set('editor.nonWordCharacters', '(){}')
      registry.maintainConfig(editor)
      expect(editor.getNonWordCharacters()).toBe('(){}')

      atom.config.set('editor.nonWordCharacters', '(){}[]')
      expect(editor.getNonWordCharacters()).toBe('(){}[]')
    })

    it('sets the scroll sensitivity based on the config', function () {
      atom.config.set('editor.scrollSensitivity', 60)
      registry.maintainConfig(editor)
      expect(editor.getScrollSensitivity()).toBe(60)

      atom.config.set('editor.scrollSensitivity', 70)
      expect(editor.getScrollSensitivity()).toBe(70)
    })

    it('gives the editor a scoped-settings delegate based on the config', function () {
      atom.config.set('editor.nonWordCharacters', '()')
      atom.config.set('editor.nonWordCharacters', '(){}', {scopeSelector: '.a.b .c.d'})
      atom.config.set('editor.nonWordCharacters', '(){}[]', {scopeSelector: '.e.f *'})

      registry.maintainConfig(editor)

      let delegate = editor.getScopedSettingsDelegate()

      expect(delegate.getNonWordCharacters(['a.b', 'c.d'])).toBe('(){}')
      expect(delegate.getNonWordCharacters(['e.f', 'g.h'])).toBe('(){}[]')
      expect(delegate.getNonWordCharacters(['i.j'])).toBe('()')
    })
  })

  describe('serialization', function () {
    it('persists editors\' grammar overrides', async function () {
      const editor2 = new TextEditor({
        config: atom.config,
        clipboard: atom.clipboard,
      })

      await atom.packages.activatePackage('language-c')
      await atom.packages.activatePackage('language-html')
      await atom.packages.activatePackage('language-javascript')

      registry.maintainGrammar(editor)
      registry.maintainGrammar(editor2)
      registry.setGrammarOverride(editor, 'source.c')
      registry.setGrammarOverride(editor2, 'source.js')

      atom.packages.deactivatePackage('language-javascript')

      const editorCopy = TextEditor.deserialize(editor.serialize(), atom)
      const editor2Copy = TextEditor.deserialize(editor2.serialize(), atom)
      const registryCopy = TextEditorRegistry.deserialize(
        JSON.parse(JSON.stringify(registry.serialize())),
        atom
      )

      expect(editorCopy.getGrammar().name).toBe('Null Grammar')
      expect(editor2Copy.getGrammar().name).toBe('Null Grammar')

      registryCopy.maintainGrammar(editorCopy)
      registryCopy.maintainGrammar(editor2Copy)
      expect(editorCopy.getGrammar().name).toBe('C')
      expect(editor2Copy.getGrammar().name).toBe('Null Grammar')

      await atom.packages.activatePackage('language-javascript')
      expect(editorCopy.getGrammar().name).toBe('C')
      expect(editor2Copy.getGrammar().name).toBe('JavaScript')
    })
  })
})

function getSubscriptionCount (editor) {
  return editor.emitter.getTotalListenerCount() +
    editor.tokenizedBuffer.emitter.getTotalListenerCount() +
    editor.buffer.emitter.getTotalListenerCount() +
    editor.displayLayer.emitter.getTotalListenerCount()
}

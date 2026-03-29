# Dim Source Text Option

Added a new reader setting: `dimTranslateSourceText`.

- Default: `false`
- Scope: persisted with reader `viewSettings`
- UI label: `Dim Source Text`

Behavior:

- Only affects inline translation when source text is shown.
- Translated text keeps the normal theme color.
- Original/source text gets a softer, dimmed tone.
- When disabled, the current visual behavior is preserved.

Implementation notes:

- The reader toggles a `translation-source-dimmed` class only while inline translation is active and source text is visible.
- No translation provider or coordinator behavior was changed.

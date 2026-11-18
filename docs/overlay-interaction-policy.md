# Overlay interaction rules

One task owns modal interaction. Independent tasks wait; related steps retain their parent's draft and return to it. Menus replace other menus. Map tools retain their selections when another tool takes their place.

AskV and Next Steps share a guidance surface. Switching guidance does not dismiss the task or clear its draft. Guidance belongs inside the active modal's focus boundary; on narrow screens it belongs inside the active tool. Closing guidance closes only guidance.

Use the shared Dialog, Sheet, AlertDialog and menu components. Bespoke dialog chrome uses `ui/task-dialog-primitives`, not direct Radix imports. Modal backdrops block background interaction; shadows and borders distinguish surfaces in dark mode.

Web forms protect edited inputs on dismissal and browser unload. Successful saves may close their controlled dialog directly. Custom dismiss buttons must use a Close/Cancel label or the shared Close primitive. Disable dismissal while a save is pending. Guidance inputs are excluded from the task's dirty state.

Native presentations use `DismissibleModal`. Related steps share one native presentation; independent native and embedded-web tasks coordinate ownership. Use `ModalTextInput` and `ModalPressable` inside forms. Pass `draftValue` for picker, attachment, or other non-text state, or `hasUnsavedChanges` for an explicit dirty calculation. Successful saves close through the caller; Close/Cancel uses the discard guard. Keep draft data in memory, not persistent browser/device storage.

iOS layouts retain safe-area exits, keyboard avoidance, and minimum 44-point dismiss controls. Swipe dismissal cannot bypass the draft guard. Embedded web messages must match the current origin, page, and channel.

Regression checks cover declined/accepted discard, picker-only edits, custom flyouts, guidance-only closing, nested task state retention, queued ownership and cleanup. Physical-device checks should additionally exercise the keyboard, VoiceOver, rotation, and repeated open/close cycles before release.

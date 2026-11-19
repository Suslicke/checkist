/** The attribute `switch` of `<input type="checkbox" switch>` (docs/design-system/components/Switch): Safari 17.4+ on
 * iOS draws its own switch for it; React and TypeScript do not know it yet, so it is spread onto the input. The
 * look of every other browser comes from `.ck-switch` (App.css). */
export const nativeSwitch = { switch: '' } as Record<string, string>

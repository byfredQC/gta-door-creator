// Built-in presets (user presets are stored in the app's user data folder)
export const BUILTIN_PRESETS = [
  { name: 'Normal Door 90°', sub: 'hinged · native · no script', config: { type: 'normal', engine: 'native', speed: 'normal', normal: { angle: 90, flip: false }, collision: { mode: 'auto', shape: 'box' } } },
  { name: 'Normal Door 180°', sub: 'scripted (needs Lua)', config: { type: 'normal', engine: 'scripted', speed: 'normal', normal: { angle: 180, flip: false }, collision: { mode: 'auto', shape: 'box' } } },
  { name: 'Sliding Door', sub: 'native sliding · no script', config: { type: 'sliding', engine: 'native', speed: 'normal', sliding: { dir: 'right', preset: 'auto' }, collision: { mode: 'auto', shape: 'box' } } },
  { name: 'Garage Door', sub: 'native lift · no script', config: { type: 'garage', engine: 'native', speed: 'normal', garage: { kind: 'sliding' }, collision: { mode: 'auto', shape: 'box', material: 67 } } },
  { name: 'Garage Roll Up', sub: 'native shutter · no script', config: { type: 'garage', engine: 'native', speed: 'slow', garage: { kind: 'rollup', panels: 12, panelSize: 0 }, collision: { mode: 'auto', shape: 'box', material: 67 } } },
  { name: 'Garage Sectional', sub: 'native garage · no script', config: { type: 'garage', engine: 'native', speed: 'normal', garage: { kind: 'sectional', panels: 5, panelSize: 0 }, collision: { mode: 'auto', shape: 'box', material: 67 } } },
];

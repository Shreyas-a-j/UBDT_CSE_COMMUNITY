const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ['dist/**', '.expo/**'],
  },
  {
    // Every screen loads its data in an effect, and setting the loading flag
    // before the first await is the intended UX. The rule targets derived
    // state updates during render, not fetch lifecycles, so it is disabled
    // here rather than contorting the data layer.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);

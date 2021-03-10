import commonjs from '@rollup/plugin-commonjs'

export default {
  input: 'src/rollup.js',
  output: {
    file: 'dist/rollup.js',
    format: 'cjs',
    exports: 'auto'
  },
  plugins: [
    commonjs()
  ],
  external: ['fs', 'path', 'magic-string', 'acorn']
}
import foo from './foo'
import { t, s } from './foo'
import * as g from './foo'

export default function add(a, b) { a + b }

export function test() {}

console.log(foo())
const a = 1 + 2
a = foo()
function one() {}
export { one }
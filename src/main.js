import foo, { two } from './foo'
import { resolve } from 'path'

export default function add(a, b) { a + b }

export function test() {}

console.log(foo())
console.log(resolve)

function one() {
    const a = 1
    const b = 2
    console.log(a)
    console.log(b)
    console.log(3)
}
export { one }
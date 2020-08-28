import * as g from './foo'
import * as path from 'path'
import bar from './bar'

export default function add(a, b) { a + b }

export function test() {
    Object.keys(path).forEach(key => {
        console.log(key)
    })
}

bar()
console.log(g.foo, g.two)
console.log(path)

function one() {
    const a = 1
    const b = 2
    console.log(a)
    console.log(b)
    console.log(3)
}
export { one }
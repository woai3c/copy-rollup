'use strict'

function add(a, b) { a + b }

function test() {}/**
 * 
 */

function foo() { console.log('foo') }

console.log(foo())
const a = 1 + 2

function one() {
    const a = 1
    const b = 2
    console.log(a)
    console.log(b)
    console.log(3)
}

exports.default = add
exports.test = test
exports.one = one
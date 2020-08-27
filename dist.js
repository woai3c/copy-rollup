'use strict';

var path = require('path');

var g = {
    get default () { return g__default; },
    get two () { return two; }
};

function add(a, b) { a + b }

function test() {}/**
 * 
 */

function foo() { console.log('foo') }

function two() {}

console.log(g.foo, g.two)
console.log(path)

function one() {
    const a = 1
    const b = 2
    console.log(a)
    console.log(b)
    console.log(3)
}

exports.default = add;
exports.test = test;
exports.one = one;
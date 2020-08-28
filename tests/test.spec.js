const rollup = require('../dist/rollup')

describe('test', () => {
    test('add', done => {
        rollup(__dirname + '/main.js').then(res => {
            console.log(res)
            done()
        })
    })
})
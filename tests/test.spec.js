const rollup = require('../src/rollup')

describe('test', () => {
    test('add', done => {
        rollup('./main.js').then(res => {
            console.log(res)
            done()
        })
    })
})
const rollup = require('./rollup')

rollup('./main.js').then(res => {
    console.log(res)
})
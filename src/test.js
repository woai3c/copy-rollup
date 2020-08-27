const rollup = require('./rollup')

rollup('./main.js').then(res => {
    res.wirte('dist.js')
})
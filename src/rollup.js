const Bundle = require('./bundle')
const fs = require('fs')

function rollup(entry, options = {}) {
    const bundle = new Bundle({ entry, ...options })
    return bundle.build().then(() => {
        return {
            generate: options => bundle.generate(options),
            write(dest, options = {}) {
                const { code } = bundle.generate({
					dest,
					format: options.format,
				})

				return fs.writeFile(dest, code, err => {
                    if (err) throw err
                })
            }
        }
    })
}

module.exports = rollup
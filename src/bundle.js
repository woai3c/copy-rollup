const path = require('path')
const fs = require('fs')
const Module = require('./module')

class Bundle {
    constructor(options = {}) {
        this.entry = path.resolve(options.entry)
        this.base = path.dirname(this.entry)
    }

    build() {
        return this.fetchModule(this.entry).then(module => {
            return module
        })
    }

    generate() {

    }

    fetchModule(path) {
        return new Promise((resolve, reject) => {
            fs.readFile(path, 'utf-8', (err, code) => {
                if (err) reject(err)
                const module = new Module({
                    code,
                    path,
                    bundle: this,
                })

                resolve(module)
            })
        })
    }
}

module.exports = Bundle
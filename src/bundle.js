const path = require('path')
const fs = require('fs')
const Module = require('./module')
const MagicString = require('magic-string')
const { keys } = require('./utils/object')
const finalisers = require('./finalisers')

class Bundle {
    constructor(options = {}) {
        // 防止用户省略 .js 后缀
        this.entryPath = path.resolve(__dirname, options.entry.replace(/\.js$/, '') + '.js')
        // 获取入口文件的目录
        this.base = path.dirname(this.entryPath)
        // 入口模块
        this.entryModule = null
        // 读取过的模块都缓存在此，如果重复读取则直接从缓存读取模块，提高效率
        this.modulePromises = {}
        // 最后真正要生成的代码的 AST 节点语句，不用生成的 AST 会被省略掉
        this.statements = []
        // 外部模块，当通过路径获取不到的模块就属于外部模块，例如 const fs = require('fs') 中的 fs 模块
		this.externalModules = []
    }

    build() {
        return this.fetchModule(this.entryPath)
            .then(entryModule => {
                this.entryModule = entryModule
                return entryModule.expandAllStatements(true)
            })
            .then(statements => {
				this.statements = statements
			})
    }

    // importee 被调用模块文件
    // importer 调用模块文件
    // 例如在入口文件 main.js 中引入了另一个文件 foo.js 中的函数
    // 此时 main.js 就是 importer，而 foo.js 是 importee
    fetchModule(importee, importer) {
        return new Promise((resolve, reject) => {
            let route
            // 入口文件没有 importer
            if (!importer) {
                route = importee.replace(/\.js$/, '') + '.js'
            } else {
                // 获取 importer 的目录，从而找到 importee 的绝对路径
                route = path.resolve(path.dirname(importer), importee.replace(/\.js$/, '') + '.js')
            }

            fs.readFile(route, 'utf-8', (err, code) => {
                if (err) reject(err)
                const module = new Module({
                    code,
                    path: route,
                    bundle: this,
                })

                resolve(module)
            })
        })
    }

    generate(options = {}) {
		let magicString = new MagicString.Bundle({ separator: '' })
		// Determine export mode - 'default', 'named', 'none'
		let exportMode = this.getExportMode(options.exports);
		let previousMargin = 0

		// Apply new names and add to the output bundle
		this.statements.forEach(statement => {
			const source = statement._source.clone().trim()

			// modify exports as necessary
			if (/^Export/.test(statement.type)) {
				// 已经引入到一起打包了，所以不需要这些语句了
				// skip `export { foo, bar, baz }`
				if (statement.type === 'ExportNamedDeclaration' && statement.specifiers.length) {
					return
				}

				// 因为已经打包在一起了
				// 如果引入的模块是 export var foo = 42，就移除 export，变成 var foo = 42
				// remove `export` from `export var foo = 42`
				if (statement.type === 'ExportNamedDeclaration' && statement.declaration.type === 'VariableDeclaration') {
					source.remove(statement.start, statement.declaration.start)
				}
				// remove `export` from `export class Foo {...}` or `export default Foo`
				// TODO default exports need different treatment
				else if (statement.declaration.id) {
					source.remove(statement.start, statement.declaration.start)
				} else if (statement.type === 'ExportDefaultDeclaration') {

				} else {
					throw new Error('Unhandled export')
				}
            }

			// add leading comments
			if (statement._leadingComments.length) {
				const commentBlock = statement._leadingComments.map(comment => {
					return comment.block ?
						`/*${comment.text}*/` :
						`//${comment.text}`
				}).join('\n')

				magicString.addSource(new MagicString(commentBlock))
			}

			// 生成空行
			// add margin
			const margin = Math.max(statement._margin[0], previousMargin)
			const newLines = new Array(margin).join('\n')

			// add the statement itself
			magicString.addSource({
				content: source,
				separator: newLines
			})

			// add trailing comments
			const comment = statement._trailingComment
			if (comment) {
				const commentBlock = comment.block ?
					` /*${comment.text}*/` :
					` //${comment.text}`

				magicString.append(commentBlock)
			}

			previousMargin = statement._margin[1]
		})

		const finalise = finalisers[options.format || 'cjs']
		magicString = finalise(this, magicString.trim(), exportMode, options)

		return { code: magicString.toString() }
    }
    
    getExportMode (exportMode) {
		const exportKeys = keys(this.entryModule.exports);

		if (exportMode === 'default') {
			if (exportKeys.length !== 1 || exportKeys[0] !== 'default') {
				badExports('default', exportKeys);
			}
		} else if (exportMode === 'none' && exportKeys.length) {
			badExports('none', exportKeys);
		}

		if (!exportMode || exportMode === 'auto') {
			if (exportKeys.length === 0) {
				exportMode = 'none';
			} else if (exportKeys.length === 1 && exportKeys[0] === 'default') {
				exportMode = 'default';
			} else {
				exportMode = 'named';
			}
		}

		if (!/(?:default|named|none)/.test(exportMode)) {
			throw new Error(`options.exports must be 'default', 'named', 'none', 'auto', or left unspecified (defaults to 'auto')`);
		}

		return exportMode;
	}
}

module.exports = Bundle
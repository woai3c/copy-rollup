const path = require('path')
const fs = require('fs')
const Module = require('./module')
const MagicString = require('magic-string')
const { has, keys } = require('./utils/object')
const finalisers = require('./finalisers')
const ExternalModule = require('./external-module')
const replaceIdentifiers = require('./utils/replaceIdentifiers')

class Bundle {
    constructor(options = {}) {
        // 防止用户省略 .js 后缀
        this.entryPath = path.resolve(options.entry.replace(/\.js$/, '') + '.js')
        // 获取入口文件的目录
        this.base = path.dirname(this.entryPath)
        // 入口模块
        this.entryModule = null
        // 读取过的模块都缓存在此，如果重复读取则直接从缓存读取模块，提高效率
        this.modules = {}
        // 最后真正要生成的代码的 AST 节点语句，不用生成的 AST 会被省略掉
        this.statements = []
        // 外部模块，当通过路径获取不到的模块就属于外部模块，例如 const fs = require('fs') 中的 fs 模块
		this.externalModules = []
		// import * as test from './foo' 需要用到
		this.internalNamespaceModules = []
    }

    build() {
        return this.fetchModule(this.entryPath)
            .then(entryModule => {
                this.entryModule = entryModule
                return entryModule.expandAllStatements(true)
            })
            .then(statements => {
				this.statements = statements
				this.deconflict()
			})
    }

    // importee 被调用模块文件
    // importer 调用模块文件
    // 例如在入口文件 main.js 中引入了另一个文件 foo.js 中的函数
    // 此时 main.js 就是 importer，而 foo.js 是 importee
    fetchModule(importee, importer) {
        return new Promise((resolve, reject) => {
			// 如果有缓存，则直接返回
			if (this.modules[importee]) {
				resolve(this.modules[importee])
				return 
			}

            let route
            // 入口文件没有 importer
            if (!importer) {
                route = importee
            } else {
				// 绝对路径
				if (path.isAbsolute(importee)) {
					route = importee
				} else if (importee[0] == '.') {
					// 相对路径
					// 获取 importer 的目录，从而找到 importee 的绝对路径
					route = path.resolve(path.dirname(importer), importee.replace(/\.js$/, '') + '.js')
				}
            }

			if (route) {
				fs.readFile(route, 'utf-8', (err, code) => {
					if (err) reject(err)
					const module = new Module({
						code,
						path: route,
						bundle: this,
					})
					
					this.modules[route] = module
					resolve(module)
				})
			} else {
				// 没有找到路径则是外部模块
				const module = new ExternalModule(importee)
				this.externalModules.push(module)
				this.modules[importee] = module
				resolve(module)
			}
        })
    }

    generate(options = {}) {
		let magicString = new MagicString.Bundle({ separator: '' })
		// Determine export mode - 'default', 'named', 'none'
		// 导出模式
		let exportMode = this.getExportMode(options.exports)
		let previousMargin = 0

		// Apply new names and add to the output bundle
		this.statements.forEach(statement => {
			let replacements = {}

			keys(statement._dependsOn)
				.concat(keys(statement._defines))
				.forEach(name => {
					const canonicalName = statement._module.getCanonicalName(name)

					if (name !== canonicalName) {
						replacements[name] = canonicalName
					}
				})

			const source = statement._source.clone().trim()

			// modify exports as necessary
			if (/^Export/.test(statement.type)) {
				// 已经引入到一起打包了，所以不需要这些语句了
				// 跳过 `export { foo, bar, baz }` 语句
				if (statement.type === 'ExportNamedDeclaration' && statement.specifiers.length) {
					return
				}

				// 因为已经打包在一起了
				// 如果引入的模块是 export var foo = 42，就移除 export，变成 var foo = 42
				if (statement.type === 'ExportNamedDeclaration' && statement.declaration.type === 'VariableDeclaration') {
					source.remove(statement.start, statement.declaration.start)
				}
				// `export class Foo {...}` 移除 export
				else if (statement.declaration.id) {
					source.remove(statement.start, statement.declaration.start)
				} else if (statement.type === 'ExportDefaultDeclaration') {
					const module = statement._module
					const canonicalName = module.getCanonicalName('default')

					if (statement.declaration.type === 'Identifier' && canonicalName === module.getCanonicalName(statement.declaration.name)) {
						return
					}

					source.overwrite(statement.start, statement.declaration.start, `var ${canonicalName} = `)
				} else {
					throw new Error('Unhandled export')
				}
            }
			
			// 例如 import { resolve } from path; 将 resolve 变为 path.resolve
			replaceIdentifiers(statement, source, replacements)

			// 生成空行
			// add margin
			const margin = Math.max(statement._margin[0], previousMargin)
			const newLines = new Array(margin).join('\n')

			// add the statement itself
			magicString.addSource({
				content: source,
				separator: newLines
			})

			previousMargin = statement._margin[1]
		})

		// 这个主要是针对 import * as g from './foo' 语句
		// 如果 foo 文件有默认导出的函数和 two() 函数，生成的代码如下
		// var g = {
		// 	 get default () { return g__default },
		// 	 get two () { return two }
		// }
		const indentString = magicString.getIndentString()
		const namespaceBlock = this.internalNamespaceModules.map(module => {
			const exportKeys = keys(module.exports)

			return `var ${module.getCanonicalName('*')} = {\n` +
				exportKeys.map(key => `${indentString}get ${key} () { return ${module.getCanonicalName(key)} }`).join(',\n') +
			`\n}\n\n`
		}).join('')

		magicString.prepend(namespaceBlock)

		const finalise = finalisers[options.format || 'cjs']
		magicString = finalise(this, magicString.trim(), exportMode, options)

		return { code: magicString.toString() }
    }
    
    getExportMode(exportMode) {
		const exportKeys = keys(this.entryModule.exports)

		if (!exportMode || exportMode === 'auto') {
			if (exportKeys.length === 0) {
				// 没有导出模块
				exportMode = 'none'
			} else if (exportKeys.length === 1 && exportKeys[0] === 'default') {
				// 只有一个导出模块，并且是 default
				exportMode = 'default'
			} else {
				exportMode = 'named'
			}
		}

		return exportMode
	}

	deconflict() {
		const definers = {}
		const conflicts = {}
		// 解决冲突，例如两个不同的模块有一个同名函数，则需要对其中一个重命名。
		this.statements.forEach(statement => {
			keys(statement._defines).forEach(name => {
				if (has(definers, name)) {
					conflicts[name] = true
				} else {
					definers[name] = []
				}

				definers[name].push(statement._module)
			})
		})

		// 为外部模块分配名称，例如引入了 path 模块的 resolve 方法，使用时直接用 resolve()
		// 打包后会变成 path.resolve
		this.externalModules.forEach(module => {
			const name = module.suggestedNames['*'] || module.suggestedNames.default || module.id

			if (has(definers, name)) {
				conflicts[name] = true
			} else {
				definers[name] = []
			}

			definers[name].push(module)
			module.name = name
		})

		// Rename conflicting identifiers so they can live in the same scope
		keys(conflicts).forEach(name => {
			const modules = definers[name]
			// 最靠近入口模块的模块可以保持原样，即不改名
			modules.pop()
			// 其他冲突的模块要改名
			// 改名就是在冲突的变量前加下划线 _
			modules.forEach(module => {
				const replacement = getSafeName(name)
				module.rename(name, replacement)
			})
		})

		function getSafeName(name) {
			while (has(conflicts, name)) {
				name = `_${name}`
			}

			conflicts[name] = true
			return name
		}
	}
}

module.exports = Bundle
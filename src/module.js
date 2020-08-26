const { parse } = require('acorn')

class Module {
    constructor({ code, path, bundle }) {
        this.code = code
        this.path = path
        this.bundle = bundle
        this.comments = []
        this.ast = parse(code, {
            ecmaVersion: 6,
            sourceType: 'module',
            onComment: (block, text, start, end) => this.comments.push({ block, text, start, end })
        })

        // console.log(JSON.stringify(this.ast, null, 4))
        this.analyse()
    }

    // 分析导入和导出的模块，将引入的模块和导出的模块填入对应的数组
    analyse () {
		this.imports = {}
		this.exports = {}

		this.ast.body.forEach(node => {
			let source

			// import foo from './foo'
			// import { bar } from './bar'
			if (node.type === 'ImportDeclaration') {
				source = node.source.value
				node.specifiers.forEach(specifier => {
					// import foo from './foo'
					const isDefault = specifier.type == 'ImportDefaultSpecifier'
					// import * as foo from './foo'
					const isNamespace = specifier.type == 'ImportNamespaceSpecifier'

					const localName = specifier.local.name
                    const name = isDefault ? 'default' 
                                    : isNamespace ? '*' : specifier.imported.name

					this.imports[localName] = {
						source,
						name,
						localName
					}
				})
			} else if (/^Export/.test(node.type)) {
				// export default function foo () {}
				// export default foo
				// export default 42
				if (node.type === 'ExportDefaultDeclaration') {
					const isDeclaration = /Declaration$/.test(node.declaration.type)
					this.exports.default = {
						node,
						name: 'default',
						localName: isDeclaration ? node.declaration.id.name : 'default',
						isDeclaration
					}
				} else if (node.type === 'ExportNamedDeclaration') {
                    // export { foo, bar, baz }
                    // export var foo = 42
                    // export function foo () {}
					// export { foo } from './foo'
					source = node.source && node.source.value;

					if (node.specifiers.length) {
						// export { foo, bar, baz }
						node.specifiers.forEach(specifier => {
							const localName = specifier.local.name
							const exportedName = specifier.exported.name

							this.exports[ exportedName ] = {
								localName,
								exportedName
							}
							
							// export { foo } from './foo'
							// 这种格式还需要引入相应的模块，例如上述例子要引入 './foo' 模块
							if (source) {
								this.imports[localName] = {
									source,
									localName,
									name: exportedName
								}
							}
						})
					} else {
						const declaration = node.declaration
						let name

						if (declaration.type === 'VariableDeclaration') {
							// export var foo = 42
							name = declaration.declarations[0].id.name
						} else {
							// export function foo () {}
							name = declaration.id.name;
						}

						this.exports[ name ] = {
							node,
							localName: name,
							expression: declaration
						}
					}
				}
			}
		})



		analyse(this.ast, this.code, this)
		// 当前模块下的顶级变量（包括函数声明）
		this.definedNames = this.ast._scope.names.slice()

		this.canonicalNames = {}

		this.definitions = {}
		this.definitionPromises = {}
		this.modifications = {}

		this.ast.body.forEach(statement => {
			// 读取当前语句下的变量
			Object.keys(statement._defines).forEach(name => {
				this.definitions[ name ] = statement
            })
            
			// 再根据 _modifies 修改它们，_modifies 是在 analyse() 中改变的
			Object.keys(statement._modifies).forEach(name => {
				if (!has(this.modifications, name)) {
					this.modifications[ name ] = []
				}

				this.modifications[ name ].push(statement)
			})
		})
	}
}

module.exports = Module
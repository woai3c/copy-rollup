const walk = require('../ast/walk')
const { has } = require('./object')

// 重写 node 名称
// 例如 import { resolve } from path; 将 resolve 变为 path.resolve
function replaceIdentifiers(statement, snippet, names) {
	const replacementStack = [names]
	const keys = Object.keys(names)

	if (keys.length === 0) {
		return
	}

	walk(statement, {
		enter(node, parent) {
			const scope = node._scope

			if (scope) {
				let newNames = {}
				let hasReplacements

				keys.forEach(key => {
					if (!scope.names.includes(key)) {
						newNames[key] = names[key]
						hasReplacements = true
					}
				})

				if (!hasReplacements) {
					return this.skip()
				}

				names = newNames
				replacementStack.push(newNames)
			}

			// We want to rewrite identifiers (that aren't property names)
			if (node.type !== 'Identifier') return
			if (parent.type === 'MemberExpression' && node !== parent.object) return
			if (parent.type === 'Property' && node !== parent.value) return

			const name = has(names, node.name) && names[node.name]

			if (name && name !== node.name) {
				snippet.overwrite(node.start, node.end, name)
			}
		},

		leave(node) {
			if (node._scope) {
				replacementStack.pop()
				names = replacementStack[replacementStack.length - 1]
			}
		}
	})
}

module.exports = replaceIdentifiers
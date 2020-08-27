const walk = require('./walk')
const Scope = require('./scope')
const { getName } = require('../utils/map-helpers')

// 对 AST 进行分析，按节点层级赋予对应的作用域，并找出有哪些依赖项和对依赖项作了哪些修改
function analyse(ast, magicString, module) {
	let scope = new Scope()
	let currentTopLevelStatement

	function addToScope(declarator) {
		var name = declarator.id.name
		scope.add(name, false)

		if (!scope.parent) {
			currentTopLevelStatement._defines[name] = true
		}
	}

	function addToBlockScope(declarator) {
		var name = declarator.id.name
		scope.add(name, true)

		if (!scope.parent) {
			currentTopLevelStatement._defines[name] = true
		}
	}

	// first we need to generate comprehensive scope info
	let previousStatement = null
	let commentIndex = 0

	// 为每个语句定义作用域，并将父子作用域关联起来
	ast.body.forEach(statement => {
		currentTopLevelStatement = statement // so we can attach scoping info

		// 这些属性不能遍历
		Object.defineProperties(statement, {
			_defines:          { value: {} },
			_modifies:         { value: {} },
			_dependsOn:        { value: {} },
			_included:         { value: false, writable: true },
			_module:           { value: module },
			_source:           { value: magicString.snip(statement.start, statement.end) }, // TODO don't use snip, it's a waste of memory
			_margin:           { value: [0, 0] },
			_leadingComments:  { value: [] },
			_trailingComment:  { value: null, writable: true },
		})

		let trailing = !!previousStatement

		// attach leading comment
		// 为上一个句子添加尾注释，为当前句子添加头注释
		do {
			const comment = module.comments[commentIndex]

			if (!comment || (comment.end > statement.start)) break

			// attach any trailing comment to the previous statement
			if (trailing && !/\n/.test(magicString.slice(previousStatement.end, comment.start))) {
				previousStatement._trailingComment = comment
			}

			// then attach leading comments to this statement
			else {
				statement._leadingComments.push(comment)
			}

			commentIndex += 1
			trailing = false
		} while (module.comments[commentIndex])

		// determine margin
		const previousEnd = previousStatement ? (previousStatement._trailingComment || previousStatement).end : 0
		const start = (statement._leadingComments[0] || statement).start

		const gap = magicString.original.slice(previousEnd, start)
		const margin = gap.split('\n').length

		if (previousStatement) previousStatement._margin[1] = margin
		statement._margin[0] = margin

		walk(statement, {
			enter (node) {
				let newScope
				switch (node.type) {
					case 'FunctionExpression':
					case 'FunctionDeclaration':
					case 'ArrowFunctionExpression':
						let names = node.params.map(getName)

						if (node.type === 'FunctionDeclaration') {
							addToScope(node)
						} else if (node.type === 'FunctionExpression' && node.id) {
							names.push(node.id.name)
						}

						newScope = new Scope({
							parent: scope,
							params: names, // TODO rest params?
							block: false
						})

						break

					case 'BlockStatement':
						newScope = new Scope({
							parent: scope,
							block: true
						})

						break

					case 'CatchClause':
						newScope = new Scope({
							parent: scope,
							params: [node.param.name],
							block: true
						})

						break

					case 'VariableDeclaration':
						node.declarations.forEach(node.kind === 'let' ? addToBlockScope : addToScope) // TODO const?
						break

					case 'ClassDeclaration':
						addToScope(node)
						break
				}

				if (newScope) {
					Object.defineProperty(node, '_scope', { value: newScope })
					scope = newScope
				}
			},
			leave (node) {
				if (node === currentTopLevelStatement) {
					currentTopLevelStatement = null
				}

				if (node._scope) {
					scope = scope.parent
				}
			}
		})

		previousStatement = statement
	})

	// then, we need to find which top-level dependencies this statement has,
	// and which it potentially modifies
	// 然后，我们需要找出这个语句有哪些顶级依赖项，以及它可能修改哪些依赖项
	ast.body.forEach(statement => {
		function checkForReads (node, parent) {
			// 节点类型为 Identifier，并且不存在 statement 作用域中，说明它是顶级依赖项
			if (node.type === 'Identifier') {
				// disregard the `bar` in `foo.bar` - these appear as Identifier nodes
				if (parent.type === 'MemberExpression' && node !== parent.object) {
					return
				}

				// disregard the `bar` in { bar: foo }
				if (parent.type === 'Property' && node !== parent.value) {
					return
				}

				const definingScope = scope.findDefiningScope(node.name)

				if ((!definingScope || definingScope.depth === 0) && !statement._defines[node.name]) {
					statement._dependsOn[node.name] = true
				}
			}

		}
		// 检查有没修改依赖
		function checkForWrites(node) {
			function addNode (node, disallowImportReassignments) {
				while (node.type === 'MemberExpression') {
					node = node.object
				}

				if (node.type !== 'Identifier') {
					return
				}

				statement._modifies[node.name] = true
			}

			// 检查 a = 1 + 2 中的 a 是否被修改
			// 如果 a 是引入模块并且被修改就报错
			if (node.type === 'AssignmentExpression') {
				addNode(node.left, true)
			}
			// a++/a--
			else if (node.type === 'UpdateExpression') {
				addNode(node.argument, true)
			}

			else if (node.type === 'CallExpression') {
				node.arguments.forEach(arg => addNode(arg, false))
			}

			// TODO UpdateExpressions, method calls?
		}

		walk(statement, {
			enter (node, parent) {
				// skip imports
				if (/^Import/.test(node.type)) return this.skip()

				if (node._scope) scope = node._scope

				checkForReads(node, parent)
				checkForWrites(node, parent)

				//if (node.type === 'ReturnStatement')

			},
			leave (node) {
				if (node._scope) scope = scope.parent
			}
		})
	})

	ast._scope = scope
}

module.exports = analyse
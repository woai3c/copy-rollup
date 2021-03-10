'use strict';

var path = require('path');
var fs = require('fs');
var require$$0 = require('acorn');
var MagicString = require('magic-string');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var path__default = /*#__PURE__*/_interopDefaultLegacy(path);
var fs__default = /*#__PURE__*/_interopDefaultLegacy(fs);
var require$$0__default = /*#__PURE__*/_interopDefaultLegacy(require$$0);
var MagicString__default = /*#__PURE__*/_interopDefaultLegacy(MagicString);

let shouldSkip;
let shouldAbort;
// 对 AST 的节点调用 enter() 和 leave() 函数，如果有子节点将递归调用
function walk (ast, { enter, leave }) {
	shouldAbort = false;
	visit(ast, null, enter, leave);
}

let context = {
	skip: () => shouldSkip = true,
	abort: () => shouldAbort = true
};

let childKeys = {};

let toString = Object.prototype.toString;

function isArray (thing) {
	return toString.call(thing) === '[object Array]'
}

function visit (node, parent, enter, leave) {
	if (!node || shouldAbort) return

	if (enter) {
		shouldSkip = false;
		enter.call(context, node, parent);
		if (shouldSkip || shouldAbort) return
	}

	let keys = childKeys[node.type] || (
		childKeys[node.type] = Object.keys(node).filter(key => typeof node[key] === 'object')
	);

	let key, value, i, j;

	i = keys.length;
	while (i--) {
		key = keys[i];
		value = node[key];

		if (isArray(value)) {
			j = value.length;
			while (j--) {
				visit(value[j], node, enter, leave);
			}
		}

		else if (value && value.type) {
			visit(value, node, enter, leave);
		}
	}

	if (leave && !shouldAbort) {
		leave(node, parent);
	}
}

var walk_1 = walk;

// 作用域
class Scope {
	constructor(options = {}) {
		this.parent = options.parent;
		this.depth = this.parent ? this.parent.depth + 1 : 0;
		this.names = options.params || [];
		this.isBlockScope = !!options.block;
	}

	add(name, isBlockDeclaration) {
		if (!isBlockDeclaration && this.isBlockScope) {
			// it's a `var` or function declaration, and this
			// is a block scope, so we need to go up
			this.parent.add(name, isBlockDeclaration);
		} else {
			this.names.push(name);
		}
	}

	contains(name) {
		return !!this.findDefiningScope(name)
	}

	findDefiningScope(name) {
		if (this.names.includes(name)) {
			return this
		}

		if (this.parent) {
			return this.parent.findDefiningScope(name)
		}

		return null
	}
}

var scope = Scope;

function getName$1(x) {
	return x.name
}

var mapHelpers = {
	getName: getName$1,
};

const { getName } = mapHelpers;

// 对 AST 进行分析，按节点层级赋予对应的作用域，并找出有哪些依赖项和对依赖项作了哪些修改
function analyse(ast, magicString, module) {
	let scope$1 = new scope();
	let currentTopLevelStatement;

	function addToScope(declarator) {
		var name = declarator.id.name;
		scope$1.add(name, false);

		if (!scope$1.parent) {
			currentTopLevelStatement._defines[name] = true;
		}
	}

	function addToBlockScope(declarator) {
		var name = declarator.id.name;
		scope$1.add(name, true);

		if (!scope$1.parent) {
			currentTopLevelStatement._defines[name] = true;
		}
	}

	// first we need to generate comprehensive scope info
	let previousStatement = null;

	// 为每个语句定义作用域，并将父子作用域关联起来
	ast.body.forEach(statement => {
		currentTopLevelStatement = statement; // so we can attach scoping info

		// 这些属性不能遍历
		Object.defineProperties(statement, {
			_defines:          { value: {} },
			_modifies:         { value: {} },
			_dependsOn:        { value: {} },
			_included:         { value: false, writable: true },
			_module:           { value: module },
			_source:           { value: magicString.snip(statement.start, statement.end) },
			_margin:           { value: [0, 0] },
		});

		// determine margin
		const previousEnd = previousStatement ? previousStatement.end : 0;
		const start = statement.start;

		const gap = magicString.original.slice(previousEnd, start);
		const margin = gap.split('\n').length;

		if (previousStatement) previousStatement._margin[1] = margin;
		statement._margin[0] = margin;

		walk_1(statement, {
			enter (node) {
				let newScope;
				switch (node.type) {
					case 'FunctionExpression':
					case 'FunctionDeclaration':
					case 'ArrowFunctionExpression':
						const names = node.params.map(getName);

						if (node.type === 'FunctionDeclaration') {
							addToScope(node);
						} else if (node.type === 'FunctionExpression' && node.id) {
							names.push(node.id.name);
						}

						newScope = new scope({
							parent: scope$1,
							params: names, // TODO rest params?
							block: false
						});

						break

					case 'BlockStatement':
						newScope = new scope({
							parent: scope$1,
							block: true
						});

						break

					case 'CatchClause':
						newScope = new scope({
							parent: scope$1,
							params: [node.param.name],
							block: true
						});

						break

					case 'VariableDeclaration':
						node.declarations.forEach(node.kind === 'let' ? addToBlockScope : addToScope); // TODO const?
						break

					case 'ClassDeclaration':
						addToScope(node);
						break
				}

				if (newScope) {
					Object.defineProperty(node, '_scope', { value: newScope });
					scope$1 = newScope;
				}
			},
			leave (node) {
				if (node === currentTopLevelStatement) {
					currentTopLevelStatement = null;
				}

				if (node._scope) {
					scope$1 = scope$1.parent;
				}
			}
		});

		previousStatement = statement;
	});

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

				const definingScope = scope$1.findDefiningScope(node.name);

				if ((!definingScope || definingScope.depth === 0) && !statement._defines[node.name]) {
					statement._dependsOn[node.name] = true;
				}
			}

		}
		// 检查有没修改依赖
		function checkForWrites(node) {
			function addNode (node, disallowImportReassignments) {
				while (node.type === 'MemberExpression') {
					node = node.object;
				}

				if (node.type !== 'Identifier') {
					return
				}

				statement._modifies[node.name] = true;
			}

			// 检查 a = 1 + 2 中的 a 是否被修改
			// 如果 a 是引入模块并且被修改就报错
			if (node.type === 'AssignmentExpression') {
				addNode(node.left);
			}
			// a++/a--
			else if (node.type === 'UpdateExpression') {
				addNode(node.argument);
			} else if (node.type === 'CallExpression') {
				node.arguments.forEach(arg => addNode(arg));
			}
		}

		walk_1(statement, {
			enter (node, parent) {
				// skip imports
				if (/^Import/.test(node.type)) return this.skip()

				if (node._scope) scope$1 = node._scope;

				checkForReads(node, parent);
				checkForWrites(node);
			},
			leave (node) {
				if (node._scope) scope$1 = scope$1.parent;
			}
		});
	});

	ast._scope = scope$1;
}

var analyse_1 = analyse;

const keys$3 = Object.keys;

const hasOwnProp = Object.prototype.hasOwnProperty;

function has$3(obj, prop) {
	return hasOwnProp.call(obj, prop)
}

var object = {
	keys: keys$3,
	hasOwnProp,
	has: has$3,
};

// 将数组每一项当成参数传给 callback 执行，最后将结果用 promise 返回
function sequence$1 (arr, callback) {
	const len = arr.length;
	const results = new Array(len);
	let promise = Promise.resolve();

	function next(i) {
		return promise
			.then(() => callback(arr[i], i))
			.then(result => results[i] = result)
	}

	let i;
	for (i = 0; i < len; i += 1) {
		promise = next(i);
	}

	return promise.then(() => results)
}

var promise = { sequence: sequence$1 };

const { parse } = require$$0__default['default'];


const { has: has$2, keys: keys$2 } = object;
const { sequence } = promise;

const emptyArrayPromise = Promise.resolve([]);

class Module {
    constructor({ code, path, bundle }) {
        this.code = new MagicString__default['default'](code, {
			filename: path
		});

        this.path = path;
        this.bundle = bundle;
        this.suggestedNames = {};
        this.ast = parse(code, {
            ecmaVersion: 6,
            sourceType: 'module',
        });

		this.analyse();
    }

    // 分析导入和导出的模块，将引入的模块和导出的模块填入对应的数组
    analyse() {
		this.imports = {};
		this.exports = {};

		this.ast.body.forEach(node => {
			let source;

			// import foo from './foo'
			// import { bar } from './bar'
			if (node.type === 'ImportDeclaration') {
				source = node.source.value;
				node.specifiers.forEach(specifier => {
					// import foo from './foo'
					const isDefault = specifier.type == 'ImportDefaultSpecifier';
					// import * as foo from './foo'
					const isNamespace = specifier.type == 'ImportNamespaceSpecifier';

					const localName = specifier.local.name;
                    const name = isDefault ? 'default' 
                                    : isNamespace ? '*' : specifier.imported.name;

					this.imports[localName] = {
						source,
						name,
						localName
					};
				});
			} else if (/^Export/.test(node.type)) {
				// export default function foo () {}
				// export default foo
				// export default 42
				if (node.type === 'ExportDefaultDeclaration') {
					const isDeclaration = /Declaration$/.test(node.declaration.type);
					this.exports.default = {
						node,
						name: 'default',
						localName: isDeclaration ? node.declaration.id.name : 'default',
						isDeclaration
					};
				} else if (node.type === 'ExportNamedDeclaration') {
                    // export { foo, bar, baz }
                    // export var foo = 42
                    // export function foo () {}
					// export { foo } from './foo'
					source = node.source && node.source.value;

					if (node.specifiers.length) {
						// export { foo, bar, baz }
						node.specifiers.forEach(specifier => {
							const localName = specifier.local.name;
							const exportedName = specifier.exported.name;

							this.exports[exportedName] = {
								localName,
								exportedName
							};
							
							// export { foo } from './foo'
							// 这种格式还需要引入相应的模块，例如上述例子要引入 './foo' 模块
							if (source) {
								this.imports[localName] = {
									source,
									localName,
									name: exportedName
								};
							}
						});
					} else {
						const declaration = node.declaration;
						let name;

						if (declaration.type === 'VariableDeclaration') {
							// export var foo = 42
							name = declaration.declarations[0].id.name;
						} else {
							// export function foo () {}
							name = declaration.id.name;
						}

						this.exports[name] = {
							node,
							localName: name,
							expression: declaration
						};
					}
				}
			}
		});

		// 调用 ast 目录下的 analyse()
		analyse_1(this.ast, this.code, this);
		// 当前模块下的顶级变量（包括函数声明）
		this.definedNames = this.ast._scope.names.slice();
		this.canonicalNames = {};
		this.definitions = {};
		this.definitionPromises = {};
		this.modifications = {};

		this.ast.body.forEach(statement => {
			// 读取当前语句下的变量
			Object.keys(statement._defines).forEach(name => {
				this.definitions[name] = statement;
            });
            
			// 再根据 _modifies 修改它们，_modifies 是在 analyse() 中改变的
			Object.keys(statement._modifies).forEach(name => {
				if (!has$2(this.modifications, name)) {
					this.modifications[name] = [];
				}

				this.modifications[name].push(statement);
			});
		});
	}

	expandAllStatements(isEntryModule) {
		let allStatements = [];

		return sequence(this.ast.body, statement => {
			// skip already-included statements
			if (statement._included) return

			// 不需要对导入语句作处理
			if (statement.type === 'ImportDeclaration') {
				return
			}

			// skip `export { foo, bar, baz }`
			if (statement.type === 'ExportNamedDeclaration' && statement.specifiers.length) {
				// but ensure they are defined, if this is the entry module
				// export { foo, bar, baz }
				// 遇到这样的语句，如果是从其他模块引入的函数，则会去对应的模块加载函数，
				if (isEntryModule) {
					return this.expandStatement(statement)
						.then(statements => {
							allStatements.push.apply(allStatements, statements);
						})
				}

				return
			}

			// 剩下的其他类型语句则要添加到 allStatements 中，以待在 bundle.generate() 中生成
			// include everything else
			return this.expandStatement(statement)
				.then(statements => {
					allStatements.push.apply(allStatements, statements);
				})
		}).then(() => {
			return allStatements
		})
	}

	expandStatement(statement) {
		if (statement._included) return emptyArrayPromise
		statement._included = true;

		let result = [];

		// 根据 AST 节点的依赖项找到相应的模块
		// 例如依赖 path 模块，就需要去找到它
		const dependencies = Object.keys(statement._dependsOn);

		return sequence(dependencies, name => {
			// define() 将从其他模块中引入的函数加载进来
			return this.define(name).then(definition => {
				result.push.apply(result, definition);
			})
		})

		// then include the statement itself
			.then(() => {
				result.push(statement);
			})
			.then(() => {
				// then include any statements that could modify the
		// thing(s) this statement defines
				return sequence(keys$2(statement._defines), name => {
					const modifications = has$2(this.modifications, name) && this.modifications[name];

					if (modifications) {
						return sequence(modifications, statement => {
							if (!statement._included) {
								return this.expandStatement(statement)
									.then(statements => {
										result.push.apply(result, statements);
									})
							}
						})
					}
				})
			})
			.then(() => {
				// the `result` is an array of statements needed to define `name`
				return result
			})
	}

	define(name) {
		if (has$2(this.definitionPromises, name)) {
			return emptyArrayPromise
		}

		let promise;

		// The definition for this name is in a different module
		if (has$2(this.imports, name)) {
			const importDeclaration = this.imports[name];

			promise = this.bundle.fetchModule(importDeclaration.source, this.path)
				.then(module => {
					importDeclaration.module = module;

					// suggest names. TODO should this apply to non default/* imports?
					if (importDeclaration.name === 'default') {
						// TODO this seems ropey
						const localName = importDeclaration.localName;
						const suggestion = has$2(this.suggestedNames, localName) ? this.suggestedNames[localName] : localName;
						module.suggestName('default', suggestion);
					} else if (importDeclaration.name === '*') {
						const localName = importDeclaration.localName;
						const suggestion = has$2(this.suggestedNames, localName) ? this.suggestedNames[localName] : localName;
						module.suggestName('*', suggestion);
						module.suggestName('default', `${suggestion}__default`);
					}

					if (module.isExternal) {
						if (importDeclaration.name === 'default') {
							module.needsDefault = true;
						} else {
							module.needsNamed = true;
						}

						module.importedByBundle.push(importDeclaration);
						return emptyArrayPromise
					}

					if (importDeclaration.name === '*') {
						// we need to create an internal namespace
						if (!this.bundle.internalNamespaceModules.includes(module)) {
							this.bundle.internalNamespaceModules.push(module);
						}

						return module.expandAllStatements()
					}

					const exportDeclaration = module.exports[importDeclaration.name];

					if (!exportDeclaration) {
						throw new Error(`Module ${module.path} does not export ${importDeclaration.name} (imported by ${this.path})`)
					}

					return module.define(exportDeclaration.localName)
				});
		}
		// The definition is in this module
		else if (name === 'default' && this.exports.default.isDeclaration) {
			// We have something like `export default foo` - so we just start again,
			// searching for `foo` instead of default
			promise = this.define(this.exports.default.name);
		} else {
			let statement;

			if (name === 'default') {
				// TODO can we use this.definitions[name], as below?
				statement = this.exports.default.node;
			} else {
				statement = this.definitions[name];
			}

			if (statement && !statement._included) {
				promise = this.expandStatement(statement);
			}
		}

		this.definitionPromises[name] = promise || emptyArrayPromise;
		return this.definitionPromises[name]
	}

	getCanonicalName(localName) {
		if (has$2(this.suggestedNames, localName)) {
			localName = this.suggestedNames[localName];
		}

		if (!has$2(this.canonicalNames, localName)) {
			let canonicalName;

			if (has$2(this.imports, localName)) {
				const importDeclaration = this.imports[localName];
				const module = importDeclaration.module;

				if (importDeclaration.name === '*') {
					canonicalName = module.suggestedNames['*'];
				} else {
					let exporterLocalName;

					if (module.isExternal) {
						exporterLocalName = importDeclaration.name;
					} else {
						const exportDeclaration = module.exports[importDeclaration.name];
						exporterLocalName = exportDeclaration.localName;
					}

					canonicalName = module.getCanonicalName(exporterLocalName);
				}
			} else {
				canonicalName = localName;
			}

			this.canonicalNames[localName] = canonicalName;
		}

		return this.canonicalNames[localName]
	}

	rename(name, replacement) {
		this.canonicalNames[name] = replacement;
	}

	suggestName(exportName, suggestion) {
		if (!this.suggestedNames[exportName]) {
			this.suggestedNames[exportName] = suggestion;
		}
	}
}

var module$1 = Module;

const { keys: keys$1 } = object;

function cjs(bundle, magicString, exportMode) {
	let intro = `'use strict'\n\n`;

	const importBlock = bundle.externalModules
		.map(module => {
			let requireStatement = `var ${module.name} = require('${module.id}')`;

			if (module.needsDefault) {
				requireStatement += '\n' + (module.needsNamed ? `var ${module.name}__default = ` : `${module.name} = `) +
					`'default' in ${module.name} ? ${module.name}['default'] : ${module.name}`;
			}

			return requireStatement
		})
		.join('\n');

	if (importBlock) {
		intro += importBlock + '\n\n';
	}

	magicString.prepend(intro);

	let exportBlock;
	if (exportMode === 'default' && bundle.entryModule.exports.default) {
		exportBlock = `module.exports = ${bundle.entryModule.getCanonicalName('default')}`;
	} else if (exportMode === 'named') {
		exportBlock = keys$1(bundle.entryModule.exports)
			.map(key => {
				const specifier = bundle.entryModule.exports[key];
				const name = bundle.entryModule.getCanonicalName(specifier.localName);

				return `exports.${key} = ${name}`
			})
			.join('\n');
	}

	if (exportBlock) {
		magicString.append('\n\n' + exportBlock);
	}

	return magicString
}

var cjs_1 = cjs;

var finalisers = { cjs: cjs_1 };

class ExternalModule {
    constructor(id) {
		this.id = id;
		this.name = null;

		this.isExternal = true;
		this.importedByBundle = [];

		this.canonicalNames = {};
		this.suggestedNames = {};

		this.needsDefault = false;
		this.needsNamed = false;
	}

	getCanonicalName(name) {
		if (name === 'default') {
			return this.needsNamed ? `${this.name}__default` : this.name
		}

		if (name === '*') {
			return this.name
		}

		// TODO this depends on the output format... works for CJS etc but not ES6
		return `${this.name}.${name}`
	}

	rename(name, replacement) {
		this.canonicalNames[name] = replacement;
	}

	suggestName(exportName, suggestion) {
		if (!this.suggestedNames[exportName]) {
			this.suggestedNames[exportName] = suggestion;
		}
	}
}

var externalModule = ExternalModule;

const { has: has$1 } = object;

// 重写 node 名称
// 例如 import { resolve } from path; 将 resolve 变为 path.resolve
function replaceIdentifiers(statement, snippet, names) {
	const replacementStack = [names];
	const keys = Object.keys(names);

	if (keys.length === 0) {
		return
	}

	walk_1(statement, {
		enter(node, parent) {
			const scope = node._scope;

			if (scope) {
				let newNames = {};
				let hasReplacements;

				keys.forEach(key => {
					if (!scope.names.includes(key)) {
						newNames[key] = names[key];
						hasReplacements = true;
					}
				});

				if (!hasReplacements) {
					return this.skip()
				}

				names = newNames;
				replacementStack.push(newNames);
			}

			// We want to rewrite identifiers (that aren't property names)
			if (node.type !== 'Identifier') return
			if (parent.type === 'MemberExpression' && node !== parent.object) return
			if (parent.type === 'Property' && node !== parent.value) return

			const name = has$1(names, node.name) && names[node.name];

			if (name && name !== node.name) {
				snippet.overwrite(node.start, node.end, name);
			}
		},

		leave(node) {
			if (node._scope) {
				replacementStack.pop();
				names = replacementStack[replacementStack.length - 1];
			}
		}
	});
}

var replaceIdentifiers_1 = replaceIdentifiers;

const { has, keys } = object;




class Bundle {
    constructor(options = {}) {
        // 防止用户省略 .js 后缀
        this.entryPath = path__default['default'].resolve(options.entry.replace(/\.js$/, '') + '.js');
        // 获取入口文件的目录
        this.base = path__default['default'].dirname(this.entryPath);
        // 入口模块
        this.entryModule = null;
        // 读取过的模块都缓存在此，如果重复读取则直接从缓存读取模块，提高效率
        this.modules = {};
        // 最后真正要生成的代码的 AST 节点语句，不用生成的 AST 会被省略掉
        this.statements = [];
        // 外部模块，当通过路径获取不到的模块就属于外部模块，例如 const fs = require('fs') 中的 fs 模块
		this.externalModules = [];
		// import * as test from './foo' 需要用到
		this.internalNamespaceModules = [];
    }

    build() {
        return this.fetchModule(this.entryPath)
            .then(entryModule => {
                this.entryModule = entryModule;
                return entryModule.expandAllStatements(true)
            })
            .then(statements => {
				this.statements = statements;
				this.deconflict();
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
				resolve(this.modules[importee]);
				return 
			}

            let route;
            // 入口文件没有 importer
            if (!importer) {
                route = importee;
            } else {
				// 绝对路径
				if (path__default['default'].isAbsolute(importee)) {
					route = importee;
				} else if (importee[0] == '.') {
					// 相对路径
					// 获取 importer 的目录，从而找到 importee 的绝对路径
					route = path__default['default'].resolve(path__default['default'].dirname(importer), importee.replace(/\.js$/, '') + '.js');
				}
            }

			if (route) {
				fs__default['default'].readFile(route, 'utf-8', (err, code) => {
					if (err) reject(err);
					const module = new module$1({
						code,
						path: route,
						bundle: this,
					});
					
					this.modules[route] = module;
					resolve(module);
				});
			} else {
				// 没有找到路径则是外部模块
				const module = new externalModule(importee);
				this.externalModules.push(module);
				this.modules[importee] = module;
				resolve(module);
			}
        })
    }

    generate(options = {}) {
		let magicString = new MagicString__default['default'].Bundle({ separator: '' });
		// Determine export mode - 'default', 'named', 'none'
		// 导出模式
		let exportMode = this.getExportMode(options.exports);
		let previousMargin = 0;

		// Apply new names and add to the output bundle
		this.statements.forEach(statement => {
			let replacements = {};

			keys(statement._dependsOn)
				.concat(keys(statement._defines))
				.forEach(name => {
					const canonicalName = statement._module.getCanonicalName(name);

					if (name !== canonicalName) {
						replacements[name] = canonicalName;
					}
				});

			const source = statement._source.clone().trim();

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
					source.remove(statement.start, statement.declaration.start);
				}
				// `export class Foo {...}` 移除 export
				else if (statement.declaration.id) {
					source.remove(statement.start, statement.declaration.start);
				} else if (statement.type === 'ExportDefaultDeclaration') {
					const module = statement._module;
					const canonicalName = module.getCanonicalName('default');

					if (statement.declaration.type === 'Identifier' && canonicalName === module.getCanonicalName(statement.declaration.name)) {
						return
					}

					source.overwrite(statement.start, statement.declaration.start, `var ${canonicalName} = `);
				} else {
					throw new Error('Unhandled export')
				}
            }
			
			// 例如 import { resolve } from path; 将 resolve 变为 path.resolve
			replaceIdentifiers_1(statement, source, replacements);

			// 生成空行
			// add margin
			const margin = Math.max(statement._margin[0], previousMargin);
			const newLines = new Array(margin).join('\n');

			// add the statement itself
			magicString.addSource({
				content: source,
				separator: newLines
			});

			previousMargin = statement._margin[1];
		});

		// 这个主要是针对 import * as g from './foo' 语句
		// 如果 foo 文件有默认导出的函数和 two() 函数，生成的代码如下
		// var g = {
		// 	 get default () { return g__default },
		// 	 get two () { return two }
		// }
		const indentString = magicString.getIndentString();
		const namespaceBlock = this.internalNamespaceModules.map(module => {
			const exportKeys = keys(module.exports);

			return `var ${module.getCanonicalName('*')} = {\n` +
				exportKeys.map(key => `${indentString}get ${key} () { return ${module.getCanonicalName(key)} }`).join(',\n') +
			`\n}\n\n`
		}).join('');

		magicString.prepend(namespaceBlock);

		const finalise = finalisers[options.format || 'cjs'];
		magicString = finalise(this, magicString.trim(), exportMode, options);

		return { code: magicString.toString() }
    }
    
    getExportMode(exportMode) {
		const exportKeys = keys(this.entryModule.exports);

		if (!exportMode || exportMode === 'auto') {
			if (exportKeys.length === 0) {
				// 没有导出模块
				exportMode = 'none';
			} else if (exportKeys.length === 1 && exportKeys[0] === 'default') {
				// 只有一个导出模块，并且是 default
				exportMode = 'default';
			} else {
				exportMode = 'named';
			}
		}

		return exportMode
	}

	deconflict() {
		const definers = {};
		const conflicts = {};
		// 解决冲突，例如两个不同的模块有一个同名函数，则需要对其中一个重命名。
		this.statements.forEach(statement => {
			keys(statement._defines).forEach(name => {
				if (has(definers, name)) {
					conflicts[name] = true;
				} else {
					definers[name] = [];
				}

				definers[name].push(statement._module);
			});
		});

		// 为外部模块分配名称，例如引入了 path 模块的 resolve 方法，使用时直接用 resolve()
		// 打包后会变成 path.resolve
		this.externalModules.forEach(module => {
			const name = module.suggestedNames['*'] || module.suggestedNames.default || module.id;

			if (has(definers, name)) {
				conflicts[name] = true;
			} else {
				definers[name] = [];
			}

			definers[name].push(module);
			module.name = name;
		});

		// Rename conflicting identifiers so they can live in the same scope
		keys(conflicts).forEach(name => {
			const modules = definers[name];
			// 最靠近入口模块的模块可以保持原样，即不改名
			modules.pop();
			// 其他冲突的模块要改名
			// 改名就是在冲突的变量前加下划线 _
			modules.forEach(module => {
				const replacement = getSafeName(name);
				module.rename(name, replacement);
			});
		});

		function getSafeName(name) {
			while (has(conflicts, name)) {
				name = `_${name}`;
			}

			conflicts[name] = true;
			return name
		}
	}
}

var bundle = Bundle;

function rollup(entry, options = {}) {
    const bundle$1 = new bundle({ entry, ...options });
    return bundle$1.build().then(() => {
        return {
            generate: options => bundle$1.generate(options),
            write(dest, options = {}) {
                const { code } = bundle$1.generate({
					dest,
					format: options.format,
				});

				return fs__default['default'].writeFile(dest, code, err => {
                    if (err) throw err
                })
            }
        }
    })
}

var rollup_1 = rollup;

module.exports = rollup_1;

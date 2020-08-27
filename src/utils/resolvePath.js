// 解析路径
function defaultResolver(importee, importer) {
	// absolute paths are left untouched
	if (path.isAbsolute(importee)) return importee

	// external modules stay external
	if (importee[0] !== '.') return false

	return path.resolve(path.dirname(importer), importee).replace(/\.js$/, '') + '.js'
}

module.exports = { defaultResolver }
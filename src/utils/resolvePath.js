import { dirname, isAbsolute, resolve } from 'path'
// 解析路径
export function defaultResolver (importee, importer) {
	// absolute paths are left untouched
	if (isAbsolute(importee)) return importee

	// external modules stay external
	if (importee[0] !== '.') return false

	return resolve(dirname(importer), importee).replace(/\.js$/, '') + '.js'
}
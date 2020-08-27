// 将数组每一项当成参数传给 callback 执行，最后将结果用 promise 返回
function sequence (arr, callback) {
	const len = arr.length
	const results = new Array(len)
	let promise = Promise.resolve()

	function next(i) {
		return promise
			.then(() => callback(arr[i], i))
			.then(result => results[i] = result)
	}

	let i
	for (i = 0; i < len; i += 1) {
		promise = next(i)
	}

	return promise.then(() => results)
}

module.exports = { sequence }
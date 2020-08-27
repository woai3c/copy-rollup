function getName(x) {
	return x.name
}

function quoteId(x) {
	return `'${x.id}'`
}

function req(x) {
	return `require('${x.id}')`
}

module.exports = {
	getName,
	quoteId,
	req
}
const { color } = require('./settings');

module.exports = new Proxy({}, { get: (_, name) => color(name) });

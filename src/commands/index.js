const list = [
  require('./stats'),
  require('./link'),
  require('./lfg'),
  ...require('./voice'),
  require('./mydata'),
  require('./setup')
];

module.exports = new Map(list.map(c => [c.data.name, c]));

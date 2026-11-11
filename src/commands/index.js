const list = [
  require('./help'),
  require('./stats'),
  require('./play'),
  require('./leaderboard'),
  require('./warframe'),
  require('./lfg'),
  require('./lfg').games,
  require('./dm'),
  require('./wrapped'),
  require('./link'),
  require('./mydata'),
  require('./setup')
];

module.exports = new Map(list.map(c => [c.data.name, c]));

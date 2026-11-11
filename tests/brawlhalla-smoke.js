const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

async function testIdParsingAndApi() {
  const brawlhalla = require('../src/brawlhalla');
  assert.equal(brawlhalla.parsePlayerId('1234567'), '1234567');
  assert.equal(brawlhalla.parsePlayerId(' 00123 '), '123');
  assert.equal(brawlhalla.parsePlayerId('0'), null);
  assert.equal(brawlhalla.parsePlayerId('nope'), null);
  assert.equal(brawlhalla.parsePlayerId('9007199254740992'), null);
  assert.match(brawlhalla.legendIconUrl('Bödvar'), /Portrait_Bodvar\.png$/);

  const urls = [];
  const oldFetch = global.fetch;
  const payloads = {
    all: {
      brawlhalla_id: '1234567', name: 'SmokeTester', games: 10, wins: 6,
      level: 15, xp_percentage: 0.5,
      legends: [{ legend_id: 1, games: 10, wins: 6, kos: 20, falls: 8, damage_dealt: 12000, damage_taken: 11000, suicides: 1 }]
    },
    ranked_1v1: { games: 4, wins: 3, rating: 1550, peak_rating: 1600, tier: 'Gold', region: 'US-E', legends: [{ legend_id: 1, games: 4, wins: 3, rating: 1550 }] },
    ranked_3v3: { games: 2, wins: 1, rating: 1400, tier: 'Silver', legends: [] }
  };

  global.fetch = async (input, options = {}) => {
    const url = String(input);
    urls.push(url);
    assert.ok(options.headers?.['User-Agent'], 'API calls should include a User-Agent');
    const parsed = new URL(url);
    let body;
    if (parsed.pathname.endsWith('/player/stats')) {
      body = payloads[parsed.searchParams.get('mode')];
    } else if (parsed.pathname.endsWith('/player/teams')) {
      body = { teams: { ranked_2v2: [] } };
    } else if (parsed.pathname.endsWith('/static/legends')) {
      body = { legends: [{ legend_id: 1, bio_name: 'Bödvar', weapon_one: 'Axe', weapon_two: 'Hammer' }], total_pages: 1 };
    } else {
      throw new Error(`Unexpected API URL: ${url}`);
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const player = await brawlhalla.getPlayer('1234567');
    assert.equal(player.all.name, 'SmokeTester');
    assert.equal(player.ranked1v1.rating, 1550);
    assert.equal(player.ranked3v3.rating, 1400);
    assert.equal(player.teams.teams.ranked_2v2.length, 0);
    assert.equal(player.legends.get(1).bio_name, 'Bödvar');
    for (const mode of ['all', 'ranked_1v1', 'ranked_3v3']) {
      assert.ok(urls.some(url => new URL(url).searchParams.get('mode') === mode), `Missing ${mode} API request`);
    }
    assert.ok(urls.some(url => new URL(url).pathname.endsWith('/player/teams')));
    assert.ok(urls.some(url => new URL(url).pathname.endsWith('/static/legends')));
  } finally {
    global.fetch = oldFetch;
  }
}

function testSqliteMigration() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khut-brawlhalla-'));
  const dbPath = path.join(dir, 'data.db');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE links (discord_id TEXT PRIMARY KEY, steam_id TEXT, riot_id TEXT);
    CREATE TABLE emoji_names (name TEXT PRIMARY KEY, key TEXT);
    INSERT INTO links (discord_id, steam_id, riot_id) VALUES ('42', 'steam-123', 'name#tag');
    INSERT INTO emoji_names (name, key) VALUES ('old_icon', 'old_key');
  `);
  legacy.close();

  process.env.DB_PATH = dbPath;
  const { db, getLinks, saveLinks } = require('../src/db');
  try {
    const columns = db.prepare('PRAGMA table_info(links)').all().map(row => row.name);
    assert.ok(columns.includes('brawlhalla_id'));
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='emoji_names'").get());
    assert.equal(getLinks('42').steam_id, 'steam-123');
    assert.equal(getLinks('42').riot_id, 'name#tag');
    assert.equal(getLinks('42').brawlhalla_id, null);

    saveLinks('42', null, null, '7654321');
    const linked = getLinks('42');
    assert.equal(linked.steam_id, 'steam-123', 'Adding Brawlhalla must not overwrite Steam');
    assert.equal(linked.riot_id, 'name#tag', 'Adding Brawlhalla must not overwrite Riot');
    assert.equal(linked.brawlhalla_id, '7654321');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DB_PATH;
  }
}

(async () => {
  await testIdParsingAndApi();
  testSqliteMigration();
  process.stdout.write('Brawlhalla smoke tests passed (ID parsing, mocked API v1 requests, SQLite migration/upsert).\n');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

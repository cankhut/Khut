const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const level = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function redact(value) {
  return String(value).replace(/(key=)[^&\s]+/gi, '$1***');
}

function write(name, args) {
  if (LEVELS[name] > level) return;
  const time = new Date().toLocaleString('sv-SE');
  const text = args.map(a => a instanceof Error ? redact(a.stack ?? a.message) : typeof a === 'string' ? redact(a) : a);
  console[name === 'debug' ? 'log' : name](`[${time}] ${name.toUpperCase().padEnd(5)}`, ...text);
}

module.exports = {
  error: (...args) => write('error', args),
  warn: (...args) => write('warn', args),
  info: (...args) => write('info', args),
  debug: (...args) => write('debug', args),
  redact
};

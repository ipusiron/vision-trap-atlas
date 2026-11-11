'use strict';
// F: readable source files (no minified lines) in UTF-8 without a byte order mark, and a lower bound on the lines of the main files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

const listed = (dir, pattern) => fs.readdirSync(path.join(root, dir)).filter((f) => pattern.test(f)).map((f) => path.posix.join(dir, f));

test('F: line length limits (JS, CSS and tests 160 characters, index.html 250) and UTF-8 without BOM', () => {
  const files = [...listed('.', /\.(js|css|html|json)$/), ...listed('test', /\.js$/), ...listed('test/fixtures', /\.js$/)].map((f) => f.replace(/^\.\//, ''));
  for (const required of ['package.json', 'index.html', 'style.css', 'theme-init.js', 'app.js', 'atlas-core.js', 'atlas-data.js', 'atlas-view.js',
    'atlas-search.js', 'messages.js', 'test/core.test.js', 'test/structure.test.js', 'test/fixtures/illusion-data.js']) {
    assert.ok(files.includes(required), required);
  }
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.notEqual(text.charCodeAt(0), 0xFEFF, file);
    assert.doesNotMatch(text, /\r/, `${file} keeps LF line ends`);
    const limit = file.endsWith('.html') ? 250 : 160;
    for (const [i, line] of text.split('\n').entries()) assert.ok([...line].length <= limit, `${file}:${i + 1} exceeds ${limit}`);
  }
});

test('F: main files keep a readable number of lines', () => {
  const minimum = [['atlas-core.js', 300], ['atlas-data.js', 350], ['atlas-view.js', 550], ['atlas-search.js', 200], ['messages.js', 900],
    ['app.js', 500], ['style.css', 300], ['index.html', 150], ['theme-init.js', 10]];
  for (const [file, lines] of minimum) {
    assert.ok(fs.readFileSync(path.join(root, file), 'utf8').split('\n').length >= lines, file);
  }
});

test('F: package.json has no dependencies and runs the tests with node --test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg, {
    name: 'vision-trap-atlas', version: '1.0.0', private: true,
    description: 'An atlas of visual traps: pop-out, grouping, figure and ground, search time and misleading charts. Day128.',
    scripts: { test: 'node --test "test/**/*.test.js"' }, engines: { node: '>=22' }, license: 'MIT',
  });
});

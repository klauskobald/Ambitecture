import http from 'http';

const base = process.env.DELIVER_BASE || 'http://127.0.0.1:8080';

/**
 * @param {string} path
 * @returns {Promise<{ status: number; body: string }>}
 */
function getPath(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
  });
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

try {
  const r1 = await getPath('/controller-test/');
  assert(r1.status === 200, `GET /controller-test/ expected 200, got ${r1.status}`);
  const lower = r1.body.toLowerCase();
  assert(lower.includes('<iframe'), 'body should include an iframe tag');
  assert(lower.includes('id="sim-frame"'), 'body should include iframe#sim-frame');
  assert(lower.includes('touch-overlay'), 'body should include overlay canvas#touch-overlay');

  const r2 = await getPath('/simulator-2d/');
  assert(r2.status === 200, `GET /simulator-2d/ expected 200, got ${r2.status}`);
  assert(
    r2.body.toLowerCase().includes('sim-canvas') || r2.body.toLowerCase().includes('<canvas'),
    'simulator page should mention canvas'
  );

  console.log('deliver-smoke: PASS');
} catch (e) {
  const err = /** @type {NodeJS.ErrnoException} */ (e);
  if (err.code === 'ECONNREFUSED') {
    console.error(
      'deliver-smoke: FAIL — could not connect. Start deliver first:\n  cd modules/deliver && npm start'
    );
  } else {
    console.error('deliver-smoke: FAIL —', err.message || err);
  }
  process.exit(1);
}

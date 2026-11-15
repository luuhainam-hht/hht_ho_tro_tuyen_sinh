'use strict';
async function add(c, day, tokensIn, tokensOut) {
  await c.query(
    `INSERT INTO token_usage_daily (day, tokens_in, tokens_out, requests) VALUES (?, ?, ?, 1)
     ON CONFLICT (day) DO UPDATE SET tokens_in = token_usage_daily.tokens_in + EXCLUDED.tokens_in,
       tokens_out = token_usage_daily.tokens_out + EXCLUDED.tokens_out, requests = token_usage_daily.requests + 1`,
    [day, tokensIn, tokensOut],
  );
}

async function totalForDay(c, day) {
  const { rows } = await c.query('SELECT COALESCE(tokens_in + tokens_out, 0)::bigint AS total FROM token_usage_daily WHERE day = ?', [day]);
  return Number(rows[0]?.total ?? 0);
}

module.exports = { add, totalForDay };

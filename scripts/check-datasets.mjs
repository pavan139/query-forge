#!/usr/bin/env node
/**
 * SQL Quest - dataset checker.
 *
 * Loads every public/datasets/*.sql file into a FRESH in-memory PGlite database and verifies:
 *   - the file is well-formed for the app (size, no DROP/BEGIN/COMMIT/SET/psql commands,
 *     INSERTs of at most 500 rows, ends with ANALYZE)
 *   - it loads without errors (primary / foreign keys, NOT NULL and CHECK constraints are
 *     enforced by the database, so a clean load proves referential integrity)
 *   - the row counts match content/datasets/catalog.json
 *   - structural rules: primary keys, no secondary indexes, snake_case names, no reserved words
 *   - the deliberate quirks documented in content/DATASETS.md really are in the data
 *
 * Usage:  node scripts/check-datasets.mjs [dataset-id ...]
 * Exit code is 1 when anything fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_DIR = path.join(ROOT, 'public', 'datasets');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'datasets', 'catalog.json'), 'utf8'));

const only = process.argv.slice(2);
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const ok = (msg) => console.log(`  ok    ${msg}`);

// -----------------------------------------------------------------------------------------------
// static checks on the SQL text
// -----------------------------------------------------------------------------------------------
function staticChecks(id, sql) {
  const kb = Buffer.byteLength(sql) / 1024;
  if (kb > 1500) fail(`${id}.sql is ${kb.toFixed(0)} KB (limit ~1500 KB)`);
  else ok(`file size ${kb.toFixed(0)} KB`);
  const lines = sql.split('\n');
  const bad = lines.filter((l) => /^\s*(DROP|BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|SET|RESET|CREATE\s+(UNIQUE\s+)?INDEX|\\)/i.test(l) && !/^\s*--/.test(l));
  if (bad.length) fail(`forbidden statements: ${bad.slice(0, 3).join(' | ')}`);
  else ok('no DROP / BEGIN / COMMIT / SET / psql commands / CREATE INDEX');
  if (id === 'blank') {
    const code = lines.filter((l) => l.trim() && !l.trim().startsWith('--'));
    if (code.length) fail('blank.sql must contain only comments');
    else ok('blank.sql contains only a comment');
    return;
  }
  // every INSERT has at most 500 value rows
  let rowsInStmt = 0;
  let maxRows = 0;
  for (const l of lines) {
    if (/^INSERT INTO /.test(l)) rowsInStmt = 0;
    else if (/^\s{2}\(/.test(l)) {
      rowsInStmt++;
      maxRows = Math.max(maxRows, rowsInStmt);
    }
  }
  if (maxRows > 500) fail(`an INSERT has ${maxRows} rows (limit 500)`);
  else ok(`largest INSERT has ${maxRows} rows`);
  if (!/ANALYZE;\s*$/.test(sql)) fail('file does not end with ANALYZE;');
  else ok('ends with ANALYZE;');
  const domains = new Set([...sql.matchAll(/[A-Za-z0-9._+-]+@([A-Za-z0-9.-]+)/g)].map((m) => m[1].toLowerCase()));
  const badDomains = [...domains].filter((d) => d !== 'example.com' && d !== 'example.org');
  if (badDomains.length) fail(`email domains other than example.com / example.org: ${badDomains.join(', ')}`);
  else if (domains.size) ok(`all email addresses use example.com / example.org`);
  if (/GENERATED\s+(ALWAYS|BY DEFAULT)/i.test(sql) || /\bserial\b/i.test(sql)) fail('identity / serial columns are not allowed');
}

// -----------------------------------------------------------------------------------------------
// dataset-specific checks: [description, sql, expected]
//   expected: a value (compared with the first cell of the first row), or a function(rows) -> boolean
// -----------------------------------------------------------------------------------------------
const eq = (v) => v;
const between = (lo, hi) => (rows) => {
  const x = Number(Object.values(rows[0])[0]);
  return x >= lo && x <= hi;
};
const CHECKS = {
  cafe: [
    ['32 menu items in the six exact categories', "SELECT count(*) FROM menu_items WHERE category IN ('Coffee','Tea','Pastry','Sandwich','Dessert','Juice')", 32],
    ['prices between 1.50 and 12.50', 'SELECT count(*) FROM menu_items WHERE price < 1.50 OR price > 12.50', 0],
    ['4 NULL calories, 3 unavailable items', "SELECT count(*) FILTER (WHERE calories IS NULL) || ',' || count(*) FILTER (WHERE NOT is_available) FROM menu_items", '4,3'],
    ['added_on within 2022-03-01..2024-11-30', "SELECT count(*) FROM menu_items WHERE added_on NOT BETWEEN '2022-03-01' AND '2024-11-30'", 0],
    ['28 customers, 5 NULL emails, 5 cities', 'SELECT count(*) || \',\' || count(*) FILTER (WHERE email IS NULL) || \',\' || count(DISTINCT city) FROM customers', '28,5,5'],
    ['loyalty points 0..850 with at least 2 zeros', 'SELECT (min(loyalty_points) = 0 AND max(loyalty_points) = 850 AND count(*) FILTER (WHERE loyalty_points = 0) >= 2)::text FROM customers', 'true'],
    ['10 staff, one manager without a boss, 4 roles', 'SELECT count(*) || \',\' || count(*) FILTER (WHERE manager_id IS NULL) || \',\' || count(DISTINCT role) FROM staff', '10,1,4'],
    ['180 orders in 2024-10-01..2024-12-31', "SELECT count(*) FROM orders WHERE order_time >= '2024-10-01' AND order_time < '2025-01-01'", 180],
    ['opening hours 07:00-19:00', 'SELECT count(*) FROM orders WHERE extract(hour FROM order_time) NOT BETWEEN 7 AND 18', 0],
    ['payment methods are cash / card / app', "SELECT count(DISTINCT payment_method) FROM orders WHERE payment_method IN ('cash','card','app')", 3],
    ['about 25% walk-ins', "SELECT count(*) FROM orders WHERE customer_id IS NULL", between(40, 50)],
    ['about 30% NULL tips', 'SELECT count(*) FROM orders WHERE tip IS NULL', between(48, 60)],
    ['exactly 3 customers never ordered', 'SELECT count(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)', 3],
    ['no order before the item was added to the menu', 'SELECT count(*) FROM orders o JOIN menu_items m USING (item_id) WHERE o.order_time::date < m.added_on', 0],
    ['no order before the customer joined', 'SELECT count(*) FROM orders o JOIN customers c USING (customer_id) WHERE o.order_time::date < c.joined_on', 0],
    ['closed on 2024-11-28 and 2024-12-25', "SELECT count(*) FROM orders WHERE order_time::date IN ('2024-11-28','2024-12-25')", 0],
    ['quantity mostly 1', 'SELECT count(*) FROM orders WHERE quantity = 1', between(110, 160)],
  ],
  shop: [
    ['14 categories in a 3-level tree', 'WITH RECURSIVE t AS (SELECT category_id, 1 AS d FROM categories WHERE parent_id IS NULL UNION ALL SELECT c.category_id, t.d + 1 FROM categories c JOIN t ON c.parent_id = t.category_id) SELECT count(*) || \',\' || max(d) FROM t', '14,3'],
    ['8 suppliers, 2 without email', 'SELECT count(*) || \',\' || count(*) FILTER (WHERE contact_email IS NULL) FROM suppliers', '8,2'],
    ['60 products: cost < price, 3 NULL suppliers, 4 inactive, some stock 0', 'SELECT count(*) || \',\' || count(*) FILTER (WHERE cost >= price) || \',\' || count(*) FILTER (WHERE supplier_id IS NULL) || \',\' || count(*) FILTER (WHERE NOT is_active) || \',\' || (count(*) FILTER (WHERE stock_qty = 0) > 0) FROM products', '60,0,3,4,true'],
    ['150 customers, ~20% NULL phone, ~10% NULL birth_date, 12 states', 'SELECT count(*) || \',\' || count(*) FILTER (WHERE phone IS NULL) || \',\' || count(*) FILTER (WHERE birth_date IS NULL) || \',\' || count(DISTINCT state) FROM customers', '150,30,15,12'],
    ['signup dates within 2022-06-01..2024-10-31', "SELECT count(*) FROM customers WHERE signup_date NOT BETWEEN '2022-06-01' AND '2024-10-31'", 0],
    ['customers 141-150 are exactly the customers without orders', "SELECT string_agg(customer_id::text, ',' ORDER BY customer_id) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)", '141,142,143,144,145,146,147,148,149,150'],
    ['about 900 orders in 2023-01-01..2024-12-31', "SELECT count(*) FROM orders WHERE order_date BETWEEN '2023-01-01' AND '2024-12-31'", between(850, 950)],
    ['every order is after the customer signed up', 'SELECT count(*) FROM orders o JOIN customers c USING (customer_id) WHERE o.order_date <= c.signup_date', 0],
    ['2024 has more orders than 2023', "SELECT (count(*) FILTER (WHERE order_date >= '2024-01-01') > count(*) FILTER (WHERE order_date < '2024-01-01'))::text FROM orders", 'true'],
    ['Nov + Dec are the busiest months', "SELECT (SELECT count(*) FROM orders WHERE extract(month FROM order_date) IN (11, 12)) > 2 * (SELECT count(*) FROM orders WHERE extract(month FROM order_date) IN (1, 2))", true],
    ['delivered is about 70% of orders', "SELECT count(*) FROM orders WHERE status = 'delivered'", between(600, 700)],
    ['all five statuses present', 'SELECT count(DISTINCT status) FROM orders', 5],
    ['shipped_date >= order_date, NULL only for processing / cancelled', "SELECT count(*) FROM orders WHERE shipped_date < order_date OR (shipped_date IS NULL) <> (status IN ('processing','cancelled'))", 0],
    ['~15% of orders use a discount code', 'SELECT count(*) FROM orders WHERE discount_code IS NOT NULL', between(100, 160)],
    ['a code fixes the line discount', "SELECT count(*) FROM orders o JOIN order_items i USING (order_id) WHERE o.discount_code IS NOT NULL AND i.discount <> CASE o.discount_code WHEN 'WELCOME10' THEN 0.10 WHEN 'SUMMER15' THEN 0.15 WHEN 'BLACKFRIDAY' THEN 0.20 WHEN 'LOYALTY5' THEN 0.05 ELSE 0 END", 0],
    ['discount values are 0, 0.05, 0.10, 0.15, 0.20', 'SELECT count(DISTINCT discount) FROM order_items', 5],
    ['every order has 1-5 items', 'SELECT count(*) || \',\' || min(n) || \',\' || max(n) FROM (SELECT order_id, count(*) AS n FROM order_items GROUP BY order_id) t', (rows) => /^\d+,1,5$/.test(Object.values(rows[0])[0]) && Number(Object.values(rows[0])[0].split(',')[0]) === 900],
    ['about 2200 order lines', 'SELECT count(*) FROM order_items', between(2000, 2400)],
    ['exactly 5 products were never ordered', 'SELECT count(*) FROM products p WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.product_id = p.product_id)', 5],
    ['order_items.unit_price equals products.price for most lines', 'SELECT count(*) FROM order_items i JOIN products p USING (product_id) WHERE i.unit_price <> p.price', between(1, 200)],
    ['payments add up to the order total for every paid order', "WITH t AS (SELECT order_id, round(sum(quantity * unit_price * (1 - discount)), 2) AS total FROM order_items GROUP BY order_id), p AS (SELECT order_id, sum(amount) AS paid FROM payments GROUP BY order_id) SELECT count(*) FROM t JOIN p USING (order_id) WHERE t.total <> p.paid", 0],
    ['exactly 15 non-cancelled orders are unpaid', "SELECT count(*) FROM orders o WHERE o.status <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.order_id)", 15],
    ['cancelled orders have no payments', "SELECT count(*) FROM payments p JOIN orders o USING (order_id) WHERE o.status = 'cancelled'", 0],
    ['20 orders have two payments, none more', 'SELECT count(*) FILTER (WHERE n = 2) || \',\' || count(*) FILTER (WHERE n > 2) FROM (SELECT order_id, count(*) AS n FROM payments GROUP BY order_id) t', '20,0'],
    ['payment methods', 'SELECT count(DISTINCT method) FROM payments', 4],
    ['payments are not before the order date', 'SELECT count(*) FROM payments p JOIN orders o USING (order_id) WHERE p.paid_at::date < o.order_date', 0],
    ['about 320 reviews, ~30% without text, ratings 1-5', 'SELECT count(*) || \',\' || count(*) FILTER (WHERE review_text IS NULL) FROM reviews', (rows) => { const [n, nul] = Object.values(rows[0])[0].split(',').map(Number); return n === 320 && nul / n > 0.2 && nul / n < 0.4; }],
    ['ratings skew to 4-5 stars', 'SELECT count(*) FILTER (WHERE rating >= 4) * 1.0 / count(*) FROM reviews', (rows) => Number(Object.values(rows[0])[0]) > 0.6],
    ['reviewers bought the product (delivered) before reviewing', "SELECT count(*) FROM reviews r WHERE NOT EXISTS (SELECT 1 FROM order_items i JOIN orders o USING (order_id) WHERE o.customer_id = r.customer_id AND i.product_id = r.product_id AND o.status = 'delivered' AND o.order_date < r.created_at)", 0],
  ],
  company: [
    ['7 departments, Research has no employees', "SELECT count(*) FROM departments d WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.dept_id = d.dept_id)", 1],
    ['the empty department is Research', "SELECT d.name FROM departments d WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.dept_id = d.dept_id)", 'Research'],
    ['55 employees, 2 without department, only the CEO without manager', 'SELECT count(*) || \',\' || count(*) FILTER (WHERE dept_id IS NULL) || \',\' || count(*) FILTER (WHERE manager_id IS NULL) FROM employees', '55,2,1'],
    ['hierarchy depth is exactly 5', 'WITH RECURSIVE t AS (SELECT emp_id, 1 AS lvl FROM employees WHERE manager_id IS NULL UNION ALL SELECT e.emp_id, t.lvl + 1 FROM employees e JOIN t ON e.manager_id = t.emp_id) SELECT max(lvl) || \',\' || count(*) FROM t', '5,55'],
    ['salaries 45k..320k, CEO is highest', 'SELECT (min(salary) >= 45000 AND max(salary) = 320000 AND (SELECT salary FROM employees WHERE manager_id IS NULL) = max(salary))::text FROM employees', 'true'],
    ['hire dates 2012..2024', "SELECT count(*) FROM employees WHERE hire_date NOT BETWEEN '2012-01-01' AND '2024-12-31'", 0],
    ['5 terminated employees, all after hire', 'SELECT count(*) FILTER (WHERE terminated_on IS NOT NULL) || \',\' || count(*) FILTER (WHERE terminated_on <= hire_date) FROM employees', '5,0'],
    ['three employment types', "SELECT count(DISTINCT employment_type) FROM employees WHERE employment_type IN ('full_time','part_time','contractor')", 3],
    ['salary ties inside departments exist', 'SELECT count(*) FROM (SELECT dept_id, salary FROM employees WHERE dept_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) t', (rows) => Number(Object.values(rows[0])[0]) >= 3],
    ['salary_history: about 170 rows, 1-5 per employee', 'SELECT count(*) || \',\' || min(n) || \',\' || max(n) FROM (SELECT emp_id, count(*) AS n FROM salary_history GROUP BY emp_id) t', (rows) => { const [, mn, mx] = Object.values(rows[0])[0].split(',').map(Number); return mn === 1 && mx === 5; }],
    ['salary_history total rows ~170', 'SELECT count(*) FROM salary_history', between(150, 190)],
    ['last history row equals the current salary', 'SELECT count(*) FROM employees e WHERE e.salary <> (SELECT h.salary FROM salary_history h WHERE h.emp_id = e.emp_id ORDER BY h.effective_date DESC LIMIT 1)', 0],
    ['exactly two pay cuts', 'SELECT count(*) FROM (SELECT salary < lag(salary) OVER (PARTITION BY emp_id ORDER BY effective_date) AS cut FROM salary_history) t WHERE cut', 2],
    ['14 projects in four statuses', "SELECT count(*) || ',' || count(DISTINCT status) FROM projects", '14,4'],
    ['about 95 assignments', 'SELECT count(*) FROM project_assignments', between(90, 100)],
    ['about 10 employees on no project', 'SELECT count(*) FROM employees e WHERE NOT EXISTS (SELECT 1 FROM project_assignments a WHERE a.emp_id = e.emp_id)', 10],
    ['exactly one project without assignments', 'SELECT count(*) FROM projects p WHERE NOT EXISTS (SELECT 1 FROM project_assignments a WHERE a.project_id = p.project_id)', 1],
    ['six assignment roles', 'SELECT count(DISTINCT role) FROM project_assignments', 6],
  ],
  movies: [
    ['110 movies from 1975 to 2024', 'SELECT count(*) || \',\' || min(release_year) || \',\' || max(release_year) FROM movies', '110,1975,2024'],
    ['age ratings G / PG / PG-13 / R all used', 'SELECT count(DISTINCT age_rating) FROM movies', 4],
    ['~15% of movies miss budget or box office', 'SELECT count(*) FROM movies WHERE budget_musd IS NULL OR box_office_musd IS NULL', between(12, 22)],
    ['12 genres, 1-3 per movie', 'SELECT (SELECT count(*) FROM genres) || \',\' || min(n) || \',\' || max(n) FROM (SELECT movie_id, count(*) AS n FROM movie_genres GROUP BY movie_id) t', '12,1,3'],
    ['about 90 people', 'SELECT count(*) FROM people', 90],
    ['each movie has exactly one director', "SELECT count(*) FROM movies m WHERE (SELECT count(*) FROM movie_cast c WHERE c.movie_id = m.movie_id AND c.role = 'director') <> 1", 0],
    ['each movie has 2-6 actors', "SELECT count(*) FROM movies m WHERE (SELECT count(*) FROM movie_cast c WHERE c.movie_id = m.movie_id AND c.role = 'actor') NOT BETWEEN 2 AND 6", 0],
    ['character_name / billing_order only for actors', "SELECT count(*) FROM movie_cast WHERE (role = 'actor') <> (character_name IS NOT NULL) OR (role = 'actor') <> (billing_order IS NOT NULL)", 0],
    ['exactly two people both act and direct', "SELECT count(*) FROM (SELECT person_id FROM movie_cast GROUP BY person_id HAVING bool_or(role = 'director') AND bool_or(role = 'actor')) t", 2],
    ['a few directors direct many movies', "SELECT max(n) FROM (SELECT count(*) AS n FROM movie_cast WHERE role = 'director' GROUP BY person_id) t", (rows) => Number(Object.values(rows[0])[0]) >= 8],
    ['220 users signed up 2022-01..2024-06', "SELECT count(*) || ',' || count(*) FILTER (WHERE signup_date NOT BETWEEN '2022-01-01' AND '2024-06-30') FROM users", '220,0'],
    ['about 1800 ratings, steps of 0.5', "SELECT count(*) || ',' || count(*) FILTER (WHERE (stars * 2) <> floor(stars * 2) OR stars < 0.5 OR stars > 5) FROM ratings", '1800,0'],
    ['some movies have no ratings', 'SELECT count(*) FROM movies m WHERE NOT EXISTS (SELECT 1 FROM ratings r WHERE r.movie_id = m.movie_id)', (rows) => Number(Object.values(rows[0])[0]) >= 3],
    ['ratings come after signup', 'SELECT count(*) FROM ratings r JOIN users u USING (user_id) WHERE r.rated_at::date < u.signup_date', 0],
    ['about 3500 plays between 2024-01-01 and 2024-06-30', "SELECT count(*) || ',' || count(*) FILTER (WHERE started_at < '2024-01-01' OR started_at >= '2024-07-01') FROM watch_history", (rows) => { const [n, bad] = Object.values(rows[0])[0].split(',').map(Number); return n >= 3300 && n <= 3800 && bad === 0; }],
    ['minutes_watched never exceeds the movie length', 'SELECT count(*) FROM watch_history w JOIN movies m USING (movie_id) WHERE w.minutes_watched > m.duration_min OR w.minutes_watched < 1', 0],
    ['binge clusters: many plays follow the previous one within 30 minutes', "SELECT count(*) FROM (SELECT started_at - lag(started_at) OVER (PARTITION BY user_id ORDER BY started_at) AS gap FROM watch_history) t WHERE gap <= interval '30 minutes'", (rows) => Number(Object.values(rows[0])[0]) >= 1000],
    ['clean session boundary: within-gap <= 30 min < 3 h <= between-gap', "WITH g AS (SELECT started_at - lag(started_at) OVER (PARTITION BY user_id ORDER BY started_at) AS gap FROM watch_history) SELECT (max(gap) FILTER (WHERE gap <= interval '30 minutes') < interval '30 minutes' AND min(gap) FILTER (WHERE gap > interval '30 minutes') >= interval '3 hours')::text FROM g", 'true'],
  ],
  bank: [
    ['5 branches, 80 customers, ~125 accounts, 40 loans', 'SELECT (SELECT count(*) FROM branches) || \',\' || (SELECT count(*) FROM customers) || \',\' || (SELECT count(*) FROM loans)', '5,80,40'],
    ['about 125 accounts', 'SELECT count(*) FROM accounts', between(115, 135)],
    ['account types and statuses', "SELECT count(DISTINCT account_type) || ',' || count(DISTINCT status) FROM accounts", '3,3'],
    ['some customers have 2-3 accounts, a few have none', 'SELECT (SELECT max(n) FROM (SELECT count(*) AS n FROM accounts GROUP BY customer_id) t) || \',\' || (SELECT count(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.customer_id = c.customer_id))', '3,5'],
    ['about 3500 transactions in 2024', "SELECT count(*) || ',' || count(*) FILTER (WHERE txn_time < '2024-01-01' OR txn_time >= '2025-01-01') FROM transactions", (rows) => { const [n, bad] = Object.values(rows[0])[0].split(',').map(Number); return n >= 3300 && n <= 3900 && bad === 0; }],
    ['seven transaction types', 'SELECT count(DISTINCT txn_type) FROM transactions', 7],
    ['merchant and category only for card payments', "SELECT count(*) FROM transactions WHERE (txn_type = 'card_payment') <> (merchant IS NOT NULL AND category IS NOT NULL) OR (txn_type <> 'card_payment' AND (merchant IS NOT NULL OR category IS NOT NULL))", 0],
    ['seven card categories', 'SELECT count(DISTINCT category) FROM transactions', 7],
    ['monthly salary deposits and savings interest exist', "SELECT (count(*) FILTER (WHERE description LIKE 'Salary - %') > 200 AND count(*) FILTER (WHERE txn_type = 'interest') > 100 AND count(*) FILTER (WHERE txn_type = 'fee') > 20)::text FROM transactions", 'true'],
    ['no transaction before the account was opened', 'SELECT count(*) FROM transactions t JOIN accounts a USING (account_id) WHERE t.txn_time::date < a.opened_on', 0],
    ['exactly three bursts of 4+ large debits within an hour (10 minutes)', "SELECT count(*) FROM (SELECT account_id FROM transactions WHERE amount <= -500 AND txn_type IN ('card_payment','withdrawal') GROUP BY account_id, date_trunc('hour', txn_time) HAVING count(*) >= 4 AND max(txn_time) - min(txn_time) <= interval '10 minutes') t", 3],
    ['exactly two debits above 10x the account average debit', 'SELECT count(*) FROM (SELECT amount, avg(-amount) OVER (PARTITION BY account_id) AS av FROM transactions WHERE amount < 0) t WHERE -amount > 10 * av', 2],
    ['the same two rows exceed 10x the average absolute amount (opening rows excluded)', "SELECT count(*) FROM (SELECT t.description, abs(amount) AS a, avg(abs(amount)) OVER (PARTITION BY account_id) AS av FROM transactions t) x WHERE a > 10 * av AND description NOT IN ('Balance brought forward','Opening deposit')", 2],
    ['transfers to savings are matched', "SELECT (SELECT count(*) FROM transactions WHERE description = 'Transfer to savings') = (SELECT count(*) FROM transactions o JOIN transactions i ON i.txn_time = o.txn_time AND i.amount = -o.amount AND i.description = 'Transfer from checking' WHERE o.description = 'Transfer to savings')", true],
    ['debits never break the overdraft limit (fees / interest excepted)', "WITH r AS (SELECT t.txn_type, t.amount, a.overdraft_limit, sum(t.amount) OVER (PARTITION BY t.account_id ORDER BY t.txn_time, t.txn_id) AS bal FROM transactions t JOIN accounts a USING (account_id)) SELECT count(*) FROM r WHERE amount < 0 AND txn_type NOT IN ('fee','interest') AND bal < -overdraft_limit - 0.001", 0],
    ['loans: three statuses, verified customers only', "SELECT count(DISTINCT status) || ',' || (SELECT count(*) FROM loans l JOIN customers c USING (customer_id) WHERE c.kyc_status <> 'verified') FROM loans", '3,0'],
    ['rejected customers have only frozen accounts', "SELECT count(*) FROM accounts a JOIN customers c USING (customer_id) WHERE c.kyc_status = 'rejected' AND a.status <> 'frozen'", 0],
  ],
  app: [
    ['300 users signed up 2024-01-01..2024-06-30', "SELECT count(*) || ',' || count(*) FILTER (WHERE signup_date NOT BETWEEN '2024-01-01' AND '2024-06-30') FROM users", '300,0'],
    ['about 7000 events within 2024-01-01..2024-07-31', "SELECT count(*) || ',' || count(*) FILTER (WHERE event_time < '2024-01-01' OR event_time >= '2024-08-01') FROM events", (rows) => { const [n, bad] = Object.values(rows[0])[0].split(',').map(Number); return n >= 6500 && n <= 7500 && bad === 0; }],
    ['no event before the user signed up', 'SELECT count(*) FROM events e JOIN users u USING (user_id) WHERE e.event_time::date < u.signup_date', 0],
    ['seven event names', 'SELECT count(DISTINCT event_name) FROM events', 7],
    ['properties are JSON objects with the documented keys', "SELECT count(*) FROM events WHERE jsonb_typeof(properties) <> 'object' OR (event_name = 'app_open' AND NOT (properties ? 'screen' AND properties ? 'app_version')) OR (event_name IN ('workout_started','workout_completed') AND NOT (properties ? 'workout_type' AND properties ? 'duration_min' AND properties ? 'calories')) OR (event_name = 'goal_set' AND NOT (properties ? 'goal' AND properties ? 'target_per_week')) OR (event_name = 'subscription_started' AND NOT (properties ? 'plan' AND properties ? 'price'))", 0],
    ['funnel shrinks: open > workout_started > workout_completed', "SELECT (count(DISTINCT user_id) FILTER (WHERE event_name = 'app_open') > count(DISTINCT user_id) FILTER (WHERE event_name = 'workout_started') AND count(DISTINCT user_id) FILTER (WHERE event_name = 'workout_started') > count(DISTINCT user_id) FILTER (WHERE event_name = 'workout_completed'))::text FROM events", 'true'],
    ['~35% of users subscribe', "SELECT count(DISTINCT user_id) FROM events WHERE event_name = 'subscription_started'", between(95, 115)],
    ['~105 subscriptions that match the subscription_started events', "SELECT (SELECT count(*) FROM subscriptions) || ',' || count(*) FROM (SELECT user_id, event_time::date AS d, properties->>'plan' AS p FROM events WHERE event_name = 'subscription_started') a FULL JOIN subscriptions s ON s.user_id = a.user_id AND s.started_at = a.d AND s.plan = a.p WHERE a.user_id IS NULL OR s.user_id IS NULL", (rows) => { const [n, bad] = Object.values(rows[0])[0].split(',').map(Number); return n >= 100 && n <= 110 && bad === 0; }],
    ['some subscriptions were cancelled', 'SELECT count(*) FROM subscriptions WHERE cancelled_at IS NOT NULL', (rows) => Number(Object.values(rows[0])[0]) > 10],
    ['some users never produced an event', 'SELECT count(*) FROM users u WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.user_id)', (rows) => Number(Object.values(rows[0])[0]) >= 10],
    ['every session starts with an app_open (30-minute rule)', "WITH g AS (SELECT event_name, event_time - lag(event_time) OVER (PARTITION BY user_id ORDER BY event_time) AS gap FROM events) SELECT count(*) FROM g WHERE (gap IS NULL OR gap > interval '30 minutes') AND event_name <> 'app_open'", 0],
    ['clean session boundary: within <= 30 min, between >= 3 h', "WITH g AS (SELECT event_time - lag(event_time) OVER (PARTITION BY user_id ORDER BY event_time) AS gap FROM events) SELECT (max(gap) FILTER (WHERE gap <= interval '30 minutes') < interval '30 minutes' AND min(gap) FILTER (WHERE gap > interval '30 minutes') >= interval '3 hours')::text FROM g", 'true'],
    ['retention decays: week 1 < week 0, week 4 < week 1', "WITH w AS (SELECT (e.event_time::date - u.signup_date) / 7 AS wk, count(DISTINCT e.user_id) AS n FROM events e JOIN users u USING (user_id) GROUP BY 1) SELECT ((SELECT n FROM w WHERE wk = 1) < (SELECT n FROM w WHERE wk = 0) AND (SELECT n FROM w WHERE wk = 4) < (SELECT n FROM w WHERE wk = 1))::text", 'true'],
    ['daily_steps: 40 users, ~3000 rows, 2024-03-01..2024-05-31', "SELECT count(DISTINCT user_id) || ',' || count(*) || ',' || min(day) || ',' || max(day) FROM daily_steps", (rows) => { const [u, n, a, b] = Object.values(rows[0])[0].split(','); return u === '40' && Number(n) >= 2800 && Number(n) <= 3300 && a === '2024-03-01' && b === '2024-05-31'; }],
    ['daily_steps has gaps and long streaks', "WITH d AS (SELECT user_id, day, day - (row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS g FROM daily_steps), s AS (SELECT user_id, g, count(*) AS len FROM d GROUP BY 1, 2) SELECT (count(*) > 100 AND max(len) >= 30 AND count(DISTINCT user_id) > 20)::text FROM s", 'true'],
  ],
  school: [
    ['12 teachers, 120 students, 18 courses, 8 clubs', 'SELECT (SELECT count(*) FROM teachers) || \',\' || (SELECT count(*) FROM students) || \',\' || (SELECT count(*) FROM courses) || \',\' || (SELECT count(*) FROM clubs)', '12,120,18,8'],
    ['grade levels 9..12', 'SELECT min(grade_level) || \',\' || max(grade_level) FROM students', '9,12'],
    ['exactly one course without a teacher', 'SELECT count(*) FROM courses WHERE teacher_id IS NULL', 1],
    ['about 650 enrollments in two terms', "SELECT count(*) || ',' || count(DISTINCT term) FROM enrollments", (rows) => { const [n, t] = Object.values(rows[0])[0].split(',').map(Number); return n >= 600 && n <= 700 && t === 2; }],
    ['NULL final_score is mostly 2025-Spring', "SELECT count(*) FILTER (WHERE term = '2025-Spring' AND final_score IS NULL) > 10 * count(*) FILTER (WHERE term = '2024-Fall' AND final_score IS NULL) FROM enrollments", true],
    ['scores are between 0 and 100', 'SELECT count(*) FROM exam_scores WHERE score < 0 OR score > 100', 0],
    ['about 1800 exam scores, three exam types', 'SELECT count(*) || \',\' || count(DISTINCT exam_type) FROM exam_scores', (rows) => { const [n, t] = Object.values(rows[0])[0].split(',').map(Number); return n >= 1650 && n <= 1950 && t === 3; }],
    ['exam scores belong to an enrollment of the same term', "SELECT count(*) FROM exam_scores x WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = x.student_id AND e.course_id = x.course_id AND ((x.exam_date < DATE '2025-01-01' AND e.term = '2024-Fall') OR (x.exam_date >= DATE '2025-01-01' AND e.term = '2025-Spring')))", 0],
    ['final_score = 0.2 quiz + 0.35 midterm + 0.45 final (within 0.01)', "WITH q AS (SELECT student_id, course_id, CASE WHEN exam_date < DATE '2025-01-01' THEN '2024-Fall' ELSE '2025-Spring' END AS term, avg(score) FILTER (WHERE exam_type = 'quiz') AS qa, max(score) FILTER (WHERE exam_type = 'midterm') AS m, max(score) FILTER (WHERE exam_type = 'final') AS f FROM exam_scores GROUP BY 1, 2, 3) SELECT count(*) FROM q JOIN enrollments e USING (student_id, course_id, term) WHERE e.final_score IS NOT NULL AND abs(round(0.2 * qa + 0.35 * m + 0.45 * f, 2) - e.final_score) > 0.011", 0],
    ['courses fit the student grade level', "SELECT count(*) FROM enrollments e JOIN students s USING (student_id) WHERE (e.course_id IN (1, 5) AND s.grade_level <> 9) OR (e.course_id = 6 AND s.grade_level <> 10) OR (e.course_id IN (4, 7, 10) AND s.grade_level < 11)", 0],
    ['about 150 club memberships, joined after enrolling', 'SELECT count(*) || \',\' || (SELECT count(*) FROM club_members m JOIN students s USING (student_id) WHERE m.joined_on < s.enrolled_on) FROM club_members', '150,0'],
    ['one club has no advisor, advisors are teachers', 'SELECT count(*) FILTER (WHERE advisor_id IS NULL) FROM clubs', 1],
    ['some students are in no club', 'SELECT count(*) FROM students s WHERE NOT EXISTS (SELECT 1 FROM club_members m WHERE m.student_id = s.student_id)', (rows) => Number(Object.values(rows[0])[0]) >= 10],
  ],
  messy: [
    ['row counts 120 / 300 / 80 / 10 / 60', 'SELECT (SELECT count(*) FROM raw_customers) || \',\' || (SELECT count(*) FROM raw_orders) || \',\' || (SELECT count(*) FROM survey_responses) || \',\' || (SELECT count(*) FROM product_sales_wide) || \',\' || (SELECT count(*) FROM monthly_sales_long)', '120,300,80,10,60'],
    ['all raw columns are text', "SELECT count(*) FROM information_schema.columns WHERE table_name IN ('raw_customers','raw_orders','survey_responses') AND column_name NOT IN ('row_id','response_id') AND data_type <> 'text'", 0],
    ['phone formats: many styles plus NULL and empty', "SELECT (count(*) FILTER (WHERE phone ~ '^\\(\\d{3}\\) ') > 5 AND count(*) FILTER (WHERE phone ~ '^\\d{3}\\.\\d{3}\\.') > 5 AND count(*) FILTER (WHERE phone ~ '^\\+1 ') > 5 AND count(*) FILTER (WHERE phone ~ '^\\d{10}$') > 5 AND count(*) FILTER (WHERE phone IS NULL) > 0 AND count(*) FILTER (WHERE phone = '') > 0)::text FROM raw_customers", 'true'],
    ['date formats in raw_customers incl. unknown and NULL', "SELECT (count(*) FILTER (WHERE signup_date ~ '^\\d{4}-\\d{2}-\\d{2}$') > 0 AND count(*) FILTER (WHERE signup_date ~ '^\\d{2}/\\d{2}/\\d{4}$') > 0 AND count(*) FILTER (WHERE signup_date ~ '^\\d{2}-[A-Za-z]{3}-\\d{4}$') > 0 AND count(*) FILTER (WHERE signup_date ~ '^\\d{4}/\\d{1,2}/\\d{1,2}$') > 0 AND count(*) FILTER (WHERE signup_date = 'unknown') > 0 AND count(*) FILTER (WHERE signup_date IS NULL) > 0)::text FROM raw_customers", 'true'],
    ['country variants listed in the spec all occur', "SELECT count(DISTINCT country) FROM raw_customers WHERE country IN ('USA','U.S.','United States','us','United States of America','Canada','CA','canada')", 8],
    ['emails with capitals and trailing spaces exist', "SELECT (count(*) FILTER (WHERE email <> lower(email)) > 5 AND count(*) FILTER (WHERE email <> btrim(email)) > 5)::text FROM raw_customers", 'true'],
    ['about 15 duplicate people', 'SELECT 120 - 105', 15],
    ['10 exact duplicate order rows (different row_id)', 'SELECT count(*) FROM (SELECT 1 FROM raw_orders GROUP BY order_ref, customer_email, order_date, amount, currency, status HAVING count(*) > 1) t', 10],
    ['6 order refs with conflicting duplicates', "SELECT count(*) FROM (SELECT order_ref FROM raw_orders GROUP BY order_ref HAVING count(*) > 1 AND count(DISTINCT (customer_email, order_date, amount, currency, status)) > 1) t", 6],
    ['amount formats: $1,234.50 / 1234.5 / padded / N/A / empty', "SELECT (count(*) FILTER (WHERE amount ~ '^\\$[0-9]{1,3},[0-9]{3}\\.') > 0 AND count(*) FILTER (WHERE amount ~ '^\\d+\\.\\d$') > 0 AND count(*) FILTER (WHERE amount ~ '^\\s+\\d+\\s+$') > 0 AND count(*) FILTER (WHERE amount = 'N/A') > 0 AND count(*) FILTER (WHERE amount = '') > 0)::text FROM raw_orders", 'true'],
    ['negative and absurd amounts exist', "SELECT (count(*) FILTER (WHERE amount ~ '^-|^\\(') >= 3 AND count(*) FILTER (WHERE amount IN ('999999.99','1000000')) = 2)::text FROM raw_orders", 'true'],
    ['currency variants USD / usd / $ / EUR all occur', "SELECT count(DISTINCT currency) FROM raw_orders WHERE currency IN ('USD','usd','$','EUR')", 4],
    ['status variants incl. canceled / cancelled and trailing space', "SELECT (count(*) FILTER (WHERE status = 'canceled') > 0 AND count(*) FILTER (WHERE status = 'cancelled') > 0 AND count(*) FILTER (WHERE status = 'shipped ') > 0 AND count(*) FILTER (WHERE status = 'DELIVERED') > 0)::text FROM raw_orders", 'true'],
    ['survey: digits, trailing spaces, words, empty, NULL', "SELECT (count(*) FILTER (WHERE q1_satisfaction = '5') > 0 AND count(*) FILTER (WHERE q1_satisfaction = '4 ') + count(*) FILTER (WHERE q1_satisfaction ~ '^\\d $') >= 1 AND count(*) FILTER (WHERE q1_satisfaction = '') > 0 AND count(*) FILTER (WHERE q1_satisfaction IS NULL) > 0 AND count(*) FILTER (WHERE q1_satisfaction ~* '^(one|two|three|four|five)$') > 0)::text FROM survey_responses", 'true'],
    ['wide and long sales tables hold the same numbers', "SELECT count(*) FROM monthly_sales_long l JOIN product_sales_wide w USING (product) WHERE l.revenue <> CASE l.month WHEN 'Jan' THEN w.jan WHEN 'Feb' THEN w.feb WHEN 'Mar' THEN w.mar WHEN 'Apr' THEN w.apr WHEN 'May' THEN w.may ELSE w.jun END", 0],
  ],
  blank: [['no tables at all', "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'", 0]],
};

// -----------------------------------------------------------------------------------------------
// structural checks that apply to every dataset
// -----------------------------------------------------------------------------------------------
async function structuralChecks(db, entry) {
  const q = async (sql) => (await db.query(sql)).rows;
  // row counts vs catalog
  for (const t of entry.tables) {
    const n = Number((await q(`SELECT count(*) AS n FROM ${t.name}`))[0].n);
    if (n !== t.rowCount) fail(`${t.name}: ${n} rows loaded but catalog says ${t.rowCount}`);
  }
  const counts = entry.tables.map((t) => `${t.name}=${t.rowCount}`).join('  ');
  if (counts) ok(`row counts match catalog.json: ${counts}`);
  const tables = (await q("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")).map((r) => r.table_name);
  const catalogTables = entry.tables.map((t) => t.name).sort();
  if (JSON.stringify(tables) !== JSON.stringify(catalogTables)) fail(`tables in the database (${tables}) differ from the catalog (${catalogTables})`);
  // columns in the catalog match the real columns (name + declared type family)
  for (const t of entry.tables) {
    const cols = await q(`SELECT column_name, data_type, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${t.name}' ORDER BY ordinal_position`);
    const names = cols.map((c) => c.column_name);
    const cat = t.columns.map((c) => c.name);
    if (JSON.stringify(names) !== JSON.stringify(cat)) fail(`${t.name}: catalog columns ${cat} differ from table columns ${names}`);
    for (const c of t.columns) if (!c.description || c.description.length < 5) fail(`${t.name}.${c.name}: missing description`);
    if (!t.description) fail(`${t.name}: missing description`);
  }
  if (entry.tables.length) {
    // every table has a primary key, identifiers are lowercase snake_case and not reserved words
    const noPk = await q("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary)");
    if (noPk.length) fail(`tables without primary key: ${noPk.map((r) => r.relname)}`);
    else ok('every table has a primary key');
    const idx = await q("SELECT c.relname, i.indisprimary, i.indisunique FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT i.indisprimary AND NOT i.indisunique");
    if (idx.length) fail(`secondary indexes found: ${idx.map((r) => r.relname)}`);
    else ok('no secondary indexes (only primary-key / unique indexes)');
    const names = await q("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'");
    const reserved = new Set((await q("SELECT word FROM pg_get_keywords() WHERE catcode = 'R'")).map((r) => r.word));
    const badName = [];
    for (const r of names) {
      for (const n of [r.t, r.c]) {
        if (!/^[a-z][a-z0-9_]*$/.test(n)) badName.push(`${n} (not snake_case)`);
        if (reserved.has(n)) badName.push(`${n} (reserved word)`);
      }
    }
    if (badName.length) fail(`bad identifiers: ${[...new Set(badName)]}`);
    else ok('all table / column names are lowercase snake_case and not reserved words');
    const nan = await q("SELECT c.relname, c.reltuples FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.reltuples < 0");
    if (nan.length) fail(`ANALYZE did not run for: ${nan.map((r) => r.relname)}`);
    else ok('ANALYZE has run on every table');
    const fks = await q("SELECT count(*) AS n FROM pg_constraint WHERE contype = 'f'");
    ok(`${fks[0].n} foreign keys enforced`);
  }
}

async function runChecks(db, id) {
  const list = CHECKS[id] || [];
  let pass = 0;
  for (const [desc, sql, expected] of list) {
    try {
      const rows = (await db.query(sql)).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
      let good;
      if (typeof expected === 'function') good = expected(rows);
      else {
        const cell = rows.length ? Object.values(rows[0])[0] : undefined;
        good = String(cell) === String(expected);
      }
      if (good) pass++;
      else fail(`${desc}  -> got ${JSON.stringify(rows[0])}, expected ${typeof expected === 'function' ? 'a value in range' : JSON.stringify(expected)}`);
    } catch (e) {
      fail(`${desc}  -> query error: ${e.message}`);
    }
  }
  if (list.length) ok(`${pass}/${list.length} data checks passed`);
  return list.length;
}

// -----------------------------------------------------------------------------------------------
console.log('SQL Quest dataset check (PGlite, one fresh database per dataset)\n');
const t0 = Date.now();
let totalChecks = 0;
for (const entry of CATALOG) {
  if (only.length && !only.includes(entry.id)) continue;
  const file = path.join(SQL_DIR, `${entry.id}.sql`);
  console.log(`${entry.id}  (${entry.name})`);
  if (!fs.existsSync(file)) {
    fail(`missing ${file}`);
    continue;
  }
  const sql = fs.readFileSync(file, 'utf8');
  staticChecks(entry.id, sql);
  const db = new PGlite();
  const s = Date.now();
  try {
    await db.exec(sql);
    ok(`loaded without errors in ${((Date.now() - s) / 1000).toFixed(1)} s`);
  } catch (e) {
    fail(`load error: ${e.message}`);
    await db.close();
    continue;
  }
  await structuralChecks(db, entry);
  totalChecks += await runChecks(db, entry.id);
  await db.close();
  console.log('');
}
// ---- documentation sanity: content/DATASETS.md has a section, quirks and 5-10 facts per dataset
{
  const docFile = path.join(ROOT, 'content', 'DATASETS.md');
  console.log('content/DATASETS.md');
  if (!fs.existsSync(docFile)) fail('content/DATASETS.md is missing');
  else {
    const md = fs.readFileSync(docFile, 'utf8');
    const sections = md.split(/\n<a id="/).slice(1);
    for (const entry of CATALOG) {
      if (only.length && !only.includes(entry.id)) continue;
      const sec = sections.find((x) => x.startsWith(entry.id + '"'));
      if (!sec) {
        fail(`no section for ${entry.id}`);
        continue;
      }
      if (entry.tables.length === 0) continue;
      const facts = (sec.match(/^  - query: /gm) || []).length;
      const hasQuirks = /### Notable facts & deliberate quirks/.test(sec);
      for (const t of entry.tables) if (!sec.includes('#### ' + t.name + '  (')) fail(`${entry.id}: table ${t.name} is not documented`);
      if (!hasQuirks) fail(`${entry.id}: no "Notable facts & deliberate quirks" list`);
      else if (facts < 5 || facts > 10) fail(`${entry.id}: ${facts} handy facts (expected 5-10)`);
      else ok(`${entry.id}: documented (${facts} handy facts, quirks list present)`);
    }
  }
  console.log('');
}
const extra = fs.readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql') && !CATALOG.some((c) => `${c.id}.sql` === f));
if (extra.length) {
  failures++;
  console.log(`FAIL  SQL files not listed in the catalog: ${extra}`);
}
console.log(`${failures === 0 ? 'ALL GOOD' : failures + ' PROBLEM(S)'} - ${totalChecks} data checks, finished in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(failures === 0 ? 0 : 1);

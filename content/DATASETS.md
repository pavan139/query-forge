# SQL Quest practice datasets - author guide

This document describes the nine practice databases that SQL Quest lessons run on. It is written for **content authors**: use it to find the right dataset for a lesson, to know which values and quirks exist, and to quote exact numbers in exercises.

**Everything below is generated.** The tables, the catalog (`content/datasets/catalog.json`) and every number in this file come from `scripts/gen-datasets.mjs`, which builds the data with a seeded random number generator and then *queries the generated data* with PGlite to produce the statistics and "handy facts". If you need to change a dataset, change the generator and re-run it; do not edit `public/datasets/*.sql` or this file by hand.

```bash
node scripts/gen-datasets.mjs      # regenerate SQL, catalog and this document (about 20 seconds)
node scripts/check-datasets.mjs    # load every dataset into a fresh PGlite and run sanity checks (about 30 seconds)
```

## Ground rules that hold for every dataset

- **Deterministic and fictional.** Running the generator twice gives byte-identical files. All people, companies, products and movies are invented; all emails use `example.com` or `example.org`.
- **Fixed dates.** Nothing is relative to today. Each dataset has its own "as of" moment (given below); use literal dates in exercises, never `CURRENT_DATE` or `now()` for expected results.
- **Ids are explicit and stable** (`integer PRIMARY KEY`, no sequences). A row keeps its id forever, so exercises may refer to ids such as `customer_id = 7`.
- **Constraints are real.** Primary keys, foreign keys, `NOT NULL`, `UNIQUE` and `CHECK` are enforced; loading a file proves referential integrity. There are **no secondary indexes** (the performance lessons add them) and each file ends with `ANALYZE;`.
- **PostgreSQL 18 (PGlite 0.5.8).** The database collation is `C`: `ORDER BY` on text sorts by byte value, so capital letters sort before lowercase ones ('Zoe' before 'adam'). Names are plain ASCII (no accents).
- **Naming.** Tables and columns are lowercase snake_case and never reserved words.
- **Money** is `numeric` (exact) and shown in US dollars unless a column name says otherwise. Result values from `numeric` columns come back as strings in the browser; cast with `::float` or `::int` if a lesson needs numbers.
- **NULL** is used on purpose where the story allows it (unknown email, walk-in customer, order not shipped yet). Each dataset lists its NULLs below.

### How to read the column tables

*NULLs* counts rows where the column is empty. *Distinct* is the number of different non-NULL values. *Range / values* shows the smallest and largest value (and the average for numbers); columns with 12 or fewer different values list every value with the number of rows that have it, e.g. `'card'` (98).

## The nine datasets at a glance

| id | name | tables | rows | best for |
|---|---|---|---|---|
| [cafe](#cafe) | ☕ Bean & Bloom Café | 4 | 250 | first queries: SELECT, WHERE, ORDER BY, NULL, first JOIN |
| [shop](#shop) | 🛒 ShopSmart | 8 | 4,526 | joins, GROUP BY, subqueries, CTEs, anti-joins |
| [company](#company) | 🏢 Acme Corp | 5 | 339 | self joins, recursive CTEs, window functions on salaries |
| [movies](#movies) | 🎬 FlickNest | 8 | 6,752 | many-to-many joins, ranking, window functions, sessionization |
| [bank](#bank) | 🏦 Harbor Bank | 5 | 3,925 | running balances, date grouping, outlier / fraud detection |
| [app](#app) | 🏃 FitTrack | 4 | 10,477 | funnels, retention cohorts, sessionization, gaps and islands, JSON |
| [school](#school) | 🏫 Maple High School | 7 | 2,692 | averages, HAVING, ranking, LEFT JOIN with missing data |
| [messy](#messy) | 🧹 Messy Data Co. | 5 | 570 | data cleaning, deduplication, casting, pivot / unpivot |
| [blank](#blank) | ✨ Blank Database | 0 | 0 | CREATE TABLE, INSERT, constraints, indexes |

<a id="cafe"></a>

## 1. cafe - ☕ Bean & Bloom Café

> A tiny neighborhood café: perfect for your very first queries.

Bean & Bloom is a cosy café with a short menu, a handful of regulars and a few months of orders. The tables are small enough to read at a glance, so it is the ideal place to learn SELECT, WHERE, ORDER BY and your first JOIN. Some values are missing on purpose (emails, calories, tips) so you can meet NULL early.

The café is deliberately tiny so that learners can look at a whole table on one screen. Start single-table lessons with `menu_items` (32 rows) and `customers` (28 rows); `orders` is the only table big enough to need LIMIT and aggregation. "As of" date: **2024-12-31** (the last order is in the morning of that day).

### Tables

| table | rows | what it holds |
|---|---|---|
| `menu_items` | 32 | Everything on the menu: one row per drink, pastry, sandwich, dessert or juice. |
| `customers` | 28 | Café regulars who joined the loyalty program. |
| `staff` | 10 | The café team, including who reports to whom. |
| `orders` | 180 | One row per order: a single menu item (with a quantity) bought by a customer or a walk-in. |

### Relationships

- `staff.manager_id` → `staff.staff_id`
- `orders.customer_id` → `customers.customer_id`
- `orders.item_id` → `menu_items.item_id`
- `orders.staff_id` → `staff.staff_id`

### Columns

#### menu_items  (32 rows)

Everything on the menu: one row per drink, pastry, sandwich, dessert or juice.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `item_id` | `integer` | Unique id of the menu item (primary key) | - | 32 | `1` to `32` |
| `name` | `text` | Name of the item as printed on the menu | - | 32 | all different (5-21 characters) |
| `category` | `text` | Menu section: Coffee, Tea, Pastry, Sandwich, Dessert or Juice | - | 6 | `'Coffee'` (8), `'Pastry'` (6), `'Sandwich'` (5), `'Tea'` (5), `'Dessert'` (4), `'Juice'` (4) |
| `price` | `numeric(5,2)` | Current price in dollars | - | 22 | `1.50` to `12.50`, avg 5.16 |
| `calories` | `integer` | Calories per serving (empty when we have not measured it yet) | 4 (12.5%) | 22 | `0` to `620`, avg 232.32 |
| `is_vegan` | `boolean` | TRUE if the item contains no animal products | - | 2 | true (14), false (18) |
| `is_available` | `boolean` | TRUE if we can sell it today | - | 2 | true (29), false (3) |
| `added_on` | `date` | Date the item was added to the menu | - | 15 | `2022-03-01` to `2024-11-30` |

#### customers  (28 rows)

Café regulars who joined the loyalty program.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `customer_id` | `integer` | Unique id of the customer (primary key) | - | 28 | `1` to `28` |
| `first_name` | `text` | Given name | - | 27 | 27 different values |
| `last_name` | `text` | Family name | - | 25 | 25 different values |
| `email` | `text` | Email address (empty if the customer did not share one) | 5 (17.9%) | 23 | all different (22-27 characters) |
| `city` | `text` | City where the customer lives | - | 5 | `'Portland'` (8), `'Boston'` (7), `'Seattle'` (6), `'Austin'` (5), `'Denver'` (2) |
| `joined_on` | `date` | Date the customer joined the loyalty program | - | 28 | `2022-06-21` to `2024-11-13` |
| `loyalty_points` | `integer` | Loyalty points collected so far | - | 25 | `0` to `850`, avg 417.86 |

#### staff  (10 rows)

The café team, including who reports to whom.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `staff_id` | `integer` | Unique id of the staff member (primary key) | - | 10 | `1` to `10` |
| `name` | `text` | Full name | - | 10 | all different (10-13 characters) |
| `role` | `text` | Job role: Manager, Barista, Baker or Cashier | - | 4 | `'Barista'` (4), `'Cashier'` (3), `'Baker'` (2), `'Manager'` (1) |
| `hourly_rate` | `numeric(5,2)` | Pay per hour in dollars | - | 10 | `15.25` to `28.50`, avg 18.53 |
| `hired_on` | `date` | Date the person was hired | - | 9 | `2022-02-14` to `2024-09-16` |
| `manager_id` | `integer` | The staff member this person reports to (empty for the top manager) → staff.staff_id | 1 (10.0%) | 3 | `2` (5), `1` (3), `3` (1) |

#### orders  (180 rows)

One row per order: a single menu item (with a quantity) bought by a customer or a walk-in.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `order_id` | `integer` | Unique id of the order (primary key) | - | 180 | `1` to `180` |
| `customer_id` | `integer` | Who ordered (empty for walk-in customers without a loyalty card) → customers.customer_id | 45 (25.0%) | 25 | `1` to `28` |
| `item_id` | `integer` | What was ordered → menu_items.item_id | - | 32 | `1` to `32` |
| `staff_id` | `integer` | Staff member who served the order → staff.staff_id | - | 8 | `5` (40), `2` (33), `4` (30), `9` (27), `7` (24), `10` (12), `8` (10), `1` (4) |
| `quantity` | `integer` | How many of the item were ordered | - | 4 | `1` (139), `2` (33), `3` (6), `4` (2) |
| `order_time` | `timestamp` | Date and time the order was placed | - | 180 | `2024-10-01 07:23:36` to `2024-12-31 18:02:00` |
| `payment_method` | `text` | How the customer paid: cash, card or app | - | 3 | `'card'` (78), `'cash'` (55), `'app'` (47) |
| `tip` | `numeric(4,2)` | Tip in dollars (empty when no tip information was recorded) | 54 (30.0%) | 12 | `1.00` (33), `0.00` (16), `1.50` (16), `0.50` (14), `2.00` (10), `1.25` (8), `0.75` (7), `3.00` (7), `0.25` (6), `4.00` (5), `2.50` (3), `5.00` (1) |

### How the data was built (distributions and rules)

- Orders cover **2024-10-01 to 2024-12-31** (90 of the 92 calendar days have at least one order). Order times are between 07:00 and 19:00 (opening hours 07:00-19:00, last hour is 18:xx). The busiest time of day is the morning rush (see the facts below); orders per month: Oct 54, Nov 54, Dec 72. On days that have orders, a weekday averages 1.73 orders and a Saturday or Sunday 2.65.
- The café is closed on Thanksgiving (2024-11-28) and Christmas Day (2024-12-25): 0 orders on those two dates.
- There is **no separate price column on orders**: the line total is `quantity * menu_items.price` (current menu price). `menu_items.is_available` describes today's menu, so past orders may contain items that are unavailable now. No order contains an item before its `added_on` date.
- Units sold per category (best first): Coffee 110, Pastry 46, Sandwich 31, Tea 25, Dessert 10, Juice 9. The item mix follows the time of day: coffee and pastries in the morning, sandwiches and juice around lunch, coffee, tea and dessert in the afternoon.
- Staff hierarchy has three levels: manager (staff 1) → shift leads (staff 2 the senior barista, staff 3 the head baker) → the rest. Bakers (staff 3 and 6) do not work the counter: 0 orders were served by a baker, so `orders.staff_id` only contains baristas, cashiers and the manager.
- Customers who joined the loyalty program are numbered in join-date order. Loyalty points roughly track how long someone has been a member; they are **not** computed from the orders table.

### Notable facts & deliberate quirks

- **4 menu items have NULL calories:** Smoked Salmon Bagel, Tiramisu Cup, Green Detox Juice, Berry Smoothie. (Teas have calories = 0, which is a real value and not NULL.)
- **3 items are unavailable:** Smoked Salmon Bagel, Tiramisu Cup, Lemon Tart. 14 of the 32 items are vegan. 0 menu items were never ordered.
- **5 customers have no email** (customer_id 4, 8, 13, 21, 27).
- **Customers who never ordered:** customer_id 9, 17, 25 (anti-join / `NOT EXISTS` / `LEFT JOIN ... IS NULL` practice). Customers 9, 25 have 0 loyalty points; the maximum is 850.
- **Walk-in orders:** 45 of 180 orders (25%) have `customer_id` NULL.
- **Tips:** 54 orders (30%) have a NULL tip ("not recorded"), another 16 have an explicit tip of 0.00; the rest are between 0.25 and 5.00. Average recorded tip by payment method: app 1.39, card 1.54, cash 0.45 (cash payers tip the least).
- **Quantity** is 1 for most orders; 41 orders have quantity 2 to 4.
- `staff.manager_id` is NULL for exactly one person (the manager) and the table is a classic self-join / recursive-CTE example in miniature.

### Handy facts (exact numbers, computed from the data)

- **Orders in total:** `180`
  - query: `SELECT count(*) FROM orders`
- **Revenue in the quarter (sum of quantity * price):** `$1,114.70`
  - query: `SELECT sum(o.quantity * m.price) FROM orders o JOIN menu_items m ON m.item_id = o.item_id`
- **Orders per month:** `2024-10` 54, `2024-11` 54, `2024-12` 72
  - query: `SELECT to_char(order_time, 'YYYY-MM') AS month, count(*) AS orders FROM orders GROUP BY 1 ORDER BY 1`
- **Orders per payment method:** `card` 78, `cash` 55, `app` 47
  - query: `SELECT payment_method, count(*) FROM orders GROUP BY 1 ORDER BY 2 DESC`
- **Best-selling item by units sold:** `Blueberry Muffin (20 units)`
  - query: `SELECT m.name || ' (' || sum(o.quantity) || ' units)' FROM orders o JOIN menu_items m ON m.item_id = o.item_id GROUP BY m.item_id, m.name ORDER BY sum(o.quantity) DESC, m.name LIMIT 1`
- **Units sold per category:** `Coffee` 110, `Pastry` 46, `Sandwich` 31, `Tea` 25, `Dessert` 10, `Juice` 9
  - query: `SELECT m.category, sum(o.quantity) AS units FROM orders o JOIN menu_items m ON m.item_id = o.item_id GROUP BY 1 ORDER BY 2 DESC`
- **Busiest hour of the day (by number of orders):** `8:00 (31 orders)`
  - query: `SELECT extract(hour FROM order_time)::int || ':00 (' || count(*) || ' orders)' FROM orders GROUP BY extract(hour FROM order_time) ORDER BY count(*) DESC, 1 LIMIT 1`
- **Average tip where a tip was recorded:** `1.22`
  - query: `SELECT round(avg(tip), 2) FROM orders WHERE tip IS NOT NULL`
- **Customer with the most orders:** `James Bennett (customer 11, 14 orders)`
  - query: `SELECT c.first_name || ' ' || c.last_name || ' (customer ' || c.customer_id || ', ' || count(*) || ' orders)' FROM orders o JOIN customers c ON c.customer_id = o.customer_id GROUP BY c.customer_id, c.first_name, c.last_name ORDER BY count(*) DESC, c.customer_id LIMIT 1`
- **Average menu price per category:** `Coffee` 3.71, `Dessert` 5.80, `Juice` 5.80, `Pastry` 3.53, `Sandwich` 9.99, `Tea` 3.60
  - query: `SELECT category, round(avg(price), 2) AS avg_price FROM menu_items GROUP BY 1 ORDER BY 1`

### Good lesson topics for this dataset

- SELECT, WHERE, ORDER BY, LIMIT, DISTINCT on `menu_items` and `customers`.
- IS NULL / IS NOT NULL, COALESCE on `calories`, `email`, `tip`, `customer_id`.
- Aggregates and GROUP BY on `orders` (revenue per category, orders per hour or per weekday).
- First JOIN (`orders` to `menu_items`), LEFT JOIN to find customers without orders, self join on `staff`.
- Date functions on `order_time` (`date_trunc`, `extract`, `to_char`).

<a id="shop"></a>

## 2. shop - 🛒 ShopSmart

> An online store with customers, orders, payments and reviews.

ShopSmart is a small online store with two years of orders, 60 products, 150 customers and their payments and reviews. It is the main playground for joins, GROUP BY, subqueries and CTEs, with realistic quirks like customers who never ordered and orders that are not paid yet. Dates run from January 2023 to December 2024, with busy Black Friday seasons.

ShopSmart is the workhorse dataset: eight related tables that are small enough to query instantly but rich enough for joins, aggregation, subqueries, CTEs, window functions and date analysis. The "as of" date is **2024-12-31**: the newest orders are still being processed or shipped, and nothing is dated later.

### Tables

| table | rows | what it holds |
|---|---|---|
| `categories` | 14 | Product categories arranged as a tree: top-level departments with sub-categories below them. |
| `suppliers` | 8 | Companies that supply the products we sell. |
| `products` | 60 | The product catalog: one row per item we sell, with price, cost and stock. |
| `customers` | 150 | People who have created an account on the shop. |
| `orders` | 900 | One row per order placed in the shop. |
| `order_items` | 2,296 | The products inside each order (one row per product per order). |
| `payments` | 778 | Payments received for orders (an order can be paid in more than one payment). |
| `reviews` | 320 | Star ratings and comments written by customers about products they bought. |

### Relationships

- `categories.parent_id` → `categories.category_id`
- `products.category_id` → `categories.category_id`
- `products.supplier_id` → `suppliers.supplier_id`
- `orders.customer_id` → `customers.customer_id`
- `order_items.order_id` → `orders.order_id`
- `order_items.product_id` → `products.product_id`
- `payments.order_id` → `orders.order_id`
- `reviews.product_id` → `products.product_id`
- `reviews.customer_id` → `customers.customer_id`

### Columns

#### categories  (14 rows)

Product categories arranged as a tree: top-level departments with sub-categories below them.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `category_id` | `integer` | Unique id of the category (primary key) | - | 14 | `1` to `14` |
| `name` | `text` | Category name | - | 14 | all different (4-11 characters) |
| `parent_id` | `integer` | The category this one sits under (empty for top-level departments) → categories.category_id | 6 (42.9%) | 5 | `1` to `11` |

#### suppliers  (8 rows)

Companies that supply the products we sell.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `supplier_id` | `integer` | Unique id of the supplier (primary key) | - | 8 | `1` to `8` |
| `name` | `text` | Company name | - | 8 | all different (17-24 characters) |
| `country` | `text` | Country where the supplier is based | - | 8 | all different (5-14 characters) |
| `contact_email` | `text` | Contact email (empty if we do not have one) | 2 (25.0%) | 6 | all different (23-30 characters) |

#### products  (60 rows)

The product catalog: one row per item we sell, with price, cost and stock.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `product_id` | `integer` | Unique id of the product (primary key) | - | 60 | `1` to `60` |
| `name` | `text` | Product name | - | 60 | all different (11-36 characters) |
| `category_id` | `integer` | Category the product belongs to → categories.category_id | - | 11 | `4` to `14` |
| `supplier_id` | `integer` | Who supplies the product (empty when sourced directly) → suppliers.supplier_id | 3 (5.0%) | 8 | `4` (17), `2` (9), `3` (8), `8` (7), `1` (5), `5` (5), `7` (4), `6` (2) |
| `price` | `numeric(10,2)` | Current selling price in dollars | - | 34 | `9.99` to `1499.99`, avg 193.04 |
| `cost` | `numeric(10,2)` | What the product costs us, in dollars | - | 60 | `7.06` to `958.30`, avg 112.01 |
| `stock_qty` | `integer` | Units currently in the warehouse | - | 52 | `0` to `468`, avg 180.92 |
| `is_active` | `boolean` | TRUE if the product is still for sale | - | 2 | true (56), false (4) |
| `created_at` | `date` | Date the product was added to the catalog | - | 58 | `2022-05-14` to `2024-12-05` |

#### customers  (150 rows)

People who have created an account on the shop.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `customer_id` | `integer` | Unique id of the customer (primary key) | - | 150 | `1` to `150` |
| `first_name` | `text` | Given name | - | 105 | 105 different values |
| `last_name` | `text` | Family name | - | 107 | 107 different values |
| `email` | `text` | Email address (unique per customer) | - | 150 | all different (20-29 characters) |
| `phone` | `text` | Phone number (empty if not provided) | 30 (20.0%) | 114 | 114 different values |
| `city` | `text` | City where the customer lives | - | 14 | 14 different values |
| `state` | `text` | Two-letter US state code | - | 12 | `'CA'` (36), `'TX'` (21), `'NY'` (17), `'WA'` (15), `'CO'` (12), `'IL'` (12), `'MA'` (9), `'AZ'` (7), `'FL'` (7), `'GA'` (6), `'OR'` (6), `'MN'` (2) |
| `signup_date` | `date` | Date the account was created | - | 142 | `2022-06-01` to `2024-10-31` |
| `birth_date` | `date` | Date of birth (empty if not provided) | 15 (10.0%) | 135 | `1950-12-09` to `2005-05-20` |
| `segment` | `text` | Customer type: Consumer, Corporate or Home Office | - | 3 | `'Consumer'` (89), `'Corporate'` (33), `'Home Office'` (28) |

#### orders  (900 rows)

One row per order placed in the shop.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `order_id` | `integer` | Unique id of the order (primary key) | - | 900 | `1` to `900` |
| `customer_id` | `integer` | Customer who placed the order → customers.customer_id | - | 140 | `1` to `140` |
| `order_date` | `date` | Day the order was placed | - | 473 | `2023-01-01` to `2024-12-31` |
| `status` | `text` | Order status: processing, shipped, delivered, cancelled or returned | - | 5 | `'delivered'` (650), `'cancelled'` (127), `'returned'` (102), `'shipped'` (14), `'processing'` (7) |
| `shipped_date` | `date` | Day the order left the warehouse (empty if it has not shipped, or was cancelled) | 134 (14.9%) | 437 | `2023-01-02` to `2024-12-31` |
| `ship_city` | `text` | City the order is shipped to | - | 14 | 14 different values |
| `discount_code` | `text` | Promo code used at checkout (empty when no code was used) | 777 (86.3%) | 5 | `'WELCOME10'` (39), `'SUMMER15'` (29), `'BLACKFRIDAY'` (26), `'LOYALTY5'` (19), `'FREESHIP'` (10) |

#### order_items  (2,296 rows)

The products inside each order (one row per product per order).

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `order_item_id` | `integer` | Unique id of the order line (primary key) | - | 2,296 | `1` to `2296` |
| `order_id` | `integer` | Order this line belongs to → orders.order_id | - | 900 | `1` to `900` |
| `product_id` | `integer` | Product that was bought → products.product_id | - | 55 | `1` to `59` |
| `quantity` | `integer` | How many units were bought | - | 5 | `1` (1,563), `2` (456), `3` (177), `4` (78), `5` (22) |
| `unit_price` | `numeric(10,2)` | Price per unit at the time of the order, in dollars | - | 38 | `9.99` to `1499.99`, avg 119.38 |
| `discount` | `numeric(3,2)` | Discount on this line as a fraction (0.10 = 10% off) | - | 5 | `0.00` (1,888), `0.10` (170), `0.05` (106), `0.20` (67), `0.15` (65) |

#### payments  (778 rows)

Payments received for orders (an order can be paid in more than one payment).

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `payment_id` | `integer` | Unique id of the payment (primary key) | - | 778 | `1` to `778` |
| `order_id` | `integer` | Order the payment is for → orders.order_id | - | 758 | `1` to `898` |
| `amount` | `numeric(10,2)` | Amount paid in dollars | - | 599 | `14.99` to `1982.96`, avg 339.31 |
| `method` | `text` | Payment method: card, paypal, gift_card or bank_transfer | - | 4 | `'card'` (463), `'paypal'` (165), `'bank_transfer'` (104), `'gift_card'` (46) |
| `paid_at` | `timestamp` | Date and time the payment was received | - | 778 | `2023-01-01 14:23:23` to `2024-12-31 23:59:59` |

#### reviews  (320 rows)

Star ratings and comments written by customers about products they bought.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `review_id` | `integer` | Unique id of the review (primary key) | - | 320 | `1` to `320` |
| `product_id` | `integer` | Product being reviewed → products.product_id | - | 52 | `1` to `59` |
| `customer_id` | `integer` | Customer who wrote the review → customers.customer_id | - | 115 | `1` to `140` |
| `rating` | `integer` | Star rating from 1 (bad) to 5 (great) | - | 5 | `5` (136), `4` (98), `3` (63), `2` (18), `1` (5) |
| `review_text` | `text` | Written comment (empty when the customer only left stars) | 93 (29.1%) | 38 | 38 different values |
| `created_at` | `date` | Day the review was written | - | 238 | `2023-01-20` to `2024-12-31` |

### How the data was built (distributions and rules)

- **Dates.** Customers signed up between 2022-06-01 and 2024-10-31 (customer ids are in signup order: 0 out-of-order pairs). Orders run **2023-01-01 to 2024-12-31** (900 orders); every order is placed after its customer's signup date. Orders per year: 2023: 328, 2024: 572. 2024 orders per month: Jan 29, Feb 23, Mar 27, Apr 36, May 44, Jun 37, Jul 47, Aug 50, Sep 43, Oct 59, Nov 91, Dec 86.
- **Seasonality and growth.** Order volume is lowest in January and February, grows through the year and peaks in November and December, with spikes on Black Friday (2023: 4 orders on Black Friday vs 1.8 on an average November day, 2024: 11 orders on Black Friday vs 3.0 on an average November day). 2024 has clearly more orders than 2023 because the customer base grew.
- **Order status** share: delivered 650 (72.2%), cancelled 127 (14.1%), returned 102 (11.3%), shipped 14 (1.6%), processing 7 (0.8%). `processing` orders are the newest ones (7 orders, oldest from 2024-12-24). 14 orders are `shipped`; 7 of them were placed before 2024-12-01 and are "stuck" in shipped (lost parcels) - a deliberate oddity you can query. `shipped_date` is on or after `order_date` (0 to 5 days later) and is NULL exactly for `processing` and `cancelled` orders (134 NULLs).
- **Order total.** There is no total column. The total of an order is `ROUND(SUM(quantity * unit_price * (1 - discount)), 2)` over its `order_items`, and the `payments` of that order add up to exactly this amount (0 orders differ).
- **Discount codes** appear on 123 orders (13.7%): WELCOME10 39, SUMMER15 29, BLACKFRIDAY 26, LOYALTY5 19, FREESHIP 10. A code fixes the line discount of the whole order: WELCOME10 = 0.10 (first orders), SUMMER15 = 0.15 (mid-June to August), BLACKFRIDAY = 0.20 (Black Friday window), LOYALTY5 = 0.05 (repeat customers), FREESHIP = 0 (free shipping only). Orders *without* a code have discount 0 on most lines; 125 of their 1,986 lines carry a 0.05 or 0.10 clearance discount.
- **Prices over time.** `order_items.unit_price` is the price at the time of the order. 8 products changed price (product 1 cost 989.99 before 2024-06-01; product 6 cost 27.99 before 2023-09-01; product 8 cost 417.99 before 2024-06-01; product 17 cost 769.99 before 2024-06-01; product 20 cost 32.99 before 2023-09-01; product 27 cost 73.99 before 2023-09-01; product 31 cost 32.99 before 2024-06-01; product 45 cost 18.99 before 2023-09-01); 7 of them have order lines at the old price, 95 lines in total, and all other lines equal today's `products.price`. Always use `order_items.unit_price` for revenue, never `products.price`.
- **Order size.** 1 to 5 distinct products per order; the same product never appears twice in one order (UNIQUE on order_id + product_id). Quantities are mostly 1; cheap products (under $20) are often bought in 2 to 5 units, expensive ones (over $500) always 1.
- **Customer behaviour is skewed.** 140 customers have orders: the most active has 23 orders, the median is 5, and 2 customers ordered exactly once. Customers live in 14 cities in 12 states; segments: Consumer 89, Corporate 33, Home Office 28. For 88 orders `ship_city` differs from the customer's own city (gifts).
- **Reviews** (320 rows, 2023-01-20 to 2024-12-31) are written only by customers who received a *delivered* order containing the product, and always after that order (0 violations). Ratings are skewed to 4 and 5 stars: 5 stars: 136, 4 stars: 98, 3 stars: 63, 2 stars: 18, 1 stars: 5 (average 4.07). 93 reviews have no text.
- **Category tree.** level 1: 6, level 2: 5, level 3: 3. Products only point to leaf or mid-level categories; categories without any product: Electronics, Home, Sports.

### Notable facts & deliberate quirks

- **Customers 141 to 150 never ordered** (10 customers, all signed up between 2024-10-12 and 2024-10-31): the classic `LEFT JOIN ... WHERE o.order_id IS NULL` / `NOT EXISTS` exercise.
- **Products never ordered:** 5 Zephyr Gaming Laptop X, 34 Standing Desk 140cm, 46 Mysteries of the Deep Sea, 56 Science Lab Starter Kit, 60 Natural Bamboo Hairbrush.
- **Products with NULL supplier_id:** 47 Learn SQL in 30 Days, 50 Mindful Mornings Journal, 60 Natural Bamboo Hairbrush.
- **Inactive products** (`is_active = FALSE`): 13 Desk Mat XL, 19 Budget Phone Go, 37 Memory Foam Pillow, 55 Plush Dragon, Large. They have no orders after they were discontinued. **Products with stock_qty = 0:** ids 9, 13, 19, 22, 49, 55.
- **Suppliers without a contact email:** Tanuki Goods Ltd., Orchid & Oak Imports. **Customers without a phone:** 30; **without a birth_date:** 15.
- **Unpaid orders:** 15 non-cancelled orders have no payment row (delivered 6, processing 6, shipped 3). Cancelled orders never have payments (0 do, 127 don't).
- **Split payments:** 20 orders were paid in two payments (often a gift card plus card or PayPal). Returned orders were paid in full - there are no refund rows or negative payments.
- **Order status vs. dates.** `shipped_date` is NULL for 134 orders; `discount_code` is NULL for 777 orders.

### Handy facts (exact numbers, computed from the data)

- **Orders by status:** `delivered` 650, `cancelled` 127, `returned` 102, `shipped` 14, `processing` 7
  - query: `SELECT status, count(*) FROM orders GROUP BY 1 ORDER BY 2 DESC`
- **Revenue of delivered orders (all time):** `$229,443.50`
  - query: `SELECT sum(i.quantity * i.unit_price * (1 - i.discount)) FROM order_items i JOIN orders o ON o.order_id = i.order_id WHERE o.status = 'delivered'`
- **Revenue of delivered orders placed in 2024:** `$145,872.38`
  - query: `SELECT sum(i.quantity * i.unit_price * (1 - i.discount)) FROM order_items i JOIN orders o ON o.order_id = i.order_id WHERE o.status = 'delivered' AND o.order_date >= '2024-01-01'`
- **Number of orders placed in 2024:** `572`
  - query: `SELECT count(*) FROM orders WHERE order_date >= '2024-01-01' AND order_date < '2025-01-01'`
- **Average delivered order value:** `$352.99`
  - query: `SELECT round(avg(t.total), 2) FROM (SELECT o.order_id, sum(i.quantity * i.unit_price * (1 - i.discount)) AS total FROM orders o JOIN order_items i ON i.order_id = o.order_id WHERE o.status = 'delivered' GROUP BY o.order_id) t`
- **Month with the most orders:** `2024-11 (91 orders)`
  - query: `SELECT to_char(order_date, 'YYYY-MM') || ' (' || count(*) || ' orders)' FROM orders GROUP BY to_char(order_date, 'YYYY-MM') ORDER BY count(*) DESC LIMIT 1`
- **Best-selling product by units (delivered orders):** `Vitamin C Moisturizer (145 units)`
  - query: `SELECT p.name || ' (' || sum(i.quantity) || ' units)' FROM order_items i JOIN orders o ON o.order_id = i.order_id JOIN products p ON p.product_id = i.product_id WHERE o.status = 'delivered' GROUP BY p.product_id, p.name ORDER BY sum(i.quantity) DESC, p.name LIMIT 1`
- **Top customer by delivered revenue:** `Noor Haddad (customer 6, 8458.40)`
  - query: `SELECT c.first_name || ' ' || c.last_name || ' (customer ' || c.customer_id || ', ' || round(sum(i.quantity * i.unit_price * (1 - i.discount)), 2) || ')' FROM customers c JOIN orders o ON o.customer_id = c.customer_id JOIN order_items i ON i.order_id = o.order_id WHERE o.status = 'delivered' GROUP BY c.customer_id, c.first_name, c.last_name ORDER BY sum(i.quantity * i.unit_price * (1 - i.discount)) DESC LIMIT 1`
- **Payments received by method (count and dollars):** `card` 463 / 162,887.72, `paypal` 165 / 51,503.74, `bank_transfer` 104 / 37,898.02, `gift_card` 46 / 11,693.89
  - query: `SELECT method, count(*) || ' / ' || round(sum(amount), 2) FROM payments GROUP BY 1 ORDER BY sum(amount) DESC`
- **Products with at least 8 reviews, best average first:** `Blender Pro 1200` 4.71 (17 reviews), `Mindful Mornings Journal` 4.69 (13 reviews), `Jigsaw Puzzle 1000pc: Harbor Sunrise` 4.56 (18 reviews)
  - query: `SELECT p.name, round(avg(r.rating), 2) || ' (' || count(*) || ' reviews)' AS rating FROM reviews r JOIN products p ON p.product_id = r.product_id GROUP BY p.product_id, p.name HAVING count(*) >= 8 ORDER BY avg(r.rating) DESC, p.name LIMIT 3`

### Good lesson topics for this dataset

- INNER / LEFT JOIN across `customers`, `orders`, `order_items`, `products`, `categories`; anti-joins for customers 141-150 and the never-ordered products.
- GROUP BY / HAVING for revenue per category, month, segment or state; conditional aggregation with `FILTER` and `CASE`.
- Subqueries and CTEs: order totals, customers above the average, products never ordered, top-N per group.
- Self-referencing `categories` (3 levels) with recursive CTEs.
- Window functions: running revenue per month, rank customers by spend, previous order date per customer (`LAG`).
- Date analysis: seasonality, 2023 vs 2024, days between order and shipment.
- Data-quality reasoning: unpaid orders, split payments, price changes, stuck shipments.

<a id="company"></a>

## 3. company - 🏢 Acme Corp

> Departments, employees, managers, salaries and projects.

Acme Corp is a mid-sized company with 55 employees spread across seven departments and a five-level management chain from the CEO down to individual contributors. Use it to learn self joins, recursive CTEs and window functions such as RANK() over salaries, and to practice finding departments without people. It also has a full salary history and a handful of projects with assignments.

Acme Corp is a deliberately tidy organisation chart: one CEO at the top, a five-level management chain and enough salary data to make ranking and window-function questions interesting. "As of" date: **2024-12-31** (that is when "current" salaries and project statuses are measured).

### Tables

| table | rows | what it holds |
|---|---|---|
| `departments` | 7 | The departments of Acme Corp, with where they are based and their yearly budget. |
| `employees` | 55 | Everyone who works (or used to work) at Acme Corp, including who their manager is. |
| `salary_history` | 167 | Every salary change an employee has had, from the day they were hired. |
| `projects` | 14 | Company projects, each owned by one department. |
| `project_assignments` | 96 | Which employees work on which projects, in what role and for how many hours a week. |

### Relationships

- `employees.dept_id` → `departments.dept_id`
- `employees.manager_id` → `employees.emp_id`
- `salary_history.emp_id` → `employees.emp_id`
- `projects.dept_id` → `departments.dept_id`
- `project_assignments.emp_id` → `employees.emp_id`
- `project_assignments.project_id` → `projects.project_id`

### Columns

#### departments  (7 rows)

The departments of Acme Corp, with where they are based and their yearly budget.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `dept_id` | `integer` | Unique id of the department (primary key) | - | 7 | `1` to `7` |
| `name` | `text` | Department name | - | 7 | all different (2-11 characters) |
| `location` | `text` | City where the department is headquartered | - | 5 | 5 different values |
| `budget` | `numeric(12,2)` | Yearly budget in dollars | - | 7 | `1200000.00` to `9800000.00`, avg 3971428.57 |

#### employees  (55 rows)

Everyone who works (or used to work) at Acme Corp, including who their manager is.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `emp_id` | `integer` | Unique id of the employee (primary key) | - | 55 | `1` to `55` |
| `first_name` | `text` | Given name | - | 47 | 47 different values |
| `last_name` | `text` | Family name | - | 51 | 51 different values |
| `email` | `text` | Work email address | - | 55 | all different (20-29 characters) |
| `dept_id` | `integer` | Department the employee belongs to (empty if not assigned to one yet) → departments.dept_id | 2 (3.6%) | 6 | `2` (20), `3` (12), `4` (9), `5` (5), `6` (5), `1` (2) |
| `manager_id` | `integer` | The employee this person reports to (empty for the CEO) → employees.emp_id | 1 (1.8%) | 26 | `1` to `28` |
| `job_title` | `text` | Job title | - | 49 | 49 different values |
| `hire_date` | `date` | First day at the company | - | 55 | `2012-03-05` to `2024-06-17` |
| `salary` | `numeric(10,2)` | Current yearly salary in dollars | - | 42 | `45000.00` to `320000.00`, avg 129509.09 |
| `employment_type` | `text` | full_time, part_time or contractor | - | 3 | `'full_time'` (48), `'part_time'` (4), `'contractor'` (3) |
| `city` | `text` | City where the employee works | - | 7 | `'Austin'` (17), `'Chicago'` (12), `'Los Angeles'` (12), `'New York'` (8), `'Seattle'` (3), `'Denver'` (2), `'Boston'` (1) |
| `terminated_on` | `date` | Last day at the company (empty for current employees) | 50 (90.9%) | 5 | `2022-12-16` to `2024-09-27` |

#### salary_history  (167 rows)

Every salary change an employee has had, from the day they were hired.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `emp_id` | `integer` | Employee whose salary changed → employees.emp_id (part of the primary key) | - | 55 | `1` to `55` |
| `effective_date` | `date` | Day the new salary started (part of the primary key) | - | 159 | `2012-03-05` to `2024-11-08` |
| `salary` | `numeric(10,2)` | Yearly salary in dollars from that day on | - | 122 | `45000.00` to `320000.00`, avg 133844.31 |

#### projects  (14 rows)

Company projects, each owned by one department.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `project_id` | `integer` | Unique id of the project (primary key) | - | 14 | `1` to `14` |
| `name` | `text` | Project name | - | 14 | all different (13-27 characters) |
| `dept_id` | `integer` | Department that owns the project → departments.dept_id | - | 6 | `2` (4), `3` (2), `4` (2), `5` (2), `6` (2), `7` (2) |
| `start_date` | `date` | Planned or actual start date | - | 14 | `2022-02-01` to `2025-02-03` |
| `end_date` | `date` | Day the project finished (empty while it is still going or not started) | 9 (64.3%) | 5 | `2023-06-30` to `2024-11-15` |
| `budget` | `numeric(12,2)` | Project budget in dollars | - | 14 | `120000.00` to `1850000.00`, avg 588928.57 |
| `status` | `text` | planned, active, completed or on_hold | - | 4 | `'active'` (5), `'completed'` (5), `'on_hold'` (2), `'planned'` (2) |

#### project_assignments  (96 rows)

Which employees work on which projects, in what role and for how many hours a week.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `emp_id` | `integer` | Employee assigned to the project → employees.emp_id (part of the primary key) | - | 45 | `8` to `54` |
| `project_id` | `integer` | Project the employee works on → projects.project_id (part of the primary key) | - | 13 | `1` to `14` |
| `role` | `text` | Role on the project: lead, developer, analyst, designer, tester or consultant | - | 6 | `'analyst'` (29), `'developer'` (27), `'consultant'` (17), `'lead'` (13), `'tester'` (6), `'designer'` (4) |
| `hours_per_week` | `integer` | Weekly hours the employee spends on the project | - | 15 | `2` to `30`, avg 13.38 |
| `assigned_on` | `date` | Day the employee joined the project | - | 87 | `2022-02-02` to `2024-12-15` |

### How the data was built (distributions and rules)

- **Hierarchy.** `employees.manager_id` forms a tree with the CEO (emp_id 1) as the only root. Employees per level: level 1: 1, level 2: 6, level 3: 9, level 4: 12, level 5: 27; the **maximum depth is 5** (CEO = level 1). Level 2 are the five VPs and the Chief of Staff, level 3 directors and managers, level 4 team leads, level 5 individual contributors. A manager always has a lower `emp_id` than their reports, and nobody was hired before their manager. Example chains: `Backend Engineer → Backend Team Lead → Director of Platform Engineering → VP of Engineering → Chief Executive Officer`; `Business Consultant → Sales Team Lead, West → Director of Sales, Americas → VP of Sales → Chief Executive Officer`.
- **Headcount per department:** Executive 2, Engineering 20, Sales 12, Marketing 9, Finance 5, HR 5, Research 0.
- **Employment types:** full_time 48, part_time 4, contractor 3. Part-time and contractor `salary` values are annualised rates, so they are comparable with full-time salaries. Hire dates run from 2012-03-05 to 2024-06-17.
- **Salaries** run from $45,000.00 to $320,000.00 (average $129,509.09); the CEO earns the most, followed by the five VPs; below that, pay overlaps between levels (some team leads and contractors earn more than some directors). Salaries are multiples of 500.
- **salary_history** has 167 rows for all 55 employees (1 row: 13, 2 rows: 9, 3 rows: 6, 4 rows: 17, 5 rows: 10). The first row of every employee is dated on their `hire_date`, the last row always equals the current `employees.salary`, and later raises come roughly every year to two and a half years, typically 3% to 10% (occasionally up to 20% for a promotion; the two pay-cut employees follow a fixed pattern). Dates range from 2012-03-05 to 2024-11-08. Terminated employees have no row after their last day.
- **Projects** (active 5, completed 5, on_hold 2, planned 2): `completed` projects have an `end_date`; active, on-hold and planned projects have `end_date` NULL. Planned projects start in 2025 (project ids 3, 14). Project budgets are between $120,000.00 and $1,850,000.00. The owning department (`projects.dept_id`) is not necessarily where the team comes from: the Research department owns two projects but has no employees at all.
- **project_assignments** (96 rows): roles analyst 29, developer 27, consultant 17, lead 13, tester 6, designer 4. Weekly hours run from 2 to 30 (average 13.4); part-timers get at most 8. `assigned_on` is on or after the project start and the employee's hire date and never after a project's end or the employee's last day (the only exception: 3 assignments to the planned project 14, which were made in December 2024 before its January 2025 start).

### Notable facts & deliberate quirks

- **Research has no employees.** `Research` (dept_id 7) is a department with zero rows in `employees` - use it for `LEFT JOIN` / `NOT EXISTS` lessons. It still owns projects: 5 Search Relevance Upgrade, 6 Churn Prediction Pilot.
- **Two employees have no department** (NULL `dept_id`): 53 Kwame Diallo (Technical Writer, contractor), 54 Jia Kang (Business Consultant, contractor). They are not counted in any department headcount.
- **Only one NULL manager:** 1 Chief Executive Officer.
- **Terminated employees (`terminated_on` not NULL):** 46 Gabriela Garcia (2022-12-16), 36 Vikram Boateng (2023-08-31), 31 Karan Chowdhury (2024-03-29), 41 Mariana Hernandez (2024-06-14), 51 Sven Rossi (2024-09-27). They still appear in `salary_history`, `project_assignments` (only for dates before they left) and as normal rows in `employees`; none of them managed anybody.
- **Salary ties** (useful for `RANK()` vs `DENSE_RANK()` vs `ROW_NUMBER()`): dept 2 salary 118000.00 x2 (emp 33, 34), dept 2 salary 122000.00 x2 (emp 31, 36), dept 2 salary 128000.00 x2 (emp 29, 30), dept 2 salary 198000.00 x2 (emp 8, 9), dept 3 salary 88000.00 x3 (emp 40, 41, 42), dept 3 salary 118000.00 x2 (emp 22, 23), dept 3 salary 185000.00 x2 (emp 11, 12).
- **Pay cuts:** exactly two salary decreases exist in `salary_history`: 23 on 2020-04-01 (108500.00 to 100500.00), 40 on 2020-04-01 (81000.00 to 75000.00) (a temporary reduction in April 2020 that was later reversed with raises).
- **10 employees are on no project:** emp_id 1, 2, 3, 4, 5, 6, 7, 41, 45, 55 (the CEO, the Chief of Staff, the five VPs, one terminated account executive, one sales development rep and one marketing coordinator).
- **Projects without assignments:** 3 Customer Data Lake (planned).

### Handy facts (exact numbers, computed from the data)

- **Employees in total / currently employed (terminated_on IS NULL):** `55 / 50`
  - query: `SELECT count(*) || ' / ' || count(*) FILTER (WHERE terminated_on IS NULL) FROM employees`
- **Employees per department (including those with none):** `Executive` 2, `Engineering` 20, `Sales` 12, `Marketing` 9, `Finance` 5, `HR` 5, `Research` 0
  - query: `SELECT d.name, count(e.emp_id) FROM departments d LEFT JOIN employees e ON e.dept_id = d.dept_id GROUP BY d.dept_id, d.name ORDER BY d.dept_id`
- **Total yearly payroll of current employees:** `$6,649,000.00`
  - query: `SELECT sum(salary) FROM employees WHERE terminated_on IS NULL`
- **Average salary per department:** `Executive` 247,500.00, `Engineering` 141,650.00, `Finance` 128,000.00, `Sales` 122,166.67, `HR` 106,200.00, `Marketing` 104,555.56
  - query: `SELECT d.name, round(avg(e.salary), 2) FROM departments d JOIN employees e ON e.dept_id = d.dept_id GROUP BY d.dept_id, d.name ORDER BY avg(e.salary) DESC`
- **Second-highest distinct salary in Engineering (dept 2):** `$198,000.00`
  - query: `SELECT DISTINCT salary FROM employees WHERE dept_id = 2 ORDER BY salary DESC OFFSET 1 LIMIT 1`
- **RANK vs DENSE_RANK on Engineering salaries (top of the list):** 

| salary | rnk | dense_rnk | people |
|---|---|---|---|
| 265000.00 | 1 | 1 | 1 |
| 198000.00 | 2 | 2 | 2 |
| 168000.00 | 3 | 3 | 1 |
| 152000.00 | 4 | 4 | 1 |
| 150000.00 | 5 | 5 | 1 |
| 148000.00 | 6 | 6 | 1 |
  - query: `SELECT salary, RANK() OVER (ORDER BY salary DESC) AS rnk, DENSE_RANK() OVER (ORDER BY salary DESC) AS dense_rnk, count(*) AS people FROM employees WHERE dept_id = 2 GROUP BY salary ORDER BY salary DESC LIMIT 6`
- **Manager with the most direct reports:** `Chief Executive Officer (emp 1, 6 reports)`
  - query: `SELECT m.job_title || ' (emp ' || m.emp_id || ', ' || count(*) || ' reports)' FROM employees e JOIN employees m ON m.emp_id = e.manager_id GROUP BY m.emp_id, m.job_title ORDER BY count(*) DESC, m.emp_id LIMIT 1`
- **Total budget of active projects:** `$3,010,000.00`
  - query: `SELECT sum(budget) FROM projects WHERE status = 'active'`
- **Projects per department (including departments with none):** `Executive` 0, `Engineering` 4, `Sales` 2, `Marketing` 2, `Finance` 2, `HR` 2, `Research` 2
  - query: `SELECT d.name, count(p.project_id) FROM departments d LEFT JOIN projects p ON p.dept_id = d.dept_id GROUP BY d.dept_id, d.name ORDER BY d.dept_id`
- **Employee working on the most projects:** `Noor Rahman (emp 29, 5 projects)`
  - query: `SELECT e.first_name || ' ' || e.last_name || ' (emp ' || e.emp_id || ', ' || count(*) || ' projects)' FROM project_assignments a JOIN employees e ON e.emp_id = a.emp_id GROUP BY e.emp_id, e.first_name, e.last_name ORDER BY count(*) DESC, e.emp_id LIMIT 1`

### Good lesson topics for this dataset

- LEFT JOIN with departments that have no employees; COALESCE for the two employees without a department.
- Self joins: employee with manager name, employees earning more than their manager, peers with the same manager.
- Recursive CTEs: whole reporting chain of an employee, all reports below a VP, depth of each person, org chart paths.
- Aggregation by department and job level; HAVING; salary bands with CASE.
- Window functions: RANK / DENSE_RANK / ROW_NUMBER over salary, running payroll, LAG on `salary_history` to compute raises and spot pay cuts.
- Date arithmetic: tenure at hire date, time between raises, who was employed on a given day.
- Many-to-many through `project_assignments` (employees x projects), anti-joins for people on no project.

<a id="movies"></a>

## 4. movies - 🎬 FlickNest

> A streaming service with movies, cast, ratings and viewing history.

FlickNest is a movie streaming service with 110 invented films, their genres, directors and casts, 220 subscribers, ratings and half a year of viewing history. It is made for many-to-many relationships, window functions, ranking and aggregation, and the watch history even contains binge sessions for you to untangle. All titles and people are fictional.

FlickNest is built around **many-to-many** relationships (movies and genres, movies and people, users and movies) and around **time**: a rating history that spans three years and a half-year of viewing logs with realistic binge sessions. All 110 titles and 90 people are invented. "As of" date: **2024-12-31** for ratings, **2024-06-30** for the end of the watch history.

### Tables

| table | rows | what it holds |
|---|---|---|
| `movies` | 110 | The FlickNest film catalog. |
| `genres` | 12 | The twelve genres a movie can belong to. |
| `movie_genres` | 207 | Links movies to their genres (a movie can have one to three genres). |
| `people` | 90 | Actors, directors and writers who worked on the movies. |
| `movie_cast` | 659 | Who worked on each movie and in which role (actor, director or writer). |
| `users` | 220 | FlickNest subscribers. |
| `ratings` | 1,800 | Star ratings users gave to movies (at most one rating per user per movie). |
| `watch_history` | 3,654 | Every time a user pressed play (January to June 2024). |

### Relationships

- `movie_genres.movie_id` → `movies.movie_id`
- `movie_genres.genre_id` → `genres.genre_id`
- `movie_cast.movie_id` → `movies.movie_id`
- `movie_cast.person_id` → `people.person_id`
- `ratings.user_id` → `users.user_id`
- `ratings.movie_id` → `movies.movie_id`
- `watch_history.user_id` → `users.user_id`
- `watch_history.movie_id` → `movies.movie_id`

### Columns

#### movies  (110 rows)

The FlickNest film catalog.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `movie_id` | `integer` | Unique id of the movie (ids are in release-year order) (primary key) | - | 110 | `1` to `110` |
| `title` | `text` | Movie title | - | 110 | all different (9-37 characters) |
| `release_year` | `integer` | Year the movie was released | - | 41 | `1975` to `2024`, avg 2006.39 |
| `duration_min` | `integer` | Running time in minutes | - | 56 | `78` to `150`, avg 112.40 |
| `age_rating` | `text` | Age rating: G, PG, PG-13 or R | - | 4 | `'PG-13'` (44), `'PG'` (31), `'R'` (28), `'G'` (7) |
| `language` | `text` | Original language of the movie | - | 10 | `'English'` (88), `'French'` (4), `'German'` (3), `'Japanese'` (3), `'Spanish'` (3), `'Hindi'` (2), `'Italian'` (2), `'Korean'` (2), `'Portuguese'` (2), `'Mandarin'` (1) |
| `budget_musd` | `numeric(6,1)` | Production budget in millions of US dollars (empty when unknown) | 13 (11.8%) | 92 | `4.4` to `293.0`, avg 74.50 |
| `box_office_musd` | `numeric(7,1)` | Worldwide box office in millions of US dollars (empty when unknown) | 13 (11.8%) | 97 | `10.0` to `1299.1`, avg 233.55 |

#### genres  (12 rows)

The twelve genres a movie can belong to.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `genre_id` | `integer` | Unique id of the genre (primary key) | - | 12 | `1` to `12` |
| `name` | `text` | Genre name | - | 12 | all different (5-9 characters) |

#### movie_genres  (207 rows)

Links movies to their genres (a movie can have one to three genres).

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `movie_id` | `integer` | The movie → movies.movie_id (part of the primary key) | - | 110 | `1` to `110` |
| `genre_id` | `integer` | One of the movie's genres → genres.genre_id (part of the primary key) | - | 12 | `1` to `12` |

#### people  (90 rows)

Actors, directors and writers who worked on the movies.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `person_id` | `integer` | Unique id of the person (primary key) | - | 90 | `1` to `90` |
| `full_name` | `text` | Full name | - | 90 | all different (6-16 characters) |
| `birth_year` | `integer` | Year of birth (empty when unknown) | 6 (6.7%) | 44 | `1943` to `1994`, avg 1967.48 |
| `country` | `text` | Country the person is from | - | 28 | 28 different values |

#### movie_cast  (659 rows)

Who worked on each movie and in which role (actor, director or writer).

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `movie_id` | `integer` | The movie → movies.movie_id (part of the primary key) | - | 110 | `1` to `110` |
| `person_id` | `integer` | The person → people.person_id (part of the primary key) | - | 90 | `1` to `90` |
| `role` | `text` | What the person did on the movie: actor, director or writer (part of the primary key) | - | 3 | `'actor'` (432), `'writer'` (117), `'director'` (110) |
| `character_name` | `text` | Character played (only for actors) | 227 (34.4%) | 409 | 409 different values |
| `billing_order` | `integer` | Position in the credits, 1 = top billed (only for actors) | 227 (34.4%) | 6 | `1` (110), `2` (110), `3` (99), `4` (67), `5` (35), `6` (11) |

#### users  (220 rows)

FlickNest subscribers.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `user_id` | `integer` | Unique id of the user (primary key) | - | 220 | `1` to `220` |
| `username` | `text` | Public username | - | 220 | all different (11-16 characters) |
| `country` | `text` | Country of the user | - | 14 | 14 different values |
| `signup_date` | `date` | Day the user signed up | - | 193 | `2022-01-12` to `2024-06-22` |
| `plan` | `text` | Subscription plan: free, basic or premium | - | 3 | `'free'` (95), `'basic'` (68), `'premium'` (57) |

#### ratings  (1,800 rows)

Star ratings users gave to movies (at most one rating per user per movie).

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `user_id` | `integer` | User who rated → users.user_id (part of the primary key) | - | 210 | `1` to `220` |
| `movie_id` | `integer` | Movie that was rated → movies.movie_id (part of the primary key) | - | 100 | `1` to `110` |
| `stars` | `numeric(2,1)` | Rating from 0.5 to 5.0 in steps of 0.5 | - | 10 | `3.5` (350), `4.0` (335), `5.0` (290), `3.0` (283), `4.5` (276), `2.5` (163), `2.0` (62), `1.5` (34), `1.0` (6), `0.5` (1) |
| `rated_at` | `timestamp` | Date and time of the rating | - | 1,800 | `2022-03-28 22:49:28` to `2024-12-31 20:36:39` |

#### watch_history  (3,654 rows)

Every time a user pressed play (January to June 2024).

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `watch_id` | `integer` | Unique id of the viewing (primary key) | - | 3,654 | `1` to `3654` |
| `user_id` | `integer` | User who watched → users.user_id | - | 208 | `1` to `220` |
| `movie_id` | `integer` | Movie that was watched → movies.movie_id | - | 109 | `1` to `110` |
| `started_at` | `timestamp` | Date and time playback started | - | 3,654 | `2024-01-01 01:14:57` to `2024-06-30 23:49:30` |
| `minutes_watched` | `integer` | Minutes actually watched (never more than the movie length) | - | 148 | `1` to `150`, avg 58.18 |
| `device` | `text` | Device used: tv, mobile, web or tablet | - | 4 | `'tv'` (1,400), `'mobile'` (979), `'web'` (854), `'tablet'` (421) |

### How the data was built (distributions and rules)

- **Movies:** 110 films released 1975 to 2024 (by decade: 1970s: 2, 1980s: 11, 1990s: 18, 2000s: 30, 2010s: 34, 2020s: 15); running time 78 to 150 minutes (average 112.4). Movie ids are assigned in release-year order. Languages: English 88, French 4, German 3, Japanese 3, Spanish 3, Hindi 2, Italian 2, Korean 2, Portuguese 2, Mandarin 1. Age ratings: G 7, PG 31, PG-13 44, R 28 (animation and family films are G/PG, horror is mostly R).
- **Money columns** are in *millions* of US dollars (`budget_musd`, `box_office_musd`). 17 films (15%) have a NULL budget and/or box office: 9 have both NULL, 4 only the budget, 4 only the box office. 14 films earned less than they cost.
- **Genres:** 12 genres; a film has 1 genre: 24, 2 genres: 75, 3 genres: 11. Films per genre (counting multi-genre films once per genre): Drama 32, Comedy 28, Family 23, Adventure 21, Action 17, Thriller 16, Fantasy 15, Sci-Fi 14, Animation 13, Romance 13, Crime 9, Horror 6.
- **Cast and crew** (`movie_cast`): actor 432 credits by 56 people, director 110 credits by 28 people, writer 117 credits by 14 people. Every film has **exactly one director** and **2 to 6 actors** (`billing_order` 1 = top billed, `character_name` only for actors) and 98 films have one or two credited writers. The primary key is (movie_id, person_id, role), so one person may hold several roles on a film: 21 films were written by their own director. A few directors direct many films: Meera Joshi (person 75, 11 films), Wei Pham (person 78, 8 films), Lars Johansson (person 27, 7 films); 28 directors in total, 8 of them directed just one film.
- **People:** 90 people from 28 countries; the age at release (`release_year - birth_year`) for every credit is between 19 and 78. 6 people have an unknown `birth_year`.
- **Users:** 220 subscribers who signed up 2022-01-12 to 2024-06-22; plans: free 95, basic 68, premium 57.
- **Ratings:** 1,800 ratings by 210 users on 100 films, from 2022-03-28 to 2024-12-31; `stars` is a multiple of 0.5 between 0.5 and 5.0 (distribution - 0.5: 1, 1.0: 6, 1.5: 34, 2.0: 62, 2.5: 163, 3.0: 283, 3.5: 350, 4.0: 335, 4.5: 276, 5.0: 290; average 3.72). A rating is never earlier than the user's signup date or the film's release year. Popularity is very uneven: the most-rated film has 75 ratings, the median film 12.5, and 10 films have 3 or fewer.
- **Watch history:** 3,654 plays by 208 users on 109 films between 2024-01-01 01:14:57 and 2024-06-30 23:49:30. Devices: tv 1400, mobile 979, web 854, tablet 421. `minutes_watched` never exceeds the film's `duration_min` (1,150 plays were watched to the very end, 1,893 stopped before the halfway point).
- **Binge sessions (sessionization).** Plays of one user come in clusters: inside a cluster consecutive plays start at most **00:28:58** apart (hh:mm:ss), while the next cluster of the same user starts at least **05:04:42** after the previous play. So a 30-minute inactivity rule gives exactly 2,049 sessions for the 3,654 plays, and 460 of those sessions contain 3 or more plays. In a binge the first plays are short samples (a few minutes) and only the last one is watched properly.

### Notable facts & deliberate quirks

- **10 films have no ratings at all:** 3 Lockwood Vice, 8 Quantum Tea Party, 35 Echoes of Andromeda Bay, 40 Station Nine, 45 The Understudy, 47 Backyard Astronauts, 60 Smoke and Sparrow, 75 The Weight of Feathers, 79 Penny and the Paper Sea, 80 The Cloud Cobbler.
- **10 users never rated a film** (user_id 6, 9, 33, 57, 78, 92, 110, 139, 145, 211); **12 users have no plays** in the watch history (they signed up but were inactive in January-June 2024).
- **Two people both act and direct:** 45 Declan Brooks (1 directed, 14 acted), 82 Fatima Omondi (1 directed, 10 acted). (Other directors may also be credited as writers, but only these two appear as actors.)
- **6 people have a NULL birth_year.**
- The same person can appear several times for one film with different roles (director + writer), so always include `role` when counting or joining `movie_cast`.
- A user may watch the same film more than once (replays), but rates it at most once (primary key on `ratings`).
- Ratings and plays are generated independently: a user can rate a film that never appears in their watch history, and vice versa.

### Handy facts (exact numbers, computed from the data)

- **Average rating of all ratings:** `3.72`
  - query: `SELECT round(avg(stars), 2) FROM ratings`
- **Most-rated film:** `Bridge to the Western Lights (75 ratings, average 4.05)`
  - query: `SELECT m.title || ' (' || count(*) || ' ratings, average ' || round(avg(r.stars), 2) || ')' FROM ratings r JOIN movies m ON m.movie_id = r.movie_id GROUP BY m.movie_id, m.title ORDER BY count(*) DESC, m.title LIMIT 1`
- **Highest average rating among films with at least 25 ratings:** `Robo Bakery (4.40 from 31 ratings)`
  - query: `SELECT m.title || ' (' || round(avg(r.stars), 2) || ' from ' || count(*) || ' ratings)' FROM ratings r JOIN movies m ON m.movie_id = r.movie_id GROUP BY m.movie_id, m.title HAVING count(*) >= 25 ORDER BY avg(r.stars) DESC, m.title LIMIT 1`
- **Director with the most films:** `Meera Joshi (11 films)`
  - query: `SELECT p.full_name || ' (' || count(*) || ' films)' FROM movie_cast c JOIN people p ON p.person_id = c.person_id WHERE c.role = 'director' GROUP BY p.person_id, p.full_name ORDER BY count(*) DESC, p.person_id LIMIT 1`
- **Actor with the most credits:** `Mei Kang (34 films)`
  - query: `SELECT p.full_name || ' (' || count(*) || ' films)' FROM movie_cast c JOIN people p ON p.person_id = c.person_id WHERE c.role = 'actor' GROUP BY p.person_id, p.full_name ORDER BY count(*) DESC, p.person_id LIMIT 1`
- **Highest-grossing film (box_office_musd):** `Echoes of Andromeda Bay (1299.1 million)`
  - query: `SELECT title || ' (' || box_office_musd || ' million)' FROM movies WHERE box_office_musd IS NOT NULL ORDER BY box_office_musd DESC LIMIT 1`
- **Users per plan:** `free` 95, `basic` 68, `premium` 57
  - query: `SELECT plan, count(*) FROM users GROUP BY 1 ORDER BY 2 DESC`
- **Total minutes watched in the watch history:** `212,584`
  - query: `SELECT sum(minutes_watched) FROM watch_history`
- **Plays per month (2024):** `2024-01` 546, `2024-02` 527, `2024-03` 507, `2024-04` 558, `2024-05` 690, `2024-06` 826
  - query: `SELECT to_char(started_at, 'YYYY-MM') AS month, count(*) FROM watch_history GROUP BY to_char(started_at, 'YYYY-MM') ORDER BY 1`
- **Most-watched film (plays):** `Rain Over Valparaiso (167 plays)`
  - query: `SELECT m.title || ' (' || count(*) || ' plays)' FROM watch_history w JOIN movies m ON m.movie_id = w.movie_id GROUP BY m.movie_id, m.title ORDER BY count(*) DESC, m.title LIMIT 1`

### Good lesson topics for this dataset

- Many-to-many joins: films by genre, films by actor, actors who worked with a given director (`movie_cast` self join).
- Aggregation and HAVING: average rating per film with a minimum number of ratings; films without ratings (LEFT JOIN / NOT EXISTS).
- Window functions: rank films by rating within each genre or decade, running totals of plays, `LAG` between a user's consecutive plays.
- Sessionization: group plays into sessions with a 30-minute gap rule (`LAG` + running `SUM` of a "new session" flag).
- Conditional aggregation and `FILTER` for devices or plans; date truncation by week or month.
- NULL-handling in `budget_musd` / `box_office_musd` (profit, ROI, `COALESCE`, `NULLIF`).

<a id="bank"></a>

## 5. bank - 🏦 Harbor Bank

> Accounts, a year of transactions, loans and a few suspicious patterns.

Harbor Bank has five branches, 80 customers, about 125 accounts and a full year of transactions: salaries, rent, card payments, fees and interest. Practice running balances, monthly summaries, GROUP BY with dates and window functions, then play detective: a few accounts show suspicious bursts of activity. Every amount is in US dollars and the data covers calendar year 2024.

Harbor Bank is a transaction-heavy dataset: every row of `transactions` is a movement of money in calendar year **2024**, which makes it ideal for running balances, month-by-month reports and spotting unusual behaviour. "As of" date: **2024-12-31 23:59**. Loans are dated back to 2015.

### Tables

| table | rows | what it holds |
|---|---|---|
| `branches` | 5 | Harbor Bank branch offices. |
| `customers` | 80 | People and households who bank with Harbor Bank. |
| `accounts` | 126 | Bank accounts (checking, savings and credit card accounts). One customer can have several. |
| `transactions` | 3,674 | Every movement of money in 2024: positive amounts are money in, negative amounts are money out. |
| `loans` | 40 | Loans granted to customers. |

### Relationships

- `accounts.customer_id` → `customers.customer_id`
- `accounts.branch_id` → `branches.branch_id`
- `transactions.account_id` → `accounts.account_id`
- `loans.customer_id` → `customers.customer_id`

### Columns

#### branches  (5 rows)

Harbor Bank branch offices.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `branch_id` | `integer` | Unique id of the branch (primary key) | - | 5 | `1` to `5` |
| `name` | `text` | Branch name | - | 5 | all different (19-21 characters) |
| `city` | `text` | City where the branch is located | - | 5 | all different (6-13 characters) |
| `opened_on` | `date` | Day the branch opened | - | 5 | `1998-04-06` to `2019-10-14` |

#### customers  (80 rows)

People and households who bank with Harbor Bank.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `customer_id` | `integer` | Unique id of the customer (primary key) | - | 80 | `1` to `80` |
| `full_name` | `text` | Full name | - | 80 | all different (6-17 characters) |
| `city` | `text` | City where the customer lives | - | 7 | `'Seattle'` (20), `'New York'` (16), `'Austin'` (15), `'Chicago'` (13), `'San Francisco'` (7), `'Tacoma'` (5), `'Oakland'` (4) |
| `date_of_birth` | `date` | Date of birth | - | 80 | `1935-09-24` to `2004-02-06` |
| `kyc_status` | `text` | Identity check status: verified, pending or rejected | - | 3 | `'verified'` (65), `'pending'` (9), `'rejected'` (6) |
| `created_at` | `date` | Day the customer record was created | - | 79 | `2010-07-02` to `2024-08-03` |

#### accounts  (126 rows)

Bank accounts (checking, savings and credit card accounts). One customer can have several.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `account_id` | `integer` | Unique id of the account (primary key) | - | 126 | `1` to `126` |
| `customer_id` | `integer` | Customer who owns the account → customers.customer_id | - | 75 | `1` to `80` |
| `branch_id` | `integer` | Branch that manages the account → branches.branch_id | - | 5 | `1` (33), `4` (28), `3` (24), `2` (22), `5` (19) |
| `account_type` | `text` | checking, savings or credit | - | 3 | `'checking'` (74), `'savings'` (35), `'credit'` (17) |
| `opened_on` | `date` | Day the account was opened | - | 115 | `2010-08-13` to `2024-12-10` |
| `status` | `text` | active, frozen or closed | - | 3 | `'active'` (108), `'frozen'` (10), `'closed'` (8) |
| `overdraft_limit` | `numeric(10,2)` | How far below zero the balance may go (the credit limit for credit accounts) | - | 8 | `0.00` (77), `500.00` (14), `250.00` (12), `1000.00` (9), `2500.00` (5), `7500.00` (4), `5000.00` (3), `10000.00` (2) |

#### transactions  (3,674 rows)

Every movement of money in 2024: positive amounts are money in, negative amounts are money out.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `txn_id` | `integer` | Unique id of the transaction (ids are in time order) (primary key) | - | 3,674 | `1` to `3674` |
| `account_id` | `integer` | Account the transaction belongs to → accounts.account_id | - | 124 | `1` to `125` |
| `txn_time` | `timestamp` | Date and time of the transaction | - | 3,029 | `2024-01-01 00:00:00` to `2024-12-31 23:50:00` |
| `amount` | `numeric(12,2)` | Amount in dollars: positive = money in, negative = money out | - | 2,146 | `-22450.00` to `35550.00`, avg 585.42 |
| `txn_type` | `text` | deposit, withdrawal, transfer_in, transfer_out, card_payment, fee or interest | - | 7 | `'card_payment'` (1,301), `'deposit'` (760), `'transfer_out'` (451), `'interest'` (353), `'withdrawal'` (343), `'transfer_in'` (319), `'fee'` (147) |
| `merchant` | `text` | Shop or company paid (only for card payments) | 2,373 (64.6%) | 39 | 39 different values |
| `category` | `text` | Spending category (only for card payments) | 2,373 (64.6%) | 7 | `'groceries'` (291), `'utilities'` (277), `'dining'` (272), `'shopping'` (190), `'entertainment'` (117), `'health'` (81), `'travel'` (73) |
| `description` | `text` | Short text shown on the statement | - | 181 | 181 different values |

#### loans  (40 rows)

Loans granted to customers.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `loan_id` | `integer` | Unique id of the loan (primary key) | - | 40 | `1` to `40` |
| `customer_id` | `integer` | Customer who borrowed the money → customers.customer_id | - | 28 | `1` to `70` |
| `principal` | `numeric(12,2)` | Amount borrowed in dollars | - | 40 | `4550.00` to `394300.00`, avg 63032.50 |
| `annual_rate` | `numeric(5,2)` | Yearly interest rate in percent (5.25 means 5.25%) | - | 39 | `3.48` to `19.66`, avg 9.30 |
| `start_date` | `date` | Day the loan was paid out | - | 39 | `2015-05-31` to `2024-10-29` |
| `term_months` | `integer` | Length of the loan in months | - | 11 | `60` (12), `36` (6), `120` (5), `24` (4), `180` (3), `240` (3), `12` (2), `72` (2), `300` (1), `360` (1), `84` (1) |
| `status` | `text` | active, paid_off or defaulted | - | 3 | `'active'` (23), `'paid_off'` (12), `'defaulted'` (5) |

### How the data was built (distributions and rules)

- **Customers:** 80 people; KYC status: verified 65, pending 9, rejected 6. Pending customers are mostly recent sign-ups. 5 customers have **no account** (customer_id 9 (rejected), 19 (rejected), 61 (rejected), 71 (pending), 73 (pending)).
- **Accounts** (checking 74, savings 35, credit 17; status: active 108, frozen 10, closed 8): accounts per customer - 1 account: 35, 2 accounts: 29, 3 accounts: 11. A customer's first account is a checking account in most cases and extra accounts are opened months or years later. Accounts per branch: Seattle 33, Chicago 22, Austin 24, New York 28, San Francisco 19. `overdraft_limit` ranges by type: checking 0.00-1000.00, credit 1000.00-10000.00, savings 0.00-0.00; for `credit` accounts it is the credit limit.
- **Transactions:** 3,674 rows on 124 accounts from 2024-01-01 00:00:00 to 2024-12-31 23:50:00; types - card_payment 1301, deposit 760, transfer_out 451, interest 353, withdrawal 343, transfer_in 319, fee 147. `amount` is signed: positive = money in, negative = money out. **Every account starts 2024 at zero**, so `SUM(amount)` over an account's rows is its balance at the end of 2024 and a running `SUM(amount) OVER (PARTITION BY account_id ORDER BY txn_time, txn_id)` is its balance at any moment.
- **Opening balances.** Instead of a balance column, accounts that existed before 2024 get one row at 2024-01-01 00:00:00 with description `Balance brought forward` (94 accounts, type `deposit`); accounts opened during 2024 get an `Opening deposit` (15 accounts). Credit accounts start at zero without such a row. These rows are legitimate deposits; filter on the description if you want to exclude them from "activity".
- **Typical patterns.** 444 salary deposits (`Salary - <employer>`) on 40 checking accounts, one per month on a fixed pay day; rent payments (`transfer_out`, `Rent payment - <landlord>`); card payments with a merchant and one of the categories groceries 291, utilities 277, dining 272, shopping 190, entertainment 117, health 81, travel 73; ATM withdrawals; monthly interest on savings accounts (positive, on the last day of the month at 23:50) and **negative** interest on credit accounts that carry a balance (`Interest charged`, on the 25th); fees: Monthly maintenance fee 101, ATM fee (out-of-network) 25, Overdraft fee 15, Late payment fee 6.
- **Paired transfers.** 123 `Transfer to savings` rows on checking accounts each have exactly one matching `Transfer from checking` row on the customer's savings account with the same timestamp and opposite amount.
- **Credit accounts** hold card purchases (negative); on the 20th of each month the customer pays all, part or none of the amount owed (`transfer_in`, `Payment received - thank you`, 102 payments), a late fee is charged on the 21st if nothing was paid, and interest on the 25th. A negative balance on a credit account means money owed.
- **Overdrafts.** Debits are never declined by the generator unless they would push the balance below `-overdraft_limit`, so balances never fall below that limit except through fees and credit-card interest (which are always charged). 7 checking accounts dip below zero at some point and get an `Overdraft fee` of 35.00 (at most once per month).
- **Closed and frozen accounts** simply stop having transactions at some point (closed accounts: last activity between 2024-02-29 and 2024-10-25, frozen accounts: last activity between 2024-04-18 and 2024-09-28); there is no closing date column.
- **Loans:** 40 loans starting 2015-05-31 to 2024-10-29; principal $4,550.00 to $394,300.00; `annual_rate` 3.48 to 19.66 (percent); terms from 12 to 360 months; status: active 23, paid_off 12, defaulted 5. Rates follow the kind of loan: long loans (20-30 years, mortgage-sized) have the low rates (at most 6.9%), small personal loans the high ones. Only verified customers have loans, always after they became customers. 10 customers have more than one loan. There are no loan-payment rows.

### Notable facts & deliberate quirks

- **Customers without accounts:** 9 (rejected), 19 (rejected), 61 (rejected), 71 (pending), 73 (pending) - anti-join practice; the rejected ones are what you would expect for failed identity checks. Customers with a rejected KYC status who do have accounts only have `frozen` ones.
- **Three suspicious bursts** (at least 4 debits of 500 or more within the same clock hour; each burst fits into about 10 minutes): account 10: 5 debits totalling $6,117.97 between 2024-03-14 02:40:35 and 2024-03-14 02:45:57; account 46: 6 debits totalling $7,780.94 between 2024-10-05 03:19:20 and 2024-10-05 03:26:06; account 76: 4 debits totalling $3,840.00 between 2024-07-27 23:19:46 and 2024-07-27 23:23:27. They happen at night, on accounts that had enough money to cover them.
- **Two unusually large debits.** txn 3203 on account 1 (2024-11-11 10:27:30): -$2,250.00 - Card purchase - Meridian Fine Jewelers, 20.7 times the account's average debit; txn 2731 on account 94 (2024-09-20 14:23:15): -$22,450.00 - Large cash withdrawal at branch, 17.7 times the account's average debit. Both are more than 10 times the average *debit* of their account (`-amount > 10 * AVG(-amount)` over the account's negative rows) **and** more than 10 times the average *absolute amount* of all the account's rows. If you use the second form on all rows you also catch 46 `Balance brought forward` / `Opening deposit` rows (opening balances are big compared with everyday transactions); exclude them by description and exactly these two remain.
- **Loan status consistency:** 12 loans are `paid_off`: 11 completed their full term by the end of 2024 and 1 was repaid early; no `active` loan has reached the end of its term; defaulted loans all have rates of at least 10.25%.
- **Year-end balances:** accounts with a negative balance on 2024-12-31 - checking 2 of 74, credit 9 of 15, savings 0 of 35. Negative checking balances are overdrafts; negative credit balances are debt.
- `merchant` and `category` are NULL for every transaction that is not a `card_payment` (and set for every card payment).

### Handy facts (exact numbers, computed from the data)

- **Transactions by type (count):** `card_payment` 1,301, `deposit` 760, `transfer_out` 451, `interest` 353, `withdrawal` 343, `transfer_in` 319, `fee` 147
  - query: `SELECT txn_type, count(*) FROM transactions GROUP BY 1 ORDER BY 2 DESC`
- **Salary deposits in total:** `$1,587,035.00`
  - query: `SELECT sum(amount) FROM transactions WHERE description LIKE 'Salary - %'`
- **Month with the most transactions:** `2024-01 (436 transactions)`
  - query: `SELECT to_char(txn_time, 'YYYY-MM') || ' (' || count(*) || ' transactions)' FROM transactions GROUP BY to_char(txn_time, 'YYYY-MM') ORDER BY count(*) DESC LIMIT 1`
- **Card spending per category (dollars):** `utilities` 35,783.76, `shopping` 23,767.57, `groceries` 17,893.70, `travel` 12,293.24, `dining` 8,680.67, `entertainment` 7,218.58, `health` 4,953.32
  - query: `SELECT category, round(-sum(amount), 2) FROM transactions WHERE txn_type = 'card_payment' GROUP BY 1 ORDER BY 2 DESC`
- **Average year-end balance per account type:** `checking` 22,256.85, `credit` -289.27, `savings` 14,518.87
  - query: `SELECT a.account_type, round(avg(b), 2) FROM (SELECT account_id, sum(amount) AS b FROM transactions GROUP BY account_id) t JOIN accounts a ON a.account_id = t.account_id GROUP BY 1 ORDER BY 1`
- **Interest credited to savings accounts in 2024:** `$9,700.51`
  - query: `SELECT sum(t.amount) FROM transactions t JOIN accounts a ON a.account_id = t.account_id WHERE t.txn_type = 'interest' AND a.account_type = 'savings'`
- **Burst detector: 4 or more debits of 500+ within one clock hour:** 

| account_id | debits | first_txn | total |
|---|---|---|---|
| 10 | 5 | 2024-03-14 02:40:35 | 6117.97 |
| 46 | 6 | 2024-10-05 03:19:20 | 7780.94 |
| 76 | 4 | 2024-07-27 23:19:46 | 3840.00 |
  - query: `SELECT account_id, count(*) AS debits, min(txn_time)::text AS first_txn, sum(-amount) AS total FROM transactions WHERE amount <= -500 AND txn_type IN ('card_payment', 'withdrawal') GROUP BY account_id, date_trunc('hour', txn_time) HAVING count(*) >= 4 ORDER BY account_id`
- **Same two rows with the all-rows definition: abs(amount) above 10 times the average absolute amount (opening rows excluded):** 

| txn_id | account_id | amount | description |
|---|---|---|---|
| 3203 | 1 | -2250.00 | Card purchase - Meridian Fine Jewelers |
| 2731 | 94 | -22450.00 | Large cash withdrawal at branch |
  - query: `SELECT txn_id, account_id, amount, description FROM (SELECT t.*, avg(abs(amount)) OVER (PARTITION BY account_id) AS av FROM transactions t) x WHERE abs(amount) > 10 * av AND description NOT IN ('Balance brought forward', 'Opening deposit') ORDER BY account_id`
- **Debits above 10 times the account's average debit:** 

| txn_id | account_id | amount | description |
|---|---|---|---|
| 3203 | 1 | -2250.00 | Card purchase - Meridian Fine Jewelers |
| 2731 | 94 | -22450.00 | Large cash withdrawal at branch |
  - query: `SELECT txn_id, account_id, amount, description FROM (SELECT t.*, avg(-amount) OVER (PARTITION BY account_id) AS avg_debit FROM transactions t WHERE amount < 0) x WHERE -amount > 10 * avg_debit ORDER BY account_id`
- **Loans: count and total principal per status:** `active` 23 loans, 2,082,200.00, `paid_off` 12 loans, 318,300.00, `defaulted` 5 loans, 120,800.00
  - query: `SELECT status, count(*) || ' loans, ' || sum(principal) FROM loans GROUP BY 1 ORDER BY count(*) DESC`

### Good lesson topics for this dataset

- Running balance per account with a window `SUM`; balance on a given date; month-end balances; the account with the highest balance.
- Monthly and weekly summaries (`date_trunc`), credits vs debits with `FILTER`, savings of each customer across all of their accounts.
- Joins customers -> accounts -> transactions; customers without accounts or without transactions (LEFT JOIN).
- Fraud-style detection: bursts in a short time window (`LAG`, self join on time), outliers vs the account average, merchants and categories never used before.
- Loans: monthly payment formula, remaining principal, default analysis by rate, customers with both a loan and an overdraft.
- Data-quality reasoning: paired transfers, signed amounts, accounts that stop being active.

<a id="app"></a>

## 6. app - 🏃 FitTrack

> Product analytics for a fitness app: events, funnels, retention and streaks.

FitTrack is a fitness app with 300 users, about 7,000 tracked events, subscriptions and a table of daily step counts. It is built for product analytics: funnels, weekly retention by signup cohort, sessionization, streaks (gaps and islands) and reading JSON properties. Events come in bursts (sessions) separated by hours or days of silence.

FitTrack is a product-analytics playground: an event log (`events`) with JSON `properties`, a small `subscriptions` table that agrees with the `subscription_started` events, and a table of daily step counts with deliberate gaps. Timestamps are plain `timestamp` values (no time zone, think "UTC"). "As of" date: **2024-07-31** (the end of the event log); step data covers March to May 2024.

### Tables

| table | rows | what it holds |
|---|---|---|
| `users` | 300 | People who installed FitTrack in the first half of 2024. |
| `events` | 7,010 | The raw event log of the app: one row per tap that FitTrack recorded. |
| `subscriptions` | 105 | Paid subscriptions bought by users (a user can subscribe again after cancelling). |
| `daily_steps` | 3,062 | Daily step counts for a group of 40 users who connected their step tracker (March to May 2024). Days without a row mean the tracker sent nothing. |

### Relationships

- `events.user_id` → `users.user_id`
- `subscriptions.user_id` → `users.user_id`
- `daily_steps.user_id` → `users.user_id`

### Columns

#### users  (300 rows)

People who installed FitTrack in the first half of 2024.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `user_id` | `integer` | Unique id of the user (primary key) | - | 300 | `1` to `300` |
| `signup_date` | `date` | Day the user created an account | - | 182 | `2024-01-01` to `2024-06-30` |
| `country` | `text` | Country of the user | - | 12 | `'United States'` (96), `'United Kingdom'` (38), `'India'` (34), `'Brazil'` (25), `'Germany'` (22), `'Canada'` (21), `'Japan'` (14), `'France'` (13), `'Mexico'` (10), `'Nigeria'` (10), `'Australia'` (9), `'Spain'` (8) |
| `platform` | `text` | Device platform: ios, android or web | - | 3 | `'ios'` (133), `'android'` (110), `'web'` (57) |
| `referral_source` | `text` | How the user found the app: organic, ads, friend or social | - | 4 | `'organic'` (123), `'ads'` (77), `'friend'` (50), `'social'` (50) |
| `birth_year` | `integer` | Year of birth (empty when the user did not say) | 26 (8.7%) | 39 | `1964` to `2006`, avg 1990.05 |

#### events  (7,010 rows)

The raw event log of the app: one row per tap that FitTrack recorded.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `event_id` | `bigint` | Unique id of the event (ids are in time order) (primary key) | - | 7,010 | `1` to `7010` |
| `user_id` | `integer` | User who triggered the event → users.user_id | - | 280 | `1` to `300` |
| `event_time` | `timestamp` | Date and time of the event | - | 7,008 | `2024-01-01 06:00:08` to `2024-07-31 22:40:49` |
| `event_name` | `text` | app_open, workout_started, workout_completed, goal_set, subscription_started, share or settings_changed | - | 7 | `'app_open'` (4,122), `'workout_started'` (1,413), `'workout_completed'` (923), `'goal_set'` (210), `'settings_changed'` (152), `'subscription_started'` (105), `'share'` (85) |
| `properties` | `jsonb` | Extra details about the event, stored as JSON (the keys depend on event_name) | - | 930 | JSON object (see notes) |

#### subscriptions  (105 rows)

Paid subscriptions bought by users (a user can subscribe again after cancelling).

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `subscription_id` | `integer` | Unique id of the subscription (primary key) | - | 105 | `1` to `105` |
| `user_id` | `integer` | User who subscribed → users.user_id | - | 102 | `1` to `294` |
| `plan` | `text` | monthly or annual | - | 2 | `'monthly'` (72), `'annual'` (33) |
| `price` | `numeric(6,2)` | Price paid per billing period in dollars | - | 2 | `9.99` (72), `79.99` (33) |
| `started_at` | `date` | Day the subscription started | - | 86 | `2024-01-01` to `2024-07-10` |
| `cancelled_at` | `date` | Day the subscription was cancelled (empty while still active) | 82 (78.1%) | 21 | `2024-02-06` to `2024-07-09` |

#### daily_steps  (3,062 rows)

Daily step counts for a group of 40 users who connected their step tracker (March to May 2024). Days without a row mean the tracker sent nothing.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `user_id` | `integer` | User who walked → users.user_id (part of the primary key) | - | 40 | `2` to `125` |
| `day` | `date` | The calendar day (part of the primary key) | - | 92 | `2024-03-01` to `2024-05-31` |
| `steps` | `integer` | Number of steps recorded that day | - | 2,673 | `1657` to `25000`, avg 7616.99 |

### How the data was built (distributions and rules)

- **Users:** 300 users who signed up 2024-01-01 to 2024-06-30 (per month: Jan 57, Feb 38, Mar 51, Apr 53, May 51, Jun 50; 34 of them joined in the first half of January - New Year's resolutions); platforms: ios 133, android 110, web 57; referral source: organic 123, ads 77, social 50, friend 50; top countries: United States 96, United Kingdom 38, India 34, Brazil 25, Germany 22. 26 users have no `birth_year` (the others are born 1964 to 2006).
- **Events:** 7,010 events from 2024-01-01 06:00:08 to 2024-07-31 22:40:49 by 280 users: app_open 4122 (280 users), workout_started 1413 (156 users), workout_completed 923 (133 users), goal_set 210 (161 users), settings_changed 152 (104 users), subscription_started 105 (102 users), share 85 (48 users). No event is dated before its user's signup date, and every user who has events starts with an `app_open` on the signup day.
- **Funnel (users with at least one event of the type):** opened the app 280, started a workout 156, completed a workout 133, started a subscription 102 (of 300 users; 34% subscribed). The funnel is deliberately leaky: the rest of the users opened the app but never started a workout.
- **JSON `properties`** keys per event: app_open: app_version, screen, goal_set: goal, target_per_week, settings_changed: setting, value, share: channel, subscription_started: plan, price, workout_completed: calories, duration_min, workout_type, workout_started: calories, duration_min, workout_type. Values - `screen`: home, workouts, progress, goals, profile; `app_version`: 2.4.0, 2.3.1, 2.5.0 (2.4.0 was released on 2024-03-12 and 2.5.0 on 2024-06-04; web users update immediately, mobile users update after 0-35 days, a few much later); `workout_type`: strength, swim, cycling, run, yoga; `duration_min` is 10 to 28 (integer) and `calories` is roughly duration times a per-sport rate; `goal`: lose_weight, stay_active, build_muscle with `target_per_week` 2 to 6; `plan`: monthly, annual with `price` 9.99 (monthly) or 79.99 (annual); `channel` (share): social, link, message; `setting` (settings_changed): notifications, theme, privacy, units. Use `->>` for text, `(properties->>'price')::numeric` for numbers and `properties @> '{"plan": "annual"}'` for containment. `workout_started` carries the planned duration and an estimated calorie count, `workout_completed` the actual calories.
- **Sessions.** Events arrive in bursts. Inside a session the gap between consecutive events of a user is at most **00:28:48** (hh:mm:ss) and a new session starts at least **03:06:07** after the previous event, so any inactivity timeout between 30 minutes and 3 hours gives the same answer: **4,122 sessions** (1.70 events per session on average, at most 8). Every session starts with exactly one `app_open`. A workout lasts under 30 minutes, so a workout never splits a session.
- **Retention decays by weeks since signup.** Users with any event in week 0, 1, 2, ...: week 0: 280, week 1: 163, week 2: 132, week 3: 104, week 4: 87, week 5: 67, week 6: 57, week 7: 64, week 8: 38 (later weeks are lower partly because recent cohorts have not had time to reach them). Users come back in irregular patterns, so weeks without activity in the middle are common.
- **Subscriptions:** 105 rows for 102 users, started 2024-01-01 to 2024-07-10; plans annual 33 at 79.99, monthly 72 at 9.99; cancelled: 23 (annual 2 of 33, monthly 21 of 72). A cancellation comes 30 to 154 days after the start. Each row matches exactly one `subscription_started` event of the same user, plan, price and day (and vice versa). 91 of the 105 subscriptions start within 7 days of the user's signup.
- **daily_steps:** 3,062 rows for 40 users between 2024-03-01 and 2024-05-31; `steps` 1,657 to 25,000 (average 7,617), a bit lower on weekends. A missing row means "no data that day": 3,557 user-days would be possible (each user from 2024-03-01, or from their signup day if later - 12 users start after 2024-03-01), so 495 days are missing.

### Notable facts & deliberate quirks

- **20 users have no events at all** (signed up but never opened the app) - the anti-join example; 11 of them came from ads (ad traffic is over-represented among them).
- **Re-subscribers:** users 34, 171, 219 cancelled a subscription and later subscribed again (one user, several `subscriptions` rows).
- **Workouts that were never completed:** 478 `workout_started` events have no matching `workout_completed` within 30 minutes (abandoned workouts) - good for funnel conversion by workout type.
- **Streaks / islands.** In `daily_steps` the 40 users together have 242 runs of consecutive days; the longest run is 92 days, 23 runs last 30 days or more, 23 are single days. Users with all 92 days and no gap at all: 38, 84.
- **Counts at a glance:** 280 users have events, 20 have none; 102 users have a `subscription_started` event (= users with a subscription).
- `event_id` is a `bigint` (and `jsonb` is stored in normalised form: keys may print in a different order than they were written).

### Handy facts (exact numbers, computed from the data)

- **Users who opened / started a workout / completed a workout / subscribed:** `280 / 156 / 133 / 102`
  - query: `SELECT count(DISTINCT user_id) FILTER (WHERE event_name = 'app_open') || ' / ' || count(DISTINCT user_id) FILTER (WHERE event_name = 'workout_started') || ' / ' || count(DISTINCT user_id) FILTER (WHERE event_name = 'workout_completed') || ' / ' || count(DISTINCT user_id) FILTER (WHERE event_name = 'subscription_started') FROM events`
- **Events per month:** `2024-01` 543, `2024-02` 878, `2024-03` 1,197, `2024-04` 1,153, `2024-05` 1,230, `2024-06` 1,185, `2024-07` 824
  - query: `SELECT to_char(event_time, 'YYYY-MM') AS month, count(*) FROM events GROUP BY to_char(event_time, 'YYYY-MM') ORDER BY 1`
- **Busiest weekday (0 = Sunday) by number of events:** `1` 1,119, `4` 1,099, `3` 1,086
  - query: `SELECT extract(dow FROM event_time)::int AS dow, count(*) FROM events GROUP BY 1 ORDER BY 2 DESC LIMIT 3`
- **Busiest hour of the day by number of events:** `18` 792, `19` 644, `17` 592
  - query: `SELECT extract(hour FROM event_time)::int AS hour, count(*) FROM events GROUP BY 1 ORDER BY 2 DESC LIMIT 3`
- **Sessions (30-minute inactivity rule):** `4,122`
  - query: `SELECT count(*) FROM (SELECT event_time - lag(event_time) OVER (PARTITION BY user_id ORDER BY event_time) AS gap FROM events) t WHERE gap IS NULL OR gap > interval '30 minutes'`
- **Share of users active 7-13 days after signup (week-1 retention, among users with events):** `58.2%`
  - query: `SELECT round(100.0 * count(DISTINCT e.user_id) FILTER (WHERE e.event_time::date - u.signup_date BETWEEN 7 AND 13) / count(DISTINCT e.user_id), 1) || '%' FROM events e JOIN users u ON u.user_id = e.user_id`
- **Subscription revenue booked (sum of price over all subscriptions):** `$3,358.95`
  - query: `SELECT sum(price) FROM subscriptions`
- **Median days from signup to first subscription:** `0`
  - query: `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.started_at - u.signup_date) FROM (SELECT user_id, min(started_at) AS started_at FROM subscriptions GROUP BY user_id) s JOIN users u ON u.user_id = s.user_id`
- **Average completed workout duration and calories per type:** `cycling` 19.8 min, 169 kcal, `run` 18.6 min, 197 kcal, `strength` 18.9 min, 114 kcal, `swim` 18.5 min, 167 kcal, `yoga` 19.3 min, 77 kcal
  - query: `SELECT properties->>'workout_type' AS workout_type, round(avg((properties->>'duration_min')::int), 1) || ' min, ' || round(avg((properties->>'calories')::int)) || ' kcal' FROM events WHERE event_name = 'workout_completed' GROUP BY 1 ORDER BY 1`
- **Longest streak of consecutive step-tracking days:** `user 38: 92 days`
  - query: `WITH d AS (SELECT user_id, day, day - (row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS g FROM daily_steps) SELECT 'user ' || user_id || ': ' || count(*) || ' days' FROM d GROUP BY user_id, g ORDER BY count(*) DESC, user_id LIMIT 1`

### Good lesson topics for this dataset

- Funnels (open -> workout_started -> workout_completed -> subscription) overall and by platform, referral source or country; conversion with `COUNT(DISTINCT ...) FILTER`.
- Retention: weekly cohorts by signup week, week-N retention matrices, classic "users active in week k / users in cohort".
- Sessionization with `LAG` and a running `SUM` of a new-session flag; events and duration per session.
- Gaps and islands on `daily_steps` (streaks of consecutive days) and on weekly activity.
- JSON: `->`, `->>`, `@>`, `jsonb_object_keys`, casting properties to numbers; aggregating by `properties->>'workout_type'`.
- Time-to-event: days from signup to first workout / subscription; subscription lifetime and churn.
- Anti-joins: users who never opened the app, users who started but never completed a workout.

<a id="school"></a>

## 7. school - 🏫 Maple High School

> Students, courses, exam scores and clubs: grades and rankings.

Maple High School has 120 students, 12 teachers, 18 courses and two terms of enrollments with exam results. It is a friendly place to practice averages, GROUP BY, HAVING and ranking functions, and to see how LEFT JOIN reveals students without clubs or courses without teachers. The 2025-Spring term is still in progress, so many final scores are empty.

Maple High School is a compact, easy-to-picture dataset about grades and people: students sit in courses, take quizzes, midterms and finals, and join clubs. "As of" date: **2025-04-10** (mid spring term): the 2024-Fall term is finished and its scores are final, the 2025-Spring term is still running.

### Tables

| table | rows | what it holds |
|---|---|---|
| `teachers` | 12 | The teaching staff of Maple High School. |
| `students` | 120 | Students currently enrolled at the school (grades 9 to 12). |
| `courses` | 18 | Courses offered during the 2024-25 school year. |
| `enrollments` | 626 | Which student takes which course in which term, with the final score once it is known. |
| `exam_scores` | 1,758 | Individual quiz, midterm and final exam results. |
| `clubs` | 8 | Student clubs and the teacher who advises each one. |
| `club_members` | 150 | Which students belong to which clubs. |

### Relationships

- `courses.teacher_id` → `teachers.teacher_id`
- `enrollments.student_id` → `students.student_id`
- `enrollments.course_id` → `courses.course_id`
- `exam_scores.student_id` → `students.student_id`
- `exam_scores.course_id` → `courses.course_id`
- `clubs.advisor_id` → `teachers.teacher_id`
- `club_members.club_id` → `clubs.club_id`
- `club_members.student_id` → `students.student_id`

### Columns

#### teachers  (12 rows)

The teaching staff of Maple High School.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `teacher_id` | `integer` | Unique id of the teacher (primary key) | - | 12 | `1` to `12` |
| `full_name` | `text` | Full name | - | 12 | all different (10-15 characters) |
| `subject` | `text` | Main subject the teacher is responsible for | - | 9 | 9 different values |
| `hire_date` | `date` | Day the teacher started at the school | - | 12 | `2005-08-22` to `2023-08-21` |
| `salary` | `numeric(9,2)` | Yearly salary in dollars | - | 12 | `52000.00` to `88000.00`, avg 65125.00 |

#### students  (120 rows)

Students currently enrolled at the school (grades 9 to 12).

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `student_id` | `integer` | Unique id of the student (lower ids enrolled earlier) (primary key) | - | 120 | `1` to `120` |
| `first_name` | `text` | Given name | - | 91 | 91 different values |
| `last_name` | `text` | Family name | - | 82 | 82 different values |
| `grade_level` | `integer` | Current grade: 9 (freshman) to 12 (senior) | - | 4 | `10` (30), `11` (30), `12` (30), `9` (30) |
| `birth_date` | `date` | Date of birth | - | 116 | `2006-08-29` to `2011-07-01` |
| `email` | `text` | School email address (empty if not issued yet) | 12 (10.0%) | 108 | all different (18-28 characters) |
| `enrolled_on` | `date` | First day at Maple High School | - | 12 | `'2024-08-26'` (30), `'2022-08-29'` (29), `'2023-08-28'` (28), `'2021-08-30'` (25), `'2022-06-29'` (1), `'2022-11-06'` (1), `'2023-10-19'` (1), `'2023-10-29'` (1), `'2024-02-16'` (1), `'2025-01-06'` (1), `'2025-01-07'` (1), `'2025-01-08'` (1) |

#### courses  (18 rows)

Courses offered during the 2024-25 school year.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `course_id` | `integer` | Unique id of the course (primary key) | - | 18 | `1` to `18` |
| `title` | `text` | Course title | - | 18 | all different (7-20 characters) |
| `subject` | `text` | Subject area of the course | - | 9 | `'Math'` (4), `'English'` (3), `'Science'` (3), `'History'` (2), `'Physical Education'` (2), `'Art'` (1), `'Computer Science'` (1), `'Music'` (1), `'Spanish'` (1) |
| `teacher_id` | `integer` | Teacher who teaches the course (empty if nobody is assigned yet) → teachers.teacher_id | 1 (5.6%) | 11 | `1` to `11` |
| `credits` | `integer` | Credits earned for completing the course | - | 4 | `3` (10), `2` (3), `4` (3), `1` (2) |
| `room` | `text` | Classroom where the course meets | - | 13 | 13 different values |

#### enrollments  (626 rows)

Which student takes which course in which term, with the final score once it is known.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `student_id` | `integer` | The student → students.student_id (part of the primary key) | - | 120 | `1` to `120` |
| `course_id` | `integer` | The course → courses.course_id (part of the primary key) | - | 18 | `1` to `18` |
| `term` | `text` | School term: 2024-Fall or 2025-Spring (part of the primary key) | - | 2 | `'2024-Fall'` (378), `'2025-Spring'` (248) |
| `final_score` | `numeric(5,2)` | Final course score from 0 to 100 (empty while the course is still running or the score is missing) | 248 (39.6%) | 358 | `49.45` to `100.00`, avg 77.11 |

#### exam_scores  (1,758 rows)

Individual quiz, midterm and final exam results.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `exam_id` | `integer` | Unique id of the exam result (primary key) | - | 1,758 | `1` to `1758` |
| `student_id` | `integer` | Student who took the exam → students.student_id | - | 120 | `1` to `120` |
| `course_id` | `integer` | Course the exam belongs to → courses.course_id | - | 18 | `1` to `18` |
| `exam_date` | `date` | Day the exam was taken | - | 111 | `2024-09-09` to `2025-04-02` |
| `exam_type` | `text` | quiz, midterm or final | - | 3 | `'quiz'` (754), `'midterm'` (626), `'final'` (378) |
| `score` | `numeric(5,2)` | Score from 0 to 100 | - | 461 | `40.10` to `100.00`, avg 77.98 |

#### clubs  (8 rows)

Student clubs and the teacher who advises each one.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `club_id` | `integer` | Unique id of the club (primary key) | - | 8 | `1` to `8` |
| `name` | `text` | Club name | - | 8 | all different (9-18 characters) |
| `advisor_id` | `integer` | Teacher who advises the club (empty if still looking for one) → teachers.teacher_id | 1 (12.5%) | 7 | `1` to `12` |

#### club_members  (150 rows)

Which students belong to which clubs.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `club_id` | `integer` | The club → clubs.club_id (part of the primary key) | - | 8 | `1` (30), `3` (26), `4` (22), `5` (18), `6` (16), `2` (14), `7` (14), `8` (10) |
| `student_id` | `integer` | The student → students.student_id (part of the primary key) | - | 81 | `2` to `119` |
| `joined_on` | `date` | Day the student joined the club | - | 72 | `2021-09-13` to `2025-02-10` |

### How the data was built (distributions and rules)

- **Students:** 120 students, 30 per grade level (9: 30, 10: 30, 11: 30, 12: 30). Grade 9 to 12 students were born in the school years you would expect (grade 9: September 2009 - August 2010 and so on); 9 students are a year younger or older than their grade (held back or skipped ahead). Student ids are in order of enrollment (oldest cohort first). Cohort first days: 9: first day 2024-08-26, 10: first day 2023-08-28, 11: first day 2022-08-29, 12: first day 2021-08-30; 8 students joined at another time (transfers), and 3 students (ids 118, 119, 120) joined in January 2025, so they have **no 2024-Fall enrollments**. 12 students have no email yet.
- **Teachers:** 12 teachers hired 2005-08-22 to 2023-08-21, salaries $52,000.00 to $88,000.00; subjects: Art 1, Computer Science 1, Drama 1, English 2, History 1, Math 2, Music 1, Physical Education 1, Science 2.
- **Courses:** 18 courses with 1 to 4 credits. Courses are grade-appropriate (Algebra I and English 9 are for grade 9 only, Physics and Pre-Calculus for grades 11-12, and so on), so enrollments respect the grade level. In the fall a student takes between 2 and 6 courses (2 courses: 27, 3 courses: 47, 4 courses: 33, 5 courses: 9, 6 courses: 1); this is a simplified catalog, not a full timetable.
- **Terms and scores:** 2024-Fall: 378 enrollments, 375 with a score, 2025-Spring: 248 enrollments, 3 with a score. Courses are year-long for most students (many Fall enrollments continue in Spring) but the Spring term is incomplete: `final_score` is NULL while a course is running. The only Spring scores that exist (3) are for course 16 (Health & Wellness), a half-term course that ended in March.
- **Exams:** 1,758 results between 2024-09-09 and 2025-04-02: final 378 (avg 76.1), midterm 626 (avg 77.4), quiz 754 (avg 79.4); scores run from 40.10 to 100.00. Every exam belongs to an enrollment (same student and course, exam date inside that term). Fall enrollments have 1-2 quizzes, one midterm (2024-10-14 to 2024-10-18) and one final (2024-12-09 to 2024-12-17); Spring enrollments have 1-2 quizzes (late January to early April) and a midterm (2025-03-10 to 2025-03-14), but no finals yet (except the half-term Health & Wellness course, whose midterm was in February and final in March).
- **final_score** is derived from the exams: `0.20 * average(quiz scores) + 0.35 * midterm + 0.45 * final`, rounded to 2 decimals (verified for all 378 scored enrollments; rounding differences are at most 0.01). Students differ in ability, courses differ slightly in difficulty, and scores are roughly bell-shaped around the high 70s.
- **Clubs:** 8 clubs with Robotics Club 30, Drama Society 26, Environmental Club 22, Debate Team 18, Photography Club 16, Book Club 14, Chess Club 14, Yearbook Committee 10 members (150 memberships). A student can be in several clubs (up to 5; 41 students are in two or more). Join dates fall at the start of a school year (September) or in January 2025 and never before the student enrolled.

### Notable facts & deliberate quirks

- **Course without a teacher:** 18 Spanish I (`teacher_id` is NULL) - use it for LEFT JOIN / COALESCE practice.
- **Teacher without a course:** 12 Jonas Lindqvist (Drama). Drama Society (advisor Jonas Lindqvist) - the teacher who teaches no course still advises a club.
- **Club without an advisor:** Yearbook Committee (`advisor_id` is NULL).
- **Incomplete fall enrollments:** student 30 in course 7, student 31 in course 3, student 36 in course 9 have `final_score` NULL and no final exam (the student missed the final), although the term is over.
- **Spring-only students:** 118, 119, 120 have no 2024-Fall enrollments and 39 students overall belong to no club.
- **Students without email:** 12 (NULL).
- `enrollments` has a composite primary key (student_id, course_id, term), so the same student can take the same course in both terms.
- There is no letter-grade column: letter grades (A-F) are a good CASE WHEN exercise (A = 90 and up, B = 80-89, C = 70-79, D = 60-69, F = below 60).

### Handy facts (exact numbers, computed from the data)

- **Enrollments per term:** `2024-Fall` 378, `2025-Spring` 248
  - query: `SELECT term, count(*) FROM enrollments GROUP BY 1 ORDER BY 1`
- **Average final score of 2024-Fall by course (highest first):** `Physics` 85.07, `Chemistry` 84.85, `Spanish I` 82.41, `Geometry` 81.27, `Concert Band` 81.21
  - query: `SELECT c.title, round(avg(e.final_score), 2) FROM enrollments e JOIN courses c ON c.course_id = e.course_id WHERE e.term = '2024-Fall' AND e.final_score IS NOT NULL GROUP BY c.course_id, c.title ORDER BY avg(e.final_score) DESC, c.title LIMIT 5`
- **Student with the best average final score in 2024-Fall (at least 3 scored courses):** `Ruby Kelly (student 10, 97.59)`
  - query: `SELECT s.first_name || ' ' || s.last_name || ' (student ' || s.student_id || ', ' || round(avg(e.final_score), 2) || ')' FROM enrollments e JOIN students s ON s.student_id = e.student_id WHERE e.term = '2024-Fall' AND e.final_score IS NOT NULL GROUP BY s.student_id, s.first_name, s.last_name HAVING count(*) >= 3 ORDER BY avg(e.final_score) DESC, s.student_id LIMIT 1`
- **Fall enrollments with a final score of 90 or more:** `44`
  - query: `SELECT count(*) FROM enrollments WHERE term = '2024-Fall' AND final_score >= 90`
- **Fall enrollments below 60 (failing):** `26`
  - query: `SELECT count(*) FROM enrollments WHERE term = '2024-Fall' AND final_score < 60`
- **Average exam score by exam type:** `final` 76.13, `midterm` 77.44, `quiz` 79.36
  - query: `SELECT exam_type, round(avg(score), 2) FROM exam_scores GROUP BY 1 ORDER BY 1`
- **Students with no club:** `39`
  - query: `SELECT count(*) FROM students s WHERE NOT EXISTS (SELECT 1 FROM club_members m WHERE m.student_id = s.student_id)`
- **Average teacher salary by subject (top 3):** `Science` 75,500.00, `Physical Education` 74,000.00, `Math` 68,750.00
  - query: `SELECT subject, round(avg(salary), 2) FROM teachers GROUP BY 1 ORDER BY avg(salary) DESC, subject LIMIT 3`
- **Teacher teaching the most students in 2024-Fall:** `Marcus Johnson (53 enrollments)`
  - query: `SELECT t.full_name || ' (' || count(*) || ' enrollments)' FROM enrollments e JOIN courses c ON c.course_id = e.course_id JOIN teachers t ON t.teacher_id = c.teacher_id WHERE e.term = '2024-Fall' GROUP BY t.teacher_id, t.full_name ORDER BY count(*) DESC, t.teacher_id LIMIT 1`
- **Grade-level averages of Fall final scores:** `9` 77.88, `10` 76.79, `11` 75.92, `12` 77.86
  - query: `SELECT s.grade_level, round(avg(e.final_score), 2) FROM enrollments e JOIN students s ON s.student_id = e.student_id WHERE e.term = '2024-Fall' GROUP BY 1 ORDER BY 1`

### Good lesson topics for this dataset

- AVG / MIN / MAX / COUNT with GROUP BY and HAVING: average score per course, per teacher, per grade level.
- NULL logic: in-progress courses (`final_score IS NULL`), COALESCE, AVG ignoring NULLs, COUNT(*) vs COUNT(column).
- LEFT JOIN: students in no club, courses without a teacher, teachers without courses.
- Ranking: top student per grade (`RANK`, `DENSE_RANK`, `ROW_NUMBER`), percentiles, `NTILE`, running average of a student's exams.
- CASE for letter grades; conditional aggregation (`FILTER`) for pass/fail counts.
- Many-to-many through `enrollments` and `club_members`; checking consistency between `exam_scores` and `final_score`.

<a id="messy"></a>

## 8. messy - 🧹 Messy Data Co.

> Dirty, real-world data: clean it with TRIM, LOWER, CASE, CAST and more.

Messy Data Co. exports its data from old systems, so everything arrives as text: names in odd cases, phone numbers in many formats, dates written five different ways and duplicates hiding in plain sight. Use it to practice cleaning with TRIM, LOWER, REPLACE, CASE, COALESCE, NULLIF and CAST, finding duplicates, and reshaping data with pivot and unpivot. Nothing here is secret or personal: all names and emails are made up.

Messy Data Co. is for **data cleaning**. Every business column is `text` on purpose (just as it would arrive in a CSV export), so values need `TRIM`, `LOWER`/`UPPER`, `REPLACE`, `CASE`, `NULLIF`, `COALESCE` and `CAST` before they can be compared, joined or summed. No cleaning has been done in the data itself and there is no "correct" cleaned table to look up: the lists below describe exactly what kind of dirt exists so that exercises and their expected results can be written safely. "As of" date: **2024-12-01** (orders run up to 2024-11-30).

### Tables

| table | rows | what it holds |
|---|---|---|
| `raw_customers` | 120 | A customer list exported from several old systems: inconsistent spelling, formats and duplicates. Every column is text. |
| `raw_orders` | 300 | An order export with text amounts, mixed date formats, duplicate rows and inconsistent statuses. |
| `survey_responses` | 80 | Answers to a customer survey in wide format (one column per question), also stored as messy text. |
| `product_sales_wide` | 10 | Monthly revenue per product in wide format: one column per month (a good table to unpivot). |
| `monthly_sales_long` | 60 | The same revenue figures in long format: one row per product and month (a good table to pivot). |

### Relationships

- none

### Columns

#### raw_customers  (120 rows)

A customer list exported from several old systems: inconsistent spelling, formats and duplicates. Every column is text.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `row_id` | `integer` | Row number of the import (primary key) | - | 120 | `1` to `120` |
| `full_name` | `text` | Customer name as typed (casing, spacing and order vary) | 1 (0.8%) | 117 | 117 different values |
| `email` | `text` | Email address as typed (may have capitals, spaces or be invalid) | 7 (5.8%) | 109 | 109 different values |
| `phone` | `text` | Phone number in many different formats | 10 (8.3%) | 102 | 102 different values |
| `signup_date` | `text` | Signup date as text in several different formats | 5 (4.2%) | 101 | 101 different values |
| `country` | `text` | Country name or code as typed | 6 (5.0%) | 14 | 14 different values |
| `city` | `text` | City as typed | 7 (5.8%) | 50 | 50 different values |

- Join key for `raw_orders`: `lower(btrim(email))`.
- Phone, date and country columns show the exact variants listed in "How the data was built" below.

#### raw_orders  (300 rows)

An order export with text amounts, mixed date formats, duplicate rows and inconsistent statuses.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `row_id` | `integer` | Row number of the import (primary key) | - | 300 | `1` to `300` |
| `order_ref` | `text` | Order reference such as ORD-1001 (a few are written differently or appear twice) | - | 284 | 284 different values |
| `customer_email` | `text` | Email of the customer who ordered, as typed | 8 (2.7%) | 174 | 174 different values |
| `order_date` | `text` | Order date as text in several formats | 14 (4.7%) | 246 | 246 different values |
| `amount` | `text` | Order amount as text (currency symbols, commas, spaces, N/A ...) | 10 (3.3%) | 254 | 254 different values |
| `currency` | `text` | Currency as typed: USD, usd, $, EUR ... | 1 (0.3%) | 7 | `'USD'` (195), `'usd'` (42), `'EUR'` (25), `'$'` (23), `'Usd'` (8), `''` (5), `'eur'` (1) |
| `status` | `text` | Order status with different spellings and casing | 5 (1.7%) | 17 | 17 different values |

- `row_id` is an import row number, not an order id: the same order can appear in several rows (see duplicates).

#### survey_responses  (80 rows)

Answers to a customer survey in wide format (one column per question), also stored as messy text.

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `response_id` | `integer` | Unique id of the response (primary key) | - | 80 | `1` to `80` |
| `respondent` | `text` | Who answered: an email, a short name, an id or nothing | 9 (11.3%) | 54 | 54 different values |
| `q1_satisfaction` | `text` | How satisfied are you, 1 to 5? (digits, words, blanks ...) | 5 (6.3%) | 18 | 18 different values |
| `q2_recommend` | `text` | How likely are you to recommend us, 0 to 10? | 6 (7.5%) | 17 | 17 different values |
| `q3_comment` | `text` | Free-text comment | 11 (13.8%) | 33 | 33 different values |
| `submitted` | `text` | When the survey was submitted, as text in several formats | 4 (5.0%) | 74 | 74 different values |

#### product_sales_wide  (10 rows)

Monthly revenue per product in wide format: one column per month (a good table to unpivot).

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `product` | `text` | Product name (primary key) | - | 10 | all different (7-16 characters) |
| `jan` | `numeric` | January revenue in dollars | - | 10 | `1772.65` to `19095.43`, avg 7613.09 |
| `feb` | `numeric` | February revenue in dollars | - | 10 | `1492.55` to `15908.64`, avg 6462.19 |
| `mar` | `numeric` | March revenue in dollars | - | 10 | `1618.51` to `15363.99`, avg 6282.53 |
| `apr` | `numeric` | April revenue in dollars | - | 10 | `1118.79` to `19523.22`, avg 6215.75 |
| `may` | `numeric` | May revenue in dollars | - | 10 | `1277.93` to `14381.95`, avg 5347.95 |
| `jun` | `numeric` | June revenue in dollars | - | 10 | `1172.70` to `16680.11`, avg 5623.69 |

- One row per product, one column per month, no NULLs. `monthly_sales_long` holds exactly the same 60 numbers.

#### monthly_sales_long  (60 rows)

The same revenue figures in long format: one row per product and month (a good table to pivot).

| column | type | meaning | NULLs | distinct | range / values |
|---|---|---|---|---|---|
| `product` | `text` | Product name (part of the primary key) | - | 10 | 10 different values |
| `month` | `text` | Month abbreviation: Jan to Jun (part of the primary key) | - | 6 | `'Apr'` (10), `'Feb'` (10), `'Jan'` (10), `'Jun'` (10), `'Mar'` (10), `'May'` (10) |
| `revenue` | `numeric(10,2)` | Revenue in dollars | - | 60 | `1118.79` to `19523.22`, avg 6257.53 |

### How the data was built (distributions and rules)

- **raw_customers** (120 rows) were created from 105 different people; 15 of them appear twice (written differently), which is why there are 105 + 15 = 120 rows. Cleaned, valid email addresses identify 96 distinct people; 8 email addresses occur twice, the other duplicates have to be found by name (or have a missing / broken email in one of the two rows).
- **Names** (`full_name`): 44 are all lowercase, 15 are all uppercase, others are mixed or alternating case (like `aLiCe sMiTh`), 39 have leading, trailing or repeated inner spaces, 10 are written "Last, First"; 1 NULL and 2 empty strings.
- **Emails:** 26 contain capital letters, 22 have leading or trailing spaces, 7 are NULL and 5 are empty strings; 4 are not valid addresses: 'dmitri pham@example.com', 'not-an-email', 'grace hall@example.com', 'jack.jackson.example.com'.
- **Phones** - formats: (555) 123-4567: 19, 555.123.4567: 19, 555-123-4567: 18, +1 555 123 4567: 15, international (UK/DE): 13, 5551234567: 12, NULL: 10, empty: 9, 1-555-123-4567: 5. (Canadian numbers share the US formats; UK and German numbers use `+44 20 7946 0xxx` / `+49 30 ...` styles.)
- **signup_date** (text) - formats: 2024-03-15: 51, 03/15/2024: 28, 15-Mar-2024: 16, 2024/3/5: 13, NULL: 5, unknown: 4, empty: 3. In `MM/DD/YYYY` dates, 8 could also be read as `DD/MM/YYYY` (both parts <= 12): by convention here they are month first. Dates run from 2021-01-01 to 2024-10-31.
- **country** - United States: 'U.S.', 'US', 'USA', 'United States of America', 'United States', 'us' (73 rows), Canada: 'CA', 'Canada', 'canada' (25 rows), NULL or empty (10 rows), United Kingdom: 'UK', 'United Kingdom' (8 rows), Germany: 'DE', 'germany' (4 rows); the "NULL or empty" group is 6 NULL plus 4 empty values. `CA` means Canada here (not California) and `DE` Germany. **city** has casing and spacing variants and New York appears as `NYC` / `new york city` / `New York City` in 1 row(s); 7 NULL and 1 empty.
- **raw_orders** (300 rows) contain 284 distinct orders once `order_ref` is normalised (`upper(replace(btrim(order_ref), '-', ''))`). `order_ref` formats: ORD-1001: 248, ORD1001: 27, ord-1001: 25. **10 rows are exact duplicates** of another row (everything equal except `row_id`), and **6 order refs appear twice with conflicting data** (ORD-1013, ORD-1062, ORD-1075, ORD-1090, ORD-1231, ORD1006): different amount, status or date.
- **amount** (text) - formats: 99.50: 155, $99.00: 66, padded with spaces: 36, 99 (whole number): 10, NULL: 10, N/A: 8, empty: 6, $1,234.50 (with comma): 3, negative (-45.00, -$45.00): 3, 99.5 (one decimal): 2, (45.00) accounting negative: 1. Strange values: negative amounts / refunds, and outliers '999999.99', '1000000', '0.01'. `$` and thousands separators appear only on some rows; a few amounts are in euros (see currency) but are not converted.
- **currency** - 'USD' 195, 'usd' 42, 'EUR' 25, '$' 23, 'Usd' 8, '' 5, 'eur' 1, NULL 1. **status** - delivered: ' delivered', 'DELIVERED', 'Delivered', 'delivered ', 'delivered' (179 rows), shipped: 'Shipped', 'shipped ', 'shipped' (45 rows), cancelled: 'CANCELED', 'Cancelled', 'canceled', 'cancelled' (38 rows), pending: 'PENDING', 'Pending', 'pending' (17 rows), returned: 'Returned', 'returned' (16 rows), NULL (5 rows). **order_date** - formats: 2024-03-15: 128, 03/15/2024: 67, 15-Mar-2024: 40, 2024/3/5: 28, March 15, 2024: 20, NULL: 14, empty: 3; orders run from 2023-06-01 to 2024-11-30.
- **customer_email** in `raw_orders` uses the same dirty email styles as the customer table. After cleaning, 31 order rows have an email that is not found in `raw_customers` (12 are guest checkouts such as `guest.123@example.com`; the others belong to customers whose email is missing or invalid in the customer table).
- **survey_responses** (80 rows, wide format - one column per question): `respondent` - email: 28, first name + initial: 24, customer code (cust-0042): 14, NULL: 9, anonymous: 5; `q1_satisfaction` (1-5) - digit 1-5: 47, digit with a space: 11, word (one ... five): 10, NULL: 5, empty: 4, out of range (0, 11): 2, 4/5 style: 1; `q2_recommend` (0-10) - digits 0-10: 55, NULL: 6, digits with spaces: 6, empty: 5, yes / no / maybe: 4, N/A: 3, the word ten: 1; `submitted` - 2024-05-03 14:22:10: 31, 05/03/2024: 15, May 3, 2024: 14, 2024-05-03T14:22:10Z: 13, NULL: 4, empty: 3. Comments: 11 NULL, 4 empty, 9 placeholders such as `n/a` or `none`, 8 with stray spaces. Out-of-range answers: response 8 (q1 0, q2 8), response 42 (q1 11, q2 N/A), response 64 (q1 5, q2 15).
- **product_sales_wide / monthly_sales_long:** 10 products x 6 months (Jan to Jun) = 60 long rows; the two tables contain the same 60 numbers (total $375,452.03), so unpivoting the wide table must reproduce the long table and pivoting the long table must reproduce the wide one. Month names in the long table are 3-letter English abbreviations.

### Notable facts & deliberate quirks

- **Text everywhere.** Dates, amounts and scores are text, so `ORDER BY` sorts them as strings ('10' before '9', '03/15/2024' before '12/01/2023'). Casting a dirty value directly (`'N/A'::numeric`, `'unknown'::date`) raises an error: clean first, or guard with `CASE` / `NULLIF`.
- **Empty string vs NULL.** Many columns use both: for example 2 empty and 1 NULL names, 5 empty and 7 NULL emails. `NULLIF(col, '')` and `COALESCE` are the tools; `IS NULL` alone misses the empty strings.
- **Duplicates come in two flavours:** exact duplicate rows (10 in `raw_orders`) that `DISTINCT` removes, and near-duplicates (the same person or order written differently) that only match after cleaning.
- **Case-sensitive comparisons.** Because the database collation is `C`, 'Delivered' <> 'delivered' and uppercase letters sort before lowercase ones.
- These tables intentionally have **no foreign keys** and, except for the id columns, no constraints: dirty data cannot satisfy them.

### Handy facts (exact numbers, computed from the data)

- **Rows per table:** `120 / 300 / 80 / 10 / 60`
  - query: `SELECT (SELECT count(*) FROM raw_customers) || ' / ' || (SELECT count(*) FROM raw_orders) || ' / ' || (SELECT count(*) FROM survey_responses) || ' / ' || (SELECT count(*) FROM product_sales_wide) || ' / ' || (SELECT count(*) FROM monthly_sales_long)`
- **Distinct valid emails in raw_customers after LOWER + TRIM:** `96`
  - query: `SELECT count(DISTINCT lower(btrim(email))) FROM raw_customers WHERE btrim(email) ~* '^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]+$'`
- **Email addresses that appear in more than one raw_customers row (after cleaning):** `8`
  - query: `SELECT count(*) FROM (SELECT 1 FROM raw_customers WHERE btrim(email) ~* '^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]+$' GROUP BY lower(btrim(email)) HAVING count(*) > 1) t`
- **Distinct raw_orders statuses before and after cleaning:** `17 raw, 6 cleaned`
  - query: `SELECT count(DISTINCT status) || ' raw, ' || count(DISTINCT lower(replace(replace(btrim(status), 'canceled', 'cancelled'), '  ', ' '))) || ' cleaned' FROM raw_orders`
- **Distinct raw_orders after removing exact duplicates:** `290`
  - query: `SELECT count(*) FROM (SELECT DISTINCT order_ref, customer_email, order_date, amount, currency, status FROM raw_orders) t`
- **Sum of the clean numeric amounts (plain 123.45, $-prefixed or padded amounts; no negatives, N/A or outliers):** `$54,964.08`
  - query: `SELECT round(sum(replace(replace(btrim(amount), '$', ''), ',', '')::numeric), 2) FROM raw_orders WHERE amount ~ '^\s*\$?[0-9,]+(\.[0-9]+)?\s*$' AND btrim(amount) NOT IN ('999999.99', '1000000', '0.01')`
- **Orders where amount is NULL, empty or N/A:** `24`
  - query: `SELECT count(*) FROM raw_orders WHERE amount IS NULL OR amount IN ('', 'N/A')`
- **Total revenue per product over the half year (wide table):** `Espresso Machine` 100,953.34, `Coffee Beans 1kg` 65,886.85, `Coffee Grinder` 55,218.84
  - query: `SELECT product, round(jan + feb + mar + apr + may + jun, 2) AS total FROM product_sales_wide ORDER BY total DESC LIMIT 3`
- **Best month overall (from the long table):** `Jan (76130.92)`
  - query: `SELECT month || ' (' || round(sum(revenue), 2) || ')' FROM monthly_sales_long GROUP BY month ORDER BY sum(revenue) DESC LIMIT 1`
- **Survey: answers to q1 that cast cleanly to 1-5 after TRIM:** `58`
  - query: `SELECT count(*) FROM survey_responses WHERE btrim(q1_satisfaction) ~ '^[1-5]$'`

### Good lesson topics for this dataset

- Normalising text: `TRIM`, `LOWER`, `UPPER`, `INITCAP`, `REPLACE`, `REGEXP_REPLACE`, `SPLIT_PART`; normalising phones to digits only.
- `NULLIF(col, '')`, `COALESCE`, `CASE` mapping many spellings to one canonical value (countries, statuses, currencies).
- Parsing dates and numbers from text with `CASE` on a regex (`~`) and `TO_DATE` / `::numeric`; handling `N/A` safely.
- Finding duplicates: `GROUP BY ... HAVING count(*) > 1`, `ROW_NUMBER() OVER (PARTITION BY ...)`, `DISTINCT ON`; exact vs near duplicates.
- Joining dirty keys after cleaning (`lower(btrim(...))`) and finding orphans with anti-joins.
- Reshaping: unpivot `product_sales_wide` (`UNION ALL` or `CROSS JOIN LATERAL (VALUES ...)`), pivot `monthly_sales_long` (`FILTER` or `CASE`); survey wide-to-long.

<a id="blank"></a>

## 9. blank - ✨ Blank Database

> An empty database: create your own tables from scratch.

This database starts completely empty. Use it to learn CREATE TABLE, INSERT, UPDATE, DELETE, constraints and indexes without any existing data getting in the way. Anything you create here is yours to experiment with.

This database contains **no tables**. The file `public/datasets/blank.sql` is a single comment line, so lessons start from an empty `public` schema.

### Notes for authors

- Use it for `CREATE TABLE`, `ALTER TABLE`, `INSERT`/`UPDATE`/`DELETE`, constraints and `CREATE INDEX` lessons.
- Each exercise starts from a fresh, empty database, so it is safe to assume no table exists.


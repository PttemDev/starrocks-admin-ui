import { useState } from 'react';
import { Drawer, Typography, Tag, Button, Tooltip, Alert } from 'antd';
import { QuestionCircleOutlined, CopyOutlined, BulbOutlined, ThunderboltOutlined } from '@ant-design/icons';

const { Text, Title, Paragraph } = Typography;

function CodeBlock({ children }: { children: string }) {
  return (
    <div style={{ position: 'relative', marginBottom: 8 }}>
      <pre
        style={{
          background: 'var(--sr-code-bg)',
          color: 'var(--sr-code-fg)',
          padding: '10px 14px',
          borderRadius: 6,
          fontSize: 12.5,
          lineHeight: 1.6,
          margin: 0,
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {children}
      </pre>
      <Tooltip title="Copy">
        <Button
          type="text"
          size="small"
          icon={<CopyOutlined />}
          style={{ position: 'absolute', top: 4, right: 4, color: 'var(--sr-text-muted)' }}
          onClick={() => navigator.clipboard.writeText(children)}
        />
      </Tooltip>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <Title level={5} style={{ marginBottom: 8 }}>{title}</Title>
      {children}
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <Alert
      type="info"
      showIcon
      icon={<BulbOutlined />}
      message={children}
      style={{ marginBottom: 12, borderRadius: 6 }}
    />
  );
}

function PerfTip({ children }: { children: React.ReactNode }) {
  return (
    <Alert
      type="warning"
      showIcon
      icon={<ThunderboltOutlined />}
      message={children}
      style={{ marginBottom: 12, borderRadius: 6 }}
    />
  );
}

export default function QueryGuide() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip title="StarRocks Query Guide">
        <Tag
          icon={<QuestionCircleOutlined />}
          color="purple"
          style={{ borderRadius: 4, margin: 0, cursor: 'pointer' }}
          onClick={() => setOpen(true)}
        >
          Query Guide
        </Tag>
      </Tooltip>

      <Drawer
        title="StarRocks Query Guide"
        open={open}
        onClose={() => setOpen(false)}
        width={560}
        styles={{ body: { fontSize: 13 } }}
      >
        {/* ===== SHOW COMMANDS ===== */}
        <Section title="Cluster & Schema Discovery">
          <Paragraph type="secondary">
            Use StarRocks-specific <Text code>SHOW</Text> commands to inspect cluster state and explore schemas.
          </Paragraph>
          <CodeBlock>{`-- Cluster nodes
SHOW BACKENDS;
SHOW FRONTENDS;

-- Schema discovery
SHOW DATABASES;
SHOW TABLES;
SHOW TABLES FROM db_name;

-- Table details
SHOW CREATE TABLE db_name.table_name;
SHOW PARTITIONS FROM db_name.table_name;
SHOW TABLET FROM db_name.table_name;

-- Running operations
SHOW PROCESSLIST;
SHOW PROC '/current_queries';`}</CodeBlock>

          <Tip>
            Use <Text code>SHOW CREATE TABLE</Text> to inspect a table's partitioning, bucket count, replication,
            and properties. Always review a similar table's CREATE statement before creating a new one.
          </Tip>
        </Section>

        {/* ===== EXPLAIN ===== */}
        <Section title="Query Plan & Profiling">
          <Paragraph type="secondary">
            Preview execution plans with <Text code>EXPLAIN</Text> and analyze actual runtime metrics
            with <Text code>EXPLAIN ANALYZE</Text>.
          </Paragraph>
          <CodeBlock>{`-- Execution plan (without running)
EXPLAIN SELECT * FROM tbl WHERE id > 100;

-- Verbose plan (more detail)
EXPLAIN VERBOSE SELECT * FROM tbl WHERE id > 100;

-- Actual runtime metrics
EXPLAIN ANALYZE SELECT * FROM tbl WHERE id > 100;`}</CodeBlock>

          <PerfTip>
            Always run <Text code>EXPLAIN</Text> before optimizing a slow query.
            Check <Text code>partitions</Text> and <Text code>tablets</Text> count
            in <Text code>OlapScanNode</Text> &mdash; verify that partition pruning is working.
          </PerfTip>
        </Section>

        {/* ===== SESSION VARIABLES ===== */}
        <Section title="Session Variables">
          <Paragraph type="secondary">
            Use <Text code>SET</Text> to change session-level settings. These apply only to the current connection.
          </Paragraph>
          <CodeBlock>{`-- View current values
SHOW VARIABLES;
SHOW VARIABLES LIKE '%timeout%';
SHOW VARIABLES LIKE '%mem%';
SHOW VARIABLES LIKE '%parallel%';

-- Query timeout (seconds, default: 300)
SET query_timeout = 600;

-- Memory limit (bytes)
SET exec_mem_limit = 8589934592;  -- 8 GB

-- Parallelism (recommended: CPU cores / 2)
SET parallel_fragment_exec_instance_num = 16;

-- Enable query profiling
SET enable_profile = true;

-- Timezone
SET time_zone = 'Europe/Istanbul';`}</CodeBlock>

          <Tip>
            The <strong>Query Settings &gt; Session Variables</strong> panel in this app does the same thing &mdash;
            it automatically runs <Text code>SET</Text> commands before each query.
          </Tip>
        </Section>

        {/* ===== SET_VAR HINT ===== */}
        <Section title="SET_VAR: Per-Query Settings">
          <Paragraph type="secondary">
            Override settings for a single query without modifying the session.
          </Paragraph>
          <CodeBlock>{`SELECT /*+ SET_VAR(
  query_timeout = 3600,
  exec_mem_limit = 17179869184,
  parallel_fragment_exec_instance_num = 32
) */
  user_id, COUNT(*) AS cnt
FROM events
GROUP BY user_id;`}</CodeBlock>

          <PerfTip>
            For heavy aggregation queries, use <Text code>SET_VAR</Text> to temporarily increase memory
            and parallelism. It only applies to that single query without polluting the session.
          </PerfTip>
        </Section>

        {/* ===== JOIN HINTS ===== */}
        <Section title="Join Hints">
          <Paragraph type="secondary">
            The optimizer usually picks the right join strategy, but you can override it with hints.
          </Paragraph>
          <CodeBlock>{`-- Broadcast: small table distributed to all big table nodes
SELECT /*+ BROADCAST(small_tbl) */
  a.*, b.name
FROM big_tbl a JOIN small_tbl b ON a.id = b.id;

-- Shuffle: both tables redistributed by join key
SELECT /*+ SHUFFLE(tbl_a, tbl_b) */
  a.*, b.*
FROM tbl_a a JOIN tbl_b b ON a.key = b.key;

-- Bucket Shuffle: only one table is shuffled
SELECT /*+ BUCKET_SHUFFLE(tbl_b) */
  a.*, b.*
FROM tbl_a a JOIN tbl_b b ON a.bucket_key = b.key;

-- Colocate: local join for tables with same bucket key
SELECT /*+ COLOCATE(tbl_a, tbl_b) */
  a.*, b.*
FROM tbl_a a JOIN tbl_b b ON a.key = b.key;`}</CodeBlock>

          <Tip>
            Check the <Text code>join op</Text> line in <Text code>EXPLAIN</Text> output.
            If a small table is being SHUFFLE'd instead of BROADCAST'd, try using a hint.
          </Tip>
        </Section>

        {/* ===== CTE & SUBQUERIES ===== */}
        <Section title="CTE (WITH) & Subquery Patterns">
          <CodeBlock>{`-- Readable queries with CTEs
WITH daily_stats AS (
  SELECT
    DATE_TRUNC('day', created_at) AS dt,
    COUNT(*) AS cnt,
    SUM(amount) AS total
  FROM orders
  WHERE created_at >= '2024-01-01'
  GROUP BY 1
)
SELECT dt, cnt, total,
  AVG(total) OVER (ORDER BY dt ROWS 6 PRECEDING) AS ma7
FROM daily_stats
ORDER BY dt;

-- Multiple CTEs
WITH
  active_users AS (
    SELECT user_id FROM logins
    WHERE login_date >= CURDATE() - INTERVAL 30 DAY
    GROUP BY user_id
  ),
  user_orders AS (
    SELECT user_id, COUNT(*) AS order_cnt
    FROM orders GROUP BY user_id
  )
SELECT a.user_id, COALESCE(o.order_cnt, 0) AS orders
FROM active_users a
LEFT JOIN user_orders o ON a.user_id = o.user_id;`}</CodeBlock>

          <PerfTip>
            If you use the same subquery in multiple places, move it into a CTE &mdash;
            StarRocks evaluates it once and reuses the result.
          </PerfTip>
        </Section>

        {/* ===== WINDOW FUNCTIONS ===== */}
        <Section title="Window Functions">
          <CodeBlock>{`-- Ranking
SELECT name, score,
  ROW_NUMBER() OVER (ORDER BY score DESC) AS rn,
  RANK() OVER (ORDER BY score DESC) AS rnk,
  DENSE_RANK() OVER (ORDER BY score DESC) AS drnk
FROM students;

-- Ranking within partitions
SELECT dept, name, salary,
  ROW_NUMBER() OVER (
    PARTITION BY dept ORDER BY salary DESC
  ) AS dept_rank
FROM employees;

-- Moving average & cumulative sum
SELECT dt, revenue,
  SUM(revenue) OVER (ORDER BY dt) AS cumulative,
  AVG(revenue) OVER (
    ORDER BY dt ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS ma7
FROM daily_revenue;

-- Previous / next row
SELECT dt, metric,
  LAG(metric, 1) OVER (ORDER BY dt) AS prev_day,
  LEAD(metric, 1) OVER (ORDER BY dt) AS next_day,
  metric - LAG(metric, 1) OVER (ORDER BY dt) AS daily_change
FROM metrics;`}</CodeBlock>

          <Tip>
            The <Text code>ROW_NUMBER() ... WHERE rn = 1</Text> pattern is the standard way to pick
            the first row per group. Wrap it in a CTE and filter from the outside.
          </Tip>
        </Section>

        {/* ===== ARRAY & LATERAL JOIN ===== */}
        <Section title="Array & LATERAL JOIN">
          <Paragraph type="secondary">
            Expand array columns into rows, or aggregate rows into arrays.
          </Paragraph>
          <CodeBlock>{`-- Expand array to rows
SELECT id, tag
FROM articles, LATERAL UNNEST(tags) AS t(tag);

-- Expand multiple arrays in parallel
SELECT id, k, v
FROM tbl, LATERAL UNNEST(keys, vals) AS t(k, v);

-- Array functions
SELECT
  array_length(tags) AS tag_count,
  array_contains(tags, 'featured') AS is_featured,
  array_join(tags, ', ') AS tag_list
FROM articles;

-- Aggregate rows into array
SELECT category, ARRAY_AGG(product_name) AS products
FROM products
GROUP BY category;`}</CodeBlock>
        </Section>

        {/* ===== MATERIALIZED VIEWS ===== */}
        <Section title="Materialized Views">
          <CodeBlock>{`-- List materialized views
SHOW MATERIALIZED VIEWS;

-- Create MV (async, refresh every 5 min)
CREATE MATERIALIZED VIEW mv_daily_stats
REFRESH ASYNC EVERY (INTERVAL 5 MINUTE)
AS
SELECT
  DATE_TRUNC('day', event_time) AS dt,
  event_type,
  COUNT(*) AS cnt
FROM events
GROUP BY 1, 2;

-- Manual refresh
REFRESH MATERIALIZED VIEW mv_daily_stats;

-- Check refresh task status
SELECT * FROM information_schema.task_runs
WHERE task_name LIKE '%mv_daily_stats%'
ORDER BY create_time DESC LIMIT 5;`}</CodeBlock>

          <PerfTip>
            Create MVs for frequently-used aggregation queries.
            StarRocks automatically rewrites matching queries to read from the MV instead.
          </PerfTip>
        </Section>

        {/* ===== DATA LOADING ===== */}
        <Section title="Data Loading (SQL)">
          <CodeBlock>{`-- INSERT INTO ... VALUES
INSERT INTO users (id, name, age)
VALUES (1, 'Alice', 30), (2, 'Bob', 25);

-- INSERT INTO ... SELECT (ETL)
INSERT INTO summary_table
SELECT category, COUNT(*), SUM(amount)
FROM raw_data
WHERE dt = '2024-01-01'
GROUP BY category;

-- Async task (for large ETL jobs)
SUBMIT TASK daily_etl AS
INSERT INTO daily_summary
SELECT * FROM raw_events
WHERE event_date = CURDATE() - INTERVAL 1 DAY;

-- Check task status
SELECT * FROM information_schema.task_runs
WHERE task_name = 'daily_etl';`}</CodeBlock>

          <Tip>
            Use <Text code>SUBMIT TASK</Text> for large INSERT ... SELECT jobs &mdash;
            the query runs in the background and survives connection drops.
          </Tip>
        </Section>

        {/* ===== ADMIN COMMANDS ===== */}
        <Section title="Admin & Maintenance">
          <CodeBlock>{`-- Replica status
ADMIN SHOW REPLICA STATUS FROM db.tbl;

-- Update table statistics (for optimizer)
ANALYZE TABLE db.tbl;
ANALYZE FULL TABLE db.tbl;

-- Partition management
SHOW PARTITIONS FROM db.tbl;
ALTER TABLE db.tbl
  ADD PARTITION p20240101 VALUES [('2024-01-01'), ('2024-01-02'));
ALTER TABLE db.tbl DROP PARTITION p_old;

-- Add column
ALTER TABLE db.tbl ADD COLUMN new_col VARCHAR(100) DEFAULT '';

-- Change table properties
ALTER TABLE db.tbl
  SET ("dynamic_partition.enable" = "true");`}</CodeBlock>

          <PerfTip>
            If you see bad query plans, run <Text code>ANALYZE TABLE</Text>.
            The optimizer produces much better plans with up-to-date statistics.
          </PerfTip>
        </Section>

        {/* ===== USEFUL PATTERNS ===== */}
        <Section title="Useful Query Patterns">
          <CodeBlock>{`-- Table size and row count
SHOW DATA FROM db_name.table_name;

-- Find duplicate rows
SELECT col1, col2, COUNT(*) AS cnt
FROM tbl
GROUP BY col1, col2
HAVING COUNT(*) > 1;

-- Sampling (quick exploration of large tables)
SELECT * FROM tbl TABLESAMPLE(10 PERCENT);

-- Column cardinality (distinct value counts)
SELECT
  COUNT(DISTINCT user_id) AS unique_users,
  COUNT(DISTINCT city) AS unique_cities,
  COUNT(*) AS total
FROM users;

-- NULL analysis
SELECT
  COUNT(*) AS total,
  COUNT(email) AS has_email,
  COUNT(*) - COUNT(email) AS missing_email
FROM users;

-- Generate date range (last 30 days)
WITH dates AS (
  SELECT DATE_ADD('2024-01-01', INTERVAL seq DAY) AS dt
  FROM TABLE(generate_series(0, 29)) t(seq)
)
SELECT d.dt, COALESCE(o.cnt, 0) AS orders
FROM dates d
LEFT JOIN (
  SELECT DATE(created_at) AS dt, COUNT(*) AS cnt
  FROM orders GROUP BY 1
) o ON d.dt = o.dt;`}</CodeBlock>

          <Tip>
            Use <Text code>TABLESAMPLE</Text> for fast exploratory analysis on large tables.
            It saves significant time when exact results aren't needed.
          </Tip>
        </Section>

        {/* ===== PERFORMANCE TIPS ===== */}
        <Section title="Performance Tips">
          <Alert
            type="success"
            style={{ borderRadius: 6, marginBottom: 12 }}
            message={
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li><strong>Partition pruning:</strong> Always filter on the partition column in WHERE to avoid full scans</li>
                <li><strong>Bucket key:</strong> Using bucket keys in JOIN and GROUP BY reduces data shuffling</li>
                <li><strong>Avoid SELECT *:</strong> Select only the columns you need to reduce I/O</li>
                <li><strong>Use LIMIT:</strong> Always add LIMIT for exploratory queries</li>
                <li><strong>Predicate pushdown:</strong> Push filters as deep as possible (into subqueries / JOIN ON)</li>
                <li><strong>Colocate tables:</strong> Place frequently joined tables in the same colocate group</li>
                <li><strong>Bitmap index:</strong> Add bitmap indexes on low-cardinality columns (status, type)</li>
                <li><strong>Use MVs:</strong> Create materialized views for recurring aggregation queries</li>
              </ul>
            }
          />
        </Section>
      </Drawer>
    </>
  );
}

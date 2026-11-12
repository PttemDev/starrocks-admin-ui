import { useState } from 'react';
import { Drawer, Typography, Tag, Button, Tooltip } from 'antd';
import { BookOutlined, CopyOutlined } from '@ant-design/icons';

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
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            color: 'var(--sr-text-muted)',
          }}
          onClick={() => navigator.clipboard.writeText(children)}
        />
      </Tooltip>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <Title level={5} style={{ marginBottom: 8 }}>
        {title}
      </Title>
      {children}
    </div>
  );
}

export default function JsonGuide() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip title="StarRocks JSON Query Guide">
        <Tag
          icon={<BookOutlined />}
          color="geekblue"
          style={{ borderRadius: 4, margin: 0, cursor: 'pointer' }}
          onClick={() => setOpen(true)}
        >
          JSON Guide
        </Tag>
      </Tooltip>

      <Drawer
        title="StarRocks JSON Query Guide"
        open={open}
        onClose={() => setOpen(false)}
        width={520}
        styles={{ body: { fontSize: 13 } }}
      >
        <Section title="Arrow Operator (->)">
          <Paragraph type="secondary">
            Shorthand for <Text code>json_query</Text>. Returns JSON type.
          </Paragraph>
          <CodeBlock>{`-- Basic path access
SELECT col -> '$.name' FROM tbl;

-- Nested access
SELECT col -> '$.store.book[0].title' FROM tbl;

-- Chain arrows
SELECT col -> 'a' -> 'b' FROM tbl;`}</CodeBlock>
        </Section>

        <Section title="JSON Path Syntax">
          <Paragraph type="secondary">
            Paths always start with <Text code>$</Text> (root). Use <Text code>.</Text> for keys, <Text code>[n]</Text> for array index.
          </Paragraph>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            <Tag>$ (root)</Tag>
            <Tag>$.key</Tag>
            <Tag>$.nested.key</Tag>
            <Tag>$.arr[0]</Tag>
            <Tag>$.arr[*]</Tag>
          </div>
          <CodeBlock>{`-- Examples
'$.name'              -- top-level key
'$.address.city'      -- nested key
'$.items[0]'          -- first array element
'$.items[*].price'    -- all prices in array`}</CodeBlock>
        </Section>

        <Section title="Extract Typed Values">
          <Paragraph type="secondary">
            Use <Text code>get_json_*</Text> functions to extract values as SQL types directly.
          </Paragraph>
          <CodeBlock>{`-- String
get_json_string(col, '$.user.name')

-- Integer
get_json_int(col, '$.user.age')

-- Double / Float
get_json_double(col, '$.price')

-- Boolean
get_json_bool(col, '$.active')`}</CodeBlock>
        </Section>

        <Section title="Query & Check Functions">
          <CodeBlock>{`-- Extract as JSON (same as -> operator)
json_query(col, '$.path')

-- Check if path exists (returns 1/0)
json_exists(col, '$.address')

-- Get top-level keys
json_keys(col)
-- Returns: ["name", "age", "email"]

-- Get element count
json_length(col)
json_length(col, '$.items')`}</CodeBlock>
        </Section>

        <Section title="CAST & Type Conversion">
          <Paragraph type="secondary">
            Cast between JSON and SQL types. Useful with arrow operator.
          </Paragraph>
          <CodeBlock>{`-- JSON value to SQL type
CAST(col -> '$.age' AS INT)
CAST(col -> '$.name' AS VARCHAR)

-- SQL value to JSON
CAST('{"a":1}' AS JSON)

-- Compare with cast
WHERE col -> '$.status' = CAST('active' AS JSON)`}</CodeBlock>
        </Section>

        <Section title="Constructors">
          <CodeBlock>{`-- Create JSON object
json_object('name', 'Alice', 'age', 30)

-- Create JSON array
json_array(1, 2, 3)

-- Parse string to JSON
parse_json('{"key": "value"}')`}</CodeBlock>
        </Section>

        <Section title="Modify & Transform">
          <CodeBlock>{`-- Remove a key
json_remove(col, '$.temp_field')

-- Convert JSON to string
json_string(col)

-- Expand to rows (table function)
SELECT t.key, t.value
FROM tbl, LATERAL json_each(tbl.col) t;`}</CodeBlock>
        </Section>

        <Section title="WHERE Clause Patterns">
          <CodeBlock>{`-- Filter by JSON value
WHERE get_json_string(col, '$.status') = 'active'

-- Filter by existence
WHERE json_exists(col, '$.email') = 1

-- Filter with arrow + cast
WHERE CAST(col -> '$.age' AS INT) > 18

-- NULL check on JSON path
WHERE col -> '$.field' IS NOT NULL`}</CodeBlock>
        </Section>

        <Section title="Common Patterns">
          <CodeBlock>{`-- SELECT with multiple JSON fields
SELECT
  get_json_string(data, '$.user.name') AS name,
  get_json_int(data, '$.user.age') AS age,
  data -> '$.metadata' AS meta
FROM events
WHERE json_exists(data, '$.user.name') = 1;

-- Aggregate JSON values
SELECT
  get_json_string(data, '$.category') AS cat,
  COUNT(*) AS cnt
FROM products
GROUP BY get_json_string(data, '$.category');

-- Expand JSON array to rows
SELECT
  t.id,
  j.value AS item
FROM orders t,
LATERAL json_each(t.items) j;`}</CodeBlock>
        </Section>
      </Drawer>
    </>
  );
}

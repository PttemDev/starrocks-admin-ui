import type { languages, editor, Position, IDisposable } from 'monaco-editor';
import { useSchemaStore } from '../store/schemaStore';

/** SQL keywords for autocompletion */
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS',
  'BETWEEN', 'LIKE', 'IS', 'NULL', 'AS', 'ON', 'JOIN', 'LEFT',
  'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'GROUP', 'BY',
  'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE',
  'TABLE', 'DROP', 'ALTER', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA',
  'IF', 'THEN', 'ELSE', 'WHEN', 'CASE', 'END', 'WITH', 'RECURSIVE',
  'ASC', 'DESC', 'PARTITION', 'OVER', 'WINDOW', 'ROWS', 'RANGE',
  'UNBOUNDED', 'PRECEDING', 'FOLLOWING', 'CURRENT', 'ROW',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'IFNULL',
  'CAST', 'CONVERT', 'SUBSTRING', 'CONCAT', 'TRIM', 'UPPER',
  'LOWER', 'LENGTH', 'REPLACE', 'NOW', 'DATE', 'YEAR', 'MONTH',
  'DAY', 'HOUR', 'MINUTE', 'SECOND', 'EXPLAIN', 'SHOW', 'DESCRIBE',
  'USE', 'GRANT', 'REVOKE', 'TRUNCATE', 'ROUTINE', 'LOAD',
  'BACKENDS', 'FRONTENDS', 'DATABASES', 'TABLES', 'COLUMNS',
  'PROPERTIES', 'DISTRIBUTED', 'BUCKETS', 'AGGREGATE', 'DUPLICATE',
  'PRIMARY', 'KEY', 'ENGINE', 'COMMENT', 'MATERIALIZED',
  'BITMAP', 'HLL', 'PERCENTILE', 'ARRAY', 'MAP', 'STRUCT', 'JSON',
];

/** StarRocks built-in functions */
const SR_FUNCTIONS = [
  'abs', 'acos', 'asin', 'atan', 'ceil', 'floor', 'round', 'truncate',
  'pow', 'sqrt', 'log', 'log2', 'log10', 'exp', 'mod', 'sign',
  'concat', 'concat_ws', 'length', 'char_length', 'lower', 'upper',
  'trim', 'ltrim', 'rtrim', 'lpad', 'rpad', 'reverse', 'repeat',
  'substring', 'substr', 'left', 'right', 'replace', 'regexp_replace',
  'regexp_extract', 'split', 'split_part', 'starts_with', 'ends_with',
  'instr', 'locate', 'hex', 'unhex', 'md5', 'sha2',
  'now', 'curdate', 'current_date', 'current_timestamp', 'unix_timestamp',
  'from_unixtime', 'date_format', 'str_to_date', 'date_add', 'date_sub',
  'datediff', 'timestampdiff', 'date_trunc', 'year', 'month', 'day',
  'hour', 'minute', 'second', 'dayofweek', 'dayofyear', 'weekofyear',
  'if', 'ifnull', 'nullif', 'coalesce', 'case',
  'cast', 'convert',
  'count', 'sum', 'avg', 'min', 'max', 'group_concat',
  'approx_count_distinct', 'hll_union_agg', 'bitmap_union_count',
  'percentile_approx', 'stddev', 'variance',
  'row_number', 'rank', 'dense_rank', 'ntile',
  'lead', 'lag', 'first_value', 'last_value',
  'json_query', 'json_exists', 'json_keys', 'json_length', 'json_remove',
  'json_string', 'get_json_string', 'get_json_int', 'get_json_double',
  'get_json_float', 'get_json_bool', 'get_json_object',
  'parse_json', 'json_object', 'json_array', 'json_each',
  'array_agg', 'array_contains', 'array_length', 'array_join',
  'map_keys', 'map_values', 'map_size',
  'bitmap_count', 'bitmap_union', 'bitmap_intersect', 'to_bitmap',
  'hll_hash', 'hll_cardinality',
];

/** JSON function snippets with parameter placeholders and documentation */
const JSON_SNIPPETS: Record<string, { snippet: string; doc: string }> = {
  json_query: {
    snippet: "json_query(${1:column}, '${2:\\$.path}')",
    doc: 'Extract a JSON value at the given path. Returns JSON type.\njson_query(col, \'$.store.name\')',
  },
  json_exists: {
    snippet: "json_exists(${1:column}, '${2:\\$.path}')",
    doc: 'Check if a JSON path exists. Returns 1 or 0.\njson_exists(col, \'$.address\')',
  },
  json_keys: {
    snippet: 'json_keys(${1:column})',
    doc: 'Return top-level keys as a JSON array.\njson_keys(col) -> ["name","age"]',
  },
  json_length: {
    snippet: 'json_length(${1:column})',
    doc: 'Return the length of a JSON document (number of top-level elements).\njson_length(col)',
  },
  json_each: {
    snippet: 'json_each(${1:column})',
    doc: 'Table function: expand top-level JSON elements into key-value rows.\nSELECT * FROM tbl, LATERAL json_each(col)',
  },
  json_remove: {
    snippet: "json_remove(${1:column}, '${2:\\$.path}')",
    doc: 'Remove data at the specified path.\njson_remove(col, \'$.temp_field\')',
  },
  json_string: {
    snippet: 'json_string(${1:column})',
    doc: 'Convert a JSON object to its string representation.',
  },
  json_object: {
    snippet: "json_object(${1:'key'}, ${2:value})",
    doc: "Create a JSON object from key-value pairs.\njson_object('name', 'Alice', 'age', 30)",
  },
  json_array: {
    snippet: 'json_array(${1:values})',
    doc: 'Create a JSON array from values.\njson_array(1, 2, 3)',
  },
  parse_json: {
    snippet: "parse_json('${1:json_string}')",
    doc: "Convert a string to a JSON value.\nparse_json('{\"name\":\"test\"}')",
  },
  get_json_string: {
    snippet: "get_json_string(${1:column}, '${2:\\$.path}')",
    doc: 'Extract a string value from JSON. Returns VARCHAR.\nget_json_string(col, \'$.user.name\')',
  },
  get_json_int: {
    snippet: "get_json_int(${1:column}, '${2:\\$.path}')",
    doc: 'Extract an integer value from JSON. Returns INT.\nget_json_int(col, \'$.user.age\')',
  },
  get_json_double: {
    snippet: "get_json_double(${1:column}, '${2:\\$.path}')",
    doc: 'Extract a double/float value from JSON. Returns DOUBLE.\nget_json_double(col, \'$.price\')',
  },
  get_json_float: {
    snippet: "get_json_float(${1:column}, '${2:\\$.path}')",
    doc: 'Extract a float value from JSON. Returns FLOAT.\nget_json_float(col, \'$.score\')',
  },
  get_json_bool: {
    snippet: "get_json_bool(${1:column}, '${2:\\$.path}')",
    doc: 'Extract a boolean value from JSON. Returns BOOLEAN.\nget_json_bool(col, \'$.active\')',
  },
  get_json_object: {
    snippet: "get_json_object(${1:column}, '${2:\\$.path}')",
    doc: 'Extract a JSON sub-object as string. Alias for get_json_string.\nget_json_object(col, \'$.metadata\')',
  },
};

type Monaco = typeof import('monaco-editor');

/**
 * Register a smart SQL completion provider for Monaco.
 * Returns a disposable to clean up when unmounting.
 */
export function registerSqlCompletionProvider(monaco: Monaco): IDisposable {
  return monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' ', '`'],

    provideCompletionItems(
      model: editor.ITextModel,
      position: Position,
    ): languages.ProviderResult<languages.CompletionList> {
      const { databases, tables, columns } = useSchemaStore.getState();

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      // Check if we're after a dot (db.table or table.column context)
      const lineContent = model.getLineContent(position.lineNumber);
      const textBeforeCursor = lineContent.substring(0, position.column - 1);
      const dotMatch = textBeforeCursor.match(/(?:`?(\w+)`?)\.(?:`?(\w*)`?)?$/);

      const suggestions: languages.CompletionItem[] = [];

      if (dotMatch) {
        const prefix = dotMatch[1];
        // Could be db.table or db.table.column
        // Check if prefix is a database
        if (databases.includes(prefix)) {
          const dbTables = tables[prefix] || [];
          for (const t of dbTables) {
            suggestions.push({
              label: t,
              kind: monaco.languages.CompletionItemKind.Struct,
              insertText: /[^a-zA-Z0-9_]/.test(t) ? `\`${t}\`` : t,
              detail: 'Table',
              sortText: '0' + t,
              range,
            });
          }
          // Also check for table.column pattern: prefix might be table name
        }

        // Check if prefix is a table name in any loaded db
        for (const [key, cols] of Object.entries(columns)) {
          const tableName = key.split('.').pop();
          if (tableName === prefix) {
            for (const col of cols) {
              suggestions.push({
                label: col.name,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: /[^a-zA-Z0-9_]/.test(col.name) ? `\`${col.name}\`` : col.name,
                detail: col.type,
                documentation: col.comment || undefined,
                sortText: '0' + col.name,
                range,
              });
            }
          }
        }

        if (suggestions.length > 0) {
          return { suggestions };
        }
      }

      // Check context: are we after FROM/JOIN? Suggest tables
      const textUpper = textBeforeCursor.toUpperCase();
      const afterFrom = /(?:FROM|JOIN)\s+(?:`?\w*`?\.)?`?\w*$/i.test(textBeforeCursor);
      const afterUse = /USE\s+\w*$/i.test(textBeforeCursor);

      // Database suggestions
      if (afterUse || afterFrom) {
        for (const db of databases) {
          suggestions.push({
            label: db,
            kind: monaco.languages.CompletionItemKind.Module,
            insertText: /[^a-zA-Z0-9_]/.test(db) ? `\`${db}\`` : db,
            detail: 'Database',
            sortText: '1' + db,
            range,
          });
        }
      }

      // Table suggestions from all loaded schemas
      if (afterFrom || suggestions.length === 0) {
        for (const [db, tbls] of Object.entries(tables)) {
          for (const t of tbls) {
            suggestions.push({
              label: t,
              kind: monaco.languages.CompletionItemKind.Struct,
              insertText: /[^a-zA-Z0-9_]/.test(t) ? `\`${t}\`` : t,
              detail: `Table (${db})`,
              documentation: `${db}.${t}`,
              sortText: afterFrom ? '0' + t : '3' + t,
              range,
            });
          }
        }
      }

      // Column suggestions from all loaded columns
      for (const [key, cols] of Object.entries(columns)) {
        for (const col of cols) {
          suggestions.push({
            label: col.name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: /[^a-zA-Z0-9_]/.test(col.name) ? `\`${col.name}\`` : col.name,
            detail: `${col.type} (${key})`,
            documentation: col.comment || undefined,
            sortText: '4' + col.name,
            range,
          });
        }
      }

      // SQL keywords — use Constant kind because suggest.showKeywords:false hides Keyword kind
      for (const kw of SQL_KEYWORDS) {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Constant,
          insertText: kw + ' ',
          detail: 'Keyword',
          sortText: '2' + kw,
          range,
        });
      }

      // Functions
      for (const fn of SR_FUNCTIONS) {
        const jsonSnippet = JSON_SNIPPETS[fn];
        suggestions.push({
          label: fn,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: jsonSnippet ? jsonSnippet.snippet : fn + '($0)',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: jsonSnippet ? 'JSON Function' : 'Function',
          documentation: jsonSnippet ? jsonSnippet.doc : undefined,
          sortText: '3' + fn,
          range,
        });
      }

      // Arrow operator for JSON
      suggestions.push({
        label: '-> (JSON path)',
        kind: monaco.languages.CompletionItemKind.Operator,
        insertText: "-> '\\$.${1:path}'",
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail: 'JSON arrow operator',
        documentation: "Arrow operator: shorthand for json_query.\ncol -> '$.store.name'\nEquivalent to: json_query(col, '$.store.name')",
        sortText: '3->',
        range,
      });

      return { suggestions };
    },
  });
}

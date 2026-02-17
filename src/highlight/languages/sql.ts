import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'sql',
    rules: [
      // Multi-line comments
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // Single-line comments
      { pattern: /--[^\n]*/y, token: 'comment' },
      // Strings
      { pattern: /'(?:''|[^'])*'/y, token: 'string' },
      // Backtick identifiers
      { pattern: /`[^`]*`/y, token: 'property' },
      // Double-quoted identifiers
      { pattern: /"[^"]*"/y, token: 'property' },
      // Numbers
      { pattern: /\d+\.?\d*(?:[eE][+-]?\d+)?/y, token: 'number' },
      // Keywords (case-insensitive via alternation of both forms)
      { pattern: /\b(?:SELECT|FROM|WHERE|AND|OR|NOT|IN|IS|NULL|AS|ON|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|NATURAL|USING|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|DROP|ALTER|ADD|COLUMN|INDEX|VIEW|DATABASE|SCHEMA|IF|EXISTS|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|CHECK|DEFAULT|CONSTRAINT|CASCADE|GRANT|REVOKE|TRUNCATE|BEGIN|COMMIT|ROLLBACK|TRANSACTION|SAVEPOINT|EXPLAIN|ANALYZE|WITH|RECURSIVE|CASE|WHEN|THEN|ELSE|END|LIKE|BETWEEN|ASC|DESC|NULLS|FIRST|LAST|FETCH|NEXT|ROWS|ONLY|RETURNING|CONFLICT|DO|NOTHING|REPLACE|TEMPORARY|TEMP|MATERIALIZED|LATERAL|EXCEPT|INTERSECT|WINDOW|OVER|PARTITION|RANK|ROW_NUMBER|DENSE_RANK|LEAD|LAG|FILTER|WITHIN|TRIGGER|FUNCTION|PROCEDURE|EXECUTE|CALL|DECLARE|CURSOR|OPEN|CLOSE|DEALLOCATE)\b/iy, token: 'keyword' },
      // Types
      { pattern: /\b(?:INT|INTEGER|SMALLINT|BIGINT|TINYINT|SERIAL|BIGSERIAL|DECIMAL|NUMERIC|FLOAT|REAL|DOUBLE|PRECISION|BOOLEAN|BOOL|CHAR|VARCHAR|TEXT|CLOB|BLOB|BYTEA|DATE|TIME|TIMESTAMP|TIMESTAMPTZ|INTERVAL|UUID|JSON|JSONB|XML|ARRAY|ENUM|MONEY|BIT|VARYING|ZONE)\b/iy, token: 'type' },
      // Constants
      { pattern: /\b(?:TRUE|FALSE|NULL|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|CURRENT_USER)\b/iy, token: 'constant' },
      // Functions
      { pattern: /\b(?:COUNT|SUM|AVG|MIN|MAX|COALESCE|NULLIF|CAST|CONVERT|CONCAT|LENGTH|SUBSTR|SUBSTRING|TRIM|UPPER|LOWER|REPLACE|NOW|DATE_TRUNC|EXTRACT|TO_CHAR|TO_DATE|TO_NUMBER|ROUND|CEIL|FLOOR|ABS|MOD|POWER|SQRT|RANDOM|GREATEST|LEAST|STRING_AGG|ARRAY_AGG|JSON_AGG|JSON_BUILD_OBJECT|REGEXP_MATCHES|REGEXP_REPLACE|EXISTS|ANY|SOME)\b(?=\s*\()/iy, token: 'function' },
      // Operators
      { pattern: /::|<>|[!=<>]=?|[+\-*/%]|\|\|/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];:,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('sql', create);

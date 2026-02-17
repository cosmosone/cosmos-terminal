import { registerGrammar } from './index';
import type { Grammar } from '../types';

function create(): Grammar {
  return {
    name: 'rust',
    rules: [
      // Multi-line comments (nested)
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // Single-line comments / doc comments
      { pattern: /\/\/[/!]?[^\n]*/y, token: 'comment' },
      // Attributes
      { pattern: /#!?\[[^\]]*\]/y, token: 'decorator' },
      // Raw strings r#"..."#
      { pattern: /r#+"[^]*?"#+/y, token: 'string' },
      { pattern: /r"[^"]*"/y, token: 'string' },
      // Byte strings
      { pattern: /b"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      { pattern: /b'(?:\\[\s\S]|[^'\\\n])'/y, token: 'string' },
      // Strings
      { pattern: /"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      // Char / lifetime (must distinguish)
      { pattern: /'(?:\\[\s\S]|[^'\\])'/y, token: 'string' },
      // Lifetimes
      { pattern: /'[a-zA-Z_]\w*/y, token: 'type' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F_]+(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize)?/y, token: 'number' },
      { pattern: /0[bB][01_]+(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize)?/y, token: 'number' },
      { pattern: /0[oO][0-7_]+(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize)?/y, token: 'number' },
      { pattern: /\d[\d_]*\.[\d_]+(?:[eE][+-]?\d[\d_]*)?(?:f32|f64)?/y, token: 'number' },
      { pattern: /\d[\d_]*(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64)?/y, token: 'number' },
      // Keywords
      { pattern: /\b(?:as|async|await|break|const|continue|crate|dyn|else|enum|extern|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|type|union|unsafe|use|where|while|yield)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:true|false)\b/y, token: 'constant' },
      // Built-in types
      { pattern: /\b(?:bool|char|str|u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64|String|Vec|Box|Rc|Arc|Option|Result|HashMap|HashSet|BTreeMap|BTreeSet|Cell|RefCell|Mutex|RwLock|Pin|Cow)\b/y, token: 'type' },
      // Macro invocations
      { pattern: /\b[a-zA-Z_]\w*!/y, token: 'function' },
      // Function calls
      { pattern: /\b[a-zA-Z_]\w*(?=\s*[(<])/y, token: 'function' },
      // Operators
      { pattern: /\.{2,3}=?|=>|->|::|&&|\|\||<<=?|>>=?|[!=<>]=?|[+\-*/%&|^]=?|[!~?]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];:,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('rust', create);

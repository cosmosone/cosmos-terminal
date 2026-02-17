import { registerGrammar } from './index';
import type { Grammar } from '../types';

function createC(): Grammar {
  return {
    name: 'c',
    rules: [
      // Preprocessor directives
      { pattern: /#\s*(?:include|define|undef|ifdef|ifndef|if|elif|else|endif|pragma|error|warning|line)\b[^\n]*/y, token: 'meta' },
      // Multi-line comments
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // Single-line comments
      { pattern: /\/\/[^\n]*/y, token: 'comment' },
      // Include strings
      { pattern: /<[a-zA-Z_][\w./]*>/y, token: 'string' },
      // Strings
      { pattern: /"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      // Char literals
      { pattern: /'(?:\\[\s\S]|[^'\\\n])+'/y, token: 'string' },
      // Numbers
      { pattern: /0[xX][0-9a-fA-F']+[uUlL]*/y, token: 'number' },
      { pattern: /0[bB][01']+[uUlL]*/y, token: 'number' },
      { pattern: /\d[\d']*\.[\d']*(?:[eE][+-]?\d[\d']*)?[fFlL]?/y, token: 'number' },
      { pattern: /\d[\d']*[uUlL]*/y, token: 'number' },
      // Keywords
      { pattern: /\b(?:auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|_Alignas|_Alignof|_Atomic|_Bool|_Complex|_Generic|_Imaginary|_Noreturn|_Static_assert|_Thread_local)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:true|false|NULL|EOF|stdin|stdout|stderr)\b/y, token: 'constant' },
      // Types
      { pattern: /\b(?:size_t|ssize_t|ptrdiff_t|intptr_t|uintptr_t|int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t|FILE|va_list)\b/y, token: 'type' },
      // Function calls
      { pattern: /\b[a-zA-Z_]\w*(?=\s*\()/y, token: 'function' },
      // Operators
      { pattern: /->|\.{3}|<<=?|>>=?|&&|\|\||[!=<>]=?|[+\-*/%&|^~]=?|[?:]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];:,.]/y, token: 'punctuation' },
    ],
  };
}

function createCpp(): Grammar {
  return {
    name: 'cpp',
    rules: [
      // Preprocessor directives
      { pattern: /#\s*(?:include|define|undef|ifdef|ifndef|if|elif|else|endif|pragma|error|warning|line)\b[^\n]*/y, token: 'meta' },
      // Multi-line comments
      { pattern: /\/\*[\s\S]*?\*\//y, token: 'comment' },
      // Single-line comments
      { pattern: /\/\/[^\n]*/y, token: 'comment' },
      // Raw strings R"delimiter(...)delimiter"
      { pattern: /R"([^(\s]*)\([\s\S]*?\)\1"/y, token: 'string' },
      // Include strings
      { pattern: /<[a-zA-Z_][\w./]*>/y, token: 'string' },
      // Strings
      { pattern: /"(?:\\[\s\S]|[^"\\\n])*"/y, token: 'string' },
      // Char literals
      { pattern: /'(?:\\[\s\S]|[^'\\\n])+'/y, token: 'string' },
      // Numbers (with digit separators)
      { pattern: /0[xX][0-9a-fA-F']+[uUlL]*/y, token: 'number' },
      { pattern: /0[bB][01']+[uUlL]*/y, token: 'number' },
      { pattern: /\d[\d']*\.[\d']*(?:[eE][+-]?\d[\d']*)?[fFlL]?/y, token: 'number' },
      { pattern: /\d[\d']*[uUlL]*/y, token: 'number' },
      // Keywords (C + C++)
      { pattern: /\b(?:alignas|alignof|and|and_eq|asm|auto|bitand|bitor|bool|break|case|catch|char|char8_t|char16_t|char32_t|class|compl|concept|const|consteval|constexpr|constinit|const_cast|continue|co_await|co_return|co_yield|decltype|default|delete|do|double|dynamic_cast|else|enum|explicit|export|extern|final|float|for|friend|goto|if|import|inline|int|long|module|mutable|namespace|new|noexcept|not|not_eq|nullptr|operator|or|or_eq|override|private|protected|public|register|reinterpret_cast|requires|return|short|signed|sizeof|static|static_assert|static_cast|struct|switch|template|this|thread_local|throw|try|typedef|typeid|typename|union|unsigned|using|virtual|void|volatile|wchar_t|while|xor|xor_eq)\b/y, token: 'keyword' },
      // Constants
      { pattern: /\b(?:true|false|nullptr|NULL|EOF|stdin|stdout|stderr)\b/y, token: 'constant' },
      // STL / common types
      { pattern: /\b(?:string|wstring|vector|map|unordered_map|set|unordered_set|list|deque|array|pair|tuple|optional|variant|any|shared_ptr|unique_ptr|weak_ptr|size_t|ptrdiff_t|int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t)\b/y, token: 'type' },
      // Function calls
      { pattern: /\b[a-zA-Z_]\w*(?=\s*[(<])/y, token: 'function' },
      // Operators
      { pattern: /->|\.\*|->|::|\.\.\.|<<=?|>>=?|&&|\|\||[!=<>]=?|[+\-*/%&|^~]=?|<=>|[?:]/y, token: 'operator' },
      // Punctuation
      { pattern: /[{}()\[\];:,.]/y, token: 'punctuation' },
    ],
  };
}

registerGrammar('c', createC);
registerGrammar('cpp', createCpp);

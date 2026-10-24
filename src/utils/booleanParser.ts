// Boolean Expression Tokenizer, Parser and Evaluator

export interface Token {
  type: 'VAR' | 'NOT' | 'AND' | 'OR' | 'XOR' | 'XNOR' | 'LPAREN' | 'RPAREN' | 'CONST';
  value: string;
}

export function extractVariables(expr: string): string[] {
  const matches = expr.toUpperCase().match(/[A-Z]/g);
  if (!matches) return [];
  const uniqueVars = Array.from(new Set(matches)).sort();
  // Filter out any reserved tokens if they were matched as single letters (like 'V' if used as OR, but let's allow letters A-Z)
  return uniqueVars;
}

export function tokenize(expr: string): Token[] {
  const cleanExpr = expr.trim();
  const tokens: Token[] = [];
  let i = 0;

  while (i < cleanExpr.length) {
    const ch = cleanExpr[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Check multi-character operators or keywords
    const substr = cleanExpr.slice(i).toUpperCase();
    if (substr.startsWith('XNOR')) {
      tokens.push({ type: 'XNOR', value: 'XNOR' });
      i += 4;
      continue;
    }
    if (substr.startsWith('XOR') || substr.startsWith('(+)')) {
      tokens.push({ type: 'XOR', value: 'XOR' });
      i += substr.startsWith('XOR') ? 3 : 3;
      continue;
    }
    if (substr.startsWith('AND')) {
      tokens.push({ type: 'AND', value: 'AND' });
      i += 3;
      continue;
    }
    if (substr.startsWith('OR')) {
      tokens.push({ type: 'OR', value: 'OR' });
      i += 2;
      continue;
    }
    if (substr.startsWith('NOT')) {
      tokens.push({ type: 'NOT', value: 'NOT' });
      i += 3;
      continue;
    }

    // Single character tokens
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
    } else if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
    } else if (ch === "'" || ch === '’') {
      // Postfix NOT: we handle it in preprocessing or insert NOT before previous operand
      tokens.push({ type: 'NOT', value: "'" });
      i++;
    } else if (ch === '!' || ch === '~') {
      tokens.push({ type: 'NOT', value: '!' });
      i++;
    } else if (ch === '+' || ch === '|' || ch === 'v' || ch === '∨') {
      tokens.push({ type: 'OR', value: '+' });
      i++;
    } else if (ch === '*' || ch === '&' || ch === '·' || ch === '∧' || ch === '•') {
      tokens.push({ type: 'AND', value: '*' });
      i++;
    } else if (ch === '^' || ch === '⊕') {
      tokens.push({ type: 'XOR', value: '^' });
      i++;
    } else if (ch === '⊙') {
      tokens.push({ type: 'XNOR', value: '⊙' });
      i++;
    } else if (ch === '0' || ch === '1') {
      tokens.push({ type: 'CONST', value: ch });
      i++;
    } else if (/[a-zA-Z]/.test(ch)) {
      tokens.push({ type: 'VAR', value: ch.toUpperCase() });
      i++;
    } else {
      throw new Error(`Bilinmeyen karakter: "${ch}"`);
    }
  }

  // Handle implicit ANDs and postfix NOT (')
  // Example: A B -> A AND B; A' B -> (NOT A) AND B; A(B+C) -> A AND (B+C); (A+B)(C+D) -> (A+B) AND (C+D)
  return normalizeTokens(tokens);
}

function normalizeTokens(tokens: Token[]): Token[] {
  // First convert postfix NOT (') to standard prefix NOT
  // Example: [VAR A, NOT '] -> [NOT !, VAR A]
  // Or: [(, VAR A, OR +, VAR B, ), NOT '] -> [NOT !, (, VAR A, OR +, VAR B, )]
  const postfixResolved: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'NOT' && (tok.value === "'" || tok.value === '’')) {
      // Find what it applies to in postfixResolved
      if (postfixResolved.length === 0) {
        throw new Error("Geçersiz tek tırnak (') kullanımı.");
      }
      const last = postfixResolved[postfixResolved.length - 1];
      if (last.type === 'VAR' || last.type === 'CONST') {
        // Insert NOT before this var
        postfixResolved.splice(postfixResolved.length - 1, 0, { type: 'NOT', value: '!' });
      } else if (last.type === 'RPAREN') {
        // Find matching LPAREN
        let depth = 0;
        let matchIdx = -1;
        for (let j = postfixResolved.length - 1; j >= 0; j--) {
          if (postfixResolved[j].type === 'RPAREN') depth++;
          else if (postfixResolved[j].type === 'LPAREN') {
            depth--;
            if (depth === 0) {
              matchIdx = j;
              break;
            }
          }
        }
        if (matchIdx !== -1) {
          postfixResolved.splice(matchIdx, 0, { type: 'NOT', value: '!' });
        } else {
          throw new Error("Parantez eşleşme hatası (') civarında.");
        }
      } else {
        throw new Error("Geçersiz tek tırnak (') kullanımı.");
      }
    } else {
      postfixResolved.push(tok);
    }
  }

  // Now insert implicit ANDs where appropriate:
  // (VAR | CONST | RPAREN) followed immediately by (VAR | CONST | LPAREN | NOT)
  const result: Token[] = [];
  for (let i = 0; i < postfixResolved.length; i++) {
    const current = postfixResolved[i];
    result.push(current);

    if (i < postfixResolved.length - 1) {
      const next = postfixResolved[i + 1];
      const isCurrentOperand = current.type === 'VAR' || current.type === 'CONST' || current.type === 'RPAREN';
      const isNextOperandOrPrefix = next.type === 'VAR' || next.type === 'CONST' || next.type === 'LPAREN' || next.type === 'NOT';

      if (isCurrentOperand && isNextOperandOrPrefix) {
        result.push({ type: 'AND', value: '*' });
      }
    }
  }

  return result;
}

// Shunting-Yard algorithm: Infix to RPN
export function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const opStack: Token[] = [];

  const precedence: Record<string, number> = {
    'NOT': 4,
    'AND': 3,
    'XOR': 2,
    'XNOR': 2,
    'OR': 1,
  };

  for (const token of tokens) {
    if (token.type === 'VAR' || token.type === 'CONST') {
      output.push(token);
    } else if (token.type === 'NOT') {
      opStack.push(token);
    } else if (['AND', 'OR', 'XOR', 'XNOR'].includes(token.type)) {
      while (
        opStack.length > 0 &&
        opStack[opStack.length - 1].type !== 'LPAREN' &&
        (precedence[opStack[opStack.length - 1].type] || 0) >= (precedence[token.type] || 0)
      ) {
        output.push(opStack.pop()!);
      }
      opStack.push(token);
    } else if (token.type === 'LPAREN') {
      opStack.push(token);
    } else if (token.type === 'RPAREN') {
      while (opStack.length > 0 && opStack[opStack.length - 1].type !== 'LPAREN') {
        output.push(opStack.pop()!);
      }
      if (opStack.length === 0) {
        throw new Error('Eşleşmeyen parantez kapatma hatası.');
      }
      opStack.pop(); // Remove LPAREN
      // If there was a NOT immediately preceding this group, pop it
      if (opStack.length > 0 && opStack[opStack.length - 1].type === 'NOT') {
        output.push(opStack.pop()!);
      }
    }
  }

  while (opStack.length > 0) {
    const op = opStack.pop()!;
    if (op.type === 'LPAREN') {
      throw new Error('Eşleşmeyen açılış parantezi.');
    }
    output.push(op);
  }

  return output;
}

// Evaluate RPN expression for given variable mapping
export function evaluateRPN(rpn: Token[], values: Record<string, number>): number {
  const stack: number[] = [];

  for (const token of rpn) {
    if (token.type === 'CONST') {
      stack.push(parseInt(token.value, 10));
    } else if (token.type === 'VAR') {
      const val = values[token.value];
      if (val === undefined) {
        throw new Error(`Değişken değeri bulunamadı: ${token.value}`);
      }
      stack.push(val);
    } else if (token.type === 'NOT') {
      if (stack.length < 1) throw new Error('NOT operatörü için eksik operand.');
      const a = stack.pop()!;
      stack.push(a === 1 ? 0 : 1);
    } else if (token.type === 'AND') {
      if (stack.length < 2) throw new Error('AND operatörü için eksik operand.');
      const b = stack.pop()!;
      const a = stack.pop()!;
      stack.push(a & b);
    } else if (token.type === 'OR') {
      if (stack.length < 2) throw new Error('OR operatörü için eksik operand.');
      const b = stack.pop()!;
      const a = stack.pop()!;
      stack.push(a | b);
    } else if (token.type === 'XOR') {
      if (stack.length < 2) throw new Error('XOR operatörü için eksik operand.');
      const b = stack.pop()!;
      const a = stack.pop()!;
      stack.push(a ^ b);
    } else if (token.type === 'XNOR') {
      if (stack.length < 2) throw new Error('XNOR operatörü için eksik operand.');
      const b = stack.pop()!;
      const a = stack.pop()!;
      stack.push((a ^ b) === 0 ? 1 : 0);
    }
  }

  if (stack.length !== 1) {
    throw new Error('İfade değerlendirme hatası.');
  }

  return stack[0];
}

// Helper to evaluate an expression directly
export function evaluateExpression(expr: string, values: Record<string, number>): number {
  const tokens = tokenize(expr);
  const rpn = toRPN(tokens);
  return evaluateRPN(rpn, values);
}

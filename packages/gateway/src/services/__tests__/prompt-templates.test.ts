import { describe, expect, it } from 'vitest';
import { extractFormatVariables, PromptTemplateValidationError } from '../prompt-templates.js';

describe('extractFormatVariables', () => {
  it('extracts simple {var} placeholders', () => {
    expect(extractFormatVariables('Hello {name}, {count}!')).toEqual(['count', 'name']);
  });

  it('ignores escaped braces', () => {
    expect(extractFormatVariables('Literal {{name}} and real {name}')).toEqual(['name']);
  });

  it('rejects unclosed brace', () => {
    expect(() => extractFormatVariables('Hello {name')).toThrow(PromptTemplateValidationError);
  });

  it('rejects empty placeholder', () => {
    expect(() => extractFormatVariables('Hello {}')).toThrow(PromptTemplateValidationError);
  });

  it('rejects format specs', () => {
    expect(() => extractFormatVariables('Value: {x:.2f}')).toThrow(PromptTemplateValidationError);
  });
});


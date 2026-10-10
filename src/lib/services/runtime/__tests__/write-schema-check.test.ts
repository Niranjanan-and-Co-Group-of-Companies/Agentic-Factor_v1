import { describe, it, expect } from 'vitest';
import { schemaProblems } from '../write-schema-check';

const schema = {
  input_parameters: {
    properties: {
      organization_id: {}, account_name: {},
      account_type: { enum: ['cash', 'bank', 'expense', 'accounts_payable'] },
    },
    required: ['organization_id', 'account_name', 'account_type'],
  },
};

describe('schemaProblems', () => {
  it('flags a value outside the allowed list, naming the allowed ones', () => {
    expect(schemaProblems('ZOHO_BOOKS_CREATE_CHART_OF_ACCOUNT', { organization_id: '1', account_name: 'Salaries Payable', account_type: 'other_current_liability' }, schema))
      .toEqual(['ZOHO_BOOKS_CREATE_CHART_OF_ACCOUNT: account_type="other_current_liability" is not allowed — use one of: cash, bank, expense, accounts_payable']);
  });

  it('flags unknown and missing parameters', () => {
    const problems = schemaProblems('X', { organization_id: '1', name: 'Rent' }, schema);
    expect(problems[0]).toContain('unknown parameter(s) name');
    expect(problems[1]).toContain('missing required account_name, account_type');
  });

  it('passes valid calls and placeholder ids from other deferred writes', () => {
    expect(schemaProblems('X', { organization_id: '1', account_name: 'Rent', account_type: 'expense' }, schema)).toEqual([]);
    expect(schemaProblems('X', { organization_id: 'dry-run-preview-3', account_name: 'Rent', account_type: 'expense' }, schema)).toEqual([]);
    expect(schemaProblems('X', { anything: 1 }, { input_parameters: {} })).toEqual([]);
  });
});

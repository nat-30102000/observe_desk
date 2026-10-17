import { describe, expect, it } from 'vitest';
import { describeDenied } from './api';

describe('describeDenied', () => {
  it('explains each reason the API can give', () => {
    expect(describeDenied('organization_not_approved')).toMatch(/not been approved/);
    expect(describeDenied('user_suspended')).toMatch(/suspended/);
  });
  it('falls back to a generic message', () => {
    expect(describeDenied('something_new')).toMatch(/do not have access/);
    expect(describeDenied()).toMatch(/do not have access/);
  });
});

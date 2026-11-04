import { describe, expect, it } from 'vitest'
import { emptyEngagementTerms, engagementError, engagementTotals, parseMoney } from './engagements'
import type { EngagementTerms } from './types'

const accepted = (): EngagementTerms => ({ ...emptyEngagementTerms(), feeMinor: 100000, depositMinor: 25000,
  scope: 'Five pages and lead intake', acceptedOn: '2026-01-01', acceptanceEvidence: 'Signed agreement A-10',
  invoices: [{ id: 'i1', reference: 'INV-1', amountMinor: 50000, dueDate: '2026-01-02' }],
  payments: [{ id: 'p1', invoiceId: 'i1', reference: 'TX-1', amountMinor: 25000, receivedOn: '2026-01-01' }],
  milestones: [{ id: 'm1', title: 'Launch', dueDate: '2026-01-03', status: 'planned', approvalEvidence: '' }],
})

describe('money and engagement gates', () => {
  it('parses decimal input exactly and refuses rounding, negative values, and exponent notation', () => {
    expect(parseMoney('19.99')).toBe(1999)
    expect(parseMoney('0.10')).toBe(10)
    for (const value of ['1.999', '-1', '1e3', 'NaN', '', '.5']) expect(parseMoney(value)).toBeNull()
  })
  it('separates collected revenue from issued invoices and agreed fee', () => {
    expect(engagementTotals(accepted())).toEqual({ invoiced: 50000, collected: 25000, outstanding: 25000, uninvoiced: 50000 })
  })
  it('requires acceptance evidence and the actual deposit to start delivery', () => {
    const terms = { ...accepted(), phase: 'active' as const }
    expect(engagementError(terms)).toBeNull()
    expect(engagementError({ ...terms, payments: [] })).toMatch(/deposit/)
    expect(engagementError({ ...terms, acceptanceEvidence: '' })).toMatch(/together/)
    expect(engagementError({ ...terms, depositMinor: 0, payments: [] })).toBeNull()
  })
  it('requires approved milestones with evidence to complete delivery', () => {
    const terms = { ...accepted(), phase: 'completed' as const }
    expect(engagementError(terms)).toMatch(/Approve/)
    terms.milestones[0].status = 'approved'
    expect(engagementError(terms)).toMatch(/evidence/)
    terms.milestones[0].approvalEvidence = 'Client confirmation E-12'
    expect(engagementError(terms)).toBeNull()
  })
  it('rejects invalid dates, duplicate references, overpayments and over-invoicing', () => {
    const terms = accepted()
    expect(engagementError({ ...terms, acceptedOn: '2026-02-30' })).toMatch(/valid date/)
    expect(engagementError({ ...terms, payments: [{ ...terms.payments[0], amountMinor: 50001 }] })).toMatch(/exceed/)
    expect(engagementError({ ...terms, invoices: [{ ...terms.invoices[0], amountMinor: 100001 }] })).toMatch(/agreed fee/)
    expect(engagementError({ ...terms, payments: [...terms.payments, { ...terms.payments[0], id: 'p2', reference: ' tx-1 ' }] })).toMatch(/unique/)
  })
  it('locks accepted terms and saved financial records while allowing later collection', () => {
    const previous = accepted()
    expect(engagementError({ ...previous, scope: 'Expanded scope' }, previous)).toMatch(/locked/)
    expect(engagementError({ ...previous, payments: [] }, previous)).toMatch(/cannot be changed/)
    const next = { ...previous, payments: [...previous.payments, { ...previous.payments[0], id: 'p2', reference: 'TX-2', amountMinor: 25000 }] }
    expect(engagementError(next, previous)).toBeNull()
  })
})

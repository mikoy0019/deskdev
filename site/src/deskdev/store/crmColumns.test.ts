import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'

// Revision 4, local mode: a column inserted beside another, widths, formulas.

const s = () => useStore.getState()
const names = (tableId: string) =>
  s().crmColumns.filter((c) => c.tableId === tableId).sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.name)

beforeEach(() => {
  s().resetSeed()
  useStore.setState({ currentUserId: 'u-admin' })
})

describe('crm columns', () => {
  it('inserts at a place, moving only the columns after it along', () => {
    const t = s().addCrmTable({ name: 'Pipeline' })
    s().addCrmColumn({ tableId: t, name: 'A', type: 'text' })
    s().addCrmColumn({ tableId: t, name: 'B', type: 'text' })
    s().addCrmColumn({ tableId: t, name: 'C', type: 'text' })
    const b = s().crmColumns.find((c) => c.tableId === t && c.name === 'B')!
    s().addCrmColumn({ tableId: t, name: 'Owner', type: 'person', sortOrder: b.sortOrder })
    expect(names(t)).toEqual(['A', 'Owner', 'B', 'C'])
    s().addCrmColumn({ tableId: t, name: 'Last', type: 'number' })
    expect(names(t)).toEqual(['A', 'Owner', 'B', 'C', 'Last'])
  })

  it('keeps a width and a formula, and clears the width back to the default', () => {
    const t = s().addCrmTable({ name: 'Fees' })
    const id = s().addCrmColumn({ tableId: t, name: 'Fee', type: 'formula', formula: '{Deal value} * 0.1' })
    s().updateCrmColumn(id, { width: 260 })
    expect(s().crmColumns.find((c) => c.id === id)).toMatchObject({ type: 'formula', formula: '{Deal value} * 0.1', width: 260 })
    s().updateCrmColumn(id, { width: undefined })
    expect(s().crmColumns.find((c) => c.id === id)!.width).toBeUndefined()
  })
})

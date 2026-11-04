import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Modal from '../Modal'

// Modal's focus and keyboard contract, in jsdom: who has focus after it opens,
// re-renders and closes; where Tab can go; what Enter and the buttons submit.

;(window as Window & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let opener: HTMLButtonElement
const realRects = HTMLElement.prototype.getClientRects

beforeEach(() => {
  // jsdom lays nothing out: every element reports no boxes, which Modal reads
  // as "not rendered". Give connected elements one.
  HTMLElement.prototype.getClientRects = function () {
    return (this.isConnected ? [{}] : []) as unknown as DOMRectList
  }
  opener = document.createElement('button')
  opener.textContent = 'Open'
  document.body.appendChild(opener)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  opener.remove()
  HTMLElement.prototype.getClientRects = realRects
})

const render = (node: ReactNode) => act(() => root.render(node))
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    ;(document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
    )
  })
const settle = () => act(async () => {
  await Promise.resolve()
})
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!

describe('Modal focus', () => {
  it('leaves an autofocused field focused and keeps it through re-renders', () => {
    opener.focus()
    const view = (label: string) =>
      // A new onClose every render, as every caller passes.
      h(Modal, { open: true, onClose: () => {}, title: label, children: h('input', { autoFocus: true, id: 'title' }) })
    render(view('New task'))
    expect(document.activeElement?.id).toBe('title')
    render(view('New task (edited)'))
    render(view('New task (edited again)'))
    expect(document.activeElement?.id).toBe('title')
  })

  it('takes focus on the panel when nothing inside asked for it', () => {
    opener.focus()
    render(h(Modal, { open: true, onClose: () => {}, title: 'Edit task', children: h('p', null, 'Body') }))
    expect(document.activeElement).toBe(dialog())
  })

  it('returns focus to the control that opened it, also past an autofocused field', async () => {
    opener.focus()
    const view = (open: boolean) =>
      h(Modal, { open, onClose: () => {}, title: 'New task', children: h('input', { autoFocus: true }) })
    render(view(true))
    expect(document.activeElement).not.toBe(opener)
    render(view(false))
    await settle()
    expect(document.activeElement).toBe(opener)
  })

  it('calls the latest onClose on Escape', () => {
    const first = vi.fn()
    const second = vi.fn()
    render(h(Modal, { open: true, onClose: first, title: 'T', children: h('input', { autoFocus: true }) }))
    render(h(Modal, { open: true, onClose: second, title: 'T', children: h('input', { autoFocus: true }) }))
    key('Escape')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('keeps Tab inside when the last control is disabled', () => {
    render(
      h(Modal, {
        open: true,
        onClose: () => {},
        title: 'Create channel',
        footer: [
          h('button', { key: 'c', type: 'button', id: 'cancel' }, 'Cancel'),
          h('button', { key: 's', type: 'button', id: 'create', disabled: true }, 'Create channel'),
        ],
        // Buttons only: jsdom returns a selector list's matches grouped by
        // selector, not in document order as browsers do.
        children: h('button', { type: 'button', id: 'kind' }, 'Text channel'),
      }),
    )
    document.getElementById('cancel')!.focus()
    key('Tab')
    // Wraps to the first control (the header's Close), not out of the dialog.
    expect(dialog().contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')
    key('Tab', { shiftKey: true })
    expect(document.activeElement?.id).toBe('cancel')
  })

  it('pulls focus back in when it has dropped to the page', () => {
    render(h(Modal, { open: true, onClose: () => {}, title: 'T', children: h('input', { autoFocus: true, id: 'name' }) }))
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
    key('Tab')
    expect(dialog().contains(document.activeElement)).toBe(true)
  })
})

describe('Modal onSubmit', () => {
  const form = (onSubmit: () => void, saveDisabled = false) =>
    h(Modal, {
      open: true,
      onClose: () => {},
      title: 'New client',
      onSubmit,
      footer: [
        h('button', { key: 'c', id: 'cancel' }, 'Cancel'),
        h('button', { key: 's', id: 'save', type: 'submit', disabled: saveDisabled }, 'Save'),
      ],
      children: [
        h('input', { key: 'n', id: 'name', autoFocus: true }),
        h('textarea', { key: 't', id: 'notes' }),
        h('input', { key: 'k', id: 'check', type: 'checkbox' }),
      ],
    })

  it('saves on Enter in a text field', () => {
    const save = vi.fn()
    render(form(save))
    key('Enter')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('leaves Enter alone in a textarea and on a checkbox', () => {
    const save = vi.fn()
    render(form(save))
    document.getElementById('notes')!.focus()
    key('Enter')
    document.getElementById('check')!.focus()
    key('Enter')
    expect(save).not.toHaveBeenCalled()
  })

  it('does not save on Enter while the submit button is disabled', () => {
    const save = vi.fn()
    render(form(save, true))
    key('Enter')
    expect(save).not.toHaveBeenCalled()
  })

  it('saves from the submit button, never from a button without a type', () => {
    const save = vi.fn()
    render(form(save))
    act(() => document.getElementById('cancel')!.click())
    expect(save).not.toHaveBeenCalled()
    act(() => document.getElementById('save')!.click())
    expect(save).toHaveBeenCalledTimes(1)
  })
})

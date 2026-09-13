import { describe, expect, it, vi } from 'vitest'
import { SkillLibraryController } from '../src/client/controller.ts'

describe('SkillLibraryController', () => {
  it('publishes only real visibility changes', () => {
    const controller = new SkillLibraryController()
    const listener = vi.fn()
    const dispose = controller.subscribe(listener)

    controller.show()
    controller.show()
    expect(controller.getSnapshot()).toBe(true)
    expect(listener).toHaveBeenCalledOnce()

    controller.hide()
    expect(controller.getSnapshot()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)

    dispose()
    controller.show()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

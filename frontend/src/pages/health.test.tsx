import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import HealthPage from './HealthPage'

describe('«Состояние сервисов» (Чекист 2.0, SSR markup of the first paint)', () => {
  it('is one panel: the summary in words for a screen reader, the four services as rows, «Повторить» while checking off', () => {
    const html = renderToStaticMarkup(<HealthPage />)
    expect(html).toContain('<section class="ck-panel ck-health" aria-labelledby="health-heading">')
    expect(html).toContain('<div class="ck-health-summary ck-health-loading" role="status" aria-live="polite" aria-atomic="true">')
    expect(html).toContain('<p class="ck-health-summary-title">Проверяем соединение…</p>')
    expect(html.match(/<div class="ck-health-service">/g)).toHaveLength(4)
    // Every state is a word beside its dot: the colour is never the only sign.
    expect(html.match(/<dd class="ck-health-state ck-health-tone-pending"><span class="ck-health-state-dot" aria-hidden="true"><\/span>Проверяем…<\/dd>/g)).toHaveLength(4)
    expect(html).toContain('<button type="button" class="ck-button-secondary ck-health-repeat" disabled="">Повторить</button>')
    // The old roadmap of 2026 is gone: it said the sign-in was not built yet.
    expect(html).not.toContain('Что планируется')
  })

  it('paints the states by the 2.0 tones: ok — income, degraded — over, error — error', () => {
    const css = readFileSync(new URL('./Health.css', import.meta.url), 'utf8')
    expect(css).toContain('.ck-health-summary.ck-health-ok { --health-tone: var(--ck-income); background: var(--ck-income-soft); }')
    expect(css).toContain('.ck-health-summary.ck-health-degraded { --health-tone: var(--ck-over); background: var(--ck-over-soft); }')
    expect(css).toContain('.ck-health-summary.ck-health-error { --health-tone: var(--ck-error); background: var(--ck-error-soft); }')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  })
})

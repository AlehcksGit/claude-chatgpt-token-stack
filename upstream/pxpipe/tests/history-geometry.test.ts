import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveGptProfile } from '../src/core/gpt-model-profiles.js';
import { transformAnthropicMessages } from '../src/core/library.js';

/**
 * Per-content-class render geometry: `historyStripCols` / `historyStyle` let a
 * profile render COLLAPSED HISTORY at a different density from the static slab
 * and tool-result pages, which keep `stripCols` / `style`.
 *
 * Why the two axes are not the same: geometry is shared across a provider's
 * models because the *billing* is, but verbatim reading accuracy is not. On one
 * 26-value battery (commit SHAs, 32-char md5 hashes, 3-decimal ratios, currency
 * to the cent, timestamped filenames) rendered at the shipped 312-col dense
 * geometry, Fable 5 read 25/26 exactly while Opus 5 read 3/26 with 10 silent
 * substitutions. At `jetbrains-mono-14` and 172 cols — still inside the
 * 1568x728 no-resize page — Opus 5 read 100/100. The static slab is unaffected
 * either way because it carries no such values.
 *
 * Both fields are undefined in every shipped profile, so the default path must
 * stay byte-identical.
 */

const ENV = 'PXPIPE_GPT_PROFILES';
const MODELS = 'PXPIPE_MODELS';

// The transform's model gate is orthogonal to what is being tested here; pin it
// so the assertions read `applied` rather than `unsupported_model`.
beforeEach(() => { process.env[MODELS] = 'claude-opus-5,claude-fable-5'; });
afterEach(() => { delete process.env[ENV]; delete process.env[MODELS]; });

/** A body big enough that history actually collapses. */
function bodyWithHistory(model: string): Uint8Array {
  const bulk = 'window 0 train 2024-01-15 test breakout+htf @240m d10 seed 780 bars, eligibility ok. ';
  const messages = [];
  for (let i = 0; i < 60; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'text', text: bulk.repeat(40) + ` turn ${i}` }] });
  }
  messages.push({ role: 'user', content: [{ type: 'text', text: 'continue' }] });
  return new TextEncoder().encode(JSON.stringify({
    model,
    max_tokens: 1024,
    system: [{ type: 'text', text: 'You are a coding agent. '.repeat(500), cache_control: { type: 'ephemeral' } }],
    messages,
  }));
}

describe('per-content-class render geometry', () => {
  it('ships legible history for misread-prone Claude models by default', () => {
    // Measured: Opus 3/26 exact at dense geometry, 100/100 at 172 cols
    // jetbrains-mono-14. Fable read 25/26 at dense, so it keeps the 5.28x
    // geometry; non-Claude families are untouched by this PR.
    const opus = resolveGptProfile('claude-opus-5');
    expect(opus.historyStripCols).toBe(172);
    expect(opus.historyStyle?.font).toBe('jetbrains-mono-14');
    for (const m of ['claude-fable-5', 'gpt-5.6-sol', 'moonshotai/kimi-k3']) {
      const p = resolveGptProfile(m);
      expect(p.historyStripCols, `${m} must stay dense by default`).toBeUndefined();
      expect(p.historyStyle, `${m} must stay dense by default`).toBeUndefined();
    }
  });

  it('accepts historyStripCols and historyStyle from PXPIPE_GPT_PROFILES', () => {
    process.env[ENV] = JSON.stringify({
      'claude-opus-5': { historyStripCols: 172, historyStyle: { font: 'jetbrains-mono-14' } },
    });
    const p = resolveGptProfile('claude-opus-5');
    expect(p.historyStripCols).toBe(172);
    expect(p.historyStyle?.font).toBe('jetbrains-mono-14');
    // The slab and tool-result geometry must not move with it.
    expect(p.stripCols).toBe(resolveGptProfile('claude-fable-5').stripCols);
    expect(p.style.font).toBe(resolveGptProfile('claude-fable-5').style.font);
  });

  it('leaves the dense geometry alone when only the history override is given', () => {
    const before = resolveGptProfile('claude-opus-5');
    process.env[ENV] = JSON.stringify({
      'claude-opus-5': { historyStripCols: 172, historyStyle: { font: 'jetbrains-mono-14' } },
    });
    const after = resolveGptProfile('claude-opus-5');
    expect(after.stripCols).toBe(before.stripCols);
    expect(after.maxHeightPx).toBe(before.maxHeightPx);
    expect(after.style).toEqual(before.style);
  });

  it('renders history at the legible geometry by default, costing more image tokens for the same text', async () => {
    // No env override on either side: this pins the SHIPPED defaults.
    // Fable keeps dense history; Opus gets legible out of the box.
    const dense = await transformAnthropicMessages({
      body: bodyWithHistory('claude-fable-5'),
      model: 'claude-fable-5',
    });
    expect(dense.applied, dense.reason).toBe(true);
    const denseImages = dense.info.collapsedImages ?? 0;
    expect(denseImages, 'the fixture must actually collapse history').toBeGreaterThan(0);

    const legible = await transformAnthropicMessages({
      body: bodyWithHistory('claude-opus-5'),
      model: 'claude-opus-5',
    });
    expect(legible.applied, legible.reason).toBe(true);

    // Same source text, larger glyphs: more pages. Legibility is bought with
    // image tokens, and for misread-prone models the default buys it.
    expect(legible.info.collapsedImages ?? 0).toBeGreaterThan(denseImages);
    expect(legible.info.collapsedChars).toBe(dense.info.collapsedChars);
  });

  it('never widens a page past the no-resize limit it was given', async () => {
    // A font change without a matching column reduction would overshoot 1568 px
    // and be downscaled server-side, removing exactly the legibility it bought.
    // The override carries its own cols for that reason; this pins that the
    // caller's cols still wins so the guard cannot be bypassed by a profile.
    process.env[ENV] = JSON.stringify({
      'claude-opus-5': { historyStripCols: 999, historyStyle: { font: 'jetbrains-mono-14' } },
    });
    const p = resolveGptProfile('claude-opus-5');
    expect(p.historyStripCols).toBe(999);
    const r = await transformAnthropicMessages({
      body: bodyWithHistory('claude-opus-5'),
      model: 'claude-opus-5',
      options: { cols: 172 },
    });
    expect(r.applied, r.reason).toBe(true);
  });
});

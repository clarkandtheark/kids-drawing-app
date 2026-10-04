import { test, expect, type Page } from '@playwright/test';

const open = async (page: Page, voices: [string, string][]) => {
  await page.addInitScript((voices) => {
    const spoken: unknown[] = ((window as any).__spoken = []);
    // The real utterance rejects fake voice objects, so use a plain recorder.
    (window as any).SpeechSynthesisUtterance = class {
      voice: any = null; pitch = 1; rate = 1; lang = '';
      constructor(public text: string) {}
    };
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak: (u: SpeechSynthesisUtterance) =>
          spoken.push({ voice: u.voice && u.voice.name, pitch: u.pitch, rate: u.rate, lang: u.lang }),
        cancel() {},
        getVoices: () => voices.map(([name, lang]) => ({ name, lang })),
      },
    });
  }, voices);
  await page.goto('./');
  await page.locator('.card[data-id=cat]').tap();
  await expect(page.locator('#lesson')).toBeVisible();
  return () => page.evaluate(() => (window as any).__spoken[0]);
};

test('prefers a natural voice over novelty ones, pitch 1', async ({ page }) => {
  const first = await open(page, [
    ['Albert', 'en-US'], ['Bad News', 'en-US'], ['Samantha', 'en-US'],
    ['Samantha (Enhanced)', 'en-US'], ['Zarvox', 'en-US'], ['Thomas', 'fr-FR'],
  ]);
  await expect.poll(first).toBeTruthy();
  expect(await first()).toMatchObject({ voice: 'Samantha (Enhanced)', pitch: 1, rate: 0.9, lang: 'en-US' });
});

test('only novelty voices: no explicit voice set', async ({ page }) => {
  const first = await open(page, [['Albert', 'en-US'], ['Bad News', 'en-US'], ['Zarvox', 'en_US']]);
  await expect.poll(first).toBeTruthy();
  expect((await first()).voice).toBeNull();
});

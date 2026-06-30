import { test, expect } from '@playwright/test';

test.describe('Job Detail Caching', () => {
  test('should render from cache instantly without loading flash when navigating back', async ({ page }) => {
    // 1. Initial navigation
    await page.goto('/jobs');
    
    // Find the first job link
    const jobLink = page.locator('a[href^="/jobs/"]').first();
    await expect(jobLink).toBeVisible({ timeout: 10000 });
    const href = await jobLink.getAttribute('href');
    
    // 2. Navigate to job detail (soft navigation)
    await jobLink.click();
    
    // Wait for it to fully load
    await expect(page.locator('h1.text-3xl')).toBeVisible({ timeout: 10000 });
    
    // 3. Navigate away (soft navigation using the "Back to Jobs" link)
    const backLink = page.locator('a[href="/jobs"]');
    await expect(backLink).toBeVisible();
    await backLink.click();
    
    // Wait for the jobs page to render
    await expect(page).toHaveURL(/\/jobs(?!\/)/);
    await expect(page.locator('a[href^="/jobs/"]').first()).toBeVisible();
    
    // 4. Navigate back to the same job detail
    // We expect NO full-page loading spinner to appear
    const sameJobLink = page.locator(`a[href="${href}"]`).first();
    await sameJobLink.click();
    
    // We expect the main loading spinner to NOT be visible
    // The spinner has size={48} and is centered
    const mainLoader = page.locator('.min-h-\\[60vh\\] .animate-spin');
    await expect(mainLoader).not.toBeVisible();
    
    // The content should render immediately
    await expect(page.locator('h1.text-3xl')).toBeVisible({ timeout: 1000 });
  });
});
